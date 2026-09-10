/* ══════════════════════════════════════════════
   ambient.js —— 声境
   所有声音都是此刻从你的设备里长出来的。
   没有音频文件，没有外链，没有版权。

   信号链：
     音源 → 滤波器 → mod(涌动调制) → out(音量) → bus → master(总音量)
        → 压缩器 → 分析器 → 扬声器

   注意：调制与音量必须分成两个增益节点。
   如果 LFO 直接接在 out.gain 上，设定音量时会把
   涌动的基准值一并覆盖掉，声音就会忽大忽小甚至消失。
   ══════════════════════════════════════════════ */

const SOUNDS = [
  { id: 'tide',  name: '潮 汐',  desc: '一波，又一波',      icon: 'waves' },
  { id: 'rain',  name: '雨 落',  desc: '隔着水听雨',        icon: 'rain'  },
  { id: 'wind',  name: '风 过',  desc: '从很远的地方来',    icon: 'wind'  },
  { id: 'deep',  name: '深 压',  desc: '水底的低鸣',        icon: 'deep'  },
  { id: 'bowl',  name: '钵 音',  desc: '偶尔一声，很久才散', icon: 'bowl'  },
  { id: 'cave',  name: '空 腔',  desc: '像在一口井里',      icon: 'cave'  },
];

