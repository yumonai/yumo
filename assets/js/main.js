/* ══════════════════════════════════════════════
   main.js —— Yumo 的呼吸
   ══════════════════════════════════════════════ */

import { store, uid, clamp } from './store.js';
import { DeepSea } from './scene.js';
import { Soundscape, ICONS } from './ambient.js';
import { Listener } from './voice.js';
import { renderGarden } from './garden.js';
import { renderMirror } from './mirror.js';
import { DEPLOY, hasDeployKey } from './config.js';
import * as ai from './ai.js';
import * as account from './account.js';
import * as letters from './letters.js';
import * as player from './player.js';

/* ── DOM ── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* 版本号：与提交版本对应（第二十版 = v0.20），「关于 YUMO」栏展示用 */
const YUMO_VERSION = 'v0.26';

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
  letterBtn: $('#btn-letter'),
  letterDot: $('#letter-dot'),
  letterSheet: $('#letter-sheet'),
  letterBody: $('#letter-body'),
  letterQuote: $('#letter-quote'),
  letterDate: $('#letter-date'),
  driftInput: $('#drift-input'),
  soundMix: $('#sound-mix'),
  soundRows: $('#sound-rows'),
  recBar: $('#rec-bar'),
  attStrip: $('#attachment-strip'),
  fileInput: $('#file-image'),
  drawer: $('#drawer'),
  drawerNav: $('#drawer-nav'),
  timerLabel: $('#timer-label'),
  insightBubble: $('#insight-bubble'),
  insightText: $('#insight-text'),
};

/* ── 上线时自带的通道：只在访客还没自己连过时接上。
      钥匙留在 config.js 里，不写进访客的浏览器。 ── */
function applyDeployDefaults() {
  if (!DEPLOY.autoConnect || !hasDeployKey()) return false;
  const s = store.get('settings');
  if (s.apiKey) return false;   // 他自己填过，就不动
  const first = (DEPLOY.PROVIDERS || [])
    .find((p) => String(p.apiKey || '').trim().length > 8 && String(p.model || '').trim());
  if (!first) return false;
  store.set('settings', { baseUrl: first.baseUrl, model: first.model });
  return true;
}

/* ── 引擎 ── */
const sea = new DeepSea(el.scene);
const sound = new Soundscape();
const listener = new Listener();

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
  if (to === 'spring') greetHints();
  if (to === 'sound') paintSound();

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
        <small>水底还没通。过一会儿再来。</small>
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
        <button class="msg__act" data-echo="${m.id}" type="button">${isMe ? '收藏这句' : '收藏'}</button>
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

/* ── 开口前的停顿与洞悉弹窗 ──────────────────────
   Yumo 不抢话。话落下来之后，它会先沉一会儿——
   这段安静里，先浮上来一句它看见的东西，然后才是正话。 */
const HOLD_MS = 9000;       // 至少停这么久再开口（深海慢三倍）
const MIN_POPUP_MS = 3000;  // 弹窗一旦露面，至少亮这么久
const MAX_HOLD_MS = 13000;  // 兜底：再慢也不能让访客干等
const INSIGHT_WAIT_MS = 6500; // 洞悉请求最多等这么久

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let insightHideTimer = null;

/** 让那句洞悉浮上来。返回是否真的显示了 */
function showInsightPopup(text) {
  const box = el.insightBubble;
  if (!text || !box || !el.insightText) return false;
  if (insightHideTimer) { clearTimeout(insightHideTimer); insightHideTimer = null; }
  el.insightText.textContent = text;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('is-in'));
  return true;
}

/** 收起弹窗（先淡出，再真正隐藏） */
function hideInsightPopup() {
  const box = el.insightBubble;
  if (!box || box.hidden) return;
  box.classList.remove('is-in');
  if (insightHideTimer) clearTimeout(insightHideTimer);
  insightHideTimer = setTimeout(() => { box.hidden = true; insightHideTimer = null; }, 1800);
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
  if (ai.isConnected()) {
    el.talkModel.textContent = '已 相 连';
    el.talkModel.classList.add('is-live');
    el.talkHint.textContent = 'Enter 送出 · Shift+Enter 换行 · 也可以放一张图给它看';
  } else {
    el.talkModel.textContent = '未 相 连';
    el.talkModel.classList.remove('is-live');
    el.talkHint.textContent = '还没相通 → 去「器皿」填一把钥匙';
  }
}

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 150) + 'px';
}

