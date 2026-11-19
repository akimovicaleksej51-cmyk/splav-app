// Воспроизведение, волна, мини-плеер, полноэкранный плеер, текст, очередь, экран блокировки
import { API } from './api.js';
import { $, $$, esc, fmt, cssUrl, key, ico, toast, haptic, state, sheet, actions, trackHead, trackRow, bindRows, refreshRows, SOURCE } from './lib.js';
import { openArtist, trackMenu, renderWave } from './views.js';
import { room, roomPublish, roomTrack } from './together.js';
import { Native, isNative } from '../core/native.js';

export const audio = new Audio();
audio.preload = 'auto';
audio.setAttribute('playsinline', '');
document.body.appendChild(audio);

export const isPlaying = () => !audio.paused && !audio.ended;
export const curTime = () => audio.currentTime || 0;
export const curDur = () => (isFinite(audio.duration) && audio.duration) || (state.current && state.current.duration) || 0;
export function seekTo(sec) { try { audio.currentTime = Math.max(0, sec); } catch {} if (room.role === 'host') roomPublish(); updateTime(); }

/* ---------- учёт прослушанного (для итогов) ---------- */
const listen = { track: null, secs: 0, lastT: 0 };
function flushListen() {
  const t = listen.track;
  if (t && listen.secs >= 30) {
    const slim = { id: t.id, rawId: t.rawId, source: t.source, title: t.title, artist: t.artist, artists: t.artists || [], album: t.album || '', albumId: t.albumId || null, duration: t.duration || 0, cover: t.cover || null, available: true };
    API.historyAdd({ key: key(t), title: t.title, artist: t.artist, artistNames: (t.artists || []).map(a => a.name), cover: t.cover, source: t.source, seconds: Math.round(listen.secs), t: slim, w: state.mode === 'wave', full: !!(t.duration && listen.secs >= t.duration * 0.8) }).catch(() => {});
  }
  listen.track = null; listen.secs = 0; listen.lastT = 0;
}

