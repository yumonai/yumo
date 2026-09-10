/* ══════════════════════════════════════════════
   scene.js —— 深海
   不依赖任何图形库。整片水由五层构成：
     ① 水面折光（顶端极淡的光斑）
     ② 光柱（从上方斜插入水的丁达尔光）
     ③ 浮游微光（远近三层视差）
     ④ 气泡（缓缓上浮，到顶即破）
     ⑤ 暗流（低频噪声，让一切缓慢横移）
   ══════════════════════════════════════════════ */

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;

/* ── 值噪声（用于暗流） ── */
function makeNoise(seed = 1) {
  const p = new Uint8Array(512);
  let s = seed * 9301 + 49297;
  const next = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 512; i++) p[i] = Math.floor(next() * 256);
  const fade = (t) => t * t * (3 - 2 * t);
  const grad = (h, x, y) => {
    const u = (h & 1) ? x : -x, v = (h & 2) ? y : -y;
    return u + v;
  };
  return function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const A = p[X] + Y, B = p[X + 1] + Y;
    return lerp(
      lerp(grad(p[A], x, y), grad(p[B], x - 1, y), u),
      lerp(grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1), u),
      v
    );
  };
}

export class DeepSea {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.noise = makeNoise(7);
    this.t = 0;
    this.motes = [];
    this.bubbles = [];
    this.shafts = [];
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.hue = { r: 46, g: 96, b: 122 };   // 可被情绪调制的水色
    this.targetHue = { ...this.hue };
    this.energy = 0.5;                      // 0 静 → 1 涌
    this.targetEnergy = 0.5;
    this._raf = null;
    this._onResize = () => this.resize();
  }

  start() {
    this.resize();
    window.addEventListener('resize', this._onResize);
    const loop = () => { this.frame(); this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    window.removeEventListener('resize', this._onResize);
  }

  /** 情绪 → 水色与涌动程度 */
  mood(name) {
    const map = {
      calm:     { hue: [42, 92, 120], energy: 0.34 },
      tender:   { hue: [72, 138, 168], energy: 0.56 },
      bright:   { hue: [120, 190, 214], energy: 0.78 },
      heavy:    { hue: [28, 58, 82],  energy: 0.18 },
      thinking: { hue: [86, 150, 184], energy: 0.66 },
    };
    const m = map[name] || map.calm;
    this.targetHue = { r: m.hue[0], g: m.hue[1], b: m.hue[2] };
    this.targetEnergy = m.energy;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.cv.width = Math.floor(this.w * dpr);
    this.cv.height = Math.floor(this.h * dpr);
    this.cv.style.width = this.w + 'px';
    this.cv.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.seed();
  }

  seed() {
    const area = this.w * this.h;
    // 浮游微光：三层视差
    const count = Math.round(Math.min(210, Math.max(70, area / 11000)));
    this.motes = [];
    for (let i = 0; i < count; i++) {
      const layer = i % 3;
      this.motes.push({
        x: rand(0, this.w),
        y: rand(0, this.h),
        r: [0.6, 1.15, 2.0][layer] * rand(0.7, 1.4),
        layer,
        speed: [5, 10, 18][layer] * rand(0.6, 1.3),
        sway: rand(0.4, 1.7),
        phase: rand(0, TAU),
        alpha: [0.30, 0.44, 0.58][layer] * rand(0.6, 1.1),
        warm: Math.random() < 0.14,     // 少数偏暖的微光，像极了深海生物
      });
    }
    // 气泡
    this.bubbles = [];
    const bc = Math.round(Math.min(34, Math.max(10, area / 62000)));
    for (let i = 0; i < bc; i++) this.bubbles.push(this.newBubble(true));
    // 光柱
    this.shafts = [];
    const sc = Math.max(3, Math.round(this.w / 300));
    for (let i = 0; i < sc; i++) {
      this.shafts.push({
        x: rand(-0.15, 1.15) * this.w,
        w: rand(0.05, 0.20) * this.w,
        tilt: rand(-0.22, 0.22),
        alpha: rand(0.020, 0.056),
        phase: rand(0, TAU),
        speed: rand(0.05, 0.14),
      });
    }
  }

  newBubble(anywhere = false) {
    const r = rand(0.8, 3.2);
    return {
      x: rand(0, this.w),
      y: anywhere ? rand(0, this.h) : this.h + rand(4, 70),
      r,
      vy: -rand(11, 34) * (1.35 - r / 4),
      drift: rand(-7, 7),
      phase: rand(0, TAU),
      a: rand(0.12, 0.4),
    };
  }

  frame() {
    const { ctx, w, h } = this;
    this.t += 1 / 60;

    // 情绪平滑过渡
    for (const k of ['r', 'g', 'b']) {
      this.hue[k] = lerp(this.hue[k], this.targetHue[k], 0.012);
    }
    this.energy = lerp(this.energy, this.targetEnergy, 0.012);

    // ① 水底渐变
    const g = ctx.createLinearGradient(0, 0, 0, h);
    const { r, g: gg, b } = this.hue;
    g.addColorStop(0, `rgb(${Math.round(r * 0.36)},${Math.round(gg * 0.34)},${Math.round(b * 0.36)})`);
    g.addColorStop(0.38, `rgb(${Math.round(r * 0.16)},${Math.round(gg * 0.17)},${Math.round(b * 0.20)})`);
    g.addColorStop(1, '#010306');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // ② 光柱：用多层嵌套四边形堆出柔边，避免出现生硬的直线切口
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const LAYERS = 6;
    for (const s of this.shafts) {
      const sway = Math.sin(this.t * s.speed + s.phase) * 26;
      const a = s.alpha * (0.62 + 0.38 * Math.sin(this.t * s.speed * 2.1 + s.phase)) * (0.55 + this.energy * 0.7);
      const x0 = s.x + sway;
      const grad = ctx.createLinearGradient(x0, -60, x0 + s.tilt * h, h * 0.94);
      grad.addColorStop(0, `rgba(${r | 0},${gg | 0},${b | 0},${a * 2.2})`);
      grad.addColorStop(0.34, `rgba(${r | 0},${gg | 0},${b | 0},${a})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.34;
      for (let j = 0; j < LAYERS; j++) {
        // 从外到内逐层收窄：中心叠加最亮，边缘只剩一层，形成线性羽化
        const k = 1 - (j / LAYERS) * 0.78;
        const tw = s.w * k;
        ctx.beginPath();
        ctx.moveTo(x0 - tw / 2, -60);
        ctx.lineTo(x0 + tw / 2, -60);
        ctx.lineTo(x0 + tw / 2 + s.tilt * h + tw * 0.9, h * 0.94);
        ctx.lineTo(x0 - tw / 2 + s.tilt * h - tw * 0.9, h * 0.94);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ③ 浮游微光（移动）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const nz = this.noise(m.x * 0.0016 + this.t * 0.012, m.y * 0.0016);
      m.x += Math.sin(this.t * m.sway * 0.35 + m.phase) * 0.24 + nz * 0.3 + this.energy * 0.12;
      m.y -= m.speed * 0.016 * (0.5 + this.energy * 0.9);
      if (m.y < -20) { m.y = this.h + 16; m.x = rand(0, this.w); }
      if (m.x < -20) m.x = this.w + 16;
      if (m.x > this.w + 20) m.x = -16;

      const twinkle = 0.66 + 0.34 * Math.sin(this.t * (0.7 + m.sway * 0.5) + m.phase * 2.2);
      const a = m.alpha * twinkle;
      const col = m.warm
        ? `rgba(226,206,178,${a})`
        : `rgba(${Math.min(255, r + 150) | 0},${Math.min(255, gg + 138) | 0},${Math.min(255, b + 118) | 0},${a})`;
      const rad = m.r * 5.2;
      const mg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, rad);
      mg.addColorStop(0, col);
      mg.addColorStop(0.34, col.replace(/[\d.]+\)$/, (a * 0.36).toFixed(3) + ')'));
      mg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(m.x, m.y, rad, 0, TAU);
      ctx.fill();
      // 核
      ctx.fillStyle = `rgba(232,246,253,${a * 0.9})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // ④ 气泡
    ctx.save();
    for (const b of this.bubbles) {
      b.y += b.vy * 0.016;
      b.x += Math.sin(this.t * 1.05 + b.phase) * 0.32 + b.drift * 0.016;
      if (b.y < -12) Object.assign(b, this.newBubble(false));
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.strokeStyle = `rgba(200,232,246,${b.a})`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.32, 0, TAU);
      ctx.fillStyle = `rgba(232,246,253,${b.a * 0.85})`;
      ctx.fill();
    }
    ctx.restore();
  }
}
