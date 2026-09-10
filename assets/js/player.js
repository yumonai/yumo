/* ══════════════════════════════════════════════
   player.js —— 月下音乐会
   ──────────────────────────────────────────────
   声境里的第二个混音层：古典乐可以与水声同时流动。
   曲目全部是公有领域作曲家的公版/自由许可录音，自托管。

   交互：点曲目播放/暂停；正在播放的曲目封面会亮起来，
   底下有一条细细的进度；一首放完自动接下一首。
   ══════════════════════════════════════════════ */

let audio = null;
let idx = -1;
let tracks = [];
let box = null;
let raf = 0;

function fmt(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ensureAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'none';
    audio.addEventListener('ended', () => play((idx + 1) % tracks.length));
  }
  return audio;
}

function paintRows() {
  if (!box) return;
  const rows = [...box.querySelectorAll('.music-row')];
  rows.forEach((row, i) => {
    const on = i === idx;
    row.classList.toggle('is-on', on);
    row.classList.toggle('is-paused', on && audio && audio.paused);
  });
}

function tick() {
  if (audio && !audio.paused && idx >= 0) {
    const row = box?.querySelectorAll('.music-row')[idx];
    const bar = row?.querySelector('.music-row__bar i');
    if (bar && audio.duration) bar.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
    const t = row?.querySelector('.music-row__time');
    if (t) t.textContent = fmt(audio.currentTime);
  }
  raf = requestAnimationFrame(tick);
}

function play(i) {
  const a = ensureAudio();
  if (i === idx && !audio.paused) { audio.pause(); paintRows(); return; }
  if (i !== idx) {
    idx = i;
    a.src = tracks[i].file;
    a.currentTime = 0;
  }
  a.play().catch(() => {});
  paintRows();
  if (!raf) raf = requestAnimationFrame(tick);
}

export function mountPlayer(container) {
  box = container;
  (async () => {
    try {
      const d = await (await fetch('assets/data/tracks.json?v=2', { cache: 'no-cache' })).json();
      tracks = d.tracks || [];
    } catch { tracks = []; }

    if (!tracks.length) { box.innerHTML = ''; return; }

    box.innerHTML = `
      <div class="card card--plain music">
        <div class="card__label">月下音乐会</div>
        <p class="music-intro">公版古典乐，与水声各自流动、互不打扰。点一首，让它陪这片水一起深下去。</p>
        <div class="music-list">
          ${tracks.map((t, i) => `
            <button class="music-row" data-i="${i}" type="button">
              <span class="music-row__cover"><img src="${t.cover}" alt="" loading="lazy" />
                <i class="music-row__eq" aria-hidden="true"><u></i><u></i><u></u></i>
              </span>
              <span class="music-row__txt">
                <b>${t.title}</b>
                <span>${t.composer} · ${t.sub}</span>
              </span>
              <span class="music-row__time">${t.dur || ''}</span>
              <span class="music-row__bar"><i></i></span>
            </button>`).join('')}
        </div>
        <p class="music-credit">录音均来自公有领域或自由许可来源，署名见各曲。</p>
      </div>`;

    box.querySelectorAll('.music-row').forEach((row) => {
      row.addEventListener('click', () => play(Number(row.dataset.i)));
    });
    paintRows();
  })();
}

export function unmount() {
  if (audio && !audio.paused) audio.pause();
  cancelAnimationFrame(raf);
  raf = 0;
  box = null;
}