/* ---------- движок ---------- */
let playToken = 0;
export async function playTrack(t) {
  if (t.locked) { const { askLogin } = await import('./views.js'); askLogin(t.locked); return; }
  const token = ++playToken;
  flushListen();
  listen.track = t;
  state.current = t;
  renderNow();
  try {
    const { url } = await API.stream(t);
    if (token !== playToken) return;
    audio.src = url;
    await audio.play();
    if (state.mode === 'wave') API.waveFeedback({ type: 'trackStarted', track: t }).catch(() => {});
    if (room.role === 'host') roomPublish(true);
  } catch (e) {
    if (token !== playToken) return;
    if (e && e.name === 'NotAllowedError') { syncPlaying(); return; }   // iOS не дал запустить звук без касания
    toast(`Не удалось включить «${t.title}». ${e.message || ''}`.trim());
    setTimeout(() => { if (token === playToken) next(false); }, 1200);
  }
}
export function playQueue(list, index, mode = 'list', from = '') {
  if (room.role === 'guest') { toast('Вы в комнате: музыку выбирает хозяин. Выйдите, чтобы слушать своё'); return; }
  state.queue = list.filter(t => t.available !== false);
  state.qi = Math.max(0, state.queue.indexOf(list[index]));
  state.mode = mode; state.from = from;
  if (mode !== 'wave') state.station = null;
  playTrack(state.queue[state.qi]);
}
export async function next(userSkip = true) {
  if (room.role === 'guest') { if (userSkip) toast('Треки выбирает хозяин комнаты'); return; }
  const cur = state.current;
  if (state.mode === 'wave' && cur && userSkip) API.waveFeedback({ type: 'skip', track: cur, played: curTime() }).catch(() => {});
  if (state.qi + 1 >= state.queue.length) {
    if (state.mode === 'wave') await loadMoreWave();
    if (state.qi + 1 >= state.queue.length) { audio.pause(); return; }
  }
  state.qi++;
  playTrack(state.queue[state.qi]);
  if (state.mode === 'wave' && state.queue.length - state.qi <= 2) loadMoreWave();
}
export function prev() {
  if (room.role === 'guest') { toast('Треки выбирает хозяин комнаты'); return; }
  if (curTime() > 3 || state.qi <= 0) { seekTo(0); return; }
  state.qi--; playTrack(state.queue[state.qi]);
}
export function togglePlay() {
  if (!state.current) { startWave(); return; }
  haptic();
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

audio.addEventListener('ended', () => {
  if (state.mode === 'wave' && state.current) API.waveFeedback({ type: 'trackFinished', track: state.current, played: curDur() }).catch(() => {});
  next(false);
});
audio.addEventListener('timeupdate', () => {
  const c = curTime(); const dt = c - listen.lastT; if (dt > 0 && dt < 2) listen.secs += dt; listen.lastT = c;
  updateTime(); syncLyrics();
});
audio.addEventListener('play', syncPlaying);
audio.addEventListener('pause', () => { syncPlaying(); if (room.role === 'host') roomPublish(); });
audio.addEventListener('playing', () => { syncPlaying(); if (room.role === 'host') roomPublish(); });

/* ---------- волна ---------- */
export function effectiveWave() {
  const w = { ...state.wave };
  if (state.prefs.timeOfDay !== false && w.moodEnergy === 'all') {
    const h = new Date().getHours();
    if (h >= 6 && h < 11) w.moodEnergy = 'active';
    else if (h >= 22 || h < 6) w.moodEnergy = 'calm';
  }
  return w;
}
export async function startWave(station) {
  if (room.role === 'guest') { toast('Вы в комнате: музыку выбирает хозяин'); return; }
  state.station = station || null;
  state.mode = 'wave'; state.queue = []; state.qi = -1; state.from = '';
  state.waveStatus = 'Подбираем музыку…'; renderWave();
  API.waveFeedback({ type: 'radioStarted', track: { source: 'ya' } }).catch(() => {});
  await loadMoreWave();
  state.waveStatus = '';
  if (state.queue.length) { state.qi = 0; playTrack(state.queue[0]); }
  else { state.waveStatus = 'Волна пока пустая. Поставьте пару лайков или выберите жанры'; renderWave(); }
}
export async function loadMoreWave() {
  if (state.loadingMore) return;
  state.loadingMore = true;
  try {
    const lastYa = [...state.queue].reverse().find(t => t.source === 'ya');
    const list = await API.waveNext({ lastYaId: lastYa ? lastYa.id.slice(3) : undefined, mix: state.wave.mix, likedSc: state.likes.sc.map(t => t.rawId), settings: effectiveWave(), station: state.station });
    const have = new Set(state.queue.map(key));
    state.queue.push(...list.filter(t => !have.has(key(t)) && t.available !== false));
    document.dispatchEvent(new Event('now-changed'));
  } catch (e) { toast('Волна: ' + e.message); }
  finally { state.loadingMore = false; }
}
export async function applyWaveSettings() {
  try { await API.waveSettings(state.wave, effectiveWave()); } catch (e) { toast(e.message); }
  if (state.mode === 'wave') { state.queue = state.queue.slice(0, state.qi + 1); loadMoreWave(); }
}
export const stationFromTrack = t => ({ type: 'track', source: t.source, id: t.rawId, title: t.title, artist: (t.artist || '').split(',')[0].trim(), genre: t._genre || '', label: `по треку «${t.title}»` });
export const stationFromArtist = (a, name) => a && ['ya', 'sc', 'au', 'ja'].includes(a.source)
  ? { type: 'artist', source: a.source, id: a.id, artist: a.name, label: `по артисту ${a.name}` }
  : { type: 'artist', source: 'none', id: null, artist: name, label: `по артисту ${name}` };
export async function startStation(st) {
  const { showTab } = await import('./lib.js');
  closePlayer(); showTab('wave'); startWave(st);
}

/* ---------- лайки ---------- */
export async function toggleLike(t) {
  if (!t || t.source === 'local') return;
  const k = key(t), on = !state.liked.has(k);
  on ? state.liked.add(k) : state.liked.delete(k);
  haptic(on ? 'medium' : 'light'); renderLikeState();
  try {
    await API.like(t, on);
    const guest = t.source === 'au' || t.source === 'ja' || (t.source === 'sc' && !state.accounts.sc);
    const b = guest ? 'guest' : t.source;
    if (state.likes[b]) state.likes[b] = on ? [t, ...state.likes[b]] : state.likes[b].filter(x => key(x) !== k);
    if (on) toast('Добавлено в «Мою музыку»');
    document.dispatchEvent(new Event('likes-changed'));
  } catch (e) { on ? state.liked.delete(k) : state.liked.add(k); renderLikeState(); toast(e.message); }
}
export async function dislike(t) {
  try { await API.dislike(t); toast('Больше не будем это ставить'); } catch (e) { toast(e.message); }
  if (state.current && key(state.current) === key(t)) next(true);
}
function renderLikeState() {
  const on = !!(state.current && state.liked.has(key(state.current)));
  const b = $('#plLike'); if (b) { b.classList.toggle('on', on); }
  const w = $('#wvLike'); if (w) w.classList.toggle('on', on);
}

/* ---------- мини-плеер ---------- */
const mini = $('#mini');
$('#miniPlay').onclick = e => { e.stopPropagation(); togglePlay(); };
$('#miniNext').onclick = e => { e.stopPropagation(); haptic(); next(true); };
$('#miniNext').innerHTML = ico('next');
// мини-плеер: свайп влево — следующий трек, вправо — предыдущий, вверх — открыть плеер
{
  let x0 = null, y0 = 0, dx = 0, axis = null, t0 = 0;
  const content = () => [$('#miniCover'), mini.querySelector('.mini-meta')];
  mini.addEventListener('touchstart', e => {
    if (e.target.closest('.mini-btn')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; axis = null; t0 = Date.now();
  }, { passive: true });
  mini.addEventListener('touchmove', e => {
    if (x0 === null) return;
    dx = e.touches[0].clientX - x0; const dy = e.touches[0].clientY - y0;
    if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axis === 'x') { mini.classList.add('swiping'); content().forEach(el => { el.style.transform = `translateX(${dx}px)`; el.style.opacity = String(1 - Math.min(.7, Math.abs(dx) / 220)); }); }
  }, { passive: true });
  mini.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dy = e.changedTouches[0].clientY - y0;
    if (axis === 'y' && dy < -30) openPlayer();
    if (axis === 'x') {
      const go = Math.abs(dx) > 70 || (Math.abs(dx) > 30 && Date.now() - t0 < 220);
      const dir = dx < 0 ? -1 : 1;
      mini.classList.remove('swiping');
      if (go) {
        haptic();
        content().forEach(el => { el.style.transform = `translateX(${dir * 260}px)`; el.style.opacity = '0'; });
        setTimeout(() => {
          dir < 0 ? next(true) : prev();
          content().forEach(el => { el.style.transition = 'none'; el.style.transform = `translateX(${-dir * 120}px)`; el.style.opacity = '0'; });
          requestAnimationFrame(() => requestAnimationFrame(() => content().forEach(el => { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; })));
        }, 160);
      } else content().forEach(el => { el.style.transform = ''; el.style.opacity = ''; });
      mini._swiped = Date.now();
    }
    x0 = null;
  }, { passive: true });
  mini.onclick = () => { if (Date.now() - (mini._swiped || 0) < 350) return; openPlayer(); };
}

