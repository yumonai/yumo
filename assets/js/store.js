/* ══════════════════════════════════════════════
   store.js —— 这片水的记忆
   一切只存在这台设备里。没有服务器，没有备份，
   没有别人。清空即真的清空。
   ══════════════════════════════════════════════ */

const NS = 'yumo.v1.';

const DEFAULTS = {
  settings: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash', // DeepSeek V4.1 Flash · 原生多模态
    temperature: 1.0,
    speakReplies: false,     // 自动朗读 Yumo 的回复
    speakRate: 1.0,
    voiceName: '',
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
  messages: [],              // [{id, role, text, images:[], t, mood}]
  memories: [],              // [{id, t, text, kind}]
  echoes: [],                // 收藏的金句 [{id,t,text,from}]
  journals: [],              // 潮汐记 · 每段对话的总结 [{id,t,title,text,echoes:[]}]
  drifts: [],                // 浮念 [{id,t,text,shared}]
  cards: [],                 // 心象抽牌记录 [{id,t,spread,question,cards:[]}]
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
    let ok = write(key, value);
    // 图片是 base64，很容易把 localStorage 撑爆。写不进去时先卸下历史图片再试一次。
    if (!ok && key === 'messages') {
      state[key] = value.map((m) => (m.images && m.images.length ? { ...m, images: [] } : m));
      ok = write(key, state[key]);
      if (ok) console.info('[yumo] 空间不够，已经把旧的图片卸下来了。');
    }
    listeners.forEach((fn) => fn(key, state[key]));
    return state[key];
  },

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /* ── 便捷方法 ── */

  pushMessage(msg) {
    let list = state.messages.concat(msg).slice(-600);
    // base64 图片很占地方，只留最近 4 条带图消息的图，其余保留文字
    const withImg = list.filter((m) => m.images && m.images.length);
    if (withImg.length > 4) {
      const drop = new Set(withImg.slice(0, withImg.length - 4).map((m) => m.id));
      list = list.map((m) => (drop.has(m.id) ? { ...m, images: [] } : m));
    }
    return this.put('messages', list);
  },

  pushMemory(text, kind = 'moment') {
    if (!text || !String(text).trim()) return;
    const list = state.memories.concat({
      id: uid(), t: Date.now(), text: String(text).trim(), kind,
    });
    return this.put('memories', list.slice(-400));
  },

  pushEcho(text, from = 'yumo') {
    const clean = String(text || '').trim();
    if (!clean) return;
    if (state.echoes.some((e) => e.text === clean)) return;
    const list = state.echoes.concat({ id: uid(), t: Date.now(), text: clean, from });
    return this.put('echoes', list.slice(-300));
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
    const mergeList = (a = [], b = [], cap = 14) => {
      const seen = new Set();
      const out = [];
      for (const x of [...a, ...(Array.isArray(b) ? b : [])]) {
        const s = String(x || '').trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      // 新的排在前面，但保留总量
      return out.slice(-cap);
    };
    const patch = {
      traits: mergeList(cur.traits, p.traits, 16),
      themes: mergeList(cur.themes, p.themes, 12),
      figures: mergeList(cur.figures, p.figures, 10),
      seasons: mergeList(cur.seasons, p.seasons, 8),
      lastUpdated: Date.now(),
    };
    if (p.essence && String(p.essence).trim()) patch.essence = String(p.essence).trim().slice(0, 120);
    this.set('profile', patch);
  },

  /**
   * 取最近 n 轮对话，转成 DeepSeek 的消息。
   * 带图的消息会变成 content 数组（text + image_url），
   * 但只对最近 maxImageMsgs 条真的附图 —— 图片很贵。
   */
  recentTurns(n = 16, { maxImageMsgs = 2, maxImagesPerMsg = 2 } = {}) {
    const msgs = state.messages.filter((m) => !m.system).slice(-n * 2);

    const keepImage = new Set();
    let taken = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'me' && m.images && m.images.length && taken < maxImageMsgs) {
        keepImage.add(m.id);
        taken++;
      }
    }

    return msgs.map((m) => {
      const role = m.role === 'me' ? 'user' : 'assistant';
      const text = m.text || '';
      const imgs = keepImage.has(m.id) ? m.images.slice(0, maxImagesPerMsg) : [];
      if (!imgs.length) return { role, content: text };
      if (role !== 'user') return { role, content: text };
      return {
        role,
        content: [
          { type: 'text', text: text || '（我没有写字，只放进了一张图。）' },
          ...imgs.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      };
    });
  },

  wipe() {
    for (const k of Object.keys(DEFAULTS)) localStorage.removeItem(NS + k);
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
