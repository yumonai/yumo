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

import { store } from './store.js?v=56';
import * as ai from './ai.js?v=56';

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
  loading = fetch('assets/data/letters-pool.json?v=2', { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then((d) => { pool = d.items || []; return pool; })
    .catch((e) => {
      // 关键：失败不缓存。否则第一次没拿到（比如 CDN 还没同步），
      // 之后每次点击都会拿到空池子，永远"内容池还没准备好"。
      pool = null;
      throw e;
    })
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
 * 挑今天这段的种子。
 * · 登录用户：用账号 user.id——稳定身份，令牌旋转/换设备都不变（同人同日同信）。
 * · 匿名用户：用 yumo.v1.anon——「清空这片水」会连它一起清掉，
 *   清空后就是全新的人，拿到全新的信。
 */
function pickSeed() {
  try {
    const acc = JSON.parse(localStorage.getItem('yumo.v1.account') || 'null');
    if (acc?.user?.id) return 'u:' + acc.user.id;
  } catch {}
  let anon = '';
  try { anon = localStorage.getItem('yumo.v1.anon') || ''; } catch {}
  if (!anon) {
    anon = 'a-' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem('yumo.v1.anon', anon); } catch {}
  }
  return 'a:' + anon;
}

/**
 * 挑今天这段。同一个用户同一天永远同一段；不同用户、不同日子会不同。
 * 先散列再取模，让相邻日子不会拿到相邻段落。
 */
function pickItem(dateStr) {
  if (!pool?.length) return null;
  const idx = hash(pickSeed() + '|' + dateStr) % pool.length;
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

    /* 配图与写信并行预加载——AI 写完的几秒里，图早就位，展开时顺滑现身 */
    if (item.img) {
      const im = new Image();
      im.src = item.img;
      im.decode?.().catch(() => {});
    }

    const letter = await ai.writeLetter({
      text: item.text,
      author: item.author,
      source: item.source,
      type: item.type,
      theme: item.theme,
      doi: item.doi,
      profile: store.get('profile'),
      echoes: store.get('echoes').slice(-2).map((e) => e.text),
    });

    const record = {
      date: today(),
      itemId: item.id,
      theme: item.theme,
      img: item.img || '',
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
