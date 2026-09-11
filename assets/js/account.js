/* ══════════════════════════════════════════════
   account.js —— 账户与云端同步
   ──────────────────────────────────────────────
   不引第三方库，直接走 Supabase 的 REST 接口。
   这样整个站依然是「纯静态、零构建」，也不会因为
   某个 CDN 抽风而让账户功能整个瘫掉。

   安全设计：
   · 浏览器里只放 publishableKey（设计上就是公开的）；
   · 真正的防线是数据库的行级安全——每个人只能
     读写 user_data 里 user_id 等于自己的那几行；
   · 注销账号走数据库里的安全函数 delete_own_account()，
     它只删「当前登录者自己」，别人碰不到别人的数据。
   ══════════════════════════════════════════════ */

import { store } from './store.js?v=49';
import { DEPLOY } from './config.js?v=49';

const CONF = DEPLOY.supabase || {};
export const enabled = !!(CONF.url && CONF.publishableKey);

const SESSION_KEY = 'yumo.v1.account';

/** 哪些分区要跟着账号走 */
export const SYNC_KINDS = ['settings', 'profile', 'messages', 'memories', 'echoes', 'journals', 'drifts', 'cards', 'letters', 'flags'];

let session = loadSession();
const listeners = new Set();

/* ── 会话存取 ─────────────────────────────── */

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* 存不了就算了，本次会话内还能用 */ }
}

function notify() { listeners.forEach((fn) => { try { fn(session); } catch {} }); }
export function onSession(fn) { listeners.add(fn); if (session) fn(session); return () => listeners.delete(fn); }

/** 当前登录的用户（没有就是 null） */
export function currentUser() {
  return session ? { id: session.user.id, email: session.user.email } : null;
}
export function isSignedIn() { return !!session; }

/* ── 底层请求 ─────────────────────────────── */

async function call(path, { method = 'GET', body, token, prefer } = {}) {
  const headers = { apikey: CONF.publishableKey, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(CONF.url + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;            // 让上层能区分「令牌坏了(400)」和「网络抖了」
    throw err;
  }
  return data;
}

/** 确保访问令牌还有效，快过期就换新的 */
let refreshInFlight = null;   // 单飞锁：并发请求共享同一次刷新

async function freshToken() {
  if (!session) throw new Error('未登录');
  const exp = session.expires_at || 0;
  if (exp && exp - Date.now() / 1000 > 90) return session.access_token;

  /* 关键修复：Supabase 的刷新令牌是旋转式的——同一时刻多个请求各刷一次，
     后到的会被判定「令牌复用」，整个会话家族被吊销（Invalid Refresh Token）。
     所以并发时只允许一次刷新在飞，大家共享同一个 Promise。 */
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const d = await call('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', body: { refresh_token: session.refresh_token },
        });
        session = normalize(d, session.user);
        saveSession(session);
        notify();
        return session.access_token;
      } catch (e) {
        /* 刷新端点返回 400 = 令牌已失效（过期太久 / 被判定复用 / 账号被删）——
           措辞各家不同，所以按状态码判定，不猜文案。
           本地会话作废。数据都在云端，重新登录就会回来。 */
        if (e.status === 400) {
          session = null; saveSession(null); notify();
          throw new Error('登录状态已过期，请重新登录。你的一切都还在云端，登录后就会回来。');
        }
        throw e;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

function normalize(d, fallbackUser) {
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user: d.user || fallbackUser || null,
  };
}

/* ── 注册 / 登录 / 退出 ────────────────────── */

export async function signUp(email, password) {
  const d = await call('/auth/v1/signup', { method: 'POST', body: { email, password } });
  if (!d.access_token) {
    // 需要邮箱确认（我们把它关了，但留着兜底）
    return { ok: true, needsConfirm: true };
  }
  session = normalize(d);
  saveSession(session); notify();
  return { ok: true };
}

export async function signIn(email, password) {
  const d = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  session = normalize(d);
  saveSession(session); notify();
  return { ok: true };
}

export async function signOut() {
  try { await call('/auth/v1/logout', { method: 'POST', token: await freshToken() }); } catch {}
  session = null; saveSession(null); notify();
}

/** 彻底注销：删掉云端账号与全部数据，不可恢复 */
export async function deleteAccount() {
  try {
    await call('/rest/v1/rpc/delete_own_account', { method: 'POST', token: await freshToken() });
  } catch (e) {
    if (/登录状态已过期/.test(String(e.message))) throw e;   // 让用户先重新登录
    throw e;
  }
  session = null; saveSession(null); notify();
}

/* ── 云端 ↔ 本地 同步 ──────────────────────── */

let silent = false;          // 拉取时不回推，避免无意义的绕圈
const pending = new Map();   // kind → timer

/** 从云端拉，覆盖本地（云端有内容的那几类才覆盖） */
export async function pullFromCloud() {
  const token = await freshToken();
  const uid = session.user.id;
  const rows = await call(`/rest/v1/user_data?select=kind,data&user_id=eq.${uid}`, { token }) || [];
  silent = true;
  try {
    for (const row of rows) {
      if (!SYNC_KINDS.includes(row.kind)) continue;
      const cloud = row.data;
      const empty = cloud == null ||
        (Array.isArray(cloud) && cloud.length === 0) ||
        (typeof cloud === 'object' && !Array.isArray(cloud) && Object.keys(cloud).length === 0);
      if (empty) continue;
      store.put(row.kind, cloud);
    }
  } finally { silent = false; }
  return rows.map((r) => r.kind);
}

/** 把某一类推上云端 */
export async function pushKind(kind) {
  if (!SYNC_KINDS.includes(kind)) return;
  const token = await freshToken();
  const uid = session.user.id;
  const data = store.get(kind);
  await call('/rest/v1/user_data?on_conflict=user_id,kind', {
    method: 'POST', token,
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_id: uid, kind, data, updated_at: new Date().toISOString() },
  });
}

/** 双向同步：先拉，再把云端没有的推上去 */
export async function syncAll() {
  const pulled = await pullFromCloud();
  const missing = SYNC_KINDS.filter((k) => !pulled.includes(k));
  for (const k of missing) await pushKind(k);
  return { pulled, pushed: missing };
}

/** 本地有变动时，延迟一点再推（别每敲一个字都发请求） */
function schedulePush(kind) {
  if (silent || !session) return;
  clearTimeout(pending.get(kind));
  pending.set(kind, setTimeout(() => {
    pending.delete(kind);
    pushKind(kind).catch((e) => console.warn('[yumo] 云端同步失败：', e.message));
  }, 2500));
}

// 任何分区被写入就排队上传
store.on((key) => { if (session && SYNC_KINDS.includes(key)) schedulePush(key); });

// 标签页重新可见 / 网络恢复时，换新令牌
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session) freshToken().catch(() => {});
});