/* ---------- полноэкранный плеер ---------- */
const P = $('#player');
P.innerHTML = `
  <div class="pl-bg" id="plBg"></div>
  <div class="pl-grab"></div>
  <div class="pl-inner">
    <div class="pl-top">
      <button class="icon-btn" id="plClose" aria-label="Свернуть">${ico('down')}</button>
      <div class="pl-from" id="plFrom"></div>
      <button class="icon-btn" id="plMore" aria-label="Ещё">${ico('more')}</button>
    </div>
    <div class="pl-stage" id="plStage">
      <div class="pl-cover" id="plCover"></div>
      <div class="lyrics hidden" id="plLyrics"></div>
    </div>
    <div class="pl-info">
      <div class="pl-meta"><div class="pl-title" id="plTitle"></div><button class="pl-artist" id="plArtist"></button></div>
      <button class="pl-like" id="plLike" aria-label="Нравится">${ico('heart')}</button>
    </div>
    <div class="pl-prog" id="plProg"><div class="pl-bar"><div class="pl-fill" id="plFill"></div><div class="pl-knob" id="plKnob"></div></div><div class="pl-times"><span id="plCur">0:00</span><span id="plDur">0:00</span></div></div>
    <div class="pl-ctrl">
      <button class="side" id="plDislike" aria-label="Не нравится">${ico('ban')}</button>
      <button class="skip" id="plPrev" aria-label="Назад">${ico('prev')}</button>
      <button class="play" id="plPlay" aria-label="Играть или пауза"></button>
      <button class="skip" id="plNext" aria-label="Дальше">${ico('next')}</button>
      <button class="side" id="plWave" aria-label="Волна по треку">${ico('radio')}</button>
    </div>
    <div class="pl-bottom">
      <button id="plLyr" aria-label="Текст песни">${ico('lyrics')}</button>
      <button id="plSend" aria-label="Отправить другу">${ico('send')}</button>
      <button id="plRoom" aria-label="Слушать вместе">${ico('people')}</button>
      <button id="plQueue" aria-label="Очередь">${ico('queue')}</button>
    </div>
  </div>`;
