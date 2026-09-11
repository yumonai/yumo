/* ══════════════════════════════════════════════
   store.js —— 这片水的记忆
   一切只存在这台设备里。没有服务器，没有备份，
   没有别人。清空即真的清空。
   ══════════════════════════════════════════════ */

const NS = 'yumo.v1.';

const DEFAULTS = {
  settings: {
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash-250414', // 访客自填钥匙时的默认上游（智谱，免费档）
    temperature: 1.0,
    autoDigest: true,        // 自动提炼记忆与画像
    deepMode: false,         // 深潜模式
    soundVolume: 0.85,       // 声境总音量
    lastPreset: null,        // 上次用的氛围
    deck: 'water',           // 心象牌组：water(22) / tarot(78)
  },
  profile: {
    // Yumo 眼中的你 —— 由对话数据持续提炼
    essence: '',             // 一句话的「你」
    traits: [],              // 特质标签
    themes: [],              // 反复出现的主题
    figures: [],             // 你提到的重要的人
    seasons: [],             // 你正处的阶段
    moodTrail: [],           // [{t, v}] 情绪潮汐轨迹 0-100
    lastUpdated: 0,
    turns: 0,                // 累计对话轮数
  },
  messages: [],              // [{id, role, text, t}]
  memories: [],              // [{id, t, text, kind}]
  echoes: [],                // 收藏的金句 [{id,t,text,from}]
  journals: [],              // 潮汐记 · 每段对话的总结 [{id,t,title,text,echoes:[]}]
  drifts: [],                // 浮念 [{id,t,text,shared}]
  cards: [],                 // 心象抽牌记录 [{id,t,spread,question,cards:[]}]
  letters: [],               // 来自 Yumo 的信 [{date,itemId,title,greeting,body,question,t}]
  flags: { dived: false },
};

function read(key) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key, val) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(val));
    return true;
  } catch (e) {
    console.warn('[yumo] 写入失败', e);
    return false;
  }
}

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (over && typeof over === 'object') {
      for (const k of Object.keys(over)) {
        out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
      }
    }
    return out;
  }
  return over === undefined ? base : over;
}

const state = {};
for (const k of Object.keys(DEFAULTS)) {
  state[k] = deepMerge(DEFAULTS[k], read(k));
}

/* ── 订阅：任何写入都会通知界面 ── */
const listeners = new Set();

export const store = {
  get state() { return state; },

  /** 读取某个分区（返回引用，勿直接改写后不 save） */
  get(key) { return state[key]; },

  /** 合并写入某分区并落盘 */
  set(key, patch) {
    state[key] = deepMerge(state[key], patch);
    write(key, state[key]);
    listeners.forEach((fn) => fn(key, state[key]));
    return state[key];
  },

  /** 直接替换某分区（数组用） */
  put(key, value) {
    state[key] = value;
    write(key, value);
    listeners.forEach((fn) => fn(key, state[key]));
    return state[key];
  },

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /* ── 便捷方法 ── */

  pushMessage(msg) {
    return this.put('messages', state.messages.concat(msg).slice(-600));
  },

  pushMemory(text, kind = 'moment') {
    if (!text || !String(text).trim()) return;
    const list = state.memories.concat({
      id: uid(), t: Date.now(), text: String(text).trim(), kind,
    });
    return this.put('memories', list.slice(-60));
  },

  pushEcho(text, from = 'yumo') {
    const clean = String(text || '').trim();
    if (!clean) return;
    if (state.echoes.some((e) => e.text === clean)) return;
    const list = state.echoes.concat({ id: uid(), t: Date.now(), text: clean, from });
    return this.put('echoes', list.slice(-40));
  },

  pushDrift(text, shared = false) {
    const list = state.drifts.concat({ id: uid(), t: Date.now(), text: String(text).trim(), shared });
    return this.put('drifts', list.slice(-500));
  },

  pushCard(record) {
    const list = state.cards.concat(record);
    return this.put('cards', list.slice(-200));
  },

  pushJournal(entry) {
    const list = state.journals.concat(entry);
    return this.put('journals', list.slice(-200));
  },

  /** 情绪潮汐：记录一个 0-100 的点 */
  tide(v) {
    const trail = (state.profile.moodTrail || []).concat({ t: Date.now(), v: clamp(v, 0, 100) });
    this.set('profile', { moodTrail: trail.slice(-120) });
  },

  bumpTurns() {
    this.set('profile', { turns: (state.profile.turns || 0) + 1 });
    return state.profile.turns;
  },

  /** 把 Yumo 提炼出的画像并进来（追加去重） */
  absorbProfile(p) {
    if (!p || typeof p !== 'object') return;
    const cur = state.profile;
    /* 合并画像：去重 + 去掉互相包含的冗余（"和母亲的关系" 吃掉 "母亲"）+ 只留最近 cap 个 */
    const mergeList = (a = [], b = [], cap = 6, maxLen = 8) => {
      const raw = [...a, ...(Array.isArray(b) ? b : [])]
        .map((x) => String(x || '').trim())
        .filter((x) => x && x.length <= maxLen);
      const out = [];
      for (const x of raw) {
        // 已收的里面有包含它的（更完整），就跳过
        if (out.some((y) => y.includes(x) || x.includes(y))) continue;
        out.push(x);
      }
      return out.slice(-cap);
    };
    /* 「压力」「迷茫」这类空词不配进星图——它们说了等于没说 */
    const EMPTY_WORDS = new Set(['压力', '迷茫', '焦虑', '内耗', '情绪', '烦恼', '心事', '低落']);
    const cleanThemes = mergeList(cur.themes, (p.themes || []).filter((t) => String(t).trim().length >= 3), 5, 8)
      .filter((t) => !EMPTY_WORDS.has(t));
    const patch = {
      traits: mergeList(cur.traits, p.traits, 6, 6),
      themes: cleanThemes,
      figures: mergeList(cur.figures, p.figures, 6, 8),
      seasons: mergeList(cur.seasons, p.seasons, 4, 8),
      lastUpdated: Date.now(),
    };
    if (p.essence && String(p.essence).trim()) patch.essence = String(p.essence).trim().slice(0, 120);
    this.set('profile', patch);
  },

  /** 取最近 n 轮对话，转成上游能读的消息 */
  recentTurns(n = 16) {
    return state.messages
      .filter((m) => !m.system)
      .slice(-n * 2)
      .map((m) => ({ role: m.role === 'me' ? 'user' : 'assistant', content: m.text || '' }));
  },

  wipe() {
    for (const k of Object.keys(DEFAULTS)) localStorage.removeItem(NS + k);
    localStorage.removeItem(NS + 'anon');   // 匿名身份也一起清——清空后就是全新访客
    location.reload();
  },

  /** 导出为 JSON 字符串 */
  export() {
    return JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), data: state }, null, 2);
  },
};

/* ── 小工具 ── */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
export function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