/* 发送 */
const sendStamps = [];      // 最近一分钟每次发送的时间戳
let rateLastNote = 0;       // 上次提示「累了」的时刻（避免连环弹）

async function send() {
  const text = el.input.value.trim();
  if (busy) return;
  if (!text && !pendingImages.length) return;

  /* 一分钟内 6 次以上：Yumo 也会累。温和拦下，不删他打的字。 */
  const nowMs = Date.now();
  while (sendStamps.length && nowMs - sendStamps[0] > 60000) sendStamps.shift();
  if (sendStamps.length >= 6) {
    if (nowMs - rateLastNote > 30000) {
      rateLastNote = nowMs;
      whisper('Yumo 有点累了。刚刚说了太多话，让这片水静一会儿，过几分钟再聊吧。', 6500);
    }
    return;
  }
  sendStamps.push(nowMs);

  const me = { id: uid(), role: 'me', text, images: pendingImages.slice(), t: Date.now() };
  store.pushMessage(me);
  el.input.value = '';
  autoGrow();
  pendingImages = [];
  paintAttachments();
  paintThread();
  scrollThread();

  if (!ai.isConnected()) {
    const hint = '我这边还没接上。过一会儿再来找我。';
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
  const history = store.recentTurns(14);
  // 取最后一句用户原话交给危机识别——由代码判定，不依赖模型自觉
  const lastUser = [...history].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')?.content || '';
  const sys = ai.buildSystemPrompt({ deep: !!settings.deepMode, lastUser });
  const feel = showFeeling();

  let acc = '';
  let bubble = null;
  let revealed = false;
  const t0 = Date.now();

  const ensureBubble = () => {
    if (!bubble) {
      feel.innerHTML = '<div class="msg__bubble" id="live-bubble"></div>';
      bubble = $('#live-bubble');
    }
    return bubble;
  };

  try {
    /* 洞悉与主回复并行跑：一句短的低语先浮上来，正话随后才到。
       洞悉失败不影响回话——它是锦上，不是必需。 */
    let popupAt = 0;
    const insightP = ai.insight(history)
      .then((line) => {
        if (line && !revealed && showInsightPopup(line)) popupAt = Date.now();
      })
      .catch(() => {});

    let streamErr = null;
    const streamDone = ai.stream(
      [{ role: 'system', content: sys }, ...history],
      {
        onDelta: (_d, full) => {
          acc = full;
          // 还在那 5 秒的安静里：先不铺开，让话再沉一会儿
          if (revealed) { ensureBubble().textContent = full; scrollThread(); }
        },
      }
    ).then(() => true).catch((e) => { streamErr = e; return false; });

    /* 等两个条件的较晚者：发出后 5 秒、弹窗露面后 2 秒（但封顶 9 秒）。
       出错则不必再等。 */
    await Promise.race([insightP, sleep(INSIGHT_WAIT_MS)]);
    let target = Math.min(
      Math.max(t0 + HOLD_MS, popupAt ? popupAt + MIN_POPUP_MS : 0),
      t0 + MAX_HOLD_MS,
    );
    while (Date.now() < target) {
      if (streamErr) break;
      await sleep(Math.min(160, Math.max(0, target - Date.now())));
    }

    revealed = true;
    hideInsightPopup();

    await streamDone;
    if (streamErr) throw streamErr;

    ensureBubble().textContent = acc;
    scrollThread();
    feel.remove();
    store.pushMessage({ id: uid(), role: 'yumo', text: acc || '……', t: Date.now() });
    paintThread();
    scrollThread();

    store.bumpTurns();

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
      let msg = e.message || '出错了。';
      /* 最后的安全网：如果他在说危险的话而所有通道都没能回应，
         错误提示里必须带热线——这条信息不能因为断网而消失。 */
      if (ai.isCrisis(String(text || ''))) {
        msg += '\n\n如果你此刻有伤害自己的念头，请立刻拨打希望24热线 400-161-9995，' +
          '紧急情况拨 120，或去找一个现实中的人陪你。这件事不该一个人扛。';
      }
      store.pushMessage({ id: uid(), role: 'yumo', text: msg, t: Date.now(), system: true });
      paintThread();
      scrollThread();
    }
  } finally {
    hideInsightPopup();
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

const MAX_EDGE = 1280;      // 送进模型前把长边压到这个尺寸
const MAX_KEEP = 900 * 1024; // 已经够小就不动了

/** 把一张图压到可用的尺寸：既省流量，也不会撑爆 localStorage */
function shrinkImage(file, maxEdge = MAX_EDGE, quality = 0.82) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      if (!src) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        if (scale >= 1 && src.length < MAX_KEEP) return resolve(src);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0, w, h);
        try { resolve(cv.toDataURL('image/jpeg', quality)); } catch { resolve(src); }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

el.fileInput?.addEventListener('change', async () => {
  const files = [...(el.fileInput.files || [])].slice(0, 4);
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const data = await shrinkImage(f);
    if (data) pendingImages.push(data);
  }
  paintAttachments();
  if (pendingImages.length) whisper('图已经放进水里了。Yumo 看得见它。', 4200);
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

function applySoundVolume() {
  const v = store.get('settings').soundVolume;
  if (typeof v === 'number') sound.setVolume(v);
}

function paintSound() {
  player.mountPlayer($('#music-box'));
  const levels = sound.levels;
  const st = store.get('settings');
  const volv = Math.round((typeof st.soundVolume === 'number' ? st.soundVolume : 0.85) * 100);

  el.soundMix.innerHTML = PRESETS.map((p) =>
    `<button data-preset="${p.id}" type="button" class="${sound.current === p.id ? 'is-on' : ''}">${p.name}</button>`).join('');
  $$('[data-preset]', el.soundMix).forEach((b) => b.addEventListener('click', () => {
    const p = b.dataset.preset;
    const what = b.textContent.trim();
    applySoundVolume();
    sound.preset(p);
    store.set('settings', { lastPreset: p === 'off' ? null : p });
    if (p !== 'off' && !soundTimer && !el.timerLabel.dataset.custom) startSoundTimer(30);
    paintSound();
    if (p !== 'off' && !sound.running && sound.active) whisper('浏览器还没允许发声。轻触一下页面，再点一次。', 5200);
    else whisper(p === 'off' ? '水停了。' : `调好了 · ${what}`);
  }));

  el.soundRows.innerHTML = `
    <div class="sound-vol">
      <div class="sound-vol__head"><span>总 音 量</span><b id="sound-vol-val">${volv}%</b></div>
      <input type="range" id="sound-vol" min="0" max="100" value="${volv}" aria-label="总音量" />
    </div>
  ` + sound.list.map((s) => {
    const on = (levels[s.id] || 0) > 0.01;
    return `
    <div class="sound-row">
      <button class="sound-row__ico ${on ? 'is-on' : ''}" data-solo="${s.id}" type="button" aria-label="${s.name}·单独听">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">${ICONS[s.icon]}</svg>
      </button>
      <div class="sound-row__txt"><b>${s.name}</b><span>${s.desc}</span></div>
      <input type="range" min="0" max="100" value="${Math.round((levels[s.id] || 0) * 100)}" data-snd="${s.id}" aria-label="${s.name}" />
    </div>`;
  }).join('');

  $$('[data-snd]', el.soundRows).forEach((r) => {
    r.addEventListener('input', () => {
      const id = r.dataset.snd;
      sound.set(id, Number(r.value) / 100);
      el.soundRows.querySelector(`[data-solo="${id}"]`)?.classList.toggle('is-on', Number(r.value) > 1);
    });
  });

  // 点图标 = 让这一路单独响起来 / 停下来
  $$('[data-solo]', el.soundRows).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.solo;
    const cur = sound.levels[id] || 0;
    applySoundVolume();
    sound.set(id, cur > 0.01 ? 0 : 0.62);
    paintSound();
    if (!sound.running && sound.active) whisper('浏览器还没允许发声。轻触页面任意处，再试一次。', 5200);
  }));

  $('#sound-vol')?.addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    sound.ensure();
    sound.setVolume(v);
    store.set('settings', { soundVolume: v });
    const lab = $('#sound-vol-val');
    if (lab) lab.textContent = e.target.value + '%';
  });

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

