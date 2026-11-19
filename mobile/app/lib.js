// Общие помощники интерфейса: состояние, иконки, списки треков, листы снизу, навигация
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { isNative } from '../core/native.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const cssUrl = u => u ? `url("${String(u).replace(/"/g, '%22')}")` : 'none';
export const key = t => t.source + ':' + t.rawId;
export function plural(n, a, b, c) { const m = n % 10, h = n % 100; return n + ' ' + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); }
export const SOURCE = { ya: 'Яндекс', sc: 'SoundCloud', zv: 'Звук', au: 'Audius', ja: 'Jamendo', local: 'Файл' };
export const SOURCE_SHORT = { ya: 'Я', sc: 'SC', zv: 'ЗВУК', au: 'AU', ja: 'JA' };

export const state = {
  accounts: {}, guest: true, prefs: {}, keys: {}, keyValues: {},
  likes: { ya: [], sc: [], zv: [], guest: [] }, liked: new Set(),
  playlists: [],
  wave: { diversity: 'default', moodEnergy: 'all', language: 'any', mix: true },
  queue: [], qi: -1, mode: null, station: null, current: null, loadingMore: false,
  tab: 'wave',
};

export const haptic = (s = 'light') => { if (!isNative) return; Haptics.impact({ style: s === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {}); };

/* ---------- иконки ---------- */
const P = {
  wave: '<path d="M2 12c2.5 0 2.5-5 5-5s2.5 10 5 10 2.5-10 5-10 2.5 5 5 5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3 2.9-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M15.5 14.6c2.6-.3 4.6 1 5.1 3.9"/>',
  play: '<path class="f" d="M8 5.5v13l11-6.5z"/>',
  pause: '<path class="f" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
  next: '<path class="f" d="M5 5.5v13l9-6.5zM16 5.5h2.6v13H16z"/>',
  prev: '<path class="f" d="M19 5.5v13l-9-6.5zM8 5.5H5.4v13H8z"/>',
  more: '<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  chev: '<path d="m9.5 6 6 6-6 6"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  lyrics: '<path d="M4 6h11M4 10.5h11M4 15h6"/><path d="M15.5 19.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm2-2V9.5l3-1"/>',
  queue: '<path d="M4 6h12M4 11h12M4 16h7"/><path d="m15 14 5 3-5 3z" fill="currentColor"/>',
  send: '<path d="M20.5 3.5 3.5 10.6l6.6 2.8 2.8 6.6z"/><path d="m10.1 13.4 4.6-4.6"/>',
  next1: '<path d="M4 7h10M4 12h10M4 17h6"/><path d="M17 14v6M14 17h6"/>',
  addq: '<path d="M4 7h16M4 12h16M4 17h9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
  radio: '<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  album: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>',
  list: '<path d="M4 6h11M4 10.5h11M4 15h7"/><path d="M17 13v7M13.5 16.5h7"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  shuffle: '<path d="M3 7h3.5c4 0 5 10 9 10H21M3 17h3.5c1.6 0 2.7-1.6 3.6-3.5M21 7h-5.5c-1.6 0-2.7 1.6-3.6 3.5M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2.5"/><path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8"/>',
  logout: '<path d="M14 5h4.5v14H14M10 8l-4 4 4 4M6 12h10"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4"/>',
};
export const ico = (n, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}">${(P[n] || '').replace(/class="f"/g, 'fill="currentColor" stroke="none"')}</svg>`;

/* ---------- уведомление ---------- */
let toastT;
export function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ---------- строки треков ---------- */
export const isCurrent = t => state.current && key(state.current) === key(t);
export function trackRow(t, i, opts = {}) {
  const liked = state.liked.has(key(t));
  return `<div class="trk${isCurrent(t) ? ' current' : ''}${t.available === false ? ' unavailable' : ''}${t.locked ? ' locked' : ''}" data-i="${i}" data-key="${esc(key(t))}">
    ${opts.numbered ? `<span class="num">${i + 1}</span>` : ''}
    ${opts.numbered ? '' : `<div class="cv" style="background-image:${esc(cssUrl(t.cover))}"><span class="eq"><i></i><i></i><i></i></span></div>`}
    <div class="tm"><div class="tt">${esc(t.title)}</div><div class="ta">${liked && !opts.noLiked ? `<span class="liked-dot">${ico('heart')}</span>` : ''}${opts.noSource ? '' : `<span class="src">${SOURCE_SHORT[t.source] || ''}</span>`}<span>${esc(t.artist)}</span></div></div>
    ${opts.numbered && t.duration ? `<span class="dur">${fmt(t.duration)}</span>` : ''}
    <button class="more" aria-label="Действия">${ico('more')}</button>
  </div>`;
}
// список с постраничной дорисовкой: длинные библиотеки не тормозят
export function renderList(el, list, { onPlay, onMore, empty = '', numbered = false, noSource = false, noLiked = false, chunk = 120 } = {}) {
  if (!list.length) { el.innerHTML = empty ? `<div class="empty">${empty}</div>` : ''; return; }
  let shown = 0;
  el.innerHTML = '';
  const more = () => {
    const part = list.slice(shown, shown + chunk);
    el.insertAdjacentHTML('beforeend', part.map((t, j) => trackRow(t, shown + j, { numbered, noSource, noLiked })).join(''));
    shown += part.length;
    if (shown < list.length) { const b = document.createElement('button'); b.className = 'btn sm load-more'; b.textContent = 'Показать ещё'; b.onclick = () => { b.remove(); more(); }; el.appendChild(b); }
  };
  more();
  bindRows(el, i => list[i], i => onPlay(i), t => onMore(t));
}
export function bindRows(el, get, onPlay, onMore) {
  el._get = get; el._play = onPlay; el._more = onMore;
  if (el._bound) return; el._bound = true;
  el.addEventListener('click', e => {
    const row = e.target.closest('.trk'); if (!row || !el.contains(row)) return;
    if (row.dataset.long) { delete row.dataset.long; return; }
    const t = el._get(+row.dataset.i);
    if (e.target.closest('.more')) { haptic(); el._more(t); return; }
    el._play(+row.dataset.i);
  });
  // долгое нажатие — меню действий
  let timer, start, row;
  el.addEventListener('touchstart', e => {
    row = e.target.closest('.trk'); if (!row || e.target.closest('.more')) { row = null; return; }
    start = e.touches[0]; row.classList.add('pressed');
    const r = row;
    timer = setTimeout(() => { r.classList.remove('pressed'); haptic('medium'); r.dataset.long = '1'; el._more(el._get(+r.dataset.i)); }, 480);
  }, { passive: true });
  const cancel = () => { clearTimeout(timer); if (row) row.classList.remove('pressed'); };
  el.addEventListener('touchmove', e => { if (start && (Math.abs(e.touches[0].clientX - start.clientX) > 8 || Math.abs(e.touches[0].clientY - start.clientY) > 8)) cancel(); }, { passive: true });
  el.addEventListener('touchend', cancel, { passive: true });
  el.addEventListener('touchcancel', cancel, { passive: true });
}
export function refreshRows() {
  $$('.trk').forEach(r => {
    const cur = state.current && r.dataset.key === key(state.current);
    r.classList.toggle('current', !!cur);
  });
}

/* ---------- листы снизу ---------- */
const openSheets = [];
export function sheet(html, { full = false, onClose } = {}) {
  const root = $('#sheets');
  const back = document.createElement('div'); back.className = 'sheet-back';
  const el = document.createElement('div'); el.className = 'sheet' + (full ? ' full' : '');
  el.innerHTML = `<div class="sh-grab"></div>${html}`;
  root.append(back, el);
  requestAnimationFrame(() => { back.classList.add('show'); el.classList.add('show'); });
  const api = {
    el,
    close() {
      if (api.closed) return; api.closed = true;
      back.classList.remove('show'); el.classList.remove('show');
      setTimeout(() => { back.remove(); el.remove(); }, 420);
      const i = openSheets.indexOf(api); if (i >= 0) openSheets.splice(i, 1);
      onClose && onClose();
    },
  };
  back.onclick = () => api.close();
  dragToClose(el, $('.sh-grab', el), () => api.close(), el);
  openSheets.push(api);
  return api;
}
export const closeSheets = () => [...openSheets].forEach(s => s.close());
// жест «потянуть вниз, чтобы закрыть»: за ручку или с верха прокрутки
export function dragToClose(el, handle, close, scrollRoot) {
  let y0 = null, dy = 0, t0 = 0;
  const startOk = e => e.target === handle || handle.contains(e.target) || (!e.target.closest('.sh-body,.lyrics,.pl-prog,input') || ((e.target.closest('.sh-body') || {}).scrollTop === 0 && !e.target.closest('.pl-prog,input')));
  el.addEventListener('touchstart', e => { if (!startOk(e)) return; y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { el.style.transform = ''; return; }
    const inner = e.target.closest('.sh-body'); if (inner && inner.scrollTop > 0) { y0 = null; return; }
    el.classList.add('dragging'); el.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (y0 === null) return;
    el.classList.remove('dragging'); el.style.transform = '';
    const fast = dy > 40 && Date.now() - t0 < 250;
    if (dy > 120 || fast) close();
    y0 = null;
  });
}
// меню действий: [иконка, текст, функция, {danger}] или null — разделитель
export function actions(head, items) {
  const list = items.filter((x, i, a) => x || (i > 0 && a[i - 1] && i < a.length - 1));
  const s = sheet(`${head || ''}<div class="sh-body">${list.map((it, i) => it ? `<button class="act${it[3] && it[3].danger ? ' danger' : ''}" data-i="${i}">${ico(it[0])}<span>${esc(it[1])}</span></button>` : '<div class="sh-sep"></div>').join('')}</div>`);
  $$('.act', s.el).forEach(b => b.onclick = () => { s.close(); haptic(); setTimeout(() => list[+b.dataset.i][2](), 60); });
  return s;
}
export const trackHead = t => `<div class="sh-head"><div class="sh-cv" style="background-image:${esc(cssUrl(t.cover))}"></div><div class="sh-t"><b>${esc(t.title)}</b><span>${esc(t.artist)}${SOURCE[t.source] ? ', ' + SOURCE[t.source] : ''}</span></div></div>`;

// диалог с полем ввода
export function prompt(title, { value = '', placeholder = '', ok = 'Готово' } = {}) {
  return new Promise(resolve => {
    const s = sheet(`<div class="sh-head"><div class="sh-title">${esc(title)}</div></div><div class="sh-pad"><div class="field"><input id="pIn" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"></div><button class="btn primary wide" id="pOk" style="margin-top:14px">${esc(ok)}</button></div>`, { onClose: () => resolve(null) });
    const inp = $('#pIn', s.el); setTimeout(() => inp.focus(), 350);
    const done = () => { const v = inp.value.trim(); resolve(v || null); s.close(); };
    $('#pOk', s.el).onclick = done;
    inp.onkeydown = e => { if (e.key === 'Enter') done(); };
  });
}

/* ---------- навигация: вкладки и стек страниц ---------- */
const stack = [];
const tabRenderers = {};
export function onTab(name, fn) { tabRenderers[name] = fn; }
export function showTab(name) {
  if (state.tab === name && !stack.length) { const el = $('#tab-' + name); el.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  popAll();
  state.tab = name;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tb').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  tabRenderers[name] && tabRenderers[name]();
}
// новая страница поверх: build(el) рисует содержимое
export function push(title, build) {
  const el = document.createElement('section'); el.className = 'page enter';
  el.innerHTML = `<div class="navbar"><button class="icon-btn nb-back" aria-label="Назад">${ico('back')}</button><div class="nb-title">${esc(title)}</div><span style="width:48px"></span></div><div class="pg"></div>`;
  $('#stack').appendChild(el);
  const prevTop = stack[stack.length - 1]; if (prevTop) prevTop.el.classList.add('under');
  stack.push({ el });
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')));
  $('.nb-back', el).onclick = pop;
  const nb = $('.navbar', el);
  el.addEventListener('scroll', () => nb.classList.toggle('solid', el.scrollTop > 120), { passive: true });
  edgeSwipe(el);
  build($('.pg', el), el, t => { $('.nb-title', el).textContent = t; });
  return el;
}
export function pop() {
  const top = stack.pop(); if (!top) return;
  top.el.classList.add('leave');
  setTimeout(() => top.el.remove(), 420);
  const under = stack[stack.length - 1]; if (under) under.el.classList.remove('under');
}
function popAll() { while (stack.length) { const t = stack.pop(); t.el.remove(); } }
// свайп от левого края — назад, как в iOS
function edgeSwipe(el) {
  let x0 = null, dx = 0;
  el.addEventListener('touchstart', e => { const x = e.touches[0].clientX; if (x < 24) { x0 = x; dx = 0; } }, { passive: true });
  el.addEventListener('touchmove', e => { if (x0 === null) return; dx = Math.max(0, e.touches[0].clientX - x0); el.style.transition = 'none'; el.style.transform = `translateX(${dx}px)`; }, { passive: true });
  el.addEventListener('touchend', () => { if (x0 === null) return; el.style.transition = ''; el.style.transform = ''; if (dx > window.innerWidth * 0.3) pop(); x0 = null; });
}
export const stackDepth = () => stack.length;
export const timeAgo = ts => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'только что'; if (m < 60) return m + ' мин назад';
  const h = Math.round(m / 60); if (h < 24) return h + ' ч назад';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};
