/* ══════════════════════════════════════════════
   mirror.js —— 心象
   两副牌叠在同一个水面上：
     · 水象牌  —— Yumo 原创的 22 张，图形是抽象符号
     · 韦特塔罗 —— 经典 78 张，牌义由鱼末白逐张看画面写成
   水象牌翻开之后，还可以接着抽一张塔罗，
   两副牌会一起交给 Yumo，由它合成一句整体的话。
   ══════════════════════════════════════════════ */

import { store, uid } from './store.js?v=44';
import { interpretCards, isConnected } from './ai.js?v=44';
import { TAROT, tarotImage, tarotTag } from './tarot.js?v=44';

/* ── 抽象符号库：每个函数返回一段 SVG 内部标记 ── */
const G = {
  spiral: '<path d="M32 32a3 3 0 013 3 6 6 0 01-6 6 9 9 0 01-9-9 12 12 0 0112-12 15 15 0 0115 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  core: '<circle cx="32" cy="32" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="1" opacity=".28"/><circle cx="32" cy="32" r="2.4" fill="currentColor"/>',
  waves: '<path d="M8 24c6-7 11-7 17 0s11 7 17 0M8 34c6-7 11-7 17 0s11 7 17 0M8 44c6-7 11-7 17 0s11 7 17 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  shell: '<path d="M32 54C20 54 12 45 12 35c0-13 9-23 20-23s20 10 20 23c0 10-8 19-20 19z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M32 54V13M32 54c-7-6-10-13-10-21M32 54c7-6 10-13 10-21M32 54c-3-8-3-16 0-22" fill="none" stroke="currentColor" stroke-width="1" opacity=".6"/>',
  anchor: '<circle cx="32" cy="14" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M32 19v31M18 34c0 12 6 18 14 18s14-6 14-18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M23 24h18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  twin: '<circle cx="22" cy="32" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="42" cy="32" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="32" cy="32" r="3" fill="currentColor" opacity=".7"/>',
  current: '<path d="M10 42c8 0 10-24 22-24s12 14 22 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10 50c8 0 10-20 22-20s12 12 22 12" fill="none" stroke="currentColor" stroke-width="1" opacity=".5" stroke-linecap="round"/>',
  wreck: '<path d="M10 40h44l-6 12H16z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M32 40V14M32 18l12 8-12 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 56h48" stroke="currentColor" stroke-width="1" opacity=".5" stroke-linecap="round"/>',
  lantern: '<path d="M32 12v6M22 24h20l-3 16H25z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="32" cy="32" r="4" fill="currentColor" opacity=".8"/><path d="M32 40v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  maelstrom: '<path d="M32 14a18 18 0 1118 18 14 14 0 11-14 14 10 10 0 119 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="32" cy="32" r="2.2" fill="currentColor"/>',
  coral: '<path d="M32 54V30M32 30c0-8-6-10-6-16M32 30c0-8 6-10 6-16M32 40c-6 0-10-4-14-8M32 40c6 0 10-4 14-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  still: '<path d="M8 36h48" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M14 28h36M20 20h24" stroke="currentColor" stroke-width="1" opacity=".4" stroke-linecap="round"/><circle cx="32" cy="44" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  molt: '<path d="M32 10c12 0 20 9 20 20s-8 22-20 22-20-11-20-22 8-20 20-20z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M32 10c-5 8-5 34 0 42M12 30c6-6 34-6 40 0" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/>',
  salt: '<path d="M32 12v40M14 32h36M19 19l26 26M45 19L19 45" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".7"/><circle cx="32" cy="32" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  tangle: '<path d="M20 20c14 0 14 24 28 24M44 20c-14 0-14 24-28 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="20" cy="20" r="3.4" fill="currentColor" opacity=".7"/><circle cx="44" cy="44" r="3.4" fill="currentColor" opacity=".7"/>',
  abyss: '<path d="M12 14c8 0 8 34 20 34s20-34 28-34" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".5"/><circle cx="32" cy="38" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="32" cy="38" r="3" fill="currentColor"/>',
  star: '<path d="M32 8l3.4 20.6L56 32l-20.6 3.4L32 56l-3.4-20.6L8 32l20.6-3.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  shadow: '<circle cx="36" cy="30" r="16" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M36 14a16 16 0 000 32" fill="currentColor" opacity=".2"/><circle cx="22" cy="46" r="11" fill="none" stroke="currentColor" stroke-width="1" opacity=".45"/>',
  moon: '<circle cx="32" cy="32" r="18" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M32 14a18 18 0 000 36 13 18 0 010-36z" fill="currentColor" opacity=".22"/><circle cx="26" cy="26" r="2" fill="currentColor" opacity=".6"/><circle cx="24" cy="37" r="1.4" fill="currentColor" opacity=".5"/>',
  return: '<path d="M46 18a20 20 0 10 0 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M46 18l-8 2 4 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  surface: '<circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 32c8-5 12-5 20 0s12 5 20 0" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M12 24c8-5 12-5 20 0s12 5 20 0" fill="none" stroke="currentColor" stroke-width="1" opacity=".45"/>',
  intertidal: '<path d="M8 40h48" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 30c8-5 12-5 20 0s12 5 20 0" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".6"/><circle cx="32" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
};