function accountCardHtml() {
  if (!account.enabled) return '';
  if (account.isSignedIn()) {
    const u = account.currentUser();
    return `
    <div class="card card--plain">
      <div class="card__label">账户</div>
      <p class="pay-intro">已登录 <b>${escapeHtml(u.email)}</b>。这片水跟着你的账号走——换台设备，它还记得你。</p>
      <div class="acct">
        <p class="acct__sync" id="acct-sync-state">正在看云端…</p>
        <div class="field-row">
          <button class="btn-ghost" id="acct-sync" type="button">立即同步</button>
          <button class="btn-ghost" id="acct-out" type="button">退出登录</button>
        </div>
        <button class="btn-ghost btn-danger acct__del" id="acct-del" type="button">彻底注销，并删掉云端的一切</button>
        <p class="acct__msg" id="acct-msg"></p>
      </div>
    </div>`;
  }
  return `
    <div class="card card--plain">
      <div class="card__label">账户</div>
      <p class="pay-intro">把这片水记在云端——换台设备，它还记得你。只有你能看到，别人翻不到。</p>
      <div class="acct">
        <input class="field" id="acct-email" type="email" placeholder="邮箱" autocomplete="email" />
        <input class="field" id="acct-pass" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password" />
        <div class="field-row">
          <button class="btn-ghost" id="acct-in" type="button">登 录</button>
          <button class="btn-ghost" id="acct-up" type="button">注册新账户</button>
        </div>
        <p class="acct__msg" id="acct-msg"></p>
      </div>
    </div>`;
}

