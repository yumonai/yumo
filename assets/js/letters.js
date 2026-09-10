/* ══════════════════════════════════════════════
   letters.js —— 来自 Yumo 的信
   ──────────────────────────────────────────────
   每天一封。用户进站就生成，但绝不推送、不弹窗，
   全凭他自己点开。看完当天不再换。

   真实性是这条产品的底线：
   · 引文只能来自仓库里的内容池（assets/data/letters-pool.json），
     每一段都标了真实出处，14 篇论文的 DOI 逐条联网核实过；
   · AI 只负责「用这段文字去解读和提问」，提示词硬性禁止自创引文；
   · 用户画像为空时，Yumo 用初见的语气写，绝不硬编一个画像。
   ══════════════════════════════════════════════ */

import { store } from './store.js';
import * as ai from './ai.js';

let pool = null;          // 内容池
let loading = null;       // 防止并发重复加载
const listeners = new Set();

const today = () => new Date().toISOString().slice(0, 10);
const state = () => store.get('letters');

function notify() { listeners.forEach((fn) => { try { fn(todayLetter()); } catch {} }); }
export function onLetter(fn) { listeners.add(fn); fn(todayLetter()); return () => listeners.delete(fn); }

async function ensurePool() {
  if (pool) return pool;
  if (loading) return loading;
  loading = fetch('assets/data/letters-pool.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then((d) => { pool = d.items || []; return pool; })
    .catch(() => { pool = []; return pool; })
    .finally(() => { loading = null; });
  return loading;
}

/** 确定性哈希：同人同日永远同一段 */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * 挑今天这段。同一个用户同一天永远同一段；不同用户、不同日子会不同。
 * 以用户的 userId（登录）或浏览器里的匿名 id 为种子。
 */
function pickItem(dateStr) {
  if (!pool?.length) return null;
  let uid = '';
  try { uid = localStorage.getItem('yumo.v1.account') || localStorage.getItem('yumo.v1.anon') || ''; } catch {}
  if (!uid) {
    uid = 'anon-' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem('yumo.v1.anon', uid); } catch {}
  }
  // 先散列再取模，让相邻日子不会拿到相邻段落
  const idx = hash(uid + '|' + dateStr) % pool.length;
  return pool[idx];
}

/** 今天已生成过的信（对象）或 null */
export function todayLetter() {
  const d = today();
  return state().find((l) => l.date === d) || null;
}

/** 是否正在生成 */
let busy = false;
export function isBusy() { return busy; }

/**
 * 拿今天的信：有缓存就给缓存，没有就生成一份。
 * 生成失败会抛错，由调用方决定怎么提示。
 */
export async function ensureToday({ force = false } = {}) {
  const cached = todayLetter();
  if (cached && !force) return cached;

  if (busy) return null;
  busy = true; notify();
  try {
    await ensurePool();
    const item = pickItem(today());
    if (!item) throw new Error('内容池还没准备好。');

    const letter = await ai.writeLetter({
      text: item.text,
      author: item.author,
      source: item.source,
      type: item.type,
      theme: item.theme,
      doi: item.doi,
      profile: store.get('profile'),
    });

    const record = {
      date: today(),
      itemId: item.id,
      theme: item.theme,
      author: item.author,
      source: item.source,
      text: item.text,
      ...letter,
      t: Date.now(),
    };
    // 同一天的旧记录（比如强制重写）先拿掉
    store.put('letters', state().filter((l) => l.date !== record.date).concat(record));
    notify();
    return record;
  } finally {
    busy = false; notify();
  }
}

/** 把今天的信的问题带进对话页 */
export function replyContext() {
  const l = todayLetter();
  return l ? `读了今天那封关于「${l.theme}」的信，` : '';
}