let plOpen = false;
export function openPlayer() {
  if (!state.current) return;
  plOpen = true; P.classList.add('open'); P.setAttribute('aria-hidden', 'false');
  renderNow(); haptic();
}
export function closePlayer() { plOpen = false; P.classList.remove('open'); P.setAttribute('aria-hidden', 'true'); }
$('#plClose').onclick = closePlayer;
$('#plPlay').onclick = togglePlay;
$('#plNext').onclick = () => { haptic(); next(true); };
$('#plPrev').onclick = () => { haptic(); prev(); };
$('#plLike').onclick = () => toggleLike(state.current);
$('#plDislike').onclick = () => state.current && dislike(state.current);
$('#plWave').onclick = () => state.current && startStation(stationFromTrack(state.current));
$('#plArtist').onclick = () => { const t = state.current; if (!t) return; const a = t.artists && t.artists[0]; if (a && (a.source === 'ya' || a.source === 'sc')) { closePlayer(); openArtist(a.source, a.id, a.name); } };
$('#plMore').onclick = () => state.current && trackMenu(state.current, { inPlayer: true });
$('#plQueue').onclick = openQueue;
$('#plLyr').onclick = toggleLyrics;
$('#plSend').onclick = async () => { if (!state.current) return; const { pickFriend } = await import('./together.js'); pickFriend(state.current); };
$('#plRoom').onclick = async () => { closePlayer(); const { showTab } = await import('./lib.js'); showTab('together'); };