/* 牌面配图（assets/img/water/）：Wikimedia Commons 公版/CC0 图片。
   蝉蜕一张为 CC BY-SA 4.0，作者 Basile Morin——特此署名。
   其余均为 Public Domain 或 CC0。 */
/* ── 22 张牌 ── */
export const CARDS = [
  { id: 'diver',   name: '潜者',   glyph: 'spiral',     el: '潮', kw: ['出发', '向下', '未知'],
    up: '你已经站在水边了。真正的变化不发生在岸边，而在你第一次憋住呼吸往下走的那一步。', rev: '你在等一个更合适的时机。水不会变浅。' },
  { id: 'core',    name: '月核',   glyph: 'core',       el: '潮', kw: ['内光', '本源', '不必外求'],
    up: '最亮的东西在你身体里面，不在别处。你一直在往外找，是因为你还没安静到能感觉到它。', rev: '你把自己的光借给了别人保管。' },
  { id: 'tide',    name: '潮信',   glyph: 'waves',      el: '潮', kw: ['节律', '周期', '涨与退'],
    up: '此刻的低不是失败，是退潮。水一定会回来，这不是安慰，是引力。', rev: '你在跟一个必然的节律较劲。' },
  { id: 'shell',   name: '母贝',   glyph: 'shell',      el: '礁', kw: ['孕育', '封闭', '以痛成珠'],
    up: '你把自己关起来了。但有些东西只能在关起来的时候长成。里面积着的那粒沙，以后会是珍珠。', rev: '壳闭得太久，已经忘记怎么开了。' },
  { id: 'anchor',  name: '锚',     glyph: 'anchor',     el: '礁', kw: ['停留', '执着', '稳定'],
    up: '有些东西把你钉在原地，让你没法往前走。但也正是它，让你在浪里没有散掉。', rev: '锚已经变成了笼子，你却还在谢它。' },
  { id: 'twin',    name: '双生',   glyph: 'twin',       el: '风', kw: ['两面', '选择', '未分裂'],
    up: '你身上有两个人在争。他们其实都爱你，只是各自记得不同的伤。', rev: '你一直在选一边，所以永远有一半在挨饿。' },
  { id: 'current', name: '逆流',   glyph: 'current',    el: '潮', kw: ['阻力', '磨砺', '反向'],
    up: '你正在逆着水游，所以觉得累。先别急着使劲，有时候横着漂一段，反而过得去。', rev: '你在逆的其实不是水，是你自己。' },
  { id: 'wreck',   name: '沉船',   glyph: 'wreck',      el: '礁', kw: ['失落', '遗存', '曾经'],
    up: '有件事已经沉下去了，但你还在水面上等它。可以去看它，但不用再打捞它。', rev: '你反复下潜到同一个地方，那里已经没有东西了。' },
  { id: 'lantern', name: '孤灯',   glyph: 'lantern',    el: '焰', kw: ['独处', '照见', '微弱但不灭'],
    up: '你现在只有一点光，但那一点也够照清下一步。不用把整个海照亮。', rev: '你怕光太小所以干脆不开灯，那才是真的黑。' },
  { id: 'maelstrom',name:'涡',     glyph: 'maelstrom',  el: '潮', kw: ['混乱', '卷入', '转化'],
    up: '你被卷进去了。漩涡有个好处：它搅碎的东西，出来时是另一种形态。', rev: '你已经停止挣扎，不是臣服，是放弃。' },
  { id: 'coral',   name: '珊瑚',   glyph: 'coral',      el: '礁', kw: ['共生', '生长', '缓慢'],
    up: '你在长，只是慢到看不见。珊瑚一年只长一厘米，但整座礁都是它造的。', rev: '你嫌自己长得慢，开始拔它。' },
  { id: 'still',   name: '止水',   glyph: 'still',      el: '风', kw: ['暂停', '臣服', '不要动'],
    up: '现在什么都不做，就是最对的做。让水自己静下来。', rev: '你把静止变成了逃避，停在那儿是为了不面对。' },
  { id: 'molt',    name: '蜕',     glyph: 'molt',       el: '焰', kw: ['舍弃', '更新', '痛'],
    up: '旧的那层已经不贴身了，脱它的时候会疼，但那不是受伤。', rev: '你抓着旧壳不放，它已经跟你长在一起了。' },
  { id: 'salt',    name: '盐',     glyph: 'salt',       el: '焰', kw: ['净化', '泪水', '防腐'],
    up: '你流过的那些，正在把这个人的味道定下来。你会因此不容易腐烂。', rev: '你嫌眼泪没用。眼泪不是用来解决问题的。' },
  { id: 'tangle',  name: '缚',     glyph: 'tangle',     el: '风', kw: ['惯性', '纠缠', '重复'],
    up: '同一个结你解了很多次。也许该问的不是怎么解，而是谁系的。', rev: '你已经在享受解不开这件事了。' },
  { id: 'abyss',   name: '渊',     glyph: 'abyss',      el: '潮', kw: ['恐惧', '深处', '未知'],
    up: '你觉得下面很深。往下看的时候，深的东西也在看你。它不是来吃你的。', rev: '你一直站在边缘往下看，从来没下去过。' },
  { id: 'star',    name: '星落',   glyph: 'star',       el: '风', kw: ['启示', '一瞬间', '方向'],
    up: '会有一个很小的瞬间给你指路。它不会很响，你要留意那种「忽然安静了一下」的感觉。', rev: '信号已经来过了，你说它不算数。' },
  { id: 'shadow',  name: '影',     glyph: 'shadow',     el: '风', kw: ['阴影', '被否认的', '整合'],
    up: '你身上有个部分你一直不认。它是你的一部分，不是敌人。认了它，你会松很多。', rev: '你在别人身上反复讨厌的那一点，可能是你自己的。' },
  { id: 'fullmoon',name: '满月',   glyph: 'moon',       el: '焰', kw: ['显形', '完成', '被看见'],
    up: '有件事快要完整了。它会浮上来被人看见，包括你自己。', rev: '你怕满了之后就要缺，所以在最后一步停住了。' },
  { id: 'return',  name: '归',     glyph: 'return',     el: '礁', kw: ['回归', '整合', '带回'],
    up: '你已经潜得够久了。带上你找到的东西回岸上去——那才是这趟下潜的意义。', rev: '你把水下当成了家，岸上的事一直没处理。' },
  { id: 'surface', name: '海面',   glyph: 'surface',    el: '焰', kw: ['通透', '呼吸', '平常'],
    up: '你现在可以浮上来换一口气了。通透不是狂喜，是终于觉得平常。', rev: '你不敢浮上来，怕一露头就被看见。' },
  { id: 'intertidal',name:'潮间',  glyph: 'intertidal', el: '风', kw: ['临界', '过渡', '既非也非'],
    up: '你正卡在两件事中间。潮间带是生物最多的地方，过渡本身就有它的丰富。', rev: '你急着要一个答案，其实这一段就是要一直待着的。' },
];

