/* ══════════════════════════════════════════════
   ambient.js —— 声境
   所有声音都是此刻从你的设备里长出来的。
   没有音频文件，没有外链，没有版权。
   ══════════════════════════════════════════════ */

const SOUNDS = [
  { id: 'tide',  name: '潮 汐',  desc: '一波，又一波',      icon: 'waves' },
  { id: 'rain',  name: '雨 落',  desc: '隔着水听雨',        icon: 'rain'  },
  { id: 'wind',  name: '风 过',  desc: '从很远的地方来',    icon: 'wind'  },
  { id: 'deep',  name: '深 压',  desc: '水底的低鸣',        icon: 'deep'  },
  { id: 'bowl',  name: '钵 音',  desc: '偶尔一声，很久才散', icon: 'bowl'  },
  { id: 'cave',  name: '空 腔',  desc: '像在一口井里',      icon: 'cave'  },
];

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.nodes = {};
    this.levels = {};
    this.started = false;
    this._bowlTimer = null;
  }

  /* ── 惰性初始化：必须由用户手势触发 ── */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.86;

    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.noiseBuf = this._noiseBuffer();
    SOUNDS.forEach((s) => { this.levels[s.id] = 0; this.nodes[s.id] = null; });

    this.started = true;
    return true;
  }

  /** 生成一段粉红噪声，作为所有声音的原料 */
  _noiseBuffer() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 6;
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

  _lfo(freq, depth, target, base) {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = freq;
    osc.type = 'sine';
    const g = this.ctx.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(target);
    if (base !== undefined) target.value = base;
    osc.start();
    return osc;
  }

  /* ── 每种声音的合成配方 ── */

  _buildTide() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 70;
    const out = ctx.createGain(); out.gain.value = 0.0001;
    src.connect(hp).connect(lp).connect(out).connect(this.master);
    // 两组不同周期的涌动叠加，海浪才不会机械
    this._lfo(0.062, 0.42, out.gain, 0.55);
    this._lfo(0.113, 0.26, lp.frequency, 460);
    this._lfo(0.041, 0.16, hp.frequency, 110);
    src.start();
    return { src, out, base: 0.55 };
  }

  _buildRain() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    src.playbackRate.value = 1.35;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1400;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking'; peak.frequency.value = 5200; peak.gain.value = 3.5; peak.Q.value = 0.6;
    const out = ctx.createGain(); out.gain.value = 0.0001;
    src.connect(hp).connect(peak).connect(out).connect(this.master);
    this._lfo(0.09, 0.10, out.gain, 0.34);
    this._lfo(0.021, 0.2, hp.frequency, 1900);
    src.start();
    return { src, out, base: 0.34 };
  }

  _buildWind() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    src.playbackRate.value = 0.42;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 1.1;
    const out = ctx.createGain(); out.gain.value = 0.0001;
    src.connect(bp).connect(out).connect(this.master);
    this._lfo(0.048, 0.30, out.gain, 0.5);
    this._lfo(0.031, 260, bp.frequency, 380);
    src.start();
    return { src, out, base: 0.5 };
  }

  _buildDeep() {
    const ctx = this.ctx;
    // 极低频的持续音：两个相差 0.6Hz 的正弦，产生缓慢的拍频
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 46;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 46.6;
    const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 69;
    const g3 = ctx.createGain(); g3.gain.value = 0.22;
    const src = this._noiseSource(); src.playbackRate.value = 0.24;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const nGain = ctx.createGain(); nGain.gain.value = 0.42;
    const out = ctx.createGain(); out.gain.value = 0.0001;
    o1.connect(out); o2.connect(out); o3.connect(g3).connect(out);
    src.connect(lp).connect(nGain).connect(out);
    out.connect(this.master);
    this._lfo(0.026, 0.22, out.gain, 0.34);
    o1.start(); o2.start(); o3.start(); src.start();
    return { src, out, base: 0.34, extra: [o1, o2, o3] };
  }

  _buildCave() {
    const ctx = this.ctx;
    // 空腔：窄带噪声 + 一个很弱的长混响式延迟
    const src = this._noiseSource();
    src.playbackRate.value = 0.55;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 5.5;
    const out = ctx.createGain(); out.gain.value = 0.0001;
    const dly = ctx.createDelay(1.5); dly.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    src.connect(bp).connect(out);
    out.connect(dly).connect(fb).connect(dly);
    dly.connect(wet).connect(this.master);
    out.connect(this.master);
    this._lfo(0.033, 0.14, out.gain, 0.26);
    this._lfo(0.017, 900, bp.frequency, 2500);
    src.start();
    return { src, out, base: 0.26 };
  }

  /** 钵音：不常出现，出现就很久才散 */
  _buildBowl() {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0.0001;
    out.connect(this.master);
    this._bowlOut = out;
    this._scheduleBowl();
    return { src: null, out, base: 0.5, virtual: true };
  }

  _scheduleBowl() {
    const wait = 9000 + Math.random() * 17000;
    this._bowlTimer = setTimeout(() => {
      if (this.nodes.bowl && this.levels.bowl > 0.01) this._strikeBowl();
      this._scheduleBowl();
    }, wait);
  }

  _strikeBowl() {
    const ctx = this.ctx;
    if (!ctx || !this._bowlOut) return;
    const now = ctx.currentTime;
    // 从五声音阶里挑一个基频，避免不协和
    const base = [146.83, 164.81, 196.00, 220.00, 261.63][Math.floor(Math.random() * 5)];
    const partials = [1, 2.02, 2.98, 4.11, 5.43];
    const amps = [1, 0.42, 0.26, 0.14, 0.07];
    const dur = 13 + Math.random() * 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    g.connect(this._bowlOut);
    partials.forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * mult;
      const pg = ctx.createGain();
      pg.gain.value = amps[i];
      o.connect(pg).connect(g);
      o.start(now);
      o.stop(now + dur + 0.5);
    });
  }

  /* ── 对外接口 ── */

  get list() { return SOUNDS; }

  /** 设定某一路的音量 0-1 */
  set(id, v) {
    if (!this.ensure()) return;
    const val = Math.max(0, Math.min(1, v));
    this.levels[id] = val;

    const existing = this.nodes[id];
    if (val <= 0.001) {
      if (existing) {
        this._fade(existing.out, 0.0001, 0.7);
        const toKill = existing;
        setTimeout(() => this._dispose(id, toKill), 800);
      }
      return;
    }
    if (existing && !existing.virtual) {
      this._fade(existing.out, existing.base * val, 0.9);
      return;
    }
    if (existing && existing.virtual) {
      this._fade(existing.out, existing.base * val, 0.9);
      return;
    }
    // 新建
    const builder = {
      tide: '_buildTide', rain: '_buildRain', wind: '_buildWind',
      deep: '_buildDeep', bowl: '_buildBowl', cave: '_buildCave',
    }[id];
    if (!builder) return;
    const node = this[builder]();
    this.nodes[id] = node;
    this._fade(node.out, node.base * val, 1.6);
  }

  _fade(param, value, sec) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(Math.max(0.0001, param.value), now);
      param.exponentialRampToValueAtTime(Math.max(0.0001, value), now + sec);
    } catch { /* noop */ }
  }

  _dispose(id, node) {
    try {
      node.src?.stop();
      node.extra?.forEach((o) => o.stop());
    } catch { /* noop */ }
    if (this.nodes[id] === node) this.nodes[id] = null;
  }

  /** 一键进入某种氛围 */
  preset(kind) {
    const presets = {
      sleep:   { tide: 0.5, deep: 0.55, bowl: 0.35, rain: 0.18, wind: 0, cave: 0 },
      focus:   { tide: 0.22, deep: 0.3, cave: 0.3, rain: 0.32, wind: 0.1, bowl: 0 },
      release: { tide: 0.62, wind: 0.3, bowl: 0.4, deep: 0.25, rain: 0, cave: 0.12 },
      rain:    { rain: 0.6, tide: 0.26, cave: 0.1, wind: 0.14, deep: 0.2, bowl: 0.18 },
      ocean:   { tide: 0.78, wind: 0.24, deep: 0.36, bowl: 0.2, rain: 0, cave: 0 },
      off:     { tide: 0, rain: 0, wind: 0, deep: 0, bowl: 0, cave: 0 },
    };
    const p = presets[kind] || presets.off;
    SOUNDS.forEach((s) => this.set(s.id, p[s.id] ?? 0));
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

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}

export const ICONS = {
  waves: '<path d="M2 8c2.4-3 4.6-3 7 0s4.6 3 7 0M2 14c2.4-3 4.6-3 7 0s4.6 3 7 0"/>',
  rain:  '<path d="M5 9.5a4 4 0 015.9-3.6A3.5 3.5 0 0117.5 8 3 3 0 0116.5 14H7a3 3 0 01-2-4.5zM8 17l-1 2M12 17l-1 2M16 17l-1 2"/>',
  wind:  '<path d="M3 8h9a2.5 2.5 0 100-5M3 12h13.5a2.5 2.5 0 110 5M3 16h6"/>',
  deep:  '<path d="M4 10c0 4 3.6 7 8 7s8-3 8-7M8 4.5v3M16 4.5v3M12 3v4.5"/><circle cx="12" cy="12" r="1.6"/>',
  bowl:  '<path d="M4 10.5h16A8 8 0 0112 18a8 8 0 01-8-7.5z"/><path d="M12 6.5V4M9 5.2l-1-2M15 5.2l1-2"/>',
  cave:  '<path d="M4 19v-6a8 8 0 0116 0v6"/><path d="M9 19v-4a3 3 0 016 0v4"/>',
};
