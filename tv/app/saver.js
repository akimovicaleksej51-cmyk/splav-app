// Заставка: пока играет музыка, экран не гаснет, а через 3 минуты без нажатий
// показывается большая обложка, часы и текущая строка песни. Картинка медленно
// плывёт по экрану, чтобы телевизор не выгорал. Любая кнопка пульта её убирает.
import { API } from '../../mobile/app/api.js';
import { Native, isNative } from '../../mobile/core/native.js';
import { $, esc, cssUrl, bigCover, key, state } from './lib.js';
import { isPlaying, curTime } from './player.js';

const IDLE = 3 * 60e3;
const el = document.createElement('div');
el.id = 'saver';
el.innerHTML = `<div class="sv-move"><div class="sv-cv" id="svCv"></div><div class="sv-t"><div class="sv-clock" id="svClock"></div><b id="svTitle"></b><span id="svArtist"></span><div class="sv-ly" id="svLy"></div></div></div>`;
document.body.appendChild(el);

let lastKey = Date.now(), shown = false;
const lyr = { key: null, lines: null, idx: -1 };

export function saverOpen() { return shown; }
// нажатие кнопки: если заставка открыта — только убираем её, кнопка дальше не идёт
export function saverKey() {
  lastKey = Date.now();
  if (!shown) return false;
  shown = false; el.classList.remove('on');
  return true;
}

function show() {
  const t = state.current; if (!t) return;
  shown = true; el.classList.add('on');
  render();
}
function render() {
  const t = state.current; if (!t) return;
  $('#svCv').style.backgroundImage = `${cssUrl(bigCover(t.cover))},${cssUrl(t.cover)}`;
  $('#svTitle').textContent = t.title; $('#svArtist').textContent = t.artist;
  if (lyr.key !== key(t)) loadLyrics(t);
}
async function loadLyrics(t) {
  lyr.key = key(t); lyr.lines = null; lyr.idx = -1; $('#svLy').textContent = '';
  try {
    const r = await API.lyrics({ source: t.source, rawId: t.rawId, title: t.title, artist: t.artist, duration: t.duration });
    if (lyr.key === key(t) && r && r.synced) lyr.lines = r.lines;
  } catch {}
}
function tick() {
  const d = new Date();
  $('#svClock').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  if (!shown) {
    // появляется, только когда играет музыка и пультом давно не пользовались
    if (isPlaying() && Date.now() - lastKey > IDLE) show();
    return;
  }
  if (!state.current) { saverKey(); return; }
  if (lyr.lines) {
    const tt = curTime() + 0.2; let idx = -1;
    for (let i = 0; i < lyr.lines.length && lyr.lines[i].t <= tt; i++) idx = i;
    if (idx !== lyr.idx) { lyr.idx = idx; const line = idx >= 0 ? lyr.lines[idx].text : ''; const ly = $('#svLy'); ly.classList.remove('in'); setTimeout(() => { ly.innerHTML = esc(line || ''); ly.classList.add('in'); }, 180); }
  }
}
setInterval(tick, 500);
document.addEventListener('now-changed', () => { if (shown) render(); });

// экран не гаснет, пока играет музыка; на паузе телевизор снова может уснуть сам
let awake = null;
document.addEventListener('play-state', () => {
  const on = isPlaying();
  if (on === awake || !isNative) return;
  awake = on;
  Native.keepAwake({ on }).catch(() => {});
});
