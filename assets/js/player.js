/* ══════════════════════════════════════════════
   player.js —— 月下音乐会
   ──────────────────────────────────────────────
   声境里的第二个混音层：古典乐可以与水声同时流动。
   曲目全部是公有领域作曲家的公版/自由许可录音，自托管。

   结构：列表上方一条「正在播放」的播放条（流媒体样式）——
   封面 / 曲名 / 作者 / 上一首 / 播放暂停 / 下一首 / 可拖动进度条。
   点列表里的曲目 = 播它；一首放完自动接下一首。
   ══════════════════════════════════════════════ */

let audio = null;
let idx = -1;
let tracks = [];
let box = null;

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.6z"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 6h2v12H7zM19 6v12l-8.5-6z"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 6h2v12h-2zM5 6l8.5 6L5 18z"/></svg>';

function fmt(s) {
  if (!Number.isFinite(s)) return '0:00';
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ensureAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'none';
    audio.addEventListener('ended', () => play((idx + 1) % tracks.length));
    audio.addEventListener('timeupdate', paintPlayer);
  }
  return audio;
}

function $id(id) { return box?.querySelector('#' + id); }

/* 播放条：进度 / 时间 / 播放键 图标 */
function paintPlayer() {
  if (!box || idx < 0) return;
  const t = tracks[idx];
  const title = $id('pb-title');
  const artist = $id('pb-artist');
  if (title) title.textContent = t.title;
  if (artist) artist.textContent = `${t.composer} · ${t.sub}`;
  const fill = $id('pb-fill');
  const cur = $id('pb-cur');
  const len = $id('pb-len');
  if (len) len.textContent = fmt(audio?.duration);
  if (cur) cur.textContent = fmt(audio?.currentTime);
  if (fill && audio?.duration) fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
  const btn = $id('pb-play');
  if (btn) btn.innerHTML = audio && !audio.paused ? ICON_PAUSE : ICON_PLAY;
  const cover = $id('pb-cover');
  if (cover) cover.style.backgroundImage = `url('${t.cover}')`;
  const bar = $id('player-bar');
  if (bar) bar.classList.toggle('is-playing', !!audio && !audio.paused);
}

/* 列表行的高亮 */
function paintRows() {
  if (!box) return;
  [...box.querySelectorAll('.music-row')].forEach((row, i) => {
    row.classList.toggle('is-on', i === idx);
  });
}

function play(i, { force = false } = {}) {
  const a = ensureAudio();
  if (i === idx && !force) {
    /* 同一首：切换播放 / 暂停 */
    if (audio.paused) a.play().catch(() => {}); else a.pause();
  } else {
    idx = i;
    a.src = tracks[i].file;
    a.currentTime = 0;
    a.play().catch(() => {});
  }
  paintRows();
  paintPlayer();
}

function step(d) {
  if (!tracks.length) return;
  play((idx + d + tracks.length) % tracks.length, { force: true });
}

export function mountPlayer(container) {
  box = container;
  (async () => {
    try {
      const d = await (await fetch('assets/data/tracks.json?v=3', { cache: 'no-cache' })).json();
      tracks = d.tracks || [];
    } catch { tracks = []; }

    if (!tracks.length) { box.innerHTML = ''; return; }

    box.innerHTML = `
      <div class="card card--plain music">
        <div class="card__label">月下音乐会</div>

        <div class="player-bar" id="player-bar">
          <span class="player-bar__cover" id="pb-cover" aria-hidden="true"></span>
          <div class="player-bar__mid">
            <b id="pb-title">未在播放</b>
            <span id="pb-artist">从下面挑一首开始</span>
            <div class="player-bar__track" id="pb-track" role="slider" aria-label="播放进度">
              <i id="pb-fill"></i>
            </div>
            <div class="player-bar__times"><span id="pb-cur">0:00</span><span id="pb-len">0:00</span></div>
          </div>
          <div class="player-bar__ctrl">
            <button class="player-bar__btn" id="pb-prev" type="button" aria-label="上一首">${ICON_PREV}</button>
            <button class="player-bar__btn player-bar__btn--main" id="pb-play" type="button" aria-label="播放或暂停">${ICON_PLAY}</button>
            <button class="player-bar__btn" id="pb-next" type="button" aria-label="下一首">${ICON_NEXT}</button>
          </div>
        </div>

        <div class="music-list">
          ${tracks.map((t, i) => `
            <button class="music-row" data-i="${i}" type="button">
              <span class="music-row__cover"><img src="${t.cover}" alt="" loading="lazy" /></span>
              <span class="music-row__txt">
                <b>${t.title}</b>
                <span>${t.composer} · ${t.sub}</span>
              </span>
            </button>`).join('')}
        </div>

        <p class="music-more">更多乐曲，敬请期待</p>
      </div>`;

    box.querySelectorAll('.music-row').forEach((row) => {
      row.addEventListener('click', () => play(Number(row.dataset.i)));
    });

    $id('pb-play')?.addEventListener('click', () => {
      if (idx < 0) { play(0, { force: true }); return; }
      play(idx);
    });
    $id('pb-prev')?.addEventListener('click', () => step(-1));
    $id('pb-next')?.addEventListener('click', () => step(1));

    /* 点进度条跳转 */
    $id('pb-track')?.addEventListener('click', (e) => {
      if (!audio?.duration) return;
      const r = e.currentTarget.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      audio.currentTime = p * audio.duration;
      paintPlayer();
    });

    paintRows();
    paintPlayer();
  })();
}

export function unmount() {
  if (audio && !audio.paused) audio.pause();
  box = null;
}