const CEIL = 0.9;          // 单路音量上限，留出叠加余量
const FLOOR = 0.0001;      // 指数斜坡不能到 0

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.master = null;      // 总音量
    this.bus = null;         // 所有声音汇总
    this.comp = null;        // 压缩器：多路叠加时不削波
    this.analyser = null;
    this.noiseBuf = null;
    this.nodes = {};
    this.levels = {};
    this.volume = 0.85;
    this.current = null;
    this.started = false;
    this._bowlTimer = null;
    this._firstBowl = null;
    this._sparkTimer = null;
    this._pending = {};       // id → 等待销毁的定时器
  }

  /* ── 惰性初始化：必须由用户手势触发 ── */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;

    let ctx;
    try { ctx = new AC(); } catch { return false; }
    this.ctx = ctx;

    /* 总音量 —— 这里必须给出真实值。
       上一版把它钉在 0.0001（约 -80dB），于是所有声音都听不见。 */
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    /* 压缩器：六路同时开足时替我们兜住瞬态 */
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 26;
    this.comp.ratio.value = 3.4;
    this.comp.attack.value = 0.02;
    this.comp.release.value = 0.42;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.86;

    this.master.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(this.master);

    this.noiseBuf = this._noiseBuffer();

    SOUNDS.forEach((s) => { this.levels[s.id] = 0; this.nodes[s.id] = null; });

    this.started = true;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    this._startSparks();
    return true;
  }

  /** 生成一段粉红噪声，作为所有声音的原料 */
  _noiseBuffer() {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buf;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    return src;
  }

  _filter(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }

  /**
   * 一个很慢的振荡器，用来给某个参数加涌动。
   * target 必须是 AudioParam（例如 mod.gain / lp.frequency）。
   */
  _lfo(freq, depth, target, base) {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = freq;
    osc.type = 'sine';
    const g = this.ctx.createGain();
    g.gain.value = depth;
    osc.connect(g);
    g.connect(target);
    if (base !== undefined) target.value = base;
    osc.start();
    return osc;
  }

  /**
   * 一条带涌动的支路：噪声 → [滤波…] → mod → out → bus
   * mod 负责「涌动」，out 负责「音量」，两者必须分开：
   * 若 LFO 直接接在 out.gain 上，set() 调音量时会连涌动的基准一起覆盖掉。
   */
  _channel(filters, { modFreq, modDepth, modBase, outBase }) {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const mod = ctx.createGain();
    mod.gain.value = modBase;
    const out = ctx.createGain();
    out.gain.value = FLOOR;

    let node = src;
    for (const f of filters) { node.connect(f); node = f; }
    node.connect(mod);
    mod.connect(out);
    out.connect(this.bus);

    const extra = [];
    if (modFreq) extra.push(this._lfo(modFreq, modDepth, mod.gain, modBase));

    src.start();
    return { src, out, mod, filters, extra, base: outBase };
  }

  /* ── 每种声音的合成配方 ── */

  /** 潮汐：一层低沉的涌动 + 一层碎裂的水花 */
  _buildTide() {
    const ctx = this.ctx;
    const body = this._channel(
      [this._filter('highpass', 60, 0.6), this._filter('lowpass', 430, 0.8)],
      { modFreq: 0.058, modDepth: 0.42, modBase: 0.6, outBase: 0.72 }
    );
    // 第二个周期的涌动叠在同一个 mod.gain 上（AudioParam 会把多路信号相加）
    body.extra.push(this._lfo(0.113, 0.2, body.mod.gain, 0.6));

    // 水花层：高通的碎裂声，跟着自己的周期涨落
    const foam = ctx.createBufferSource();
    foam.buffer = this.noiseBuf;
    foam.loop = true;
    foam.playbackRate.value = 1.05;
    const fhp = this._filter('highpass', 1100, 0.5);
    const flp = this._filter('lowpass', 5200, 0.5);
    const fmod = ctx.createGain(); fmod.gain.value = 0.3;
    foam.connect(fhp); fhp.connect(flp); flp.connect(fmod); fmod.connect(body.out);
    foam.start();

    body.extra.push(this._lfo(0.083, 0.2, fmod.gain, 0.3));
    body.extra.push(this._lfo(0.017, 1600, flp.frequency, 5200));
    body.extra.push(foam);
    return body;
  }

  /** 雨落：连绵的沙沙，加上一颗一颗的雨滴 */
  _buildRain() {
    const src = this._noiseSource();
    src.playbackRate.value = 1.32;
    const hp = this._filter('highpass', 1500, 0.5);
    const peak = this._filter('peaking', 5400, 0.7);
    peak.gain.value = 4.5;
    const mod = this.ctx.createGain();
    mod.gain.value = 0.42;
    const out = this.ctx.createGain();
    out.gain.value = FLOOR;
    src.connect(hp); hp.connect(peak); peak.connect(mod); mod.connect(out); out.connect(this.bus);
    src.start();
    const extra = [
      this._lfo(0.085, 0.12, mod.gain, 0.42),
      this._lfo(0.019, 260, hp.frequency, 1900),
    ];
    return { src, out, extra, base: 0.58, spark: 'drop' };
  }

  /** 风过：带通噪声 + 两重阵风 + 一丝尾音 */
  _buildWind() {
    const src = this._noiseSource();
    src.playbackRate.value = 0.4;
    const bp = this._filter('bandpass', 380, 1.1);
    const bp2 = this._filter('bandpass', 1150, 3.2);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.16;
    const mod = this.ctx.createGain();
    mod.gain.value = 0.5;
    const out = this.ctx.createGain();
    out.gain.value = FLOOR;
    src.connect(bp); bp.connect(mod);
    bp.connect(bp2); bp2.connect(g2); g2.connect(mod);
    mod.connect(out); out.connect(this.bus);
    src.start();
    const extra = [
      this._lfo(0.048, 0.3, mod.gain, 0.5),
      this._lfo(0.031, 250, bp.frequency, 380),
      this._lfo(0.023, 420, bp2.frequency, 1150),
      this._lfo(0.014, 0.1, g2.gain, 0.16),
    ];
    return { src, out, extra, base: 0.62 };
  }

  /** 深压：极低频持续音 + 缓慢拍频 + 偶尔上浮的气泡 */
  _buildDeep() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = FLOOR;
    out.connect(this.bus);

    // 两个相差 0.6Hz 的正弦，产生很慢的拍频，像水压本身在呼吸
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 44;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 44.7;
    const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 66;
    const g3 = ctx.createGain(); g3.gain.value = 0.2;
    const src = this._noiseSource(); src.playbackRate.value = 0.22;
    const lp = this._filter('lowpass', 150, 0.9);
    const nGain = ctx.createGain(); nGain.gain.value = 0.45;
    const lfo = ctx.createGain(); lfo.gain.value = 0.34;

    o1.connect(lfo); o2.connect(lfo); o3.connect(g3); g3.connect(lfo);
    src.connect(lp); lp.connect(nGain); nGain.connect(lfo);
    lfo.connect(out);

    o1.start(); o2.start(); o3.start(); src.start();
    const extra = [
      this._lfo(0.026, 0.22, lfo.gain, 0.34),
      this._lfo(0.009, 8, o2.frequency, 44.7),
    ];
    return { src, out, extra, base: 0.5, spark: 'bubble' };
  }

  /** 空腔：一口井的窄带共鸣 + 很长的拖尾 + 偶尔一滴水 */
  _buildCave() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    src.playbackRate.value = 0.52;
    const bp = this._filter('bandpass', 2400, 5.5);
    const mod = ctx.createGain();
    mod.gain.value = 0.26;
    const out = ctx.createGain();
    out.gain.value = FLOOR;

    const dly = ctx.createDelay(1.5);
    dly.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.36;
    const wet = ctx.createGain(); wet.gain.value = 0.42;

    src.connect(bp); bp.connect(mod); mod.connect(out);
    out.connect(this.bus);
    out.connect(dly); dly.connect(fb); fb.connect(dly);
    dly.connect(wet); wet.connect(this.bus);
    src.start();

    const extra = [
      this._lfo(0.033, 0.14, mod.gain, 0.26),
      this._lfo(0.017, 820, bp.frequency, 2400),
    ];
    return { src, out, extra, base: 0.42, spark: 'drip' };
  }

  /** 钵音：不常出现，出现就很久才散 */
  _buildBowl() {
    const out = this.ctx.createGain();
    out.gain.value = FLOOR;
    out.connect(this.bus);
    this._bowlOut = out;
    // 音量升到位之后再给第一声，让用户知道它活着
    clearTimeout(this._firstBowl);
    this._firstBowl = setTimeout(() => {
      if (this.nodes.bowl && this.levels.bowl > 0.01) this._strikeBowl();
    }, 2100);
    this._scheduleBowl();
    return { src: null, out, extra: [], base: 0.9, virtual: true };
  }

  _scheduleBowl() {
    clearTimeout(this._bowlTimer);
    const wait = 11000 + Math.random() * 19000;
    this._bowlTimer = setTimeout(() => {
      if (this.nodes.bowl && this.levels.bowl > 0.01) this._strikeBowl();
      if (this.nodes.bowl) this._scheduleBowl();
    }, wait);
  }

  /** 一声颂钵：五个非整数倍分音 + 极长的衰减 */
  _strikeBowl() {
    const ctx = this.ctx;
    if (!ctx || !this._bowlOut) return;
    const now = ctx.currentTime;
    // 从五声音阶里挑一个基频，避免不协和
    const base = [146.83, 164.81, 196.00, 220.00, 261.63][Math.floor(Math.random() * 5)];
    const partials = [1, 2.02, 2.98, 4.11, 5.43];
    const amps = [1, 0.42, 0.26, 0.14, 0.07];
    const dur = 14 + Math.random() * 7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(FLOOR, now);
    g.gain.exponentialRampToValueAtTime(0.42, now + 0.03);
    g.gain.exponentialRampToValueAtTime(FLOOR, now + dur);
    g.connect(this._bowlOut);
    partials.forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * mult;
      const pg = ctx.createGain();
      pg.gain.value = amps[i];
      o.connect(pg);
      pg.connect(g);
      o.start(now);
      o.stop(now + dur + 0.6);
    });
  }

  /* ── 瞬态细节：雨滴 / 气泡 / 水滴 ── */

  _startSparks() {
    clearInterval(this._sparkTimer);
    this._sparkTimer = setInterval(() => this._tickSparks(), 520);
  }

  _tickSparks() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    for (const s of SOUNDS) {
      const node = this.nodes[s.id];
      const lv = this.levels[s.id] || 0;
      if (!node || lv <= 0.01 || !node.spark) continue;
      // 出现频率跟着音量走：声音越大，细节越密
      if (Math.random() > lv * 0.85) continue;
      if (node.spark === 'drop') this._drop(lv);
      else if (node.spark === 'bubble') this._bubble(lv);
      else if (node.spark === 'drip') this._drip(lv);
    }
  }

  _connectToBus(node, pan) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      p.connect(this.bus);
    } else {
      node.connect(this.bus);
    }
  }

  /** 一颗雨滴：极短的高 Q 带通噪声爆点 */
  _drop(intensity = 1) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 1.5 + Math.random() * 1.8;
    const bp = this._filter('bandpass', 1600 + Math.random() * 4600, 7 + Math.random() * 11);
    const g = ctx.createGain();
    const dur = 0.028 + Math.random() * 0.075;
    g.gain.setValueAtTime(FLOOR, now);
    g.gain.exponentialRampToValueAtTime(0.34 * intensity, now + 0.004);
    g.gain.exponentialRampToValueAtTime(FLOOR, now + dur);
    src.connect(bp); bp.connect(g);
    this._connectToBus(g, Math.random() * 2 - 1);
    src.start(now);
    src.stop(now + dur + 0.06);
  }

  /** 一颗气泡：向上滑的短正弦 */
  _bubble(intensity = 1) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const f0 = 110 + Math.random() * 170;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.5, now + 0.085);
    const g = ctx.createGain();
    const dur = 0.1 + Math.random() * 0.12;
    g.gain.setValueAtTime(FLOOR, now);
    g.gain.exponentialRampToValueAtTime(0.15 * intensity, now + 0.018);
    g.gain.exponentialRampToValueAtTime(FLOOR, now + dur);
    o.connect(g);
    this._connectToBus(g, Math.random() * 1.6 - 0.8);
    o.start(now);
    o.stop(now + dur + 0.06);
  }

  /** 洞里的滴水：高音点 + 一点延迟回响的味道 */
  _drip(intensity = 1) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = 900 + Math.random() * 1500;
    o.frequency.setValueAtTime(f, now);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, now + 0.09);
    const g = ctx.createGain();
    const dur = 0.13 + Math.random() * 0.1;
    g.gain.setValueAtTime(FLOOR, now);
    g.gain.exponentialRampToValueAtTime(0.14 * intensity, now + 0.006);
    g.gain.exponentialRampToValueAtTime(FLOOR, now + dur);
    const dly = ctx.createDelay(1.5);
    dly.delayTime.value = 0.31;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const wet = ctx.createGain(); wet.gain.value = 0.3;
    o.connect(g);
    this._connectToBus(g, Math.random() * 1.4 - 0.7);
    g.connect(dly); dly.connect(fb); fb.connect(dly);
    dly.connect(wet); wet.connect(this.bus);
    o.start(now);
    o.stop(now + dur + 0.06);
  }

  /* ── 对外接口 ── */

  get list() { return SOUNDS; }

  /** 总音量 0-1 */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this._fade(this.master.gain, Math.max(FLOOR, this.volume), 0.5);
    return this.volume;
  }

  /** 设定某一路的音量 0-1 */
  set(id, v) {
    if (!this.ensure()) return;
    const val = Math.max(0, Math.min(1, v)) * CEIL;
    this.levels[id] = Math.max(0, Math.min(1, v));

    const existing = this.nodes[id];
    if (this.levels[id] <= 0.005) {
      if (existing) {
        this._fade(existing.out.gain, FLOOR, 0.7);
        const toKill = existing;
        // 记下这个定时器：用户如果在淡出还没结束前又把音量推上来，
        // 必须把它取消掉，否则声音会被「销毁」在一个已经变响的路由上。
        clearTimeout(this._pending[id]);
        this._pending[id] = setTimeout(() => {
          this._pending[id] = null;
          if (this.levels[id] <= 0.005) this._dispose(id, toKill);
        }, 820);
      }
      return;
    }
    if (existing) {
      clearTimeout(this._pending[id]);
      this._pending[id] = null;
      this._fade(existing.out.gain, existing.base * val, 0.9);
      return;
    }
    const builder = {
      tide: '_buildTide', rain: '_buildRain', wind: '_buildWind',
      deep: '_buildDeep', bowl: '_buildBowl', cave: '_buildCave',
    }[id];
    if (!builder) return;
    const node = this[builder]();
    this.nodes[id] = node;
    this._fade(node.out.gain, node.base * val, 1.6);
  }

  /** 给 AudioParam 做一次平滑过渡（注意传的是 .gain，不是 GainNode） */
  _fade(param, value, sec) {
    if (!this.ctx || !param) return;
    const now = this.ctx.currentTime;
    const to = Math.max(FLOOR, value);
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(Math.max(FLOOR, param.value), now);
      param.exponentialRampToValueAtTime(to, now + sec);
    } catch {
      try { param.value = to; } catch { /* noop */ }
    }
  }

  _dispose(id, node) {
    if (!node) return;
    try {
      node.src?.stop();
      node.extra?.forEach((o) => { try { o.stop?.(); } catch { /* noop */ } });
      try { node.out.disconnect(); } catch { /* noop */ }
    } catch { /* noop */ }
    if (this.nodes[id] === node) this.nodes[id] = null;
  }

  /** 一键进入某种氛围 */
  preset(kind) {
    const presets = {
      sleep:   { tide: 0.5, deep: 0.55, bowl: 0.4, rain: 0.18, wind: 0, cave: 0 },
      focus:   { tide: 0.22, deep: 0.3, cave: 0.3, rain: 0.32, wind: 0.1, bowl: 0 },
      release: { tide: 0.62, wind: 0.3, bowl: 0.45, deep: 0.25, rain: 0, cave: 0.12 },
      rain:    { rain: 0.62, tide: 0.26, cave: 0.1, wind: 0.14, deep: 0.2, bowl: 0.18 },
      ocean:   { tide: 0.78, wind: 0.24, deep: 0.36, bowl: 0.2, rain: 0, cave: 0 },
      off:     { tide: 0, rain: 0, wind: 0, deep: 0, bowl: 0, cave: 0 },
    };
    const p = presets[kind] || presets.off;
    SOUNDS.forEach((s) => this.set(s.id, p[s.id] ?? 0));
    this.current = kind;
    return p;
  }

  /** 任意一路是否在响 */
  get active() {
    return Object.values(this.levels).some((v) => v > 0.01);
  }

  /** 供可视化使用 */
  getSpectrum() {
    if (!this.analyser) return null;
    const arr = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(arr);
    return arr;
  }

  /** 当前是否真的在出声（用于确认音频链路真的通了） */
  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  disposeAll() {
    SOUNDS.forEach((s) => {
      const n = this.nodes[s.id];
      if (n) this._dispose(s.id, n);
    });
    clearTimeout(this._bowlTimer);
    clearTimeout(this._firstBowl);
    clearInterval(this._sparkTimer);
    Object.values(this._pending).forEach((t) => clearTimeout(t));
    this._pending = {};
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
}

export const ICONS = {
  waves: '<path d="M2 8c2.4-3 4.6-3 7 0s4.6 3 7 0M2 14c2.4-3 4.6-3 7 0s4.6 3 7 0"/>',
  rain:  '<path d="M5 9.5a4 4 0 015.9-3.6A3.5 3.5 0 0117.5 8 3 3 0 0116.5 14H7a3 3 0 01-2-4.5zM8 17l-1 2M12 17l-1 2M16 17l-1 2"/>',
  wind:  '<path d="M3 8h9a2.5 2.5 0 100-5M3 12h13.5a2.5 2.5 0 110 5M3 16h6"/>',
  deep:  '<path d="M4 10c0 4 3.6 7 8 7s8-3 8-7M8 4.5v3M16 4.5v3M12 3v4.5"/><circle cx="12" cy="12" r="1.6"/>',
  bowl:  '<path d="M4 10.5h16A8 8 0 0112 18a8 8 0 01-8-7.5z"/><path d="M12 6.5V4M9 5.2l-1-2M15 5.2l1-2"/>',
  cave:  '<path d="M4 19v-6a8 8 0 0116 0v6"/><path d="M9 19v-4a3 3 0 016 0v4"/>',
};
