// Воспроизведение, волна, лайки, полноэкранный плеер с текстом песни
import Hls from 'hls.js';
import { API } from '../../mobile/app/api.js';
import { $, $$, esc, fmt, cssUrl, bigCover, key, ico, toast, state, SOURCE, pushLayer, popLayer, focus, focusFirst, topLayer } from './lib.js';

/* ---------- движок ---------- */
export const audio = new Audio();
audio.preload = 'auto';
document.body.appendChild(audio);
let hls = null;
// SoundCloud часто отдаёт поток кусками (HLS): в Android WebView его играет hls.js
function setSource(url, isHls) {
  if (hls) { hls.destroy(); hls = null; }
  if (isHls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: false, maxBufferLength: 30 });
    hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) audio.dispatchEvent(new Event('error')); });
    hls.loadSource(url); hls.attachMedia(audio);
  } else { audio.src = url; }
}

export const isPlaying = () => !audio.paused && !audio.ended;
export const curTime = () => audio.currentTime || 0;
export const curDur = () => (isFinite(audio.duration) && audio.duration) || (state.current && state.current.duration) || 0;
export function seekTo(sec) { try { audio.currentTime = Math.max(0, Math.min(sec, curDur() - 1)); } catch {} updateTime(); }

/* ---------- учёт прослушанного (для итогов, как на iPhone) ---------- */
const listen = { track: null, secs: 0, lastT: 0 };
function flushListen() {
  const t = listen.track;
  if (t && listen.secs >= 30) {
    const slim = { id: t.id, rawId: t.rawId, source: t.source, title: t.title, artist: t.artist, artists: t.artists || [], album: t.album || '', albumId: t.albumId || null, duration: t.duration || 0, cover: t.cover || null, available: true };
    API.historyAdd({ key: key(t), title: t.title, artist: t.artist, artistNames: (t.artists || []).map(a => a.name), cover: t.cover, source: t.source, seconds: Math.round(listen.secs), t: slim, w: state.mode === 'wave', full: !!(t.duration && listen.secs >= t.duration * 0.8) }).catch(() => {});
  }
  listen.track = null; listen.secs = 0; listen.lastT = 0;
}

