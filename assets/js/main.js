/* ══════════════════════════════════════════════
   main.js —— Yumo 的呼吸
   ══════════════════════════════════════════════ */

import { store, uid, clamp } from './store.js';
import { DeepSea, EchoSea } from './scene.js';
import { Soundscape, ICONS } from './ambient.js';
import { Listener, Speaker } from './voice.js';
import { renderGarden } from './garden.js';
import { renderMirror } from './mirror.js';
import * as ai from './ai.js';

/* ── DOM ── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const el = {
  scene: $('#scene'),
  whisper: $('#whisper'),
  thread: $('#thread'),
  input: $('#input'),
  talkSub: $('#talk-sub'),
  talkHint: $('#talk-hint'),
  talkModel: $('#talk-model'),
  core: $('#core'),
  springState: $('#spring-state'),
  gardenBody: $('#garden-body'),
  mirrorBody: $('#mirror-body'),
  settingsBody: $('#settings-body'),
  driftList: $('#drift-list'),
  driftInput: $('#drift-input'),
  soundMix: $('#sound-mix'),
  soundRows: $('#sound-rows'),
  soundPulse: $('#sound-pulse'),
  waveCanvas: $('#wave-canvas'),
  recBar: $('#rec-bar'),
  attStrip: $('#attachment-strip'),
  fileInput: $('#file-image'),
  drawer: $('#drawer'),
  drawerNav: $('#drawer-nav'),
  starModal: $('#star-modal'),
  starCard: $('#star-card'),
  sanctuaryVeil: $('#sanctuary-veil'),
  seaCanvas: $('#sea-canvas'),
  timerLabel: $('#timer-label'),
};

/* ── 引擎 ── */
const sea = new DeepSea(el.scene);
const sound = new Soundscape();
const listener = new Listener();
const speaker = new Speaker();

let echoSea = null;
let view = 'threshold';
let garden = null;
let busy = false;
let pendingImages = [];
let soundTimer = null;

/* ══════════════════════════════════════════════
   耳语
   ══════════════════════════════════════════════ */
let whisperTimer = null;
function whisper(text, ms = 3400) {
  if (!text) return;
  el.whisper.textContent = text;
  el.whisper.classList.add('is-on');
  clearTimeout(whisperTimer);
  whisperTimer = setTimeout(() => el.whisper.classList.remove('is-on'), ms);
}

/* ══════════════════════════════════════════════
   路由
   ══════════════════════════════════════════════ */
function navigate(to) {
  if (to === view) return;
  const from = view;
  const fromEl = $(`#view-${from}`);
  const toEl = $(`#view-${to}`);
  if (!toEl) return;

  if (fromEl) {
    fromEl.classList.remove('view--active');
    fromEl.classList.add('view--leaving');
    setTimeout(() => fromEl.classList.remove('view--leaving'), 520);
  }
  toEl.classList.add('view--active');
  view = to;

  if (to === 'talk') onEnterTalk();
  if (to === 'garden') { garden?.paint(); }
  if (to === 'settings') paintSettings();
  if (to === 'drift') paintDrift();
  if (to === 'sound') { paintSound(); startWaveViz(); }
  if (to !== 'sound') stopWaveViz();

  setMood(to === 'talk' ? currentMood() : currentMood());
}

function setMood(name) {
  el.core?.setAttribute('data-mood', name);
  sea.mood(name);
}

function currentMood() {
  const trail = store.get('profile').moodTrail || [];
  if (!trail.length) return 'calm';
  const avg = trail.slice(-4).reduce((a, b) => a + b.v, 0) / Math.min(4, trail.length);
  if (avg < 28) return 'heavy';
  if (avg < 48) return 'calm';
  if (avg < 72) return 'tender';
  return 'bright';
}

/* ══════════════════════════════════════════════
   对话
   ══════════════════════════════════════════════ */

const GREETING = '水很静。\n你可以在任何地方开始——不用从头讲起，也不用讲清楚。';

const SEEDS = [
  '最近有点睡不着',
  '有件事我一直没放下',
  '说不上来，就是有点累',
  '我想找个人说说话',
];

function onEnterTalk() {
  const msgs = store.get('messages');
  if (!msgs.length) {
    store.pushMessage({ id: uid(), role: 'yumo', text: GREETING, t: Date.now(), system: true });
  }
  paintThread();
  updateModelChip();
  // 从心象带过来的问题
  const seed = sessionStorage.getItem('yumo.seed');
  if (seed) {
    sessionStorage.removeItem('yumo.seed');
    el.input.value = seed;
    autoGrow();
    setTimeout(() => send(), 300);
  }
}