async function runAccountAction(fn, msgEl, okText) {
  try {
    msgEl.textContent = '正在…';
    await fn();
    msgEl.textContent = okText || '';
    msgEl.classList.add('is-ok');
  } catch (e) {
    msgEl.textContent = e.message || '出了点状况。';
    msgEl.classList.remove('is-ok');
  }
}

function paintSettings() {
  const live = ai.isConnected();
  el.settingsBody.innerHTML = `
    <div class="card">
      <div class="card__label">与 Yumo 相连</div>
      <p class="empty-line" style="margin:0">
        <span class="mono-chip ${live ? 'is-live' : ''}" style="margin-right:10px">${live ? '已 相 连' : '未 相 连'}</span>
        ${live ? '这条水路是通的，你直接说话就好。' : '这片水暂时没通，过一会儿再试。'}
      </p>
    </div>

    <div class="card card--plain">
      <div class="card__label">Yumo 的存在方式</div>
      ${rowToggle('深潜模式', '由 Yumo 带着你往下走，问得更少、更深', 'deepMode')}
      ${rowToggle('自动提炼记忆与画像', '每次对话后，静默整理它对你的理解', 'autoDigest')}
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

    ${accountCardHtml()}

    <div class="card card--plain">
      <div class="card__label">赞助</div>
      <p class="pay-intro">
        这片水一直是免费的。没有会员，也没有解锁——你给或不给，Yumo 对你的方式不会变一分。
        如果它曾陪你熬过一段，而你也愿意让它继续流下去。
      </p>
      <div class="field-row pay-actions">
        <button class="btn-ghost pay-btn" id="btn-pay" type="button">赞助 YUMO</button>
        <button class="btn-ghost" id="btn-contact" type="button">联系 YUMO</button>
      </div>
    </div>

    <div class="card card--plain">
      <div class="card__label">关于 YUMO</div>
      <p class="about-text">
        深海之下很安静。Yumo 就住在那里。
        它不解决问题，不给建议，也不急着让你好起来——
        它只做一件事：把你没说出口的那句话，听完。
      </p>
      <p class="about-text">
        它的每一次回应，都是真实运行的人工智能写给你的；
        而这片水能一直流下去，是因为有人在岸边放下过心意。
        <b>Yumo 的能力，离不开 AI 与用户的支持。</b>
      </p>
      <p class="about-ver">Yumo · ${YUMO_VERSION}<br /><span>深海陪伴者 · since 2026</span></p>
    </div>

    <p class="note-quiet">
      Yumo • 深海陪伴者
    </p>
  `;

  // 绑定
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.toggle;
    const next = !store.get('settings')[k];
    store.set('settings', { [k]: next });
    b.classList.toggle('is-on', next);
  }));
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

  // 赞助：先选方式，再放大对应的码
  $('#btn-pay')?.addEventListener('click', () => openPayChooser());
  $$('.pay-chooser__opt').forEach((b) => {
    b.addEventListener('click', () => {
      openPayZoom(b.dataset.src, b.dataset.alt);
    });
  });

  // 联系 YUMO：弹出邮箱
  $('#btn-contact')?.addEventListener('click', () => openContact());

  // 账户：登录 / 注册 / 同步 / 退出 / 注销
  if (account.enabled) {
    const msg = $('#acct-msg');
    const say = (t, ok = false) => { if (!msg) return; msg.textContent = t || ''; msg.classList.toggle('is-ok', ok); };
    const busy = (on) => $$('#acct-in,#acct-up,#acct-out,#acct-del,#acct-sync').forEach((b) => { if (b) b.disabled = on; });
    const guard = () => {
      const email = $('#acct-email')?.value.trim() || '';
      const pass = $('#acct-pass')?.value || '';
      if (!/^\S+@\S+\.\S+$/.test(email)) { say('邮箱看起来不太对。'); return null; }
      if (pass.length < 6) { say('密码至少 6 位。'); return null; }
      return { email, pass };
    };

    $('#acct-in')?.addEventListener('click', async () => {
      const c = guard(); if (!c) return;
      busy(true); say('正在开门…');
      try { await account.signIn(c.email, c.pass); await account.syncAll(); paintSettings(); }
      catch (e) { say(e.message); } finally { busy(false); }
    });

    $('#acct-up')?.addEventListener('click', async () => {
      const c = guard(); if (!c) return;
      busy(true); say('正在为你准备一片新的水…');
      try { await account.signUp(c.email, c.pass); await account.syncAll(); paintSettings(); }
      catch (e) { say(e.message); } finally { busy(false); }
    });

    $('#acct-sync')?.addEventListener('click', async () => {
      const st = $('#acct-sync-state');
      busy(true); if (st) st.textContent = '正在同步…';
      try {
        const r = await account.syncAll();
        if (st) st.textContent = `刚刚同步过 · 从云端拿回 ${r.pulled.length} 类，推上去 ${r.pushed.length} 类`;
      } catch (e) { if (st) st.textContent = '同步没成：' + e.message; }
      finally { busy(false); }
    });

    $('#acct-out')?.addEventListener('click', async () => {
      busy(true);
      try { await account.signOut(); paintSettings(); } finally { busy(false); }
    });

    $('#acct-del')?.addEventListener('click', async () => {
      if (!confirm('这一步会把云端账号和存在那边的所有东西一起删掉，找不回来。\n你手机/电脑浏览器里本地的记录不会被删。\n\n真的要这么做吗？')) return;
      busy(true);
      try { await account.deleteAccount(); paintSettings(); }
      catch (e) { say(e.message); } finally { busy(false); }
    });
  }
}