// жест вниз — свернуть плеер; влево/вправо по обложке — следующий/предыдущий
{
  let x0, y0, axis = null, dy = 0, dx = 0, t0;
  P.addEventListener('touchstart', e => {
    if (e.target.closest('.pl-prog') || (e.target.closest('.lyrics') && $('#plLyrics').scrollTop > 0)) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; axis = null; dx = dy = 0; t0 = Date.now();
  }, { passive: true });
  P.addEventListener('touchmove', e => {
    if (x0 == null) return;
    dx = e.touches[0].clientX - x0; dy = e.touches[0].clientY - y0;
    if (!axis && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) axis = Math.abs(dy) > Math.abs(dx) ? 'y' : (e.target.closest('#plCover') ? 'x' : 'none');
    if (axis === 'y' && dy > 0) { P.classList.add('dragging'); P.style.transform = `translateY(${dy}px)`; }
    if (axis === 'x') { const c = $('#plCover'); c.classList.add('swipe'); c.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`; c.style.opacity = String(1 - Math.min(.6, Math.abs(dx) / 400)); }
  }, { passive: true });
  P.addEventListener('touchend', () => {
    if (x0 == null) return;
    if (axis === 'y') { P.classList.remove('dragging'); P.style.transform = ''; if (dy > 140 || (dy > 50 && Date.now() - t0 < 250)) closePlayer(); }
    if (axis === 'x') {
      const c = $('#plCover'); c.classList.remove('swipe'); c.style.transform = ''; c.style.opacity = '';
      if (dx < -80) { haptic(); next(true); } else if (dx > 80) { haptic(); prev(); }
    }
    x0 = null;
  });
}
// перемотка пальцем
{
  const prog = $('#plProg'); let drag = false;
  const at = e => { const r = $('.pl-bar', prog).getBoundingClientRect(); return Math.min(1, Math.max(0, ((e.touches ? e.touches[0] : e).clientX - r.left) / r.width)); };
  const show = f => { const d = curDur(); $('#plFill').style.width = (f * 100) + '%'; $('#plKnob').style.left = (f * 100) + '%'; $('#plCur').textContent = fmt(f * d); };
  prog.addEventListener('touchstart', e => { drag = true; prog.classList.add('active'); prog._f = at(e); show(prog._f); }, { passive: true });
  prog.addEventListener('touchmove', e => { if (!drag) return; prog._f = at(e); show(prog._f); }, { passive: true });
  prog.addEventListener('touchend', () => { if (!drag) return; drag = false; prog.classList.remove('active'); seekTo(prog._f * curDur()); haptic(); });
  prog.addEventListener('click', e => { if ('ontouchstart' in window) return; seekTo(at(e) * curDur()); });
  P._dragging = () => drag;
}

function fromLabel() {
  if (room.role === 'guest') return ['Слушаем вместе', room.host];
  if (state.mode === 'wave') return ['Играет из', state.station ? 'Волна ' + state.station.label : 'Моя волна'];
  return [state.from ? 'Играет из' : 'Сейчас играет', state.from || (SOURCE[state.current && state.current.source] || '')];
}
let lastCover = null;
export function renderNow() {
  const t = state.current;
  document.body.classList.toggle('has-mini', !!t);
  mini.classList.toggle('hidden', !t);
  if (!t) return;
  $('#miniCover').style.backgroundImage = cssUrl(t.cover);
  $('#miniTitle').textContent = t.title; $('#miniArtist').textContent = t.artist;
  $('#plCover').style.backgroundImage = cssUrl(t.cover);
  $('#plTitle').textContent = t.title; $('#plArtist').textContent = t.artist;
  const [a, b] = fromLabel(); $('#plFrom').innerHTML = `${esc(a)}<small>${esc(b)}</small>`;
  $('#plDislike').classList.toggle('hidden', state.mode !== 'wave' || t.source !== 'ya');
  $('#plLyr').classList.toggle('has-dot', !!t.hasLyrics);
  renderLikeState(); syncPlaying(); updateTime(); refreshRows();
  if (t.cover !== lastCover) {
    lastCover = t.cover;
    API.coverColor(t.cover).then(c => { if (c && state.current === t) P.style.setProperty('--bgc', `rgb(${c.join(',')})`); }).catch(() => {});
  }
  if (lyr.open) loadLyrics();
  setMediaSession(t);
  document.dispatchEvent(new Event('now-changed'));
}
export function syncPlaying() {
  const p = isPlaying();
  document.body.classList.toggle('playing', p);
  document.body.classList.toggle('paused', !p);
  const icon = ico(p ? 'pause' : 'play');
  $('#miniPlay').innerHTML = icon; $('#plPlay').innerHTML = icon;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'playing' : 'paused';
  document.dispatchEvent(new Event('play-state'));
}
function updateTime() {
  const c = curTime(), d = curDur(), f = d ? Math.min(1, c / d) : 0;
  $('#miniFill').style.width = (f * 100) + '%';
  if (!plOpen || (P._dragging && P._dragging())) return;
  $('#plFill').style.width = (f * 100) + '%'; $('#plKnob').style.left = (f * 100) + '%';
  $('#plCur').textContent = fmt(c); $('#plDur').textContent = fmt(d);
}

/* ---------- текст песни ---------- */
const lyr = { open: false, key: null, data: undefined, idx: -1 };
function toggleLyrics() {
  lyr.open = !lyr.open; haptic();
  $('#plLyr').classList.toggle('on', lyr.open);
  $('#plLyrics').classList.toggle('hidden', !lyr.open);
  $('#plCover').style.visibility = lyr.open ? 'hidden' : '';
  if (lyr.open) loadLyrics();
}
async function loadLyrics() {
  const t = state.current; if (!t) return;
  const box = $('#plLyrics');
  if (lyr.key === key(t) && lyr.data !== undefined) return;
  lyr.key = key(t); lyr.data = undefined; lyr.idx = -1;
  box.innerHTML = '<div class="ly-empty">Ищем текст…</div>';
  let res = null;
  try { res = await API.lyrics({ source: t.source, rawId: t.rawId, title: t.title, artist: t.artist, duration: t.duration }); } catch {}
  if (lyr.key !== key(t)) return;
  lyr.data = res;
  if (!res) { box.innerHTML = '<div class="ly-empty">Для этого трека текста нет</div>'; return; }
  if (!res.synced) { box.innerHTML = res.text.split('\n').map(l => `<div class="ly plain">${esc(l) || '&nbsp;'}</div>`).join(''); box.scrollTop = 0; return; }
  box.innerHTML = res.lines.map((l, i) => `<div class="ly" data-i="${i}">${l.text ? esc(l.text) : '• • •'}</div>`).join('');
  box.onclick = e => { const el = e.target.closest('.ly'); if (el && el.dataset.i) { seekTo(res.lines[+el.dataset.i].t); if (audio.paused) audio.play(); } };
  box.scrollTop = 0;
}
function syncLyrics() {
  if (!plOpen || !lyr.open || !lyr.data || !lyr.data.synced) return;
  const lines = lyr.data.lines, t = curTime() + 0.2;
  let lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].t <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
  if (idx === lyr.idx) return;
  lyr.idx = idx;
  const box = $('#plLyrics');
  $$('.ly', box).forEach((el, i) => el.classList.toggle('on', i === idx));
  const el = box.children[idx]; if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.32, behavior: 'smooth' });
}

/* ---------- очередь ---------- */
function openQueue() {
  const upcoming = state.queue.slice(state.qi + 1, state.qi + 81);
  const s = sheet(`<div class="sh-head"><div class="sh-title">Очередь</div>${state.mode !== 'wave' && upcoming.length ? '<button class="btn sm" id="qClear">Очистить</button>' : ''}</div>
    <div class="sh-body"><div class="q-label">Сейчас играет</div><div class="q-now list" id="qNow"></div><div class="q-label">${state.mode === 'wave' ? 'Дальше в волне' : 'Дальше'}</div><div class="list" id="qList"></div></div>`, { full: true });
  $('#qNow', s.el).innerHTML = state.current ? trackRow(state.current, 0) : '';
  const ql = $('#qList', s.el);
  ql.innerHTML = upcoming.length ? upcoming.map((t, i) => trackRow(t, i)).join('') : '<div class="empty">Дальше пусто</div>';
  bindRows(ql, i => upcoming[i], i => { state.qi = state.qi + 1 + i; playTrack(state.queue[state.qi]); s.close(); }, t => actions(trackHead(t), [['trash', 'Убрать из очереди', () => { const j = state.queue.indexOf(t); if (j > state.qi) state.queue.splice(j, 1); s.close(); openQueue(); }]]));
  const c = $('#qClear', s.el); if (c) c.onclick = () => { state.queue = state.queue.slice(0, state.qi + 1); s.close(); toast('Очередь очищена'); };
}
export function queueNext(t) { state.queue.splice(state.qi + 1, 0, t); if (state.qi < 0) { state.qi = 0; playTrack(t); } toast('Сыграет следующим'); }
export function queueEnd(t) { state.queue.push(t); if (state.qi < 0) { state.qi = 0; playTrack(t); } toast('Добавлено в конец очереди'); }

/* ---------- экран блокировки и пункт управления ---------- */
function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || 'Сплав', artwork: t.cover ? [{ src: t.cover, sizes: '512x512', type: 'image/jpeg' }] : [] });
  } catch {}
}
// кнопки «трек назад / вперёд» на экране блокировки (без двойного срабатывания)
let lastRemote = 0;
const remote = fn => () => { if (Date.now() - lastRemote < 800) return; lastRemote = Date.now(); fn(); };
const remoteNext = remote(() => next(true)), remotePrev = remote(() => prev());
function setupMediaHandlers() {
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const h = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
    h('play', () => audio.play());
    h('pause', () => audio.pause());
    h('nexttrack', remoteNext);
    h('previoustrack', remotePrev);
    h('seekforward', null);
    h('seekbackward', null);
    h('seekto', d => seekTo(d.seekTime));
  }
  if (isNative) Native.remoteCommands().catch(() => {});
}
setupMediaHandlers();
if (isNative) Native.addListener('remote', e => (e.cmd === 'next' ? remoteNext : remotePrev)());
// WebKit сам возвращает перемотку при смене трека, поэтому переставляем кнопки после старта
audio.addEventListener('playing', () => { setupMediaHandlers(); setTimeout(setupMediaHandlers, 600); setTimeout(setupMediaHandlers, 2000); });
audio.addEventListener('pause', () => setTimeout(setupMediaHandlers, 300));
export { roomTrack };