let playToken = 0, retried = false;
export async function playTrack(t) {
  if (t.locked) { toast('Этот трек из Яндекс Музыки. Войдите в Яндекс на вкладке «Аккаунты»'); next(false); return; }
  const token = ++playToken;
  flushListen();
  listen.track = t; state.current = t; retried = false;
  renderNow();
  try {
    const s = await API.stream(t);
    if (token !== playToken) return;
    setSource(s.url, s.hls);
    await audio.play();
    if (state.mode === 'wave') API.waveFeedback({ type: 'trackStarted', track: t }).catch(() => {});
    if (state.mode === 'wave' && state.queue.length - state.qi <= 3) loadMoreWave();
  } catch (e) {
    if (token !== playToken) return;
    toast(`Не удалось включить «${t.title}». ${e.message || ''}`.trim());
    setTimeout(() => { if (token === playToken) next(false); }, 1500);
  }
}
export function playQueue(list, index, mode = 'list', from = '') {
  state.queue = list.filter(t => t.available !== false);
  state.qi = Math.max(0, state.queue.indexOf(list[index]));
  state.mode = mode; state.from = from;
  if (mode !== 'wave') state.station = null;
  playTrack(state.queue[state.qi]);
}
export async function next(userSkip = true) {
  const cur = state.current;
  if (state.mode === 'wave' && cur && userSkip) API.waveFeedback({ type: 'skip', track: cur, played: curTime() }).catch(() => {});
  if (state.qi + 1 >= state.queue.length) {
    if (state.mode === 'wave') await loadMoreWave();
    if (state.qi + 1 >= state.queue.length) { audio.pause(); return; }
  }
  state.qi++;
  playTrack(state.queue[state.qi]);
}
export function prev() {
  if (curTime() > 3 || state.qi <= 0) { seekTo(0); return; }
  state.qi--; playTrack(state.queue[state.qi]);
}
export function togglePlay() {
  if (!state.current) { startWave(); return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

audio.addEventListener('ended', () => {
  if (state.mode === 'wave' && state.current) API.waveFeedback({ type: 'trackFinished', track: state.current, played: curDur() }).catch(() => {});
  next(false);
});
audio.addEventListener('timeupdate', () => {
  const c = curTime(); const dt = c - listen.lastT; if (dt > 0 && dt < 2) listen.secs += dt; listen.lastT = c;
  const d = curDur(); if (d && d - c < 60 && state.mode === 'wave' && state.qi + 1 >= state.queue.length) loadMoreWave();
  updateTime(); syncLyrics();
});
for (const ev of ['play', 'pause', 'playing']) audio.addEventListener(ev, syncPlaying);
// оборвался поток — пробуем переподключиться с того же места, потом следующий трек
audio.addEventListener('error', async () => {
  const t = state.current; if (!t) return;
  if (retried) { toast(`«${t.title}» не грузится, включаем следующий`); next(false); return; }
  retried = true;
  const at = curTime(), token = playToken;
  try { const s = await API.stream(t); if (token !== playToken) return; setSource(s.url, s.hls); audio.currentTime = at; await audio.play(); } catch { if (token === playToken) next(false); }
});

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
  state.station = station || null;
  state.mode = 'wave'; state.queue = []; state.qi = -1; state.from = '';
  state.waveStatus = 'Подбираем музыку…'; document.dispatchEvent(new Event('now-changed'));
  API.waveFeedback({ type: 'radioStarted', track: { source: 'ya' } }).catch(() => {});
  await loadMoreWave();
  state.waveStatus = '';
  if (state.queue.length) { state.qi = 0; playTrack(state.queue[0]); }
  else { state.waveStatus = 'Волна пока пустая. Поставьте пару лайков или выберите жанр'; document.dispatchEvent(new Event('now-changed')); }
}
export async function loadMoreWave() {
  if (state.loadingMore) return;
  state.loadingMore = true;
  try {
    const lastYa = [...state.queue].reverse().find(t => t.source === 'ya');
    const list = await API.waveNext({ lastYaId: lastYa ? lastYa.id.slice(3) : undefined, mix: state.wave.mix, likedSc: state.likes.sc.map(t => t.rawId), settings: effectiveWave(), station: state.station });
    const have = new Set(state.queue.map(key));
    state.queue.push(...list.filter(t => !have.has(key(t)) && t.available !== false));
  } catch (e) { toast('Волна: ' + e.message); }
  finally { state.loadingMore = false; }
}
export const stationFromTrack = t => ({ type: 'track', source: t.source, id: t.rawId, title: t.title, artist: (t.artist || '').split(',')[0].trim(), genre: t._genre || '', label: `по треку «${t.title}»` });

/* ---------- лайки ---------- */
export async function toggleLike(t) {
  if (!t || t.source === 'local') return;
  const k = key(t), on = !state.liked.has(k);
  on ? state.liked.add(k) : state.liked.delete(k);
  renderLikeState();
  try {
    await API.like(t, on);
    const guest = t.source === 'au' || t.source === 'ja' || (t.source === 'sc' && !state.accounts.sc);
    const b = guest ? 'guest' : t.source;
    if (state.likes[b]) state.likes[b] = on ? [t, ...state.likes[b]] : state.likes[b].filter(x => key(x) !== k);
    toast(on ? 'Добавлено в «Мою музыку»' : 'Убрано из «Моей музыки»');
    document.dispatchEvent(new Event('likes-changed'));
  } catch (e) { on ? state.liked.delete(k) : state.liked.add(k); renderLikeState(); toast(e.message); }
}
export async function dislike(t) {
  try { await API.dislike(t); toast('Больше не будем это ставить'); } catch (e) { toast(e.message); }
  if (state.current && key(state.current) === key(t)) next(true);
}
function renderLikeState() {
  const on = !!(state.current && state.liked.has(key(state.current)));
  $$('[data-like-now]').forEach(b => b.classList.toggle('on', on));
}

/* ---------- полоска «сейчас играет» внизу ---------- */
const bar = $('#nowbar'); bar.classList.add('now');
bar.innerHTML = `<button class="f nb-open" id="nbOpen"><div class="nb-cv" id="nbCover"><span class="eq"><i></i><i></i><i></i></span></div><div class="nb-meta"><b id="nbTitle"></b><span id="nbArtist"></span></div></button>
  <button class="f nb-btn" id="nbPlay" aria-label="Играть или пауза"></button>
  <button class="f nb-btn" id="nbNext" aria-label="Дальше">${ico('next')}</button>
  <div class="nb-prog"><i id="nbFill"></i></div>`;
$('#nbOpen').onclick = () => openPlayer();
$('#nbPlay').onclick = togglePlay;
$('#nbNext').onclick = () => next(true);

/* ---------- полноэкранный плеер ---------- */
const P = $('#player');
P.innerHTML = `
  <div class="pl-bg" id="plBg"></div><div class="pl-shade"></div>
  <div class="pl-main">
    <div class="pl-cover" id="plCover"></div>
    <div class="pl-side">
      <div class="pl-from" id="plFrom"></div>
      <div class="pl-title" id="plTitle"></div>
      <div class="pl-artist" id="plArtist"></div>
      <div class="lyrics hidden" id="plLyrics"></div>
      <div class="pl-prog"><div class="pl-bar" id="plBar"><i id="plFill"></i></div><div class="pl-times"><span id="plCur">0:00</span><span id="plDur">0:00</span></div></div>
      <div class="pl-ctrl">
        <button class="f c-side" id="plDislike" aria-label="Не нравится">${ico('ban')}</button>
        <button class="f c-skip" id="plPrev" aria-label="Назад">${ico('prev')}</button>
        <button class="f c-play" id="plPlay" aria-label="Играть или пауза" data-autofocus></button>
        <button class="f c-skip" id="plNext" aria-label="Дальше">${ico('next')}</button>
        <button class="f c-side" id="plLike" data-like-now aria-label="Нравится">${ico('heart')}</button>
        <span class="c-gap"></span>
        <button class="f c-side" id="plLyr" aria-label="Текст песни">${ico('lyrics')}</button>
        <button class="f c-side" id="plWave" aria-label="Волна по треку">${ico('radio')}</button>
      </div>
      <div class="pl-hint" id="plHint">Влево и вправо на полосе — перемотка</div>
    </div>
  </div>`;
let plOpen = false;
export function openPlayer() {
  if (!state.current || plOpen) return;
  plOpen = true; P.classList.add('open');
  pushLayer(P, closePlayer);
  renderNow();
  // плеер проявляется плавно: фокус ставим, когда он уже видим
  setTimeout(() => { if (plOpen) focus($('#plPlay')); }, 60);
  wake();
}
export function closePlayer() { if (!plOpen) return; plOpen = false; P.classList.remove('open', 'idle'); popLayer(P); }
export const playerOpen = () => plOpen;
$('#plPlay').onclick = togglePlay;
$('#plNext').onclick = () => next(true);
$('#plPrev').onclick = prev;
$('#plLike').onclick = () => toggleLike(state.current);
$('#plDislike').onclick = () => state.current && dislike(state.current);
$('#plWave').onclick = () => { if (!state.current) return; const st = stationFromTrack(state.current); toast('Включаем волну ' + st.label); startWave(st); };
$('#plLyr').onclick = toggleLyrics;
// полоса перемотки тоже получает фокус: влево/вправо — на 10 секунд
const plBar = $('#plBar'); plBar.classList.add('f'); plBar.tabIndex = 0;
plBar.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seekTo(curTime() + (e.key === 'ArrowRight' ? 10 : -10)); }
});
// в плеере без нажатий 8 секунд — убираем кнопки, остаются обложка и текст
let idleT;
export function wake() {
  P.classList.remove('idle'); clearTimeout(idleT);
  idleT = setTimeout(() => { if (plOpen && isPlaying() && topLayer() && topLayer().el === P) P.classList.add('idle'); }, 8000);
}