function paintThread() {
  const msgs = store.get('messages');
  if (!msgs.length) {
    el.thread.innerHTML = `
      <div class="thread__empty">
        <p>水是空的。<br />你可以说任何话，也可以什么都不说。</p>
        <div class="seed-row">${SEEDS.map((s) => `<button class="seed" data-seed="${s}" type="button">${s}</button>`).join('')}</div>
        <small>要先连上 Yumo 的思维，它才能真正回你。</small>
      </div>`;
    $$('[data-seed]', el.thread).forEach((b) => b.addEventListener('click', () => {
      el.input.value = b.dataset.seed;
      autoGrow();
      send();
    }));
    return;
  }
  el.thread.innerHTML = msgs.map(messageHTML).join('');
  bindThread();
  scrollThread(false);
}

function messageHTML(m) {
  const isMe = m.role === 'me';
  const time = new Date(m.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const imgs = (m.images || []).length
    ? `<div class="msg__att">${m.images.map((src) => `<img src="${src}" alt="附图" loading="lazy" />`).join('')}</div>`
    : '';
  return `
    <div class="msg msg--${isMe ? 'me' : 'yumo'}" data-id="${m.id}">
      <div class="msg__bubble">${escapeHtml(m.text)}${imgs}</div>
      <div class="msg__meta">
        <span>${time}</span>
        ${isMe
          ? `<button class="msg__act" data-echo="${m.id}" type="button">收藏这句</button>`
          : `<button class="msg__act" data-say="${m.id}" type="button">读给我听</button>
             <button class="msg__act" data-echo="${m.id}" type="button">收藏</button>`}
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bindThread() {
  $$('[data-echo]', el.thread).forEach((b) => {
    b.addEventListener('click', () => {
      const m = store.get('messages').find((x) => x.id === b.dataset.echo);
      if (!m) return;
      store.pushEcho(m.text, m.role === 'me' ? 'me' : 'yumo');
      whisper('捞起来了。在「回响」里能找到。');
    });
  });
  $$('[data-say]', el.thread).forEach((b) => {
    b.addEventListener('click', () => {
      const m = store.get('messages').find((x) => x.id === b.dataset.say);
      if (!m) return;
      if (!speaker.supported) return whisper('这台设备不支持朗读。');
      speaker.rate = store.get('settings').speakRate || 1;
      speaker.setVoice(store.get('settings').voiceName);
      speaker.speak(m.text);
    });
  });

  // 长按也收藏
  $$('.msg', el.thread).forEach((node) => {
    let timer = null;
    const start = () => {
      timer = setTimeout(() => {
        const m = store.get('messages').find((x) => x.id === node.dataset.id);
        if (!m || !m.text) return;
        store.pushEcho(m.text, m.role === 'me' ? 'me' : 'yumo');
        whisper('捞起来了。');
        if (navigator.vibrate) navigator.vibrate(12);
      }, 620);
    };
    const cancel = () => clearTimeout(timer);
    node.addEventListener('pointerdown', start);
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointerleave', cancel);
    node.addEventListener('pointercancel', cancel);
  });
}

function scrollThread(smooth = true) {
  requestAnimationFrame(() => {
    el.thread.scrollTo({ top: el.thread.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}

function showFeeling(text = 'Yumo 正在感受') {
  const div = document.createElement('div');
  div.className = 'msg msg--yumo';
  div.id = 'feeling-node';
  div.innerHTML = `<div class="feeling"><div class="feeling__dots"><i></i><i></i><i></i></div><span class="feeling__text">${text}</span></div>`;
  el.thread.appendChild(div);
  scrollThread();
  return div;
}

function updateModelChip() {
  if (!el.talkModel) return;
  const s = store.get('settings');
  if (ai.isConnected()) {
    el.talkModel.textContent = s.model;
    el.talkModel.classList.add('is-live');
    el.talkHint.textContent = 'Enter 送出 · Shift+Enter 换行';
  } else {
    el.talkModel.textContent = '未连接';
    el.talkModel.classList.remove('is-live');
    el.talkHint.textContent = '还没连上 → 去「器皿」填入密钥';
  }
}

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 150) + 'px';
}

/* 发送 */
async function send() {
  const text = el.input.value.trim();
  if (busy) return;
  if (!text && !pendingImages.length) return;

  const me = { id: uid(), role: 'me', text, images: pendingImages.slice(), t: Date.now() };
  store.pushMessage(me);
  el.input.value = '';
  autoGrow();
  pendingImages = [];
  paintAttachments();
  paintThread();
  scrollThread();

  if (!ai.isConnected()) {
    const hint = '我还没连上你的思维。\n到「器皿」里填入 DeepSeek 的密钥，我就能真正回你了。';
    store.pushMessage({ id: uid(), role: 'yumo', text: hint, t: Date.now(), system: true });
    paintThread();
    scrollThread();
    return;
  }

  busy = true;
  el.input.disabled = true;
  setMood('thinking');
  el.springState.textContent = '正在感受你说的话…';

  const settings = store.get('settings');
  const sys = ai.buildSystemPrompt({ deep: !!settings.deepMode });
  const history = store.recentTurns(18);
  const feel = showFeeling();

  let acc = '';
  let bubble = null;
  try {
    await ai.stream(
      [{ role: 'system', content: sys }, ...history],
      {
        onDelta: (_d, full) => {
          acc = full;
          if (!bubble) {
            feel.innerHTML = '<div class="msg__bubble" id="live-bubble"></div>';
            bubble = $('#live-bubble');
          }
          bubble.textContent = full;
          scrollThread();
        },
      }
    );
    feel.remove();
    store.pushMessage({ id: uid(), role: 'yumo', text: acc || '……', t: Date.now() });
    paintThread();
    scrollThread();

    store.bumpTurns();

    // 自动朗读
    if (settings.speakReplies && speaker.supported && acc) {
      speaker.rate = settings.speakRate || 1;
      speaker.setVoice(settings.voiceName);
      speaker.speak(acc);
    }

    // 后台提炼（不阻塞）
    ai.distill().then((d) => {
      if (d) {
        setMood(currentMood());
        const trail = store.get('profile').moodTrail || [];
        if (trail.length) {
          const v = trail[trail.length - 1].v;
          el.springState.textContent = v < 30 ? '水有点重。我接着。' : v < 55 ? '水还算静。' : '感觉水亮了一点。';
        }
      }
    });

    // 每 6 轮写一页潮汐记
    if (store.get('profile').turns % 6 === 0) {
      ai.writeJournal().then((j) => { if (j) whisper(`写完了一页潮汐记：《${j.title}》`); });
    }

  } catch (e) {
    feel.remove();
    if (e.name !== 'AbortError') {
      const msg = e.message || '出错了。';
      store.pushMessage({ id: uid(), role: 'yumo', text: msg, t: Date.now(), system: true });
      paintThread();
      scrollThread();
    }
  } finally {
    busy = false;
    el.input.disabled = false;
    el.input.focus();
    setMood(currentMood());
    el.springState.textContent = '水很静。我在这里。';
  }
}

/* 附件 */
function paintAttachments() {
  if (!pendingImages.length) { el.attStrip.hidden = true; el.attStrip.innerHTML = ''; return; }
  el.attStrip.hidden = false;
  el.attStrip.innerHTML = pendingImages.map((src, i) =>
    `<div class="att-thumb"><img src="${src}" alt="" /><button type="button" data-rm="${i}">✕</button></div>`
  ).join('');
  $$('[data-rm]', el.attStrip).forEach((b) => b.addEventListener('click', () => {
    pendingImages.splice(Number(b.dataset.rm), 1);
    paintAttachments();
  }));
}

el.fileInput?.addEventListener('change', () => {
  const files = [...(el.fileInput.files || [])].slice(0, 4);
  files.forEach((f) => {
    if (!f.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => {
      pendingImages.push(r.result);
      paintAttachments();
      if (pendingImages.length === 1) {
        whisper('图已经放进水里了。DeepSeek 目前看不见图，你可以顺手写一句它是什么。', 5200);
      }
    };
    r.readAsDataURL(f);
  });
  el.fileInput.value = '';
});

/* 语音 */
function toggleListen() {
  if (!listener.supported) return whisper('这个浏览器听不见。换成 Chrome 或 Edge 试试。', 4600);
  if (listener.active) { listener.stop(); return; }

  const before = el.input.value;
  listener.onPartial = (t) => {
    el.input.value = (before ? before + ' ' : '') + t;
    autoGrow();
  };
  listener.onFinal = () => { autoGrow(); };
  listener.onError = (err) => {
    whisper(err === 'not-allowed' ? '麦克风被挡住了。去浏览器设置里放行。' : `听不清（${err}）`);
  };
  const ok = listener.start();
  if (ok) {
    el.recBar.hidden = false;
    $('#btn-mic').classList.add('is-on');
    speaker.cancel();
  } else {
    whisper('没能打开麦克风。');
  }
}

function stopListenUI() {
  el.recBar.hidden = true;
  $('#btn-mic')?.classList.remove('is-on');
}
listener.onEnd = stopListenUI;

/* ══════════════════════════════════════════════
   声境
   ══════════════════════════════════════════════ */

const PRESETS = [
  { id: 'ocean',   name: '海 边' },
  { id: 'sleep',   name: '入 睡' },
  { id: 'focus',   name: '专 注' },
  { id: 'rain',    name: '雨 夜' },
  { id: 'release', name: '松 开' },
  { id: 'off',     name: '全 部 停 下' },
];

function paintSound() {
  const levels = sound.levels;
  el.soundMix.innerHTML = PRESETS.map((p) =>
    `<button data-preset="${p.id}" type="button">${p.name}</button>`).join('');
  $$('[data-preset]', el.soundMix).forEach((b) => b.addEventListener('click', () => {
    const p = b.dataset.preset;
    sound.preset(p);
    if (p !== 'off' && !soundTimer && !el.timerLabel.dataset.custom) startSoundTimer(30);
    paintSound();
    whisper(p === 'off' ? '水停了。' : '调好了。');
  }));

  el.soundRows.innerHTML = sound.list.map((s) => `
    <div class="sound-row">
      <div class="sound-row__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">${ICONS[s.icon]}</svg></div>
      <div class="sound-row__txt"><b>${s.name}</b><span>${s.desc}</span></div>
      <input type="range" min="0" max="100" value="${Math.round((levels[s.id] || 0) * 100)}" data-snd="${s.id}" />
    </div>`).join('');

  $$('[data-snd]', el.soundRows).forEach((r) => {
    r.addEventListener('input', () => {
      sound.set(r.dataset.snd, Number(r.value) / 100);
      syncPulse();
    });
  });
  syncPulse();
}

function syncPulse() {
  const on = sound.active;
  el.soundPulse?.classList.toggle('is-on', on);
}

/* 波形可视化 */
let waveRaf = null;
function startWaveViz() {
  const cv = el.waveCanvas;
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.floor(r.width * dpr));
    cv.height = Math.max(1, Math.floor(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
  let t = 0;
  const draw = () => {
    const r = cv.getBoundingClientRect();
    const W = r.width, H = r.height;
    ctx.clearRect(0, 0, W, H);
    const spec = sound.getSpectrum();
    const on = sound.active;
    const bars = 46;
    const bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const p = i / bars;
      let amp;
      if (spec && on) {
        const idx = Math.floor(Math.pow(p, 1.5) * (spec.length * 0.55));
        amp = (spec[idx] / 255) * 0.85 + 0.06;
      } else {
        amp = 0.05 + 0.03 * Math.sin(t * 0.7 + i * 0.5);
      }
      const h = Math.max(2, amp * H * 0.62);
      const x = i * bw + bw * 0.22;
      const g = ctx.createLinearGradient(0, H / 2 - h / 2, 0, H / 2 + h / 2);
      g.addColorStop(0, 'rgba(223,243,250,.10)');
      g.addColorStop(0.5, `rgba(168,216,232,${0.20 + amp * 0.6})`);
      g.addColorStop(1, 'rgba(223,243,250,.10)');
      ctx.fillStyle = g;
      const w = bw * 0.56;
      ctx.beginPath();
      ctx.roundRect(x, H / 2 - h / 2, w, h, w / 2);
      ctx.fill();
    }
    t += 1 / 60;
    waveRaf = requestAnimationFrame(draw);
  };
  draw();
  el._waveResize = resize;
}
function stopWaveViz() {
  if (waveRaf) cancelAnimationFrame(waveRaf);
  waveRaf = null;
  if (el._waveResize) window.removeEventListener('resize', el._waveResize);
}

/* 定时 */
function startSoundTimer(minutes) {
  clearTimeout(soundTimer);
  if (!minutes) { el.timerLabel.textContent = '不限时'; return; }
  const end = Date.now() + minutes * 60000;
  el.timerLabel.textContent = `${minutes} 分`;
  const tick = () => {
    const left = end - Date.now();
    if (left <= 0) {
      sound.preset('off');
      el.timerLabel.textContent = '已结束';
      paintSound();
      whisper('时间到了，水自己静了。', 5000);
      return;
    }
    const m = Math.ceil(left / 60000);
    el.timerLabel.textContent = `${m} 分`;
    soundTimer = setTimeout(tick, 20000);
  };
  soundTimer = setTimeout(tick, 20000);
}

/* ══════════════════════════════════════════════
   浮念
   ══════════════════════════════════════════════ */

function paintDrift() {
  const list = [...store.get('drifts')].reverse();
  if (!list.length) {
    el.driftList.innerHTML = `<p class="empty-line" style="text-align:center;padding:20px 0">
      这里还是空的。<br />浮念不需要完整，半句话也可以。</p>`;
    return;
  }
  el.driftList.innerHTML = list.map((d) => `
    <div class="drift-item">
      <div class="drift-item__text">${escapeHtml(d.text)}</div>
      <div class="drift-item__foot">
        <span>${new Date(d.t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${new Date(d.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        <span style="display:flex;gap:9px;align-items:center">
          ${d.shared ? '<span class="drift-item__badge">Yumo 已看过</span>' : `<button data-share="${d.id}" type="button">交给 Yumo</button>`}
          <button data-del="${d.id}" type="button">丢掉</button>
        </span>
      </div>
    </div>`).join('');

  $$('[data-share]', el.driftList).forEach((b) => b.addEventListener('click', () => {
    const list2 = store.get('drifts').map((d) => d.id === b.dataset.share ? { ...d, shared: true } : d);
    store.put('drifts', list2);
    whisper('Yumo 会在下次对话里想起这件事。');
    paintDrift();
  }));
  $$('[data-del]', el.driftList).forEach((b) => b.addEventListener('click', () => {
    store.put('drifts', store.get('drifts').filter((d) => d.id !== b.dataset.del));
    paintDrift();
  }));
}

/* ══════════════════════════════════════════════
   器皿（设置）
   ══════════════════════════════════════════════ */

function rowToggle(label, desc, key) {
  const on = !!store.get('settings')[key];
  return `<div class="set-row">
    <div class="set-row__txt"><b>${label}</b><span>${desc}</span></div>
    <button class="toggle ${on ? 'is-on' : ''}" data-toggle="${key}" type="button" aria-label="${label}"></button>
  </div>`;
}

function paintSettings() {
  const s = store.get('settings');
  const p = store.get('profile');
  const voiceOpts = speaker.voices.map((v) =>
    `<option value="${escapeHtml(v.name)}" ${v.name === s.voiceName ? 'selected' : ''}>${escapeHtml(v.name)} · ${v.lang}</option>`).join('');

  el.settingsBody.innerHTML = `
    <div class="card">
      <div class="card__label">连接 · DeepSeek</div>
      <p class="empty-line" style="margin-bottom:14px">
        密钥只存在这台设备上，不会经过任何第三方。<br />
        这个页面是纯前端，所以请不要在公开设备上填写。
      </p>
      <input class="field" id="set-key" type="password" placeholder="sk-..." value="${escapeHtml(s.apiKey)}" autocomplete="off" spellcheck="false" />
      <div class="field-row">
        <input class="field" id="set-model" type="text" placeholder="deepseek-chat" value="${escapeHtml(s.model)}" spellcheck="false" />
        <button class="btn-ghost" id="btn-test" type="button">试一试</button>
      </div>
      <div class="field-row">
        <input class="field" id="set-base" type="text" value="${escapeHtml(s.baseUrl)}" spellcheck="false" />
      </div>
      <p class="empty-line" style="margin-top:12px" id="test-result"></p>
    </div>

    <div class="card card--plain">
      <div class="card__label">Yumo 的存在方式</div>
      ${rowToggle('深潜模式', '由 Yumo 带着你往下走，它会不断提问', 'deepMode')}
      ${rowToggle('自动提炼记忆与画像', '每次对话后，静默整理它对你的理解', 'autoDigest')}
    </div>

    <div class="card card--plain">
      <div class="card__label">声音</div>
      ${speaker.supported ? `
        ${rowToggle('自动朗读回复', 'Yumo 说完话后读给你听', 'speakReplies')}
        <div class="set-row">
          <div class="set-row__txt"><b>语速</b><span>${(s.speakRate || 1).toFixed(2)} 倍</span></div>
        </div>
        <input type="range" min="60" max="150" value="${Math.round((s.speakRate || 1) * 100)}" id="set-rate" style="width:100%;-webkit-appearance:none;height:2px;background:rgba(168,216,232,.14);border-radius:99px;outline:none" />
        ${voiceOpts ? `<div class="field-row" style="margin-top:14px">
          <select class="field" id="set-voice" style="font-family:var(--font-sans)">
            <option value="">跟随系统默认</option>${voiceOpts}
          </select>
        </div>` : ''}
        ${speaker.voices.length ? '' : '<p class="empty-line" style="margin-top:10px">系统还没报出可用的音色，点一下页面任意处再回来看看。</p>'}
      ` : '<p class="empty-line">这台设备不支持朗读。</p>'}
    </div>

    <div class="card card--plain">
      <div class="card__label">这片水里的东西</div>
      <div class="stat-grid">
        <div class="stat"><b>${store.get('messages').length}</b><span>条 说 过 的 话</span></div>
        <div class="stat"><b>${store.get('memories').length}</b><span>记 住 的 事</span></div>
        <div class="stat"><b>${store.get('echoes').length}</b><span>回 声</span></div>
      </div>
      <div class="field-row" style="margin-top:16px;flex-wrap:wrap">
        <button class="btn-ghost" id="btn-export" type="button">导出全部数据</button>
        <button class="btn-ghost btn-danger" id="btn-wipe" type="button">清空这片水</button>
      </div>
    </div>

    <p class="note-quiet">
      Yumo • 深海陪伴者<br />
      它不是一个产品，是一片你可以反复回来的水。<br />
      所有内容存在你自己的浏览器里。删掉，就真的没有了。
    </p>
  `;

  // 绑定
  const keyEl = $('#set-key');
  keyEl?.addEventListener('change', () => {
    store.set('settings', { apiKey: keyEl.value.trim() });
    updateModelChip();
    whisper(keyEl.value.trim() ? '已经连上了。' : '已经断开了。');
  });
  $('#set-model')?.addEventListener('change', (e) => {
    store.set('settings', { model: e.target.value.trim() || 'deepseek-chat' });
    updateModelChip();
  });
  $('#set-base')?.addEventListener('change', (e) => {
    store.set('settings', { baseUrl: e.target.value.trim() || 'https://api.deepseek.com' });
  });
  $('#btn-test')?.addEventListener('click', async () => {
    const out = $('#test-result');
    out.textContent = '正在试…';
    const r = await ai.testConnection();
    out.textContent = r.ok ? `✓ 有回应：「${r.msg}」` : `✗ ${r.msg}`;
    out.style.color = r.ok ? 'var(--tide-200)' : '#D98A8A';
  });
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.toggle;
    const next = !store.get('settings')[k];
    store.set('settings', { [k]: next });
    b.classList.toggle('is-on', next);
  }));
  $('#set-rate')?.addEventListener('input', (e) => {
    store.set('settings', { speakRate: Number(e.target.value) / 100 });
    speaker.rate = Number(e.target.value) / 100;
    e.target.previousElementSibling.querySelector('span').textContent = speaker.rate.toFixed(2) + ' 倍';
  });
  $('#set-voice')?.addEventListener('change', (e) => {
    store.set('settings', { voiceName: e.target.value });
    speaker.setVoice(e.target.value);
  });
  $('#btn-export')?.addEventListener('click', () => {
    const blob = new Blob([store.export()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yumo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    whisper('已经带走了一份。');
  });
  $('#btn-wipe')?.addEventListener('click', () => {
    if (confirm('清空之后，Yumo 就再也不记得你了。真的要这么做吗？')) store.wipe();
  });
}

/* ══════════════════════════════════════════════
   回声海
   ══════════════════════════════════════════════ */

const VOICES = [
  { mood: 'dusk',   text: '今天把他的号码删了。第三次。' },
  { mood: 'cocoon', text: '我妈生病那年我十七岁。现在我三十一了，还是不敢听医院走廊的声音。' },
  { mood: 'dawn',   text: '今天第一次一个人去看了电影，发现也没那么可怕。' },
  { mood: 'dusk',   text: '我们分手很平静，没有吵架。可我总觉得，是不是我哪里不够用力。' },
  { mood: 'cocoon', text: '我一直在等他说一句「辛苦了」。等到现在也不打算等了。' },
  { mood: 'dawn',   text: '开始学游泳了。四十二岁，第一次敢把头埋进水里。' },
  { mood: 'cocoon', text: '所有人都说我过得好。只有我知道每天早上要花多久才能起床。' },
  { mood: 'dusk',   text: '爷爷走的那天是个晴天。我居然笑了，因为我松了口气。我到现在都不能原谅自己那个笑。' },
  { mood: 'dawn',   text: '我把辞职信发出去了。手在抖，但心里很静。' },
  { mood: 'cocoon', text: '我不知道自己想要什么。这句话我说了十年了。' },
  { mood: 'dusk',   text: '其实我不是想死，我只是想停下来。' },
  { mood: 'dawn',   text: '今天有个陌生人帮我扶了门。我居然在电梯里哭了。' },
  { mood: 'cocoon', text: '我今年三十五岁，还是不敢让任何人看到我没化妆的样子。' },
  { mood: 'dusk',   text: '养了十四年的猫走了。房间太安静了。' },
  { mood: 'dawn',   text: '和他打了电话，说了很多年没说的话。挂掉以后，睡得特别好。' },
  { mood: 'cocoon', text: '我很努力地想让父母满意。后来发现他们满意的那个我，我自己都觉得陌生。' },
  { mood: 'dawn',   text: '今天出门前，我对镜子里的自己说了句「今天也辛苦了」。有点傻，但我笑了。' },
  { mood: 'cocoon', text: '我一直在做一个很懂事的女儿。累。' },
  { mood: 'dusk',   text: '有些人不在了，但他们的椅子还空在那里。' },
  { mood: 'dawn',   text: '第一次自己煮了一顿饭。糊了。但我吃完了。' },
];

const ANCHORS = {
  dusk:   { name: '暮', sub: '告别' },
  cocoon: { name: '茧', sub: '转化' },
  dawn:   { name: '曙', sub: '重生' },
};

function openSanctuary() {
  el.sanctuaryVeil.hidden = false;
  const saved = store.get('sea') || { lights: {} };
  const list = VOICES.map((v, i) => ({
    text: v.text,
    mood: v.mood,
    light: saved.lights?.[i] || 0,
  }));

  // 等布局稳定后再布点，否则星星会挤在左上角
  echoSea = new EchoSea(el.seaCanvas);
  if (window.__yumo) window.__yumo.echoSea = echoSea;
  echoSea.onPick = (star) => {
    const idx = VOICES.findIndex((v) => v.text === star.text);
    const a = ANCHORS[star.mood];
    el.starCard.innerHTML = `
      <div class="card__label" style="text-align:center">${a.name} · ${a.sub}</div>
      <p style="font-family:var(--font-serif);font-size:15.5px;line-height:2.1;letter-spacing:.05em;color:var(--mist-050);text-align:center;margin:14px 0 0">${escapeHtml(star.text)}</p>
      <p class="empty-line" style="text-align:center;margin-top:16px">
        这一段来自一个陌生人。他不在你认识的人里。
      </p>
      <div style="display:flex;justify-content:center;gap:10px;margin-top:20px">
        <button class="btn-ghost" id="star-light" type="button">
          ${star.light > 0 ? `★ 已点过 ${star.light} 次` : '为他点一束光'}
        </button>
        <button class="btn-ghost" id="star-next" type="button">漂流到下一颗</button>
      </div>
      <p class="empty-line" style="text-align:center;margin-top:16px;font-size:10.5px">
        你的点光也是匿名的。他只会看到自己的星星亮了一点。
      </p>`;
    el.starModal.hidden = false;

    $('#star-light')?.addEventListener('click', () => {
      star.light = (star.light || 0) + 1;
      const lights = { ...(saved.lights || {}) };
      lights[idx] = star.light;
      store.set('sea', { lights });
      $('#star-light').textContent = `★ 已点过 ${star.light} 次`;
      whisper('你把光放在那里了。');
    });
    $('#star-next')?.addEventListener('click', () => {
      el.starModal.hidden = true;
      const others = echoSea.stars.filter((s) => s !== star);
      const pick = others[Math.floor(Math.random() * others.length)];
      if (pick) echoSea.onPick(pick);
    });
  };
  requestAnimationFrame(() => {
    if (!echoSea) return;
    echoSea.resize();
    echoSea.load(list);
    echoSea.start();
  });
}

function closeSanctuary() {
  el.sanctuaryVeil.hidden = true;
  el.starModal.hidden = true;
  echoSea?.stop();
  echoSea = null;
}

/* ══════════════════════════════════════════════
   抽屉
   ══════════════════════════════════════════════ */

const NAV = [
  { to: 'talk',     label: '心灵对话', icon: '<path d="M4 5.5h16v11H9l-5 4z"/>' },
  { to: 'garden',   label: '潮汐花园', icon: '<path d="M12 21c-5 0-8-3-8-7 0-5 8-11 8-11s8 6 8 11c0 4-3 7-8 7z"/>' },
  { to: 'mirror',   label: '心象',     icon: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M7 20h10M12 16v4"/>' },
  { to: 'sound',    label: '声境',     icon: '<path d="M12 3v18M7 8v8M17 8v8M3 11v2M21 11v2"/>' },
  { to: 'drift',    label: '浮念',     icon: '<path d="M5 6h14M5 12h14M5 18h8"/>' },
  { to: 'settings', label: '器皿',     icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>' },
];

function paintDrawer() {
  el.drawerNav.innerHTML = NAV.map((n) => `
    <button class="drawer__item" data-goto="${n.to}" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">${n.icon}</svg>
      <span>${n.label}</span>
      ${n.to === 'garden' ? `<em>${store.get('profile').turns || 0} 轮</em>` : ''}
    </button>`).join('');
}

/* ══════════════════════════════════════════════
   全局事件绑定
   ══════════════════════════════════════════════ */

document.addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) {
    if (goto.dataset.goto === 'spring') navigate('spring');
    else navigate(goto.dataset.goto);
    el.drawer.hidden = true;
    return;
  }
  if (e.target.closest('[data-close="drawer"]')) { el.drawer.hidden = true; return; }
});

$('#btn-dive')?.addEventListener('click', () => {
  store.set('flags', { dived: true });
  // 第一声水响：借用户手势启动音频，但先保持静音
  sound.ensure();
  navigate('spring');
  setTimeout(() => {
    el.springState.textContent = store.get('messages').length > 1
      ? '你回来了。'
      : '水很静。我在这里。';
  }, 900);
});

$('#core')?.addEventListener('click', () => navigate('talk'));
$('#core')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('talk'); }
});

$('#btn-menu')?.addEventListener('click', () => { paintDrawer(); el.drawer.hidden = false; });
$('#drawer-reset')?.addEventListener('click', () => {
  if (confirm('清空之后，Yumo 就再也不记得你了。真的要这么做吗？')) store.wipe();
});
$('#btn-sanctuary')?.addEventListener('click', openSanctuary);
$('#sanctuary-close')?.addEventListener('click', closeSanctuary);
$('#star-modal')?.addEventListener('click', (e) => { if (e.target.id === 'star-modal') el.starModal.hidden = true; });

/* 对话输入 */
el.input?.addEventListener('input', autoGrow);
el.input?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#btn-send')?.addEventListener('click', send);
$('#btn-mic')?.addEventListener('click', toggleListen);
$('#btn-rec-stop')?.addEventListener('click', () => listener.stop());
$('#btn-image')?.addEventListener('click', () => el.fileInput?.click());

/* 深潜 */
$('#btn-deep')?.addEventListener('click', () => {
  const next = !store.get('settings').deepMode;
  store.set('settings', { deepMode: next });
  $('#btn-deep').classList.toggle('is-on', next);
  whisper(next ? '深潜模式。这次由我带路。' : '回到平常的陪伴。');
});

/* 声境定时 */
$('#btn-timer')?.addEventListener('click', () => {
  const opts = [0, 15, 30, 60];
  const cur = Number(el.timerLabel.dataset.min || 30);
  const next = opts[(opts.indexOf(cur) + 1) % opts.length];
  el.timerLabel.dataset.min = next;
  el.timerLabel.dataset.custom = '1';
  if (next === 0) { clearTimeout(soundTimer); el.timerLabel.textContent = '不限时'; }
  else { startSoundTimer(next); }
});

/* 浮念 */
$('#drift-save')?.addEventListener('click', () => {
  const t = el.driftInput.value.trim();
  if (!t) return;
  store.pushDrift(t, false);
  el.driftInput.value = '';
  paintDrift();
  whisper('放进水里了。');
});
$('#drift-share')?.addEventListener('click', () => {
  const t = el.driftInput.value.trim();
  if (!t) return;
  store.pushDrift(t, true);
  el.driftInput.value = '';
  paintDrift();
  whisper('Yumo 已经看过了。');
});

/* 花园分段 */
$$('#garden-seg .seg__i').forEach((b) => b.addEventListener('click', () => {
  $$('#garden-seg .seg__i').forEach((x) => x.classList.remove('is-on'));
  b.classList.add('is-on');
  garden?.setTab(b.dataset.tab);
}));

/* 键盘：Esc 一层层往回退 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.starModal.hidden) { el.starModal.hidden = true; return; }
  if (!el.drawer.hidden) { el.drawer.hidden = true; return; }
  if (!el.sanctuaryVeil.hidden) { closeSanctuary(); return; }
  if (view !== 'spring' && view !== 'threshold') navigate('spring');
});

/* 页面可见性：省电 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { sea.stop(); speaker.cancel(); }
  else sea.start();
});

/* ══════════════════════════════════════════════
   启动
   ══════════════════════════════════════════════ */

function boot() {
  sea.start();
  speaker.load();
  setMood(currentMood());

  garden = renderGarden(el.gardenBody, { whisper });
  renderMirror(el.mirrorBody, { whisper, navigate });
  paintDrift();
  updateModelChip();

  $('#btn-deep')?.classList.toggle('is-on', !!store.get('settings').deepMode);
  paintThread();

  // 门户：如果已经来过，跳过门槛
  if (store.get('flags').dived && store.get('messages').length) {
    navigate('spring');
    el.springState.textContent = '你回来了。';
  }

  // 首次进入的提示
  if (!store.get('settings').apiKey) {
    setTimeout(() => whisper('这只是一种陪伴，不是治疗。如果你正处在很黑的时刻，请一定找一个真人。', 7000), 2600);
  }
}

boot();

/* 圆角矩形兜底（老浏览器） */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
    return this;
  };
}

window.__yumo = { store, ai, sound, sea, navigate, whisper };