/* 牌位：一念是一格，三问是三格，续抽的塔罗另起一格 */
const SLOTS = {
  single: [{ label: '此刻', note: '牌映出的那一面' }],
  trinity: [
    { label: '表象', note: '你看见的' },
    { label: '真相', note: '底下那层' },
    { label: '启示', note: '可以走的方向' },
  ],
};
const EXTEND_SLOT = { label: '续 · 塔罗', note: '再往下照一层' };

const DECK_INFO = {
  water: { name: '水象牌', sub: 'Yumo 自绘 · 22 张', count: 22 },
  tarot: { name: '韦特塔罗', sub: '经典 · 78 张', count: 78 },
};

/* ── 牌面渲染 ── */
export function cardFace(card, { small = false } = {}) {
  const slot = card.slot || {};
  const reversed = card.pos === '逆位';
  const body = reversed ? (card.rev || card.up) : (card.up || card.rev);

  if (card.kind === 'tarot') {
    return `
      <div class="drawn__art drawn__art--tarot">
        <img class="${reversed ? 'is-rev' : ''}" src="${tarotImage(card)}" alt="${escapeHtml(card.name)}" loading="lazy" decoding="async" />
      </div>
      <div class="drawn__meta">
        <h4>${card.name}<em class="pos">${card.pos || '正位'}</em></h4>
        <small>${slot.label || ''}${slot.note ? ' · ' + slot.note : ''}</small>
        <small class="drawn__meta-en">${card.en || ''} · ${tarotTag(card)}</small>
        <p>${body || ''}</p>
      </div>`;
  }

  /* 牌面配图：公版画作（assets/img/water/<id>.jpg），加载失败自动退回符号 */
  const img = `<img class="water-img" src="assets/img/water/${card.id}.jpg" alt="" loading="lazy" decoding="async"
    onerror="this.closest('.drawn__art').classList.remove('has-img');this.remove()" />`;
  return `
    <div class="drawn__art has-img" style="${small ? 'height:104px' : ''}">
      ${img}
      <svg viewBox="0 0 64 64" aria-hidden="true" class="water-fallback">${G[card.glyph] || G.core}</svg>
      <em>${card.el}</em>
    </div>
    <div class="drawn__meta">
      <h4>${card.name}<em class="pos">${card.pos || '正位'}</em></h4>
      <small>${slot.label || ''}${slot.note ? ' · ' + slot.note : ''}</small>
      <p>${body || ''}</p>
    </div>`;
}