function fromLabel() {
  if (state.mode === 'wave') return state.station ? 'Волна ' + state.station.label : 'Моя волна';
  return state.from || SOURCE[state.current && state.current.source] || '';
}
let lastCover = null;
export function renderNow() {
  const t = state.current;
  document.body.classList.toggle('has-now', !!t);
  if (!t) return;
  const cv = cssUrl(t.cover), big = cssUrl(bigCover(t.cover));
  $('#nbCover').style.backgroundImage = cv;
  $('#nbTitle').textContent = t.title; $('#nbArtist').textContent = t.artist;
  $('#plCover').style.backgroundImage = big + ',' + cv;
  $('#plBg').style.backgroundImage = cv;
  // живой фон всего приложения — размытая обложка играющего трека
  const amb = $('#ambient');
  if (amb && amb.dataset.cover !== t.cover) {
    amb.dataset.cover = t.cover || '';
    const layer = document.createElement('i'); layer.style.backgroundImage = cv;
    amb.appendChild(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('in')));
    setTimeout(() => { while (amb.children.length > 1) amb.firstChild.remove(); }, 1400);
  }
  $('#plTitle').textContent = t.title; $('#plArtist').textContent = t.artist + (SOURCE[t.source] ? '  ·  ' + SOURCE[t.source] : '');
  $('#plFrom').textContent = fromLabel();
  $('#plDislike').classList.toggle('hidden', t.source === 'local');
  renderLikeState(); syncPlaying(); updateTime();
  if (t.cover !== lastCover) {
    lastCover = t.cover;
    API.coverColor(t.cover).then(c => { if (c && state.current === t) document.documentElement.style.setProperty('--accent', `rgb(${c.join(',')})`); }).catch(() => {});
  }
  if (lyr.open) loadLyrics();
  setMediaSession(t);
  document.dispatchEvent(new Event('now-changed'));
}
export function syncPlaying() {
  const p = isPlaying();
  document.body.classList.toggle('playing', p);
  const icon = ico(p ? 'pause' : 'play');
  $('#nbPlay').innerHTML = icon; $('#plPlay').innerHTML = icon;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'playing' : 'paused';
  document.dispatchEvent(new Event('play-state'));
}
function updateTime() {
  const c = curTime(), d = curDur(), f = d ? Math.min(1, c / d) : 0;
  $('#nbFill').style.width = (f * 100) + '%';
  if (!plOpen) return;
  $('#plFill').style.width = (f * 100) + '%';
  $('#plCur').textContent = fmt(c); $('#plDur').textContent = fmt(d);
}