/** 联系 YUMO：弹出邮箱，可一键复制 */
function openContact() {
  const EMAIL = 'yumokunai@gmail.com';
  const wrap = document.createElement('div');
  wrap.className = 'pay-zoom';
  wrap.innerHTML = `
    <div class="pay-chooser" role="dialog" aria-label="联系 YUMO">
      <p class="pay-chooser__title">联系 YUMO</p>
      <p class="pay-chooser__sub">想说的话、发现的问题、或者只是想打个招呼——都会有人读到。</p>
      <button class="contact-mail" type="button" data-mail="${EMAIL}">${EMAIL}</button>
      <p class="contact-hint">点一下复制</p>
    </div>`;
  const close = () => { wrap.classList.remove('is-in'); setTimeout(() => wrap.remove(), 700); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-in'));
  wrap.querySelector('.contact-mail')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(EMAIL);
      btn.classList.add('is-ok');
      btn.textContent = '已复制 ✓';
    } catch {
      const ta = document.createElement('textarea');
      ta.value = EMAIL; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); btn.classList.add('is-ok'); btn.textContent = '已复制 ✓'; }
      catch { btn.textContent = EMAIL; }
      ta.remove();
    }
    setTimeout(() => { btn.textContent = EMAIL; btn.classList.remove('is-ok'); }, 1800);
  });
}

