/* ══════════════════════════════════════════════
   garden.js —— 潮汐花园
   星图（Yumo 眼中的你）· 记忆 · 回声 · 潮汐记
   ══════════════════════════════════════════════ */

import { store } from './store.js?v=53';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmt(t) {
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtFull(t) {
  const d = new Date(t);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

/* ── 情绪潮汐曲线 ── */
function tideChart(trail) {
  if (!trail || !trail.length) {
    return `<p class="empty-line">还没有足够的水痕。多聊几次，这条线会自己长出来。</p>`;
  }

  // 只有一个点时，画一颗悬着的浮标而不是折线
  if (trail.length === 1) {
    const v = trail[0].v;
    const tone = toneOf(v);
    return `
      <svg class="tide-chart" viewBox="0 0 320 84" preserveAspectRatio="none">
        <line x1="0" y1="42" x2="320" y2="42" stroke="rgba(168,216,232,.10)" stroke-width="1" stroke-dasharray="3 5"/>
        <circle cx="160" cy="${(84 - 12 - (v / 100) * 60).toFixed(1)}" r="4" fill="#F4FBFF"/>
        <circle cx="160" cy="${(84 - 12 - (v / 100) * 60).toFixed(1)}" r="12" fill="rgba(168,216,232,.20)"/>
        <path d="M160 30v18" stroke="rgba(168,216,232,.06)" stroke-width="1"/>
      </svg>
      <div class="tide-legend"><span>第一次落点</span><span>此刻 ${v}/100 · ${tone.word}</span></div>`;
  }

  const pts = trail.slice(-40);
  const W = 320, H = 84, pad = 6;
  const n = pts.length;
  const x = (i) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v) => H - pad - (v / 100) * (H - pad * 2);

  let d = '';
  pts.forEach((p, i) => {
    const px = x(i), py = y(p.v);
    if (i === 0) { d += `M${px.toFixed(1)},${py.toFixed(1)}`; return; }
    const prevX = x(i - 1), prevY = y(pts[i - 1].v);
    const cx = (prevX + px) / 2;
    d += ` C${cx.toFixed(1)},${prevY.toFixed(1)} ${cx.toFixed(1)},${py.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
  });
  const area = `${d} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const last = pts[n - 1].v;

  return `
    <svg class="tide-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="rgba(168,216,232,.30)"/>
          <stop offset="1" stop-color="rgba(168,216,232,0)"/>
        </linearGradient>
        <linearGradient id="tideLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="rgba(78,147,174,.7)"/>
          <stop offset="1" stop-color="rgba(223,243,250,.95)"/>
        </linearGradient>
      </defs>
      <line x1="0" y1="${y(50)}" x2="${W}" y2="${y(50)}" stroke="rgba(168,216,232,.10)" stroke-width="1" stroke-dasharray="3 5"/>
      <path d="${area}" fill="url(#tideFill)"/>
      <path d="${d}" fill="none" stroke="url(#tideLine)" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" fill="#F4FBFF"/>
      <circle cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="7" fill="rgba(168,216,232,.28)"/>
    </svg>
    <div class="tide-legend"><span>更早</span><span>此刻 ${last}/100</span></div>`;
}

function toneOf(v) {
  if (v < 25) return { word: '很沉', note: '这段时间水压很大。你还在，这本身就不容易。' };
  if (v < 45) return { word: '偏低', note: '不太顺。但你有在说，水就在流动。' };
  if (v < 62) return { word: '平稳', note: '大致安静，偶有起伏。这是可以待住的水位。' };
  if (v < 80) return { word: '偏亮', note: '有东西在松开。留意是什么让它松的。' };
  return { word: '明亮', note: '你正浮在光里。记住这个感觉，它是真的。' };
}

/* ── 四个页签 ── */
function tabProfile() {
  const p = store.get('profile');
  const trail = p.moodTrail || [];
  const recent = trail.slice(-6).map((x) => x.v);
  const avg = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : null;
  const tone = avg === null ? null : toneOf(avg);

  const hasAnything = p.essence || p.traits?.length || p.themes?.length || p.figures?.length;

  if (!hasAnything) {
    return `<div class="card">
      <div class="card__label">Yumo 眼中的你</div>
      <p class="empty-line">这里现在还是一片空白。<br />
      Yumo 不会让你填问卷——它是在跟你说话的过程里，慢慢认出你的。<br />
      去聊几次，这片水域会自己长出形状。</p>
    </div>
    <div class="card card--plain">
      <div class="card__label">情绪潮汐</div>
      ${tideChart(trail)}
    </div>`;
  }

  return `
    ${p.essence ? `<div class="card">
      <div class="card__label">Yumo 眼中的你</div>
      <p style="font-family:var(--font-serif);font-size:16px;line-height:2;letter-spacing:.06em;color:var(--mist-050)">${esc(p.essence)}</p>
    </div>` : ''}

    ${tone ? `<div class="card card--plain">
      <div class="card__label">此刻的水位 · ${tone.word}</div>
      <div class="scale">
        <div class="scale__track"><div class="scale__fill" style="width:${avg}%"></div></div>
        <span class="scale__val">${avg}</span>
      </div>
      <p class="empty-line">${tone.note}</p>
    </div>` : ''}

    <div class="card card--plain">
      <div class="card__label">情绪潮汐 · 最近四十次</div>
      ${tideChart(trail)}
    </div>

    ${p.traits?.length ? `<div class="card">
      <div class="card__label">你身上的质地<span class="chip-hint">点一下，看它是从哪句话里长出来的</span></div>
      <div class="chips">${p.traits.map((t) => `<button class="chip chip--tide" data-ev="${esc(t)}" type="button">${esc(t)}</button>`).join('')}</div>
      <div class="ev-strip" hidden></div>
    </div>` : ''}

    ${p.themes?.length ? `<div class="card">
      <div class="card__label">你反复浮上来的事<span class="chip-hint">点一下，看证据</span></div>
      <div class="chips">${p.traits ? p.themes.map((t) => `<button class="chip chip--big" data-ev="${esc(t)}" type="button">${esc(t)}</button>`).join('') : ''}</div>
      <div class="ev-strip" hidden></div>
    </div>` : ''}

    ${p.figures?.length ? `<div class="card">
      <div class="card__label">水面倒映出的身影</div>
      <div class="chips">${p.figures.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
    </div>` : ''}

    <div class="card card--plain">
      <div class="stat-grid">
        <div class="stat"><b>${p.turns || 0}</b><span>对 话 轮 次</span></div>
        <div class="stat"><b>${store.get('memories').length}</b><span>记 住 的 片 段</span></div>
        <div class="stat"><b>${store.get('echoes').length}</b><span>你 的 回 声</span></div>
      </div>
      <p class="empty-line" style="margin-top:14px">上次更新：${p.lastUpdated ? fmt(p.lastUpdated) : '还没开始'}</p>
    </div>`;
}

function tabMemory() {
  const list = [...store.get('memories')].reverse();
  if (!list.length) {
    return `<div class="card"><p class="empty-line">Yumo 还什么都没记住。<br />当你提到某个人、某件事、某个决定，它会悄悄收起来，下次见面时还给你。</p></div>`;
  }
  const now = Date.now();
  const recent = list.filter((m) => now - m.t < 14 * 86400000);
  const older = list.filter((m) => now - m.t >= 14 * 86400000);
  const row = (m) => `
      <div class="row-item">
        <div class="row-item__time">${fmt(m.t)}</div>
        <div class="row-item__body">
          <p>${esc(m.text)}</p>
        </div>
        <button class="msg__act" data-forget="${m.id}" type="button">忘掉</button>
      </div>`;
  return `<div class="card">
    <div class="card__label">Yumo 记得的 ${list.length} 件事</div>
    ${recent.length ? `<p class="group-label">这 段 时 间</p>${recent.map(row).join('')}` : ''}
    ${older.length ? `<p class="group-label">更 早 的 水 痕</p>${older.map(row).join('')}` : ''}
  </div>
  <p class="note-quiet">这些都是从你的话里提炼的。点「忘掉」，它就真的不在了。</p>`;
}

function tabEcho() {
  const list = [...store.get('echoes')].reverse();
  if (!list.length) {
    return `<div class="card"><p class="empty-line">还没有回声。<br />在对话里长按你自己的某句话，就能把它捞起来存进这里。</p></div>`;
  }
  return list.map((e) => `
    <div class="echo-card">
      <div class="echo-card__text">${esc(e.text)}</div>
      <div class="echo-card__foot">
        <span>${e.from === 'me' ? '你说的' : 'Yumo 说的'} · ${fmt(e.t)}</span>
        <span>
          <button data-copy="${e.id}" type="button">复制</button>
          &nbsp;·&nbsp;
          <button data-drop="${e.id}" type="button">放回水里</button>
        </span>
      </div>
    </div>`).join('');
}

function tabLog() {
  const list = [...store.get('journals')].reverse();
  if (!list.length) {
    return `<div class="card"><p class="empty-line">还没有潮汐记。<br />一段对话结束后，Yumo 会为它写一页。<br />你需要先在「器皿」里连上它的思维。</p></div>`;
  }
  return list.map((j) => `
    <div class="card" data-jr="${j.t}" role="button" tabindex="0" title="翻开这一页">
      <div class="card__label">${fmtFull(j.t)}${j.lastRead ? `<span class="reread">· 上次翻开 ${fmt(j.lastRead)}</span>` : '<span class="reread reread--new">· 还没翻开过</span>'}</div>
      <div class="card__title">${esc(j.title)}</div>
      <p style="font-family:var(--font-serif);line-height:2.1;letter-spacing:.04em">${esc(j.body)}</p>
    </div>`).join('');
}

function tabKept() {
  const list = [...store.get('letters')].filter((l) => l.kept).reverse();
  if (!list.length) {
    return `<div class="card"><p class="empty-line">还没有存下的信。<br />在「来自 Yumo 的信」里点「在心里存下」，<br />它就会离开水面，来到这里。</p></div>`;
  }
  return list.map((l) => `
    <div class="card">
      <div class="card__label">${esc(l.date || '')}${l.theme ? ' · ' + esc(l.theme) : ''}</div>
      ${l.img ? `<img class="kept-img" src="${esc(l.img)}" alt="" loading="lazy" />` : ''}
      ${l.text ? `<blockquote class="kept-quote">${esc(l.text)}</blockquote>` : ''}
      <p class="kept-body">${esc(l.body || '')}</p>
      ${l.question ? `<p class="kept-q">${esc(l.question)}</p>` : ''}
      <small class="kept-src">${esc(l.author || '')}${l.source ? ' · ' + esc(l.source) : ''}</small>
    </div>`).join('');
}

/* ── 渲染入口 ── */
export function renderGarden(root, { whisper, refresh }) {
  let tab = 'profile';

  const paint = () => {
    root.innerHTML = ({
      profile: tabProfile,
      memory: tabMemory,
      echo: tabEcho,
      log: tabLog,
      kept: tabKept,
    }[tab])();

    // 记忆：忘掉
    root.querySelectorAll('[data-forget]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.forget;
        store.put('memories', store.get('memories').filter((m) => m.id !== id));
        whisper('已经忘了。');
        paint();
      });
    });
    // 回声：复制 / 丢弃
    root.querySelectorAll('[data-copy]').forEach((b) => {
      b.addEventListener('click', async () => {
        const e = store.get('echoes').find((x) => x.id === b.dataset.copy);
        if (!e) return;
        try {
          await navigator.clipboard.writeText(e.text);
          whisper('已经放进剪贴板。');
        } catch { whisper('复制不了，长按文字自己选吧。'); }
      });
    });
    root.querySelectorAll('[data-drop]').forEach((b) => {
      b.addEventListener('click', () => {
        store.put('echoes', store.get('echoes').filter((x) => x.id !== b.dataset.drop));
        whisper('让它漂走吧。');
        paint();
      });
    });
    // 质地/事：点开证据（当时的那句原话）
    const evMap = store.get('profile').evidence || {};
    root.querySelectorAll('[data-ev]').forEach((b) => {
      b.addEventListener('click', () => {
        const strip = b.closest('.card')?.querySelector('.ev-strip');
        if (!strip) return;
        const ev = evMap[b.dataset.ev];
        strip.hidden = false;
        strip.innerHTML = ev
          ? `当时的原话：「${esc(ev.text)}」<small>· ${fmt(ev.t)}</small>`
          : '这个判断来自不止一次对话，原话已经沉在水底了。';
      });
    });
    // 潮汐记：点卡片 = 翻开，记下重读时间
    root.querySelectorAll('[data-jr]').forEach((cardEl) => {
      cardEl.addEventListener('click', () => {
        const t = Number(cardEl.dataset.jr);
        store.put('journals', store.get('journals').map((x) => (x.t === t ? { ...x, lastRead: Date.now() } : x)));
        cardEl.querySelector('.reread')?.replaceWith(Object.assign(document.createElement('span'), { className: 'reread', textContent: '· 刚刚翻开了' }));
      });
    });
  };

  paint();
  return { paint, setTab: (t) => { tab = t; paint(); } };
}