/* ---------- текст песни ---------- */
const lyr = { open: false, key: null, data: undefined, idx: -1 };
function toggleLyrics() {
  lyr.open = !lyr.open;
  $('#plLyr').classList.toggle('on', lyr.open);
  $('#plLyrics').classList.toggle('hidden', !lyr.open);
  P.classList.toggle('with-lyrics', lyr.open);
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
  box.innerHTML = res.lines.map(l => `<div class="ly">${l.text ? esc(l.text) : '• • •'}</div>`).join('');
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
  const el = box.children[idx]; if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.35, behavior: 'smooth' });
}

/* ---------- системная панель «сейчас играет» и медиакнопки ---------- */
function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || 'Сплав', artwork: t.cover ? [{ src: bigCover(t.cover), sizes: '1000x1000', type: 'image/jpeg' }] : [] }); } catch {}
}
if ('mediaSession' in navigator) {
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
  h('play', () => audio.play()); h('pause', () => audio.pause());
  h('nexttrack', () => next(true)); h('previoustrack', prev);
  h('seekto', d => seekTo(d.seekTime));
}
// медиакнопки пульта приходят как обычные клавиши
export function mediaKey(e) {
  switch (e.key) {
    case 'MediaPlayPause': togglePlay(); return true;
    case 'MediaPlay': audio.play().catch(() => {}); return true;
    case 'MediaPause': case 'MediaStop': audio.pause(); return true;
    case 'MediaTrackNext': next(true); return true;
    case 'MediaTrackPrevious': prev(); return true;
    case 'MediaFastForward': seekTo(curTime() + 15); return true;
    case 'MediaRewind': seekTo(curTime() - 15); return true;
  }
  return false;
}
export { focusFirst };