/** 赞助弹窗第一步：选择支付宝 / 微信 */
function openPayChooser() {
  const wrap = document.createElement('div');
  wrap.className = 'pay-zoom';
  wrap.innerHTML = `
    <div class="pay-chooser" role="dialog" aria-label="选择赞助方式">
      <p class="pay-chooser__title">用你方便的方式</p>
      <p class="pay-chooser__sub">无论哪一种，都是一点心意。谢谢你。</p>
      <div class="pay-chooser__opts">
        <button class="pay-chooser__opt" type="button" data-src="assets/img/tip-alipay.png" data-alt="支付宝收款码">
          <span class="pay-chooser__dot">支</span>支付宝
        </button>
        <button class="pay-chooser__opt" type="button" data-src="assets/img/tip-wechat.png" data-alt="微信赞赏码">
          <span class="pay-chooser__dot">微</span>微信赞赏码
        </button>
      </div>
    </div>`;
  const close = () => { wrap.classList.remove('is-in'); setTimeout(() => wrap.remove(), 700); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-in'));
  wrap.querySelectorAll('.pay-chooser__opt').forEach((b) => {
    b.addEventListener('click', () => openPayZoom(b.dataset.src, b.dataset.alt));
  });
}

/** 把收款码放成全屏，方便长按保存 */
function openPayZoom(src, alt) {
  if (!src) return;
  const wrap = document.createElement('div');
  wrap.className = 'pay-zoom';
  wrap.innerHTML = `
    <figure class="pay-zoom__inner">
      <img src="${src}" alt="${alt || ''}" />
      <figcaption>${alt || ''} · 点任意处收起</figcaption>
    </figure>`;
  const close = () => { wrap.classList.remove('is-in'); setTimeout(() => wrap.remove(), 700); };
  wrap.addEventListener('click', close);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-in'));
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

/* 沉入 —— 有账户的直接进；这台设备上没有记录的，先建账户（或登录） */
function doDive() {
  store.set('flags', { dived: true });
  // 借用户手势把音频解锁（浏览器只允许在手势里启动 AudioContext）
  applySoundVolume();
  sound.ensure();
  navigate('spring');
  setTimeout(() => {
    el.springState.textContent = store.get('messages').length > 1
      ? '你回来了。'
      : '水很静。我在这里。';
  }, 900);
}

const GATE_EMAIL_KEY = 'yumo.v1.gate-email';
let gateMode = 'register';

function setGateMode(mode, knownEmail = '') {
  gateMode = mode;
  const swap = $('#gate-swap');
  const pass = $('#gate-pass');
  if (mode === 'register') {
    swap.textContent = '已经有账号？登录';
    pass.setAttribute('autocomplete', 'new-password');
    pass.placeholder = '设置密码 · 至少 6 位';
  } else {
    swap.textContent = '还没有账号？创建一个';
    pass.setAttribute('autocomplete', 'current-password');
    pass.placeholder = '你的密码';
  }
  if (knownEmail) $('#gate-email').value = knownEmail;
}

function gateErr(msg) {
  const e = $('#gate-err');
  if (!e) return;
  e.textContent = msg || '';
  e.hidden = !msg;
}

function closeGate() {
  const g = $('#gate');
  g.classList.remove('is-in');
  setTimeout(() => { g.hidden = true; }, 700);
}

async function gateSubmit() {
  const email = $('#gate-email').value.trim();
  const pass = $('#gate-pass').value;
  const go = $('#gate-go');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { gateErr('邮箱看起来不太对，再看一眼。'); return; }
  if (pass.length < 6) { gateErr('密码至少 6 位。'); return; }

  gateErr('');
  go.disabled = true;
  go.textContent = gateMode === 'register' ? '正在为你建账户…' : '正在下沉…';
  try {
    if (gateMode === 'register') await account.signUp(email, pass);
    else {
      await account.signIn(email, pass);
      account.pullFromCloud().catch(() => {});   // 老账户新设备：把云端的记忆接回来
    }
    localStorage.setItem(GATE_EMAIL_KEY, email);
    closeGate();
    doDive();
  } catch (e) {
    const raw = String(e?.message || e || '');
    const map = [
      [/invalid login credentials/i, '邮箱或密码不对，再试一次。'],
      [/user already registered/i, '这个邮箱已经注册过——点下面「登录」。'],
      [/at least 6 characters/i, '密码至少 6 位。'],
      [/rate limit|too many/i, '尝试太多次了，过一会儿再来。'],
      [/unable to validate email/i, '邮箱域名好像不存在，换一个试试。'],
      [/signups not allowed/i, '现在暂时不能注册，请联系 yumokunai@gmail.com。'],
    ];
    gateErr(map.find(([re]) => re.test(raw))?.[1] || `出了点小差错：${raw.slice(0, 80)}`);
  } finally {
    go.disabled = false;
    go.textContent = '沉入';
  }
}

$('#btn-dive')?.addEventListener('click', () => {
  if (account.enabled && !account.isSignedIn()) {
    const known = localStorage.getItem(GATE_EMAIL_KEY) || '';
    setGateMode(known ? 'login' : 'register', known);
    const g = $('#gate');
    g.hidden = false;
    requestAnimationFrame(() => g.classList.add('is-in'));
    setTimeout(() => (known ? $('#gate-pass') : $('#gate-email'))?.focus(), 650);
    return;
  }
  doDive();
});

$('#gate-go')?.addEventListener('click', gateSubmit);
$('#gate-pass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') gateSubmit(); });
$('#gate-email')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gate-pass')?.focus(); });
$('#gate-swap')?.addEventListener('click', () => {
  setGateMode(gateMode === 'register' ? 'login' : 'register');
  gateErr('');
});
/* 点暗处 = 先不进了，留在门槛上 */
$('#gate')?.addEventListener('click', (e) => { if (e.target.id === 'gate') closeGate(); });