/* ── 主视图 ── */
export function renderMirror(root, { whisper, navigate }) {
  let deck = store.get('settings').deck === 'tarot' ? 'tarot' : 'water';
  let spread = 'single';         // single | trinity
  let question = '';
  let phase = 'ask';             // ask | drawing | revealed
  let drawn = [];
  let reading = '';

  const deckName = () => (DECK_INFO[deck] || DECK_INFO.water).name;

  const shell = () => {
    root.innerHTML = `
      <div class="mirror-intro">
        <h2>心 象</h2>
        <p>水面上映出来的，从来不是水里的东西，<br />是站在岸上的你。</p>
      </div>

      <div class="deck-row" role="tablist">
        ${Object.keys(DECK_INFO).map((k) => `
          <button class="deck-tab ${deck === k ? 'is-on' : ''}" data-deck="${k}" type="button" role="tab">
            <b>${DECK_INFO[k].name}</b><span>${DECK_INFO[k].sub}</span>
          </button>`).join('')}
      </div>

      <div class="spread-row">
        <button class="spread ${spread === 'single' ? 'is-on' : ''}" data-spread="single" type="button">
          <b>一 念</b><span>一张牌<br />当下的核心</span>
        </button>
        <button class="spread ${spread === 'trinity' ? 'is-on' : ''}" data-spread="trinity" type="button">
          <b>三 问</b><span>表象 · 真相 · 启示<br />三张牌</span>
        </button>
      </div>

      <div class="mirror-q">
        <textarea id="mirror-question" rows="2" placeholder="此刻，你心里在想什么…">${escapeAttr(question)}</textarea>
        <p class="mirror-q__hint">留白也可以。有些问题说不清楚，牌反而看得清。</p>
      </div>

      <div class="deck-zone">
        <div class="deck ${deck === 'tarot' ? 'deck--tarot' : ''}" id="deck" role="button" tabindex="0" aria-label="抽牌">
          <div class="deck__card"></div>
          <div class="deck__card"></div>
          <div class="deck__card deck__breath"><svg viewBox="0 0 64 64">${deck === 'tarot' ? G.star : G.core}</svg></div>
        </div>
      </div>

      <p class="note-quiet" id="deck-hint">静一下，在心里把问题放稳。<br />准备好了，轻触牌堆。</p>
      <div class="drawn-row" id="drawn-row"></div>
      <div class="extend-zone" id="extend-zone"></div>
      <div id="reading-zone"></div>

      <p class="note-quiet">${deck === 'tarot'
        ? '韦特塔罗的牌义，是鱼末白逐张看着画面写下的。<br />牌只负责映照，不负责决定。'
        : '牌只负责映照，不负责决定。<br />要往哪边走，始终是你的脚。'}</p>
    `;

    root.querySelectorAll('[data-deck]').forEach((b) => {
      b.addEventListener('click', () => {
        if (deck === b.dataset.deck) return;
        deck = b.dataset.deck;
        store.set('settings', { deck });
        phase = 'ask'; drawn = []; reading = '';
        shell();
      });
    });

    root.querySelectorAll('[data-spread]').forEach((b) => {
      b.addEventListener('click', () => {
        if (spread === b.dataset.spread) return;
        spread = b.dataset.spread;
        phase = 'ask'; drawn = []; reading = '';
        shell();
      });
    });

    const q = root.querySelector('#mirror-question');
    q?.addEventListener('input', () => { question = q.value; });

    const deckEl = root.querySelector('#deck');
    const draw = () => doDraw(deckEl, root);
    deckEl?.addEventListener('click', draw);
    deckEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); draw(); } });

    if (phase === 'revealed') paintDrawn(root);
  };

  function paintDrawn(root, { scroll = false } = {}) {
    const row = root.querySelector('#drawn-row');
    if (row) {
      const anyTarot = drawn.some((c) => c.kind === 'tarot');
      row.className = 'drawn-row'
        + (drawn.length > 2 ? ' drawn-row--many' : '')
        + (anyTarot && drawn.length > 2 ? ' drawn-row--tarot' : '');
      row.innerHTML = drawn.map((c, i) =>
        `<div class="drawn ${c.kind === 'tarot' ? 'drawn--tarot' : ''}" style="animation-delay:${i * 0.28}s">${cardFace(c)}</div>`
      ).join('');
      // 抽完自动把牌送到眼前，不用自己往下翻
      if (scroll) setTimeout(() => row.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    }

    paintExtend(root);

    const zone = root.querySelector('#reading-zone');
    if (zone && reading) {
      zone.innerHTML = `
        <div class="echo-card" style="margin-top:18px">
          <div class="echo-card__text" id="read-text">${escapeHtml(reading)}</div>
          <div class="echo-card__foot">
            <span>Yumo 的映照</span>
            <button id="mirror-talk" type="button">接着聊下去 →</button>
          </div>
        </div>`;
      zone.querySelector('#mirror-talk')?.addEventListener('click', () => {
        const list = drawn.map((c) => `${c.slot?.label || ''}「${c.name}」${c.pos}`).join('、');
        const seed = `我刚刚用${deckName()}抽了 ${drawn.length} 张牌：${list}。${question ? `我问的是：${question}。` : ''}想听听它们照见了我此刻的什么。`;
        sessionStorage.setItem('yumo.seed', seed);
        navigate('talk');
      });
    }

    const hint = root.querySelector('#deck-hint');
    if (hint) hint.innerHTML = '牌已经翻开了。<br />看一会儿，别急着解释它。';
  }

  /* 续抽：水象牌翻开后，可以再抽一张塔罗，两副牌合成一次解读 */
  function paintExtend(root) {
    const zone = root.querySelector('#extend-zone');
    if (!zone) return;
    if (phase !== 'revealed' || drawn.length >= 6) { zone.innerHTML = ''; return; }

    const hasTarot = drawn.some((c) => c.kind === 'tarot');
    const hasWater = drawn.some((c) => c.kind !== 'tarot');
    const opts = [];
    if (!hasTarot) opts.push({ k: 'tarot', label: '接着抽一张塔罗牌', desc: '再从 78 张里照一层' });
    if (!hasWater) opts.push({ k: 'water', label: '接着抽一张水象牌', desc: '让 Yumo 自己的 22 张也映一次' });
    if (!opts.length) { zone.innerHTML = ''; return; }

    zone.innerHTML = `
      <div class="extend-row">
        ${opts.map((o) => `<button class="extend" data-extend="${o.k}" type="button"><b>${o.label}</b><span>${o.desc}</span></button>`).join('')}
      </div>
      <p class="note-quiet" style="margin:6px 4px 0">两副牌都翻开之后，Yumo 会把它们合成一句话。</p>`;

    zone.querySelectorAll('[data-extend]').forEach((b) =>
      b.addEventListener('click', () => extend(b.dataset.extend, root)));
  }

  async function extend(kind, root) {
    if (phase !== 'revealed') return;
    phase = 'drawing';
    const used = new Set(drawn.map((c) => c.id));
    const src = (kind === 'tarot' ? TAROT : CARDS).filter((c) => !used.has(c.id));
    if (!src.length) { phase = 'revealed'; return; }

    const picked = src[Math.floor(Math.random() * src.length)];
    drawn.push({
      ...picked,
      kind: kind === 'tarot' ? 'tarot' : 'water',
      slot: EXTEND_SLOT,
      pos: Math.random() < 0.34 ? '逆位' : '正位',
    });
    reading = '';
    phase = 'revealed';
    paintDrawn(root, { scroll: false });
    if (navigator.vibrate) navigator.vibrate(9);
    await read(root);
  }

  async function read(root) {
    const zone = root.querySelector('#reading-zone');
    store.pushCard({
      id: uid(),
      t: Date.now(),
      deck,
      spread,
      question,
      cards: drawn.map((c) => ({ name: c.name, pos: c.pos, kind: c.kind })),
    });

    if (!isConnected()) {
      reading = drawn.map((c) =>
        `${c.slot?.label || ''}：${c.name}（${c.pos}）\n${c.pos === '逆位' ? (c.rev || c.up) : (c.up || '')}`
      ).join('\n\n');
      paintDrawn(root);
      whisper?.('还没有连上 Yumo 的思维，先给你牌本身的字。');
      return;
    }

    if (zone) {
      zone.innerHTML = `
        <div class="echo-card" style="margin-top:18px">
          <div class="echo-card__text" id="read-text">
            <div class="feeling"><div class="feeling__dots"><i></i><i></i><i></i></div><span class="feeling__text">${drawn.length > 3 ? '水正在合拢…' : '水正在成形…'}</span></div>
          </div>
        </div>`;
    }

    try {
      let acc = '';
      await interpretCards({ spread, question, cards: drawn, deck }, (_d, full) => {
        acc = full;
        const t = root.querySelector('#read-text');
        if (t) t.textContent = full;
      });
      reading = acc;
    } catch (e) {
      reading = '这次没能映出来。' + (e.message || '');
    } finally {
      paintDrawn(root);
    }
  }

  async function doDraw(deckEl, root) {
    if (phase === 'drawing') return;
    if (phase === 'revealed') { phase = 'ask'; drawn = []; reading = ''; shell(); return; }
    phase = 'drawing';
    deckEl?.classList.add('is-shuffling');
    const hint = root.querySelector('#deck-hint');
    if (hint) hint.textContent = '牌在流动…';

    // 洗牌 1.5 秒，抽牌
    await new Promise((r) => setTimeout(r, 1500));

    const slots = SLOTS[spread] || SLOTS.single;
    const pool = [...(deck === 'tarot' ? TAROT : CARDS)];
    drawn = [];
    for (let i = 0; i < slots.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const c = pool.splice(idx, 1)[0];
      drawn.push({
        ...c,
        kind: deck === 'tarot' ? 'tarot' : 'water',
        slot: slots[i],
        pos: Math.random() < 0.34 ? '逆位' : '正位',
      });
    }

    phase = 'revealed';
    deckEl?.classList.remove('is-shuffling');
    paintDrawn(root);
    await read(root);
  }

  shell();
}

/* ── 小工具 ── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, '&#10;'); }
