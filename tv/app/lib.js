// Общее для экранов телевизора: состояние, иконки, уведомления и навигация пультом
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const cssUrl = u => u ? `url("${String(u).replace(/"/g, '%22')}")` : 'none';
export const key = t => t.source + ':' + t.rawId;
export function plural(n, a, b, c) { const m = n % 10, h = n % 100; return n + ' ' + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); }
export const SOURCE = { ya: 'Яндекс', sc: 'SoundCloud', zv: 'Звук', au: 'Audius', ja: 'Jamendo', local: 'Файл' };
// обложки Яндекса приходят в 400x400, для большого экрана просим крупнее
export const bigCover = u => u ? String(u).replace(/\/\d{2,4}x\d{2,4}(?=$|[?#])/, '/1000x1000') : u;

export const state = {
  accounts: {}, guest: true, prefs: {},
  likes: { ya: [], sc: [], zv: [], guest: [] }, liked: new Set(),
  wave: { diversity: 'default', moodEnergy: 'all', language: 'any', mix: true },
  queue: [], qi: -1, mode: null, station: null, current: null, from: '', loadingMore: false, waveStatus: '',
  tab: 'wave',
};

/* ---------- иконки (те же, что на iPhone) ---------- */
const P = {
  wave: '<path d="M2 12c2.5 0 2.5-5 5-5s2.5 10 5 10 2.5-10 5-10 2.5 5 5 5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
  play: '<path class="f" d="M8 5.5v13l11-6.5z"/>',
  pause: '<path class="f" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
  next: '<path class="f" d="M5 5.5v13l9-6.5zM16 5.5h2.6v13H16z"/>',
  prev: '<path class="f" d="M19 5.5v13l-9-6.5zM8 5.5H5.4v13H8z"/>',
  lyrics: '<path d="M4 6h11M4 10.5h11M4 15h6"/><path d="M15.5 19.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm2-2V9.5l3-1"/>',
  queue: '<path d="M4 6h12M4 11h12M4 16h7"/><path d="m15 14 5 3-5 3z" fill="currentColor"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
  radio: '<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  shuffle: '<path d="M3 7h3.5c4 0 5 10 9 10H21M3 17h3.5c1.6 0 2.7-1.6 3.6-3.5M21 7h-5.5c-1.6 0-2.7 1.6-3.6 3.5M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  logout: '<path d="M14 5h4.5v14H14M10 8l-4 4 4 4M6 12h10"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4"/>',
  chart: '<path d="M5 20v-7M12 20V5M19 20v-10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3 2.9-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M15.5 14.6c2.6-.2 4.4 1.3 5 4.4"/>',
  list: '<path d="M4 6h11M4 10.5h11M4 15h7"/><path d="M17 13v7M13.5 16.5h7"/>',
  album: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>',
  up: '<path class="f" d="M12 6l6 8H6z"/>',
  down: '<path class="f" d="M12 18l6-8H6z"/>',
};
export const ico = (n, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}">${(P[n] || '').replace(/class="f"/g, 'fill="currentColor" stroke="none"')}</svg>`;

/* ---------- уведомление ---------- */
let toastT;
export function toast(text) {
  const el = $('#toast'); if (!el) return;
  el.textContent = text; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3800);
}

/* ---------- навигация пультом ----------
   Фокус получают только элементы с классом .f. Стрелка ищет ближайший элемент в её сторону.
   Слой — то, что сейчас поверх всего (плеер, окно), иначе весь экран.
   Зона (data-zone) помнит, где был фокус: вернувшись в неё, попадаете на то же место. */
const layers = [];
export function pushLayer(el, onBack) { layers.push({ el, onBack, prev: document.activeElement }); }
export function popLayer(el) {
  const i = layers.findIndex(l => l.el === el); if (i < 0) return;
  const [l] = layers.splice(i, 1);
  if (l.prev && document.contains(l.prev) && visible(l.prev)) focus(l.prev); else focusFirst();
}
export const topLayer = () => layers[layers.length - 1] || null;
const root = () => (topLayer() ? topLayer().el : $('#app'));
const visible = el => { if (!el || el.disabled) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
const candidates = () => $$('.f', root()).filter(visible);

const zoneMemory = new Map();
const zoneOf = el => el && el.closest('[data-zone]');
let fast = false;   // стрелку держат зажатой — прокручиваем сразу, без анимации
export function setFast(v) { fast = v; }
export function focus(el, { scroll = true } = {}) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const z = zoneOf(el); if (z) zoneMemory.set(z.dataset.zone, el);
  if (scroll) keepInView(el);
}
// запомнить, куда вернётся фокус при входе в зону (например, в меню — на открытую вкладку)
export function remember(zone, el) { if (el) zoneMemory.set(zone, el); }
export function focusFirst(scope) {
  const list = scope ? $$('.f', scope).filter(visible) : candidates();
  const pref = list.find(e => e.dataset.autofocus !== undefined) || list[0];
  if (pref) focus(pref);
}
// прокручиваем все блоки вокруг элемента, чтобы он был на виду с запасом:
// карусель — по горизонтали, страницу — по вертикали
function keepInView(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const st = getComputedStyle(p);
    const canY = /(auto|scroll)/.test(st.overflowY) && p.scrollHeight > p.clientHeight;
    const canX = /(auto|scroll)/.test(st.overflowX) && p.scrollWidth > p.clientWidth;
    if (!canY && !canX) continue;
    const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
    let dy = 0, dx = 0;
    if (canY) {
      const pad = Math.min(pr.height * 0.25, 180);
      if (r.top < pr.top + pad) dy = r.top - (pr.top + pad);
      else if (r.bottom > pr.bottom - pad) dy = r.bottom - (pr.bottom - pad);
      // элемент в начале страницы — показываем её с самого верха, вместе с заголовком
      if (r.bottom - pr.top + p.scrollTop < pr.height * 0.9) dy = -p.scrollTop;
      else if (p.scrollTop + dy < 0) dy = -p.scrollTop;
    }
    if (canX) {
      const pad = Math.min(pr.width * 0.12, 140);
      if (r.left < pr.left + pad) dx = r.left - (pr.left + pad);
      else if (r.right > pr.right - pad) dx = r.right - (pr.right - pad);
    }
    if (dy || dx) p.scrollBy({ top: dy, left: dx, behavior: fast ? 'auto' : 'smooth' });
  }
}

export function move(dir) {
  const cur = document.activeElement;
  let list = candidates();
  // в боковом меню вверх и вниз ходят только по меню: раскрытое, оно перекрывает экран
  const side = cur && cur.closest('#side');
  if (side && (dir === 'up' || dir === 'down')) list = list.filter(el => side.contains(el));
  if (!cur || !list.includes(cur)) { focusFirst(); return true; }
  const a = cur.getBoundingClientRect();
  const horiz = dir === 'left' || dir === 'right';
  let best = null, bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    // насколько элемент дальше в нужную сторону
    const gap = dir === 'right' ? b.left - a.right : dir === 'left' ? a.left - b.right : dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
    const ahead = dir === 'right' ? b.left + b.width / 2 > a.left + a.width / 2 + 1 : dir === 'left' ? b.left + b.width / 2 < a.left + a.width / 2 - 1 : dir === 'down' ? b.top + b.height / 2 > a.top + a.height / 2 + 1 : b.top + b.height / 2 < a.top + a.height / 2 - 1;
    if (!ahead || gap < -Math.min(a[horiz ? 'width' : 'height'], b[horiz ? 'width' : 'height']) / 2) continue;
    // смещение поперёк: если полосы перекрываются, смещения нет
    const lo1 = horiz ? a.top : a.left, hi1 = horiz ? a.bottom : a.right, lo2 = horiz ? b.top : b.left, hi2 = horiz ? b.bottom : b.right;
    const ortho = hi2 < lo1 ? lo1 - hi2 : lo2 > hi1 ? lo2 - hi1 : 0;
    const score = Math.max(0, gap) + ortho * 3;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return false;
  // переходим в другую зону — возвращаемся туда, где были в прошлый раз
  const zFrom = zoneOf(cur), zTo = zoneOf(best);
  if (zTo && zTo !== zFrom) {
    const mem = zoneMemory.get(zTo.dataset.zone);
    if (mem && document.contains(mem) && visible(mem) && list.includes(mem)) best = mem;
    else if ((zTo.classList.contains('cards') || zTo.hasAttribute('data-first')) && (dir === 'up' || dir === 'down')) {
      const zr = zTo.getBoundingClientRect();
      best = list.find(e => zTo.contains(e) && e.getBoundingClientRect().left >= zr.left - 2) || best;
    }
  }
  focus(best);
  return true;
}

// Назад: закрыть верхний слой, иначе — обработчик экрана
let backHandler = null;
export function onBack(fn) { backHandler = fn; }
export function back() {
  const l = topLayer();
  if (l) { l.onBack ? l.onBack() : popLayer(l.el); return true; }
  return backHandler ? backHandler() : false;
}

/* ---------- окно выбора поверх экрана ---------- */
// items: [[иконка, текст, функция], …]
export function menu(title, items) {
  const el = document.createElement('div'); el.className = 'modal';
  el.innerHTML = `<div class="m-box"><div class="m-title">${esc(title)}</div>${items.map((it, i) => `<button class="f m-item" data-i="${i}">${ico(it[0])}<span>${esc(it[1])}</span></button>`).join('')}</div>`;
  document.body.appendChild(el);
  const close = () => { popLayer(el); el.remove(); };
  pushLayer(el, close);
  $$('.m-item', el).forEach(b => b.onclick = () => { close(); items[+b.dataset.i][2](); });
  focusFirst(el);
  return close;
}

/* ---------- окно ввода (название плейлиста и т.п.) ---------- */
export function ask(title, { placeholder = '', ok = 'Готово' } = {}) {
  return new Promise(resolve => {
    const el = document.createElement('div'); el.className = 'modal';
    el.innerHTML = `<div class="m-box"><div class="m-title">${esc(title)}</div><div class="s-field"><input class="f" id="askIn" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" data-autofocus></div><div class="m-row"><button class="f btn primary" id="askOk">${esc(ok)}</button><button class="f btn" id="askNo">Отмена</button></div></div>`;
    document.body.appendChild(el);
    let done = false;
    const close = v => { if (done) return; done = true; popLayer(el); el.remove(); resolve(v); };
    pushLayer(el, () => close(null));
    const inp = $('#askIn', el);
    $('#askOk', el).onclick = () => close(inp.value.trim() || null);
    $('#askNo', el).onclick = () => close(null);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); close(inp.value.trim() || null); } });
    focus(inp);
  });
}