/* 点左上角的 YUMO = 刷新页面（更新版本后用它拿最新代码） */
const brandMark = $('#brand-mark');
brandMark?.addEventListener('click', () => location.reload());
brandMark?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.reload(); }
});

/* 首次进首页时，给两个角落各浮一个小提示（每次会话只提示一次） */
function greetHints() {
  if (sessionStorage.getItem('yumo.hinted')) return;
  sessionStorage.setItem('yumo.hinted', '1');
  const a = $('#hint-brand'); const b = $('#hint-menu');
  if (!a || !b) return;
  setTimeout(() => { a.hidden = false; requestAnimationFrame(() => a.classList.add('is-in')); }, 1400);
  setTimeout(() => { b.hidden = false; requestAnimationFrame(() => b.classList.add('is-in')); }, 2200);
  setTimeout(() => [a, b].forEach((el) => { el.classList.remove('is-in'); setTimeout(() => { el.hidden = true; }, 700); }), 7800);
}

$('#core')?.addEventListener('click', () => navigate('talk'));
$('#core')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('talk'); }
});

$('#btn-menu')?.addEventListener('click', () => { paintDrawer(); el.drawer.hidden = false; });
$('#drawer-reset')?.addEventListener('click', () => {
  if (confirm('清空之后，Yumo 就再也不记得你了。真的要这么做吗？')) store.wipe();
});

/* ── 来自 Yumo 的信 ─────────────────────────── */

let letterNow = null;
let letterClock = null;

