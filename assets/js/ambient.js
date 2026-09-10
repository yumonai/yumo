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

/* 瞬态细节的节拍（毫秒）——雨滴在一拍内被打散到这个跨度里 */
const SPARK_TICK = 0.52;

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

  /**
   * 雨落：隔着水听雨。
   * 关键在「厚」——只有中高频的噪声会变成干涩的嘶嘶声，
   * 所以下面垫一层低通噪声当身体，上面再铺一层带峰的中高频雨幕。
   */
  _buildRain() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = FLOOR;
    out.connect(this.bus);

    // ① 身体层：低通噪声，给雨一把厚度
    const bodySrc = this._noiseSource();
    bodySrc.playbackRate.value = 0.46;
    const bodyHp = this._filter('highpass', 80, 0.7);
    const bodyLp = this._filter('lowpass', 640, 0.9);
    const bodyG = ctx.createGain(); bodyG.gain.value = 0.36;
    bodySrc.connect(bodyHp); bodyHp.connect(bodyLp); bodyLp.connect(bodyG);

    // ② 雨幕层：连绵的沙沙，峰值随缓慢移动的共振点走
    const veilSrc = this._noiseSource();
    veilSrc.playbackRate.value = 1.16;
    const veilHp = this._filter('highpass', 820, 0.6);
    const veilPeak = this._filter('peaking', 2500, 0.8);
    veilPeak.gain.value = 3.4;
    const veilLp = this._filter('lowpass', 7200, 0.5);
    const veilG = ctx.createGain(); veilG.gain.value = 0.19;
    veilSrc.connect(veilHp); veilHp.connect(veilPeak); veilPeak.connect(veilLp); veilLp.connect(veilG);

    const mod = ctx.createGain(); mod.gain.value = 0.74;
    bodyG.connect(mod); veilG.connect(mod);
    mod.connect(out);

    bodySrc.start(); veilSrc.start();

    const extra = [
      this._lfo(0.071, 0.09, mod.gain, 0.74),          // 雨势的涨落
      this._lfo(0.021, 340, veilHp.frequency, 820),    // 雨幕缓慢变薄变厚
      this._lfo(0.013, 900, veilPeak.frequency, 2500),
      bodySrc, veilSrc,
    ];
    return { src: veilSrc, out, extra, base: 0.6, spark: 'drop' };
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

  /**
   * 深压：水底的低鸣。
   * 原来的基频 44Hz 在手机和笔记本喇叭上根本发不出来，所以只能听见一点点噪声。
   * 现在把基频提到 58Hz，并补上 116/174Hz 的谐波 ——
   * 小喇叭放不出 58Hz，但能放出它的谐波，耳朵就会「补」出那个低沉感。
   */
  _buildDeep() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = FLOOR;
    out.connect(this.bus);

    // ① 低音组：两个极近的频率产生很慢的拍频，像水压自己在呼吸
    const tones = ctx.createGain(); tones.gain.value = 0.5;
    [[58, 0.5], [58.4, 0.42], [116, 0.2], [174, 0.1]].forEach(([f, a]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = a;
      o.connect(g); g.connect(tones);
      o.start();
    });

    // ② 被低频包住的噪声，给「压」的质感
    const src = this._noiseSource();
    src.playbackRate.value = 0.3;
    const lp = this._filter('lowpass', 220, 3.4);
    const nGain = ctx.createGain(); nGain.gain.value = 0.5;
    src.connect(lp); lp.connect(nGain);

    const mod = ctx.createGain(); mod.gain.value = 0.42;
    tones.connect(mod); nGain.connect(mod);
    mod.connect(out);
    src.start();

    const extra = [
      this._lfo(0.019, 0.15, mod.gain, 0.42),        // 很慢的涨落
      this._lfo(0.0093, 0.14, tones.gain, 0.5),      // 呼吸感
      this._lfo(0.0071, 62, lp.frequency, 220),      // 共振点缓缓移动
    ];
    return { src, out, extra, base: 0.52, spark: 'bubble' };
  }

  /**
   * 空腔：像在一口井里。
   * 「空洞」不是一个高频窄带能给出的 —— 那是哨音。
   * 空腔感来自几个低中频的共振峰（像对着瓶口吹气），
   * 再加上四个不同距离的早期反射，才有空间的体积。
   */
  _buildCave() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = FLOOR;
    out.connect(this.bus);

    // ① 腔体的三个共振峰
    const src = this._noiseSource();
    src.playbackRate.value = 0.44;
    const bed = this._filter('lowpass', 1900, 0.7);
    src.connect(bed);

    const resos = [[186, 4.6, 0.5], [468, 5.6, 0.34], [1140, 6.4, 0.2]].map(([f, q, a]) => {
      const bp = this._filter('bandpass', f, q);
      const g = ctx.createGain(); g.gain.value = a;
      bed.connect(bp); bp.connect(g);
      return { bp, g };
    });

    const mod = ctx.createGain(); mod.gain.value = 0.3;
    resos.forEach((r) => r.g.connect(mod));
    mod.connect(out);
    src.start();

    // ② 四个不同距离、不同方位的早期反射 —— 让空间有体积，而不是金属弹簧
    const taps = [[0.083, 0.3, -0.8], [0.147, 0.24, 0.7], [0.241, 0.18, -0.4], [0.377, 0.12, 0.9]];
    taps.forEach(([t, a, pan]) => {
      const d = ctx.createDelay(1.2);
      d.delayTime.value = t;
      const g = ctx.createGain(); g.gain.value = a;
      mod.connect(d); d.connect(g);
      this._connectTo(g, pan, out);   // 反射同样受这一路的音量控制
    });

    const extra = [
      this._lfo(0.031, 0.1, mod.gain, 0.3),
      this._lfo(0.017, 52, resos[0].bp.frequency, 186),
      this._lfo(0.023, 96, resos[1].bp.frequency, 468),
      this._lfo(0.013, 190, resos[2].bp.frequency, 1140),
      src,
    ];
    return { src, out, extra, base: 0.46, spark: 'drip' };
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
    this._sparkTimer = setInterval(() => this._tickSparks(), SPARK_TICK * 1000);
  }

  _tickSparks() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    for (const s of SOUNDS) {
      const node = this.nodes[s.id];
      const lv = this.levels[s.id] || 0;
      if (!node || lv <= 0.01 || !node.spark) continue;
      if (node.spark === 'drop') {
        // 雨是一片，不是一颗：每次 tick 撒下一小把，时间上打散
        const n = 3 + Math.round(lv * 9);
        for (let i = 0; i < n; i++) this._drop(lv, Math.random() * SPARK_TICK, node.out);
      } else {
        // 气泡与滴水是零星的：出现频率跟着音量走
        if (Math.random() > lv * 0.85) continue;
        if (node.spark === 'bubble') this._bubble(lv, node.out);
        else if (node.spark === 'drip') this._drip(lv, node.out);
      }
    }
  }

  /** 把一个节点按 pan 摆位后接到 dest（默认总线） */
  _connectTo(node, pan, dest) {
    const target = dest || this.bus;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      p.connect(target);
    } else {
      node.connect(target);
    }
  }

  /** 一颗雨滴：极短的带通噪声爆点。offset 用来在一拍里把它打散 */
  _drop(intensity = 1, offset = 0, dest) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + offset;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 1.2 + Math.random() * 1.5;
    const bp = this._filter('bandpass', 900 + Math.random() * 3900, 4 + Math.random() * 7);
    const g = ctx.createGain();
    const dur = 0.018 + Math.random() * 0.046;
    g.gain.setValueAtTime(FLOOR, t0);
    g.gain.exponentialRampToValueAtTime(0.13 * intensity, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(FLOOR, t0 + dur);
    src.connect(bp); bp.connect(g);
    this._connectTo(g, Math.random() * 2 - 1, dest);
    src.start(t0);
    src.stop(t0 + dur + 0.06);
  }

  /** 一颗气泡：向上滑的短正弦 */
  _bubble(intensity = 1, dest) {
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
    this._connectTo(g, Math.random() * 1.6 - 0.8, dest);
    o.start(now);
    o.stop(now + dur + 0.06);
  }

  /** 洞里的一滴水：一点高音，尾巴交给带阻尼的短回响 */
  _drip(intensity = 1, dest) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = 780 + Math.random() * 1400;
    o.frequency.setValueAtTime(f, now);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, now + 0.1);
    const g = ctx.createGain();
    const dur = 0.14 + Math.random() * 0.12;
    g.gain.setValueAtTime(FLOOR, now);
    g.gain.exponentialRampToValueAtTime(0.17 * intensity, now + 0.005);
    g.gain.exponentialRampToValueAtTime(FLOOR, now + dur);
    o.connect(g);
    this._connectTo(g, Math.random() * 1.4 - 0.7, dest);
    // 一小段带阻尼的反馈：越回越暗，像井壁吸掉高频
    const dly = ctx.createDelay(1.5);
    dly.delayTime.value = 0.19;
    const dlp = this._filter('lowpass', 2400, 0.7);
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const wet = ctx.createGain(); wet.gain.value = 0.3;
    g.connect(dly); dly.connect(dlp);
    dlp.connect(fb); fb.connect(dly);
    dlp.connect(wet);
    this._connectTo(wet, -0.3, dest);
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