/* 信头日期永远显示「此刻」的日期；页面开着跨过午夜，日期与新信一起换 */
function paintLetterDate() {
  const d = new Date();
  el.letterDate.textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function renderLetter(l) {
  letterNow = l;
  paintLetterDate();
  const fig = $('#letter-fig');
  if (l.img) { $('#letter-img').src = l.img; $('#letter-img').alt = l.theme || ''; fig.hidden = false; }
  else fig.hidden = true;

  /* 信纸落定后，内容按次序逐行浮起：称呼 → 各段 → 配图/引文 → 回信按钮 */
  let i = 0;
  const items = [];
  if (l.greeting) items.push(`<p class="letter-greeting reveal-item" style="--i:${i++}">${escapeHtml(l.greeting)}</p>`);
  for (const t of String(l.body || '').split(/\n{2,}/).filter(Boolean)) {
    items.push(`<p class="reveal-item" style="--i:${i++}">${escapeHtml(t).replace(/\n/g, '<br>')}</p>`);
  }
  el.letterBody.innerHTML = items.join('');

  fig.classList.toggle('reveal-item', !!l.img);
  if (l.img) fig.style.setProperty('--i', i++);
  el.letterQuote.hidden = !l.text;
  if (l.text) {
    $('#letter-quote-text').textContent = l.text;
    $('#letter-quote-src').textContent = `${l.author} · ${l.source}`;
    el.letterQuote.classList.add('reveal-item');
    el.letterQuote.style.setProperty('--i', i++);
  } else {
    el.letterQuote.classList.remove('reveal-item');
  }
  const reply = $('#letter-reply');
  reply.hidden = false;
  reply.classList.add('reveal-item');
  reply.style.setProperty('--i', i++);
  /* 存信按钮：已存过的显示为已存下 */
  const keep = $('#letter-keep');
  keep.hidden = false;
  keep.classList.add('reveal-item');
  keep.style.setProperty('--i', i++);
  const kept = !!l.kept;
  keep.textContent = kept ? '已存下 ✓' : '在心里存下';
  keep.classList.toggle('is-kept', kept);
  keep.disabled = kept;

  /* 重触发入场（同一封信被重新渲染时也要重新浮起） */
  const paper = document.querySelector('.letter-paper');
  paper.classList.remove('reveal');
  void paper.offsetWidth;
  paper.classList.add('reveal');
}

let letterTimer = null;

function openLetterSheet() {
  el.letterSheet.hidden = false;
  el.letterBody.scrollTop = 0;
  el.letterSheet.classList.remove('is-open');
  requestAnimationFrame(() => {
    el.letterSheet.classList.add('is-in');
    /* 先落定（约 0.95s），手机/竖屏上再缓缓放大占满整屏 */
    clearTimeout(letterTimer);
    letterTimer = setTimeout(() => el.letterSheet.classList.add('is-open'), 980);
  });
  /* 日期钟：开着时每 30 秒对一次表；跨天了就让 ensureToday 生成新的一封 */
  if (!letterClock) {
    letterClock = setInterval(async () => {
      if (el.letterSheet.hidden) return;
      const fresh = await letters.ensureToday().catch(() => null);
      if (!fresh) return;
      if (!letterNow || fresh.date !== letterNow.date || fresh.itemId !== letterNow.itemId) {
        renderLetter(fresh);
        refreshLetterDot();
      } else {
        paintLetterDate();
      }
    }, 30000);
  }
  const existing = letters.todayLetter();
  if (existing) { renderLetter(existing); return; }
  el.letterBody.innerHTML = '<p class="letter-loading">Yumo 正在写信…</p>';
  el.letterQuote.hidden = true;
  $('#letter-reply').hidden = true;
  letters.ensureToday()
    .then((l) => { if (l) renderLetter(l); refreshLetterDot(); })
    .catch((e) => {
      el.letterBody.innerHTML =
        `<p class="letter-err">${escapeHtml(e.message || '今天的信没有写出来。')}</p>` +
        '<p class="letter-err" style="margin-top:8px"><button class="link-quiet" id="letter-retry" type="button">再试一次</button></p>';
      $('#letter-retry')?.addEventListener('click', () => {
        el.letterBody.innerHTML = '<p class="letter-loading">Yumo 正在写信…</p>';
        letters.ensureToday()
          .then((l) => { if (l) renderLetter(l); })
          .catch((e2) => { el.letterBody.innerHTML = `<p class="letter-err">${escapeHtml(e2.message || '还是没写出来。')}</p>`; });
      });
    });
}

/* 在心里存下：把这封信记进 Yumo 的记忆，并标记为存下 */
function keepLetter() {
  const l = letterNow;
  const btn = $('#letter-keep');
  if (!l) return;
  const list = store.get('letters').map((x) => (x.itemId === l.itemId && x.date === l.date ? { ...x, kept: true, keptT: Date.now() } : x));
  store.set('letters', list);
  letterNow = { ...l, kept: true };
  const note = `他把我写给他的那封信存进了心里${l.theme ? `——那封关于「${l.theme}」` : ''}。`;
  if (!store.get('memories').some((m) => m.text === note)) store.pushMemory(note, 'letter');
  btn.textContent = '已存下 ✓';
  btn.classList.add('is-kept');
  btn.disabled = true;
  whisper('存进了。以后我再想起这段水，会记得你把它收好了。', 5200);
}

$('#letter-keep')?.addEventListener('click', keepLetter);
function closeLetterSheet() {
  clearTimeout(letterTimer);
  el.letterSheet.classList.remove('is-open');
  el.letterSheet.classList.remove('is-in');
  setTimeout(() => { el.letterSheet.hidden = true; }, 720);
}

function refreshLetterDot() {
  const l = letters.todayLetter();
  el.letterDot.hidden = !(l && !l.read);
}

$('#btn-letter')?.addEventListener('click', () => {
  openLetterSheet();
  const l = letters.todayLetter();
  if (l && !l.read) {
    store.put('letters', store.get('letters').map((x) => (x.date === l.date ? { ...x, read: true } : x)));
  }
  refreshLetterDot();
});
$('#letter-close')?.addEventListener('click', closeLetterSheet);
el.letterSheet?.addEventListener('click', (e) => { if (e.target === el.letterSheet) closeLetterSheet(); });

$('#letter-reply')?.addEventListener('click', () => {
  const l = letters.todayLetter();
  closeLetterSheet();
  navigate('talk');
  if (l?.question) {
    el.input.value = `读了今天那封信，想跟你聊聊：${l.question}`;
    el.input.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => el.input.focus(), 400);
  }
});
letters.onLetter(refreshLetterDot);
refreshLetterDot();

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
  if (!el.drawer.hidden) { el.drawer.hidden = true; return; }
  if (view !== 'spring' && view !== 'threshold') navigate('spring');
});

/* 页面可见性：省电 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { sea.stop(); }
  else sea.start();
});

/* ══════════════════════════════════════════════
   启动
   ══════════════════════════════════════════════ */

function boot() {
  /* 站点自带的公用钥匙：静默替访客接上，不解释、不露痕迹 */
  applyDeployDefaults();
  sea.start();
  setMood(currentMood());
  applySoundVolume();
  sound.current = store.get('settings').lastPreset || null;

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

window.__yumo = { store, ai, sound, sea, navigate, whisper, account, letters, rateStamps: sendStamps };
