/* Сплав — renderer */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const API = window.api;

const state = {
  accounts: { ya: null, sc: null },
  likes: { ya: [], sc: [], local: [], zv: [], am: [], guest: [] },
  libLimit: 300,
  liked: new Set(),
  queue: [], qi: -1, mode: null,          // mode: 'wave' | 'list'
  current: null, loadingMore: false,
  wave: { diversity: 'default', moodEnergy: 'all', language: 'any', mix: true },
  libFilter: 'all', libText: '',
  downloadDir: '', folders: [],
  offline: [], offlineKeys: new Set(),
};
const key = t => t.source + ':' + t.rawId;
const SOURCE_NAME = { ya: 'Яндекс', sc: 'SoundCloud', local: 'Файл', zv: 'Звук', am: 'Apple Music', au: 'Audius', ja: 'Jamendo' };

/* ---------- утилиты ---------- */
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let toastTimer;
function toast(msg, onClick) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  el.classList.toggle('clickable', !!onClick);
  el.onclick = onClick ? () => { el.classList.remove('show'); onClick(); } : null;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), onClick ? 6000 : 3200);
}
// уведомление: в окне — всплывашка, а если Сплав свёрнут — системное; нажатие ведёт куда нужно
function notify(title, body, go) {
  if (document.hasFocus()) { toast(`${title}: ${body}`, go); return; }
  try {
    const n = new Notification(title, { body, silent: false });
    n.onclick = () => { API.focusWindow().catch(() => {}); go(); };
  } catch { toast(`${title}: ${body}`, go); }
}
const cssUrl = u => u ? `url("${String(u).replace(/"/g, '%22')}")` : '';

/* ---------- навигация ---------- */
function showPage(name) {
  if (name !== 'detail') { nav.stack = []; nav.from = name; }
  closeNp();
  if (name !== 'detail') $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  if (name === 'search') setTimeout(() => $('#searchInput').focus(), 30);
  if (window.Wave3D) Wave3D.setVisible(name === 'wave');
  if (name === 'friends') onFriendsShown();
}
$$('.nav-item').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));

/* ---------- звуковой движок: две деки, кроссфейд, нормализация, эквалайзер ---------- */
const deckA = new Audio(), deckB = new Audio();
for (const d of [deckA, deckB]) { d.preload = 'auto'; d.crossOrigin = 'anonymous'; }
let audio = deckA;                       // активная дека
const deckHls = new Map();
const otherDeck = () => (audio === deckA ? deckB : deckA);
const fx = { ctx: null, gains: new Map(), eq: [], master: null };
state.prefs = { crossfade: 0, normalize: false, eqOn: false, eqBands: [0, 0, 0, 0, 0], eqPreset: 'flat', timeOfDay: true, tray: true };
state.volume = 0.8;
const EQ_FREQS = [60, 230, 910, 3600, 14000];
const EQ_PRESETS = {
  flat: ['Ровно', [0, 0, 0, 0, 0]],
  bass: ['Больше баса', [6, 3, 0, -1, 0]],
  vocal: ['Вокал', [-2, -1, 3, 3, 1]],
  night: ['Ночной', [3, 1, 0, -2, -4]],
  bright: ['Ярко', [-1, 0, 1, 3, 5]],
};
function ensureGraph() {
  if (fx.ctx) { if (fx.ctx.state === 'suspended') fx.ctx.resume(); return true; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    fx.ctx = ctx;
    fx.eq = EQ_FREQS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1.0; b.gain.value = 0; return b; });
    for (let i = 0; i < fx.eq.length - 1; i++) fx.eq[i].connect(fx.eq[i + 1]);
    fx.master = ctx.createGain();
    fx.eq[fx.eq.length - 1].connect(fx.master); fx.master.connect(ctx.destination);
    for (const d of [deckA, deckB]) { const src = ctx.createMediaElementSource(d); const g = ctx.createGain(); src.connect(g); g.connect(fx.eq[0]); fx.gains.set(d, g); d.volume = 1; }
    applyEq(); setVolume(state.volume);
    return true;
  } catch (e) { fx.ctx = null; return false; }
}
function applyEq() {
  if (!fx.ctx) return;
  const bands = state.prefs.eqOn ? state.prefs.eqBands : [0, 0, 0, 0, 0];
  fx.eq.forEach((b, i) => b.gain.setTargetAtTime(bands[i] || 0, fx.ctx.currentTime, 0.05));
  // небольшой запас, чтобы подъём частот не клиповал
  const boost = Math.max(0, ...bands);
  if (fx.master) fx.master.gain.setTargetAtTime(state.volume * Math.pow(10, -boost / 40) * sleepFadeK, fx.ctx.currentTime, 0.05);
}
let sleepFadeK = 1;
function setVolume(v) {
  state.volume = v;
  if (typeof am !== 'undefined' && am.active) API.amCmd('volume', v).catch(() => {});
  if (fx.ctx) { applyEq(); deckA.volume = deckB.volume = 1; }
  else deckA.volume = deckB.volume = v * sleepFadeK;
}
function normGain(t) {
  if (!state.prefs.normalize || !t || !t.r128) return 1;
  return Math.min(1.3, Math.max(0.3, Math.pow(10, (-14 - t.r128.i) / 20)));
}
function unloadDeck(d) {
  const h = deckHls.get(d); if (h) { h.destroy(); deckHls.delete(d); }
  d.pause(); d.removeAttribute('src'); d.load();
}
function loadDeck(d, url, isHls) {
  const h = deckHls.get(d); if (h) { h.destroy(); deckHls.delete(d); }
  if (isHls && window.Hls && Hls.isSupported()) { const n = new Hls(); n.loadSource(url); n.attachMedia(d); deckHls.set(d, n); }
  else d.src = url;
}

let playToken = 0;
const listen = { key: null, secs: 0, lastT: 0, track: null };
function flushListen() {
  if (listen.track && listen.secs >= 30) {
    const t = listen.track;
    const slimTr = { id: t.id, rawId: t.rawId, source: t.source, title: t.title, artist: t.artist, artists: t.artists || [], album: t.album || '', albumId: t.albumId || null, duration: t.duration || 0, cover: t.cover || null, url: t.url, dlUrl: t.dlUrl, downloadable: t.downloadable, available: true };
    API.historyAdd({ key: key(t), title: t.title, artist: t.artist, artistNames: (t.artists || []).map(a => a.name), cover: t.cover, source: t.source, seconds: Math.round(listen.secs), t: slimTr, w: state.mode === 'wave', full: !!(t.duration && listen.secs >= t.duration * 0.8) }).catch(() => {});
  }
  listen.track = null; listen.secs = 0;
}

/* Apple Music играет через приложение «Музыка», мы им управляем */
const am = { active: false, pid: null, playing: false, started: false, timer: null, pos: 0, dur: 0 };
function amStop() { if (am.active) API.amCmd('pause').catch(() => {}); am.active = false; clearInterval(am.timer); am.timer = null; }
async function amPoll() {
  if (!am.active) return;
  const s = await API.amState().catch(() => null); if (!s || !am.active) return;
  const mine = s.id === am.pid;
  if (mine) { am.started = true; am.playing = s.st === 'playing'; am.pos = s.p || 0; am.dur = s.d || am.dur; }
  if (am.started && (!mine || s.st === 'stopped')) {          // трек доиграл, «Музыка» перешла дальше сама
    API.amCmd('pause').catch(() => {}); am.active = false; clearInterval(am.timer);
    onEnded({ target: audio, am: true }); return;
  }
  updateTimeUI(am.pos, am.dur);
  const dt = am.pos - listen.lastT; if (dt > 0 && dt < 3) listen.secs += dt; listen.lastT = am.pos;
  scrobbleTick(am.pos, am.dur);
  syncPlaying();
}
const isPlaying = () => am.active ? am.playing : !audio.paused;
const curTime = () => am.active ? am.pos : audio.currentTime;
const curDur = () => am.active ? am.dur : (audio.duration || (state.current && state.current.duration) || 0);
function seekTo(sec) { if (am.active) { am.pos = sec; API.amCmd('seek', sec); } else audio.currentTime = sec; if (typeof room !== 'undefined' && room.role === 'host') roomPublish(); }
function updateTimeUI(c, d) {
  $('#pCur').textContent = fmt(c); $('#pDur').textContent = fmt(d);
  const pct = d ? (c / d * 100) + '%' : '0';
  $('#pFill').style.width = pct; $('#npFill').style.width = pct;
  $('#npCur').textContent = fmt(c); $('#npDur').textContent = fmt(d);
}

async function playTrack(t, opts = {}) {
  if (t.locked) { askLogin(t.locked); return; }
  const token = ++playToken;
  flushListen();
  listen.track = t; listen.secs = 0; listen.lastT = 0;
  state.current = t;
  scrobbleStart(t);
  renderNowPlaying();
  if (t.source === 'am') {
    unloadDeck(deckA); unloadDeck(deckB);
    am.active = true; am.pid = t.rawId; am.started = false; am.playing = true; am.pos = 0; am.dur = t.duration;
    clearInterval(am.timer); am.timer = setInterval(amPoll, 700);
    try { await API.amPlay(t.rawId); } catch (e) { toast('Apple Music: ' + e.message); }
    if (!t.cover) API.amCover(t.artist, t.title).then(c => { if (c && state.current === t) { t.cover = c; renderNowPlaying(); } }).catch(() => {});
    syncPlaying(); return;
  }
  amStop();
  const graph = ensureGraph();
  const fade = !!(opts.fade && graph && state.prefs.crossfade > 0);
  const X = state.prefs.crossfade;
  const prevDeck = audio;
  const target = fade ? otherDeck() : audio;
  try {
    const { url, hls: isHls } = await API.stream(t);
    if (token !== playToken) return;
    if (!fade) unloadDeck(otherDeck());
    loadDeck(target, url, isHls);
    const g = fx.gains.get(target), now = fx.ctx ? fx.ctx.currentTime : 0;
    if (g) {
      g.gain.cancelScheduledValues(now);
      if (fade) { g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(normGain(t), now + X); }
      else g.gain.setValueAtTime(normGain(t), now);
    }
    audio = target;
    await target.play();
    if (fade && prevDeck !== target) {
      const pg = fx.gains.get(prevDeck);
      if (pg) { pg.gain.cancelScheduledValues(now); pg.gain.setValueAtTime(pg.gain.value, now); pg.gain.linearRampToValueAtTime(0.0001, now + X); }
      setTimeout(() => { if (audio !== prevDeck) unloadDeck(prevDeck); }, X * 1000 + 150);
    }
    syncPlaying();
    if (state.mode === 'wave') API.waveFeedback({ type: 'trackStarted', track: t }).catch(() => {});
  } catch (e) {
    if (token !== playToken) return;
    xfading = false;
    toast(`Не удалось включить «${t.title}». ${e.message || ''}`.trim());
    setTimeout(() => { if (token === playToken) next(false); }, 900);
  }
}

function playQueue(list, index, mode = 'list', context = null) {
  if (room.role === 'guest') { toast('Вы в комнате: музыку выбирает хозяин. Выйдите, чтобы слушать своё'); return; }
  state.queue = list.filter(t => t.available !== false);
  const target = list[index];
  state.qi = Math.max(0, state.queue.indexOf(target));
  state.mode = mode;
  state.queueContext = context;   // { type: 'album' | 'playlist', keys: Set }
  playTrack(state.queue[state.qi]);
  renderQueue();
}

async function next(userSkip = true, opts = {}) {
  if (room.role === 'guest') { if (userSkip) toast('Треки выбирает хозяин комнаты'); return; }
  const cur = state.current;
  if (state.mode === 'wave' && cur && userSkip) API.waveFeedback({ type: 'skip', track: cur, played: audio.currentTime }).catch(() => {});
  if (state.qi + 1 >= state.queue.length) {
    if (state.mode === 'wave') await loadMoreWave();
    if (state.qi + 1 >= state.queue.length) { audio.pause(); xfading = false; return; }
  }
  state.qi++;
  playTrack(state.queue[state.qi], opts);
  renderQueue();
  if (state.mode === 'wave' && state.queue.length - state.qi <= 2) loadMoreWave();
}
function prev() {
  if (room.role === 'guest') { toast('Треки выбирает хозяин комнаты'); return; }
  if (curTime() > 3 || state.qi <= 0) { seekTo(0); return; }
  state.qi--; playTrack(state.queue[state.qi]); renderQueue();
}
function togglePlay() {
  if (!state.current) { startWave(); return; }
  if (am.active) { am.playing = !am.playing; API.amCmd('toggle'); syncPlaying(); return; }
  ensureGraph();
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

let xfading = false;
function onEnded(e) {
  if (e.target !== audio) return;
  if (am.active && !e.am) return;
  if (state.mode === 'wave' && state.current) API.waveFeedback({ type: 'trackFinished', track: state.current, played: audio.duration }).catch(() => {});
  if (sleepStopsAfterCurrent()) { flushListen(); sleepFire(); return; }
  xfading = false;
  next(false);
}
function onTime(e) {
  if (e.target !== audio) return;
  if (am.active) return;
  const d = audio.duration || (state.current && state.current.duration) || 0, c = audio.currentTime;
  updateTimeUI(c, d);
  scrobbleTick(c, d);
  // учёт прослушанного времени для итогов
  const dt = c - listen.lastT; if (dt > 0 && dt < 2) listen.secs += dt; listen.lastT = c;
  // кроссфейд
  const X = state.prefs.crossfade;
  if (X > 0 && fx.ctx && !xfading && d > X * 2 + 5 && d - c <= X && !audio.paused && !sleepStopsAfterCurrent()
      && (state.qi + 1 < state.queue.length || state.mode === 'wave')) {
    xfading = true;
    if (state.mode === 'wave' && state.current) API.waveFeedback({ type: 'trackFinished', track: state.current, played: c }).catch(() => {});
    next(false, { fade: true }).then(() => setTimeout(() => { xfading = false; }, X * 1000));
  }
}
for (const d of [deckA, deckB]) {
  d.addEventListener('ended', onEnded);
  d.addEventListener('timeupdate', onTime);
  d.addEventListener('play', e => { if (e.target === audio) syncPlaying(); });
  d.addEventListener('pause', e => { if (e.target === audio) syncPlaying(); });
}
$('#pBar').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const d = curDur();
  if (d) seekTo((e.clientX - r.left) / r.width * d);
});
$('#pVol').addEventListener('input', e => { setVolume(+e.target.value); $('#npVol').value = e.target.value; });
$('#pVol').addEventListener('change', e => API.setVolume(+e.target.value));
$('#pPlay').addEventListener('click', togglePlay);
$('#pNext').addEventListener('click', () => next(true));
$('#pPrev').addEventListener('click', prev);
$('#pLike').addEventListener('click', () => state.current && toggleLike(state.current));
$('#pDislike').addEventListener('click', async () => {
  const t = state.current; if (!t) return;
  try { await API.dislike(t); toast('Больше не будем предлагать этот трек'); } catch (e) { toast(e.message); }
  next(false);
});

/* ---------- Last.fm и Discord ---------- */
const scr = { track: null, start: 0, sent: false };
function scrobbleStart(t) {
  scr.track = t; scr.start = Math.floor(Date.now() / 1000); scr.sent = false;
  if (state.prefs.lastfm) API.scrobble('now', slimT(t)).catch(() => {});
}
function scrobbleTick(c, d) {
  if (!scr.track || scr.sent || !state.prefs.lastfm || !d || d < 30) return;
  if (listen.secs >= Math.min(240, d / 2)) { scr.sent = true; API.scrobble('scrobble', slimT(scr.track), scr.start).catch(() => {}); }
}
const slimT = t => ({ title: t.title, artist: t.artist, album: t.album || '', duration: t.duration || 0 });
let presTimer = null;
function pushPresence() {
  clearTimeout(presTimer);
  presTimer = setTimeout(() => {
    const t = state.current;
    if (!state.prefs.discord) return;
    API.presence(t ? { ...slimT(t), cover: t.cover, playing: isPlaying(), position: curTime(), duration: curDur() } : null).catch(() => {});
  }, 600);
}

/* ---------- таймер сна ---------- */
const sleep = { mode: null, endsAt: 0, minutes: 30, tick: null, releaseKeys: null, releaseAlbum: null };
function sleepStopsAfterCurrent() {
  if (sleep.mode === 'track') return true;
  if (sleep.mode === 'release') {
    const nextT = state.queue[state.qi + 1];
    if (!nextT) return true;
    if (sleep.releaseKeys) return !sleep.releaseKeys.has(key(nextT));
    if (sleep.releaseAlbum) return nextT.albumId !== sleep.releaseAlbum;
    return true;
  }
  return false;
}
function sleepSet(mode, minutes) {
  sleepClear(true);
  sleep.mode = mode;
  if (mode === 'release') {
    const ctx = state.queueContext;
    sleep.releaseKeys = ctx && ctx.keys ? ctx.keys : null;
    sleep.releaseAlbum = !sleep.releaseKeys && state.current ? state.current.albumId : null;
  }
  if (mode === 'minutes') {
    sleep.minutes = minutes;
    sleep.endsAt = Date.now() + minutes * 60000;
    sleep.tick = setInterval(sleepTick, 500);
  }
  renderSleepBadge();
  toast(mode === 'track' ? 'Остановим после этого трека' : mode === 'release' ? 'Остановим в конце альбома или выпуска' : `Таймер сна: ${fmtMin(minutes)}`);
}
function sleepTick() {
  const left = sleep.endsAt - Date.now();
  const FADE = 20000;
  if (left <= FADE && left > 0) { sleepFadeK = Math.max(0.0001, left / FADE); setVolume(state.volume); }
  if (left <= 0) { sleepFire(); return; }
  renderSleepBadge();
}
function sleepFire() {
  if (am.active) { am.playing = false; API.amCmd('pause').catch(() => {}); syncPlaying(); }
  audio.pause();
  sleepClear();
  toast('Таймер сна: спокойной ночи');
}
function sleepClear(silent) {
  clearInterval(sleep.tick); sleep.tick = null;
  sleep.mode = null; sleep.releaseKeys = null; sleep.releaseAlbum = null;
  if (sleepFadeK !== 1) { sleepFadeK = 1; setVolume(state.volume); }
  renderSleepBadge();
  if (!silent && $('#sleepPop') && !$('#sleepPop').classList.contains('hidden')) renderSleepPop();
}
const fmtMin = m => { const s = Math.round(m * 60); const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return (h ? h + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight' && e.metaKey) next(true);
  if (e.code === 'ArrowLeft' && e.metaKey) prev();
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => next(true));
  navigator.mediaSession.setActionHandler('previoustrack', prev);
}

function syncPlaying() {
  const playing = isPlaying();
  $('#pPlay').classList.toggle('playing', playing);
  $('#wavePlay').classList.toggle('playing', playing && state.mode === 'wave');
  $('#npPlay').classList.toggle('playing', playing);
  if (window.Wave3D) Wave3D.setEnergy(playing ? 1 : 0.3);
  pushTray(); pushPresence(); roomPublish();
}

function renderNowPlaying() {
  const t = state.current;
  $('#pTitle').textContent = t ? t.title : 'Ничего не играет';
  $('#pArtist').innerHTML = t ? artistLinks(t) : ''; bindArtistLinks($('#pArtist'));
  $('#pLyrics').disabled = !t; $('#pExpand').disabled = !t;
  $('#pCover').style.backgroundImage = t ? cssUrl(t.cover) : '';
  $('#pSource').textContent = t ? SOURCE_NAME[t.source] : '';
  $('#pSource').classList.toggle('hidden', !t);
  $('#pLike').classList.toggle('on', !!(t && state.liked.has(key(t))));
  $('#pLike').disabled = !t || t.source === 'local';
  $('#pDislike').disabled = !t || state.mode !== 'wave' || t.source !== 'ya';
  if (state.mode === 'wave' && t) setWaveTitle(t.title, t.artist);
  else setWaveTitle('Моя волна', 'Бесконечный поток музыки под ваш вкус');
  npOnTrack();
  const pc = $('#pCover'); pc.classList.remove('swap'); void pc.offsetWidth; if (t) pc.classList.add('swap');
  $$('.row').forEach(r => r.classList.toggle('current', !!t && r.dataset.key === key(t)));
  if (t && key(t) !== renderNowPlaying._k) {
    renderNowPlaying._k = key(t);
    npColor = null; prefetchTrayLyrics(t);
    API.coverColor(t.cover).then(c => { if (state.current === t) { npColor = c; pushTray(); } }).catch(() => {});
  }
  pushTray();
  if ('mediaSession' in navigator && t) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork: t.cover ? [{ src: t.cover, sizes: '400x400' }] : [] });
  }
}

/* ---------- волна ---------- */
let lastTitle = null;
function setWaveTitle(title, sub) {
  const el = $('#waveTitle');
  if (title !== lastTitle) {
    lastTitle = title;
    el.innerHTML = splitWords(title, Math.min(0.035, 0.6 / Math.max(1, title.length)));
    el.title = title;
    requestAnimationFrame(() => fitText(el, Math.min(76, Math.max(44, window.innerWidth * 0.055)), 26));
    if (window.Wave3D) Wave3D.kick();
    const now = $('#waveNow'); now.style.animation = 'none'; void now.offsetWidth; now.style.animation = '';
  }
  $('#waveNow').textContent = sub;
}

const WAVE_OPTIONS = {
  diversity: [['default', 'Любой'], ['favorite', 'Любимое'], ['discover', 'Незнакомое'], ['popular', 'Популярное']],
  moodEnergy: [['all', 'Любое'], ['active', 'Бодрое'], ['fun', 'Весёлое'], ['calm', 'Спокойное'], ['sad', 'Грустное']],
  language: [['any', 'Любой'], ['russian', 'Русский'], ['not-russian', 'Иностранный'], ['without-words', 'Без слов']],
};
const ARROW_L = '<svg viewBox="0 0 24 24"><path d="m14.5 6-6 6 6 6"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6"/></svg>';
function buildCarousels() {
  $$('.car').forEach(car => {
    const k = car.dataset.key;
    car.innerHTML = `<button class="car-arrow" data-d="-1" aria-label="Предыдущее">${ARROW_L}</button>
      <div class="car-body"><div class="car-label">${car.dataset.label}</div><div class="car-value"></div><div class="car-dots">${WAVE_OPTIONS[k].map(() => '<i></i>').join('')}</div></div>
      <button class="car-arrow" data-d="1" aria-label="Следующее">${ARROW_R}</button>`;
    $$('.car-arrow', car).forEach(b => b.addEventListener('click', () => stepCarousel(k, +b.dataset.d)));
    let wheelLock = 0;
    car.addEventListener('wheel', e => {
      e.preventDefault();
      const now = Date.now(); if (now - wheelLock < 260) return; wheelLock = now;
      stepCarousel(k, (e.deltaY || e.deltaX) > 0 ? 1 : -1);
    }, { passive: false });
  });
  renderWaveChips();
}
let settingsTimer;
function stepCarousel(k, d) {
  const opts = WAVE_OPTIONS[k];
  let i = opts.findIndex(o => o[0] === state.wave[k]); if (i < 0) i = 0;
  i = (i + d + opts.length) % opts.length;
  state.wave[k] = opts[i][0];
  renderWaveChips(k, d);
  clearTimeout(settingsTimer); settingsTimer = setTimeout(applyWaveSettings, 450);
}
async function startWave(station) {
  if (room.role === 'guest') { toast('Вы в комнате: музыку выбирает хозяин'); return; }
  state.station = station || null; renderStationChip();
  state.mode = 'wave'; state.queue = []; state.qi = -1;
  $('#waveNow').textContent = 'Подбираем музыку…';
  API.waveFeedback({ type: 'radioStarted', track: { source: 'ya' } }).catch(() => {});
  await loadMoreWave();
  if (state.queue.length) { state.qi = 0; playTrack(state.queue[0]); }
  else { $('#waveNow').textContent = 'Волна пока пустая — поставьте пару лайков'; }
}
async function loadMoreWave() {
  if (state.loadingMore) return;
  state.loadingMore = true;
  try {
    const lastYa = [...state.queue].reverse().find(t => t.source === 'ya');
    const lastYaId = lastYa ? lastYa.id.slice(3) : undefined;
    const list = await API.waveNext({ lastYaId, mix: state.wave.mix, likedSc: state.likes.sc.map(t => t.rawId), settings: effectiveWave(), station: state.station });
    const have = new Set(state.queue.map(key));
    state.queue.push(...list.filter(t => !have.has(key(t)) && t.available !== false));
  } catch (e) { toast('Волна: ' + e.message); }
  finally { state.loadingMore = false; }
}
$('#wavePlay').addEventListener('click', () => {
  if (state.mode === 'wave' && state.current) togglePlay(); else startWave(state.station);
});

function renderWaveChips(changedKey, dir) {
  $$('.car').forEach(car => {
    const k = car.dataset.key, opts = WAVE_OPTIONS[k];
    let i = opts.findIndex(o => o[0] === state.wave[k]); if (i < 0) i = 0;
    const v = $('.car-value', car); if (!v) return;
    v.textContent = opts[i][1];
    v.classList.remove('next', 'prev');
    if (k === changedKey) { void v.offsetWidth; v.classList.add(dir > 0 ? 'next' : 'prev'); }
    $$('.car-dots i', car).forEach((d, j) => d.classList.toggle('on', j === i));
  });
  $('#mixToggle').classList.toggle('on', !!state.wave.mix);
  $('#mixToggle').classList.toggle('hidden', !state.accounts.sc);
}
$('#mixToggle').addEventListener('click', async () => { state.wave.mix = !state.wave.mix; renderWaveChips(); await applyWaveSettings(); });
async function applyWaveSettings() {
  try { await API.waveSettings(state.wave, effectiveWave()); } catch (e) { toast(e.message); }
  if (state.mode === 'wave') {
    state.queue = state.queue.slice(0, state.qi + 1);   // убираем старый «хвост», подбираем заново
    loadMoreWave().then(renderQueue);
  }
}

/* ---------- списки ---------- */
const DL_SVG = '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></svg>';
function artistLinks(t) {
  if ((t.source === 'ya' || t.source === 'sc') && t.artists && t.artists.length) {
    return t.artists.map(a => `<span class="a-link" data-asrc="${a.source}" data-aid="${esc(a.id)}">${esc(a.name)}</span>`).join(', ');
  }
  return esc(t.artist);
}
function bindArtistLinks(root) {
  $$('.a-link', root).forEach(el => el.addEventListener('click', e => {
    e.stopPropagation(); openArtist(el.dataset.asrc, el.dataset.aid);
  }));
}
function rowHtml(t, i, opts = {}) {
  const liked = state.liked.has(key(t));
  const canLike = t.source !== 'local' && t.source !== 'am' && !t.locked;
  const offline = state.offlineKeys.has(key(t));
  const canDl = !offline && (t.source === 'sc' || (t.source === 'ja' && t.dlUrl)) && t.downloadable;
  const dlCell = offline ? `<span class="r-off" title="Скачан, играет без интернета">${DL_SVG}</span>`
    : canDl ? `<button class="ibtn r-dl" title="Скачать">${DL_SVG}</button>` : '<span></span>';
  return `<div class="row${opts.numbered ? ' numbered' : ''}${t.available === false ? ' unavailable' : ''}${state.current && key(state.current) === key(t) ? ' current' : ''}" data-key="${esc(key(t))}" style="animation-delay:${Math.min(i, 20) * 0.018}s">
    ${opts.numbered ? `<span class="r-num">${i + 1}</span>` : ''}
    <div class="r-cover" style="background-image:${esc(cssUrl(t.cover))}"></div>
    <div class="r-main"><div class="r-title">${esc(t.title)}</div><div class="r-artist">${artistLinks(t)}</div></div>
    <span class="badge">${SOURCE_NAME[t.source]}</span>
    ${canLike ? `<button class="ibtn r-like${liked ? ' on' : ''}" title="Нравится"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg></button>` : '<span></span>'}
    ${dlCell}
    <span class="r-dur">${t.duration ? fmt(t.duration) : ''}</span>
  </div>`;
}
function renderList(container, list, emptyHtml, opts = {}) {
  if (!list.length) { container.innerHTML = `<div class="empty">${emptyHtml}</div>`; return; }
  container.innerHTML = list.map((t, i) => rowHtml(t, i, opts)).join('');
  bindArtistLinks(container);
  $$('.row', container).forEach((row, i) => {
    const t = list[i];
    $('.r-cover', row).addEventListener('click', () => playQueue(list, i, 'list', opts.context || null));
    $('.r-main', row).addEventListener('click', () => playQueue(list, i, 'list', opts.context || null));
    row.addEventListener('dblclick', () => playQueue(list, i, 'list', opts.context || null));
    row.addEventListener('contextmenu', e => openCtx(e, t, { playlistId: opts.playlistId }));
    const lb = $('.r-like', row); if (lb) lb.addEventListener('click', e => { e.stopPropagation(); toggleLike(t); });
    const db = $('.r-dl', row); if (db) db.addEventListener('click', e => { e.stopPropagation(); download(t, db); });
  });
}

async function toggleLike(t) {
  const k = key(t); const on = !state.liked.has(k);
  on ? state.liked.add(k) : state.liked.delete(k);
  refreshLikeButtons();
  try {
    await API.like(t, on);
    const guestSrc = t.source === 'au' || t.source === 'ja' || (t.source === 'sc' && !state.accounts.sc);
    const bucketName = guestSrc ? 'guest' : t.source;
    const bucket = state.likes[bucketName];
    if (bucket) { if (on) bucket.unshift(t); else state.likes[bucketName] = bucket.filter(x => key(x) !== k); }
    if (on) toast('Добавлено в «Мою музыку»');
    renderLibrary();
  } catch (e) {
    on ? state.liked.delete(k) : state.liked.add(k);
    refreshLikeButtons(); toast(e.message);
  }
}
function refreshLikeButtons() {
  $$('.row').forEach(r => { const b = $('.r-like', r); if (b) b.classList.toggle('on', state.liked.has(r.dataset.key)); });
  $('#pLike').classList.toggle('on', !!(state.current && state.liked.has(key(state.current))));
  $('#npLike').classList.toggle('on', !!(state.current && state.liked.has(key(state.current))));
  pushTray();
}

async function download(t, btn) {
  btn.disabled = true; toast(`Скачиваем «${t.title}»…`);
  try {
    const file = await API.download(t);
    toast(`Сохранено в «Скачанное»: ${t.artist} — ${t.title}`);
    await loadOffline(); renderLibrary(); refreshRows(); void file;
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
}

/* ---------- поиск ---------- */
let searchTimer, searchSeq = 0;
$('#searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) { renderArtists([]); $('#searchResults').innerHTML = '<div class="empty">Ищем сразу в Яндекс Музыке и SoundCloud</div>'; return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    $('#searchResults').innerHTML = '<div class="empty">Ищем…</div>';
    try {
      const r = await API.search(q);
      if (seq !== searchSeq) return;
      renderArtists(r.artists || []);
      renderList($('#searchResults'), r.tracks, r.locked && r.locked.length ? 'В открытых источниках не нашли' : (r.artists || []).length ? '' : 'Ничего не нашли. Попробуйте написать иначе');
      renderLocked(r.locked || []);
    } catch (err) { if (seq === searchSeq) $('#searchResults').innerHTML = `<div class="empty">Поиск не сработал: ${esc(err.message)}</div>`; }
  }, 320);
});

// сначала артист: крупная карточка лучшего совпадения и лента похожих
function renderArtists(list) {
  const box = $('#artistBlock');
  box.classList.toggle('hidden', !list.length);
  if (!list.length) { box.innerHTML = ''; return; }
  const [best, ...others] = list;
  box.innerHTML = `<button class="ab-best" data-i="0"><i style="background-image:${esc(cssUrl(best.cover))}"></i><span><b>${esc(best.name)}</b><small>Артист${best.source === 'sc' ? ' в SoundCloud' : best.genre ? ', ' + esc(best.genre) : ''}</small></span></button>
    ${others.length ? `<div class="ab-row">${others.map((a, i) => `<button class="ab-item" data-i="${i + 1}"><i style="background-image:${esc(cssUrl(a.cover))}"></i><b>${esc(a.name)}</b></button>`).join('')}</div>` : ''}
    ${''}<div class="ab-label">Треки</div>`;
  $$('[data-i]', box).forEach(b => b.addEventListener('click', () => { const a = list[+b.dataset.i]; openArtist(a.source, a.id); }));
}

function renderLocked(list) {
  const box = $('#lockedBlock');
  box.classList.toggle('hidden', !list.length);
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="lk-head"><div><div class="lk-title">Есть в Яндекс Музыке</div><div class="lk-sub">Эти треки откроются после входа в ваш аккаунт</div></div><button class="btn primary" id="lkLogin">Войти в Яндекс</button></div><div class="lk-row">${list.map(t => `<div class="lk-card" title="${esc(t.artist)} — ${esc(t.title)}"><i style="background-image:${esc(cssUrl(t.cover))}"></i><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></div>`).join('')}</div>`;
  $('#lkLogin').addEventListener('click', () => loginFlow('ya'));
  $$('.lk-card', box).forEach(c => c.addEventListener('click', () => askLogin('ya')));
}
function askLogin(src) {
  toast(src === 'ya' ? 'Этот трек есть в Яндекс Музыке. Войдите в свой аккаунт, чтобы слушать' : 'Нужен вход в сервис');
  openSettings('accounts');
}

/* ---------- моя музыка ---------- */
function libraryList() {
  const f = state.libFilter;
  const L = state.likes;
  let list = f === 'all' ? [...L.ya, ...L.zv, ...L.sc, ...L.guest, ...L.local, ...L.am]
    : f === 'offline' ? state.offline
    : (state.likes[f] || []);
  const q = state.libText.toLowerCase();
  if (q) list = list.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(q));
  return list;
}
function renderLibrary() {
  renderLibTabs();
  if (state.libFilter === 'playlists') {
    $('#libOffline').classList.add('hidden');
    renderPlaylistsGrid($('#libList'));
    $('#libCount').textContent = libTotal() ? plural(libTotal(), 'трек', 'трека', 'треков') : '';
    return;
  }
  renderLibTabs();
  const full = libraryList();
  const list = full.slice(0, state.libLimit);
  $('#libCount').textContent = libTotal() ? plural(libTotal(), 'трек', 'трека', 'треков') : '';
  const none = !libTotal();
  renderList($('#libList'), list, none
    ? 'Ставьте лайки трекам в волне и поиске, и они появятся здесь<br><button class="btn" data-open-settings>Подключить сервис</button>'
    : 'Здесь пусто');
  if (full.length > list.length) {
    const more = document.createElement('button'); more.className = 'btn ghost lib-more'; more.textContent = `Показать ещё (${full.length - list.length})`;
    more.addEventListener('click', () => { state.libLimit += 500; renderLibrary(); });
    $('#libList').appendChild(more);
  }
  const ob = $('[data-open-settings]', $('#libList')); if (ob) ob.addEventListener('click', openSettings);
  // блок «Скачанные треки» над общим списком
  const blk = $('#libOffline');
  const showBlock = state.libFilter === 'all' && !state.libText && state.offline.length > 0;
  blk.classList.toggle('hidden', !showBlock);
  if (showBlock) {
    blk.innerHTML = `<button class="off-head" id="offHead"><span class="off-title">Скачанные треки</span><svg viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6"/></svg></button>
      <div class="off-count">${plural(state.offline.length, 'трек', 'трека', 'треков')}, доступны без интернета</div><div class="list off-list"></div>`;
    renderList($('.off-list', blk), state.offline.slice(0, 3), '');
    $('#offHead').addEventListener('click', () => { state.libFilter = 'offline'; renderLibrary(); });
  }
}
function refreshRows() { $$('.row').forEach(r => {
  if (!state.offlineKeys.has(r.dataset.key)) return;
  const dl = $('.r-dl', r); if (dl) dl.outerHTML = `<span class="r-off" title="Скачан, играет без интернета">${DL_SVG}</span>`;
}); }
async function loadOffline() {
  try { state.offline = await API.downloads(); } catch { state.offline = []; }
  state.offlineKeys = new Set(state.offline.map(key));
}
const libTotal = () => Object.values(state.likes).reduce((s, l) => s + l.length, 0);
function renderLibTabs() {
  const L = state.likes, A = state.accounts;
  const tabs = [['all', 'Все'], ['ya', 'Яндекс', A.ya || L.ya.length], ['zv', 'Звук', A.zv || L.zv.length], ['sc', 'SoundCloud', A.sc || L.sc.length],
    ['am', 'Apple Music', A.am], ['guest', 'Независимые', L.guest.length], ['offline', 'Скачанные'], ['local', 'Файлы', L.local.length], ['playlists', 'Плейлисты']]
    .filter(t => t.length < 3 || t[2]);
  if (!tabs.some(t => t[0] === state.libFilter)) state.libFilter = 'all';
  const box = $('#libTabs');
  const sig = tabs.map(t => t[0]).join() + '|' + state.libFilter;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = tabs.map(([f, n]) => `<button class="tab${f === state.libFilter ? ' active' : ''}" data-f="${f}">${n}</button>`).join('');
  $$('.tab', box).forEach(b => b.addEventListener('click', () => { state.libFilter = b.dataset.f; state.libLimit = 300; renderLibrary(); }));
}
function plural(n, a, b, c) { const m = n % 10, h = n % 100; return n + ' ' + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); }

$('#libFilter').addEventListener('input', e => { state.libText = e.target.value; renderLibrary(); });
$('#libPlay').addEventListener('click', () => { const l = libraryList(); if (l.length) playQueue(l, 0); });
$('#libShuffle').addEventListener('click', () => {
  const l = libraryList().slice();
  for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  if (l.length) playQueue(l, 0);
});

async function loadLikes() {
  await loadOffline(); await loadPlaylists();
  try {
    const r = await API.likes();
    state.likes = { ya: r.ya || [], sc: r.sc || [], local: r.local || [], zv: r.zv || [], am: r.am || [], guest: r.guest || [] };
    state.liked = new Set([...state.likes.ya, ...state.likes.sc, ...state.likes.zv, ...state.likes.guest].map(key));
    if (r.zvError) toast('Звук: ' + r.zvError);
    if (r.amError) toast('Apple Music: ' + r.amError);
    if (r.yaError) toast('Яндекс: ' + r.yaError);
    if (r.scError) toast('SoundCloud: ' + r.scError);
  } catch (e) { toast(e.message); }
  renderLibrary(); refreshLikeButtons(); renderSourceDots();
}
async function reloadLocal() { await loadLikes(); }

/* ---------- настройки ---------- */
function openSettings(tab) { renderSettings(); showSetTab(typeof tab === 'string' ? tab : 'accounts'); $('#settings').classList.remove('hidden'); }
window.openSettings = openSettings;
$('#openSettings').addEventListener('click', openSettings);
$('#closeSettings').addEventListener('click', () => $('#settings').classList.add('hidden'));
$('#settings').addEventListener('click', e => { if (e.target.id === 'settings') $('#settings').classList.add('hidden'); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#ask').classList.contains('hidden')) return;
  if (!$('#ctx').classList.contains('hidden')) { closeCtx(); return; }
  if (!$('#sleepPop').classList.contains('hidden')) { closeSleepPop(); return; }
  if (!$('#wrapped').classList.contains('hidden')) { $('#wrapped').classList.add('hidden'); return; }
  if (!$('#settings').classList.contains('hidden')) { $('#settings').classList.add('hidden'); return; }
  if (Q.open) { toggleQueue(false); return; }
  closeNp();
});

function renderSettings() {
  renderProfile(); renderPrefs();
  const { ya, sc } = state.accounts;
  $('#yaStatus').textContent = ya ? `${ya.name}${ya.plus ? ', Плюс' : ''}` : 'Не подключено';
  $('#yaBtn').textContent = ya ? 'Выйти' : 'Войти';
  $('#yaBtn').className = ya ? 'btn danger' : 'btn';
  $('#yaIc').classList.toggle('on', !!ya);
  $('#yaTokenBox').classList.toggle('hidden', !!ya);
  $('#scStatus').textContent = sc ? sc.name : 'Не подключено';
  $('#scBtn').textContent = sc ? 'Выйти' : 'Войти';
  $('#scBtn').className = sc ? 'btn danger' : 'btn';
  $('#scIc').classList.toggle('on', !!sc);
  const zv = state.accounts.zv, amA = state.accounts.am;
  $('#zvStatus').textContent = zv ? (zv.name || 'Подключено') : 'Не подключено';
  $('#zvBtn').textContent = zv ? 'Выйти' : 'Войти'; $('#zvBtn').className = zv ? 'btn danger' : 'btn';
  $('#zvIc').classList.toggle('on', !!zv); $('#zvTokenBox').classList.toggle('hidden', !!zv);
  $('#amRow').classList.toggle('hidden', !state.amAvailable);
  $('#amStatus').textContent = amA ? 'Медиатека подключена, играет через «Музыку»' : 'Через приложение «Музыка» на этом Mac';
  $('#amBtn').textContent = amA ? 'Отключить' : 'Подключить'; $('#amBtn').className = amA ? 'btn danger' : 'btn';
  $('#amIc').classList.toggle('on', !!amA);
  const lfm = state.lfm;
  $('#lfmStatus').textContent = lfm ? `Подключено: ${lfm.name}` : state.keys.lastfm ? 'Скробблинг и «Сейчас играет»' : 'Сначала укажите ключи ниже';
  $('#lfmBtn').textContent = lfm ? 'Отключить' : 'Подключить'; $('#lfmBtn').className = lfm ? 'btn danger' : 'btn';
  $('#jaStatus').textContent = state.keys.jamendo ? 'Подключено: треки Creative Commons в гостевой волне и поиске' : 'Музыка Creative Commons для гостевой волны';
  const kv = state.keyValues || {};
  if (document.activeElement && !/^k/.test(document.activeElement.id || '')) {
    $('#kServer').value = kv.server || ''; $('#kLfmKey').value = kv.lastfmKey || ''; $('#kLfmSecret').value = kv.lastfmSecret || ''; $('#kDiscord').value = kv.discordId || ''; $('#kJamendo').value = kv.jamendo || '';
  }
  $('#dlPath').textContent = state.downloadDir.replace(/^\/Users\/[^/]+/, '~');
  $('#folders').innerHTML = state.folders.length
    ? state.folders.map(f => `<div class="folder"><span title="${esc(f)}">${esc(f.replace(/^\/Users\/[^/]+/, '~'))}</span><button class="btn ghost" data-rm="${esc(f)}">Убрать</button></div>`).join('')
    : '<div class="set-sub">Добавьте папку — треки из неё появятся в «Моей музыке»</div>';
  $$('[data-rm]').forEach(b => b.addEventListener('click', async () => { state.folders = await API.removeFolder(b.dataset.rm); renderSettings(); reloadLocal(); }));
}
async function loginFlow(service) {
  try {
    await API.login(service);
    await refreshState(); await loadLikes();
    toast({ ya: 'Яндекс Музыка подключена', sc: 'SoundCloud подключён', zv: 'Звук подключён', am: 'Apple Music подключена', lfm: 'Last.fm подключён' }[service] || 'Готово');
  } catch (e) { if (!/отменён/.test(e.message)) toast(e.message); }
}
async function logoutFlow(service) {
  await API.logout(service); await refreshState(); await loadLikes();
}
$('#yaBtn').addEventListener('click', () => state.accounts.ya ? logoutFlow('ya') : loginFlow('ya'));
$('#scBtn').addEventListener('click', () => state.accounts.sc ? logoutFlow('sc') : loginFlow('sc'));
$('#zvBtn').addEventListener('click', () => state.accounts.zv ? logoutFlow('zv') : loginFlow('zv'));
$('#amBtn').addEventListener('click', () => state.accounts.am ? logoutFlow('am') : loginFlow('am'));
$('#lfmBtn').addEventListener('click', () => state.lfm ? logoutFlow('lfm') : loginFlow('lfm'));
$('#zvTokenSave').addEventListener('click', async () => {
  const v = $('#zvTokenInput').value.trim(); if (!v) return;
  try { await API.setZvToken(v); $('#zvTokenInput').value = ''; await refreshState(); await loadLikes(); toast('Звук подключён'); }
  catch (e) { toast('Токен не подошёл: ' + e.message); }
});
$('#saveKeys').addEventListener('click', async () => {
  try {
    await API.setKeys({ server: $('#kServer').value, lastfmKey: $('#kLfmKey').value, lastfmSecret: $('#kLfmSecret').value, discordId: $('#kDiscord').value, jamendo: $('#kJamendo').value });
    await refreshState(); toast('Ключи сохранены');
  } catch (e) { toast(e.message); }
});
$$('[data-login]').forEach(b => b.addEventListener('click', () => loginFlow(b.dataset.login)));
$('#yaTokenSave').addEventListener('click', async () => {
  const v = $('#yaTokenInput').value.trim(); if (!v) return;
  try { await API.setYaToken(v); $('#yaTokenInput').value = ''; await refreshState(); await loadLikes(); toast('Яндекс Музыка подключена'); }
  catch (e) { toast('Токен не подошёл: ' + e.message); }
});
$('#addFolder').addEventListener('click', async () => { state.folders = await API.addFolder(); renderSettings(); reloadLocal(); });
$('#openDownloads').addEventListener('click', () => API.openDownloads());

function renderSourceDots() {
  const A = state.accounts;
  const on = [!!A.ya, !!A.zv, !!A.sc, !!A.am].filter((x, i) => x || i < 2);
  $('#sourceDots').innerHTML = on.map(x => `<i class="${x ? 'on' : ''}"></i>`).join('');
}
async function refreshState() {
  const s = await API.state();
  state.accounts = { ya: s.ya, sc: s.sc, zv: s.zv, am: s.am };
  state.guest = !!s.guest; state.amAvailable = !!s.amAvailable; state.lfm = s.lfm; state.keys = s.keys || {}; state.keyValues = s.keyValues || {};
  state.folders = s.localFolders || [];
  state.downloadDir = s.downloadDir;
  if (s.waveSettings) state.wave = { ...state.wave, ...s.waveSettings };
  if (s.prefs) state.prefs = { ...state.prefs, ...s.prefs };
  if (typeof s.volume === 'number') { setVolume(s.volume); $('#pVol').value = s.volume; $('#npVol').value = s.volume; }
  renderProfile(); renderPrefs();
  renderOnboarding();
  applyLite();
  renderWaveChips(); renderSettings(); renderSourceDots();
}

/* ---------- артист и альбом ---------- */
const nav = { stack: [], from: 'wave' };
const BACK_SVG = '<svg viewBox="0 0 24 24"><path d="m14.5 6-6 6 6 6"/></svg>';
const HEART_SVG = '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>';
const USER_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c.8-3.3 3.6-5 7-5s6.2 1.7 7 5"/></svg>';
const splitChars = s => [...s].map((c, i) => c === ' ' ? ' ' : `<span class="ch" style="animation-delay:${(i * 0.03).toFixed(2)}s">${esc(c)}</span>`).join('');
const fmtNum = n => n == null ? '' : n.toLocaleString('ru-RU');

function openArtist(source, id) { closeNp(); nav.stack.push({ type: 'artist', source, id }); renderDetail(); }
function openAlbum(source, id) { closeNp(); nav.stack.push({ type: 'album', source, id }); renderDetail(); }
function goBack() { nav.stack.pop(); if (nav.stack.length) renderDetail(); else showPage(nav.from); }

let detailSeq = 0;
async function renderDetail() {
  const item = nav.stack[nav.stack.length - 1]; if (!item) return;
  const seq = ++detailSeq;
  const page = $('#page-detail');
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-detail'));
  if (window.Wave3D) Wave3D.setVisible(false);
  page.scrollTop = 0;
  page.innerHTML = `<button class="dt-back" id="dtBack">${BACK_SVG}Назад</button><div class="dt-loading">Загружаем…</div>`;
  $('#dtBack').addEventListener('click', goBack);
  try {
    if (item.type === 'artist') {
      const a = item.data || (item.data = await API.artist(item.source, item.id));
      if (seq !== detailSeq) return;
      renderArtist(page, a, item);
    } else if (item.type === 'smart') {
      if (seq !== detailSeq) return;
      await renderSmartPage(page, item.id);
    } else if (item.type === 'playlist') {
      await loadPlaylists();
      const pl = state.playlists.find(p => p.id === item.id);
      if (seq !== detailSeq) return;
      if (!pl) { goBack(); return; }
      renderPlaylistPage(page, pl);
    } else {
      const al = item.data || (item.data = await API.album(item.source, item.id));
      if (seq !== detailSeq) return;
      renderAlbum(page, al);
    }
    requestAnimationFrame(fitAll);
  } catch (e) {
    if (seq !== detailSeq) return;
    $('.dt-loading', page).textContent = 'Не удалось загрузить: ' + e.message;
  }
}
async function tint(el, url) {
  if (!url) return;
  try { const c = await API.coverColor(url); if (c) el.style.setProperty('--tint', c.join(',')); } catch {}
}
function albumsHtml(albums) {
  return `<div class="albums">${albums.map((al, i) => `<div class="al-card" data-i="${i}" style="animation-delay:${Math.min(i, 16) * 0.03}s">
    <div class="al-cover" style="background-image:${esc(cssUrl(al.cover))}"></div>
    <div class="al-title">${esc(al.title)}</div>
    <div class="al-sub">${[al.year, al.type === 'single' ? 'Сингл' : al.type === 'compilation' ? 'Сборник' : al.type === 'playlist' ? 'Плейлист' : al.type === 'ep' ? 'EP' : 'Альбом'].filter(Boolean).join(', ')}</div>
  </div>`).join('')}</div>`;
}
function renderArtist(page, a, item) {
  const popular = a.popular.slice(0, 5);
  page.innerHTML = `
    <button class="dt-back" id="dtBack">${BACK_SVG}Назад</button>
    <header class="dt-hero">
      <div class="dt-art round" style="background-image:${esc(cssUrl(a.cover))}"></div>
      <div class="dt-info">
        <div class="dt-kind">Исполнитель в ${a.source === 'ya' ? 'Яндекс Музыке' : 'SoundCloud'}</div>
        <div class="dt-name display">${splitWords(a.name)}</div>
        <div class="dt-meta">${a.listeners ? `<span class="dt-pill">${USER_SVG}${fmtNum(a.listeners)} ${a.listenersLabel || 'слушателей в месяц'}</span>` : ''}</div>
        <div class="dt-actions">
          <button class="btn primary" id="arPlay"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>Слушать</button>
          <button class="btn" id="arWave">Волна артиста</button>
          ${a.source === 'ya' ? `<button class="ibtn${a.liked ? ' on' : ''}" id="arLike" title="Нравится">${HEART_SVG}</button>` : ''}
        </div>
      </div>
    </header>
    <section class="sec">
      <div class="sec-head"><span class="sec-title">Популярные треки</span><button class="btn ghost sec-more" id="arAll">Все треки</button></div>
      <div class="list" id="arTracks"></div>
    </section>
    ${a.albums.length ? `<section class="sec"><div class="sec-head"><span class="sec-title">Альбомы и синглы</span></div>${albumsHtml(a.albums)}</section>` : ''}`;
  $('#dtBack').addEventListener('click', goBack);
  tint($('.dt-hero', page), a.cover);
  renderList($('#arTracks'), popular, 'У артиста пока нет треков', { numbered: true });
  $('#arPlay').addEventListener('click', () => { const l = item.all || a.popular; if (l.length) playQueue(l, 0); });
  $('#arWave').addEventListener('click', () => startStation({ type: 'artist', source: a.source, id: a.id, artist: a.name, label: `по артисту ${a.name}` }));
  const like = $('#arLike');
  if (like) like.addEventListener('click', async () => {
    const on = !like.classList.contains('on'); like.classList.toggle('on', on);
    try { await API.likeArtist(a.id, on); a.liked = on; } catch (e) { like.classList.toggle('on', !on); toast(e.message); }
  });
  $('#arAll').addEventListener('click', async () => {
    const btn = $('#arAll');
    if (btn.dataset.state === 'all') { renderList($('#arTracks'), popular, '', { numbered: true }); btn.textContent = 'Все треки'; btn.dataset.state = ''; return; }
    btn.textContent = 'Загружаем…';
    try {
      const all = item.all || (item.all = await API.artistTracks(a.source, a.id));
      renderList($('#arTracks'), all, 'Треков не нашлось', { numbered: true });
      $('.sec-title', btn.parentElement).textContent = `Все треки, ${all.length}`;
      btn.textContent = 'Свернуть'; btn.dataset.state = 'all';
    } catch (e) { btn.textContent = 'Все треки'; toast(e.message); }
  });
  $$('.al-card', page).forEach(c => c.addEventListener('click', () => { const al = a.albums[+c.dataset.i]; openAlbum(al.source, al.id); }));
}
function renderAlbum(page, al) {
  const total = al.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  page.innerHTML = `
    <button class="dt-back" id="dtBack">${BACK_SVG}Назад</button>
    <header class="dt-hero">
      <div class="dt-art square" style="background-image:${esc(cssUrl(al.cover))}"></div>
      <div class="dt-info">
        <div class="dt-kind">${al.type === 'single' ? 'Сингл' : al.type === 'playlist' ? 'Плейлист' : 'Альбом'}${al.year ? ', ' + al.year : ''}</div>
        <div class="dt-name display">${splitWords(al.title)}</div>
        <div class="dt-meta"><span>${al.artists.map(x => `<span class="a-link" data-asrc="${x.source}" data-aid="${esc(x.id)}">${esc(x.name)}</span>`).join(', ')}</span><span>${plural(al.tracks.length, 'трек', 'трека', 'треков')}, ${Math.round(total / 60)} мин</span></div>
        <div class="dt-actions"><button class="btn primary" id="alPlay"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>Слушать</button></div>
      </div>
    </header>
    <section class="sec"><div class="list" id="alTracks"></div></section>`;
  $('#dtBack').addEventListener('click', goBack);
  bindArtistLinks($('.dt-meta', page));
  tint($('.dt-hero', page), al.cover);
  const actx = { type: 'album', keys: new Set(al.tracks.map(key)) };
  renderList($('#alTracks'), al.tracks, 'В альбоме нет доступных треков', { numbered: true, context: actx });
  $('#alPlay').addEventListener('click', () => al.tracks.length && playQueue(al.tracks, 0, 'list', actx));
}

/* ---------- полноэкранный плеер и текст ---------- */
const np = { open: false, lyrics: false, lyr: null, lyrKey: null, idx: -1 };
function openNp(withLyrics) {
  if (!state.current) return;
  const el = $('#np');
  el.classList.remove('hidden', 'closing');
  np.open = true;
  if (withLyrics !== undefined) setLyricsMode(withLyrics);
  $('#queue').classList.add('over-np');
  if (window.Wave3D) Wave3D.setVisible(false);
  npOnTrack(true);
  syncPlaying();
}
function closeNp() {
  if (!np.open) return;
  np.open = false;
  const el = $('#np'); el.classList.add('closing'); $('#queue').classList.remove('over-np');
  setTimeout(() => { if (!np.open) el.classList.add('hidden'); }, 330);
  $('#pLyrics').classList.remove('on');
  if (window.Wave3D) Wave3D.setVisible($('#page-wave').classList.contains('active'));
}
function setLyricsMode(on) {
  np.lyrics = on;
  $('#npBody').classList.toggle('with-lyrics', on);
  $('#pLyrics').classList.toggle('on', on && np.open);
  $('#npLyr').classList.toggle('on', on);
  if (on) loadLyrics();
}
let npLastKey = null;
function npOnTrack(force) {
  const t = state.current;
  if (!t) { closeNp(); return; }
  if (!np.open) return;
  const k = key(t);
  if (k === npLastKey && !force) return;
  const changed = k !== npLastKey; npLastKey = k;
  const cv = $('#npCover');
  cv.style.backgroundImage = cssUrl(t.cover);
  $('#npBgImg').style.backgroundImage = cssUrl(t.cover);
  if (changed) { cv.classList.remove('swap'); void cv.offsetWidth; cv.classList.add('swap'); }
  $('#npTitle').innerHTML = splitWords(t.title); $('#npTitle').title = t.title;
  requestAnimationFrame(() => fitText($('#npTitle'), Math.min(54, Math.max(34, window.innerWidth * 0.04)), 22));
  $('#npArtist').innerHTML = artistLinks(t); bindArtistLinks($('#npArtist'));
  $('#npLike').classList.toggle('on', state.liked.has(k)); $('#npLike').disabled = t.source === 'local';
  $('#npVol').value = audio.volume;
  API.coverColor(t.cover).then(c => { if (c && state.current === t) $('#np').style.setProperty('--np', c.join(',')); }).catch(() => {});
  if (np.lyrics) loadLyrics();
}
async function loadLyrics() {
  const t = state.current; if (!t) return;
  const k = key(t);
  if (np.lyrKey === k && np.lyr !== undefined) { renderLyrics(); return; }
  np.lyrKey = k; np.lyr = undefined; np.idx = -1;
  $('#lyScroll').innerHTML = '<div class="ly-empty">Ищем текст…</div>';
  let res = null;
  try { res = await API.lyrics({ source: t.source, rawId: t.rawId, title: t.title, artist: t.artist, duration: t.duration }); } catch {}
  if (np.lyrKey !== k) return;
  np.lyr = res; renderLyrics();
}
function renderLyrics() {
  const box = $('#lyScroll'), L = np.lyr;
  np.idx = -1;
  if (!L) { box.innerHTML = '<div class="ly-empty">Для этого трека текста нет</div>'; return; }
  const credit = `<div class="ly-src">Текст: ${esc(L.source)}${L.writers ? '. Авторы: ' + esc(L.writers) : ''}</div>`;
  if (!L.synced) { box.innerHTML = `<div class="ly-plain">${esc(L.text)}</div>${credit}`; box.scrollTop = 0; return; }
  box.innerHTML = L.lines.map((l, i) => `<div class="ly-line${l.text ? '' : ' gap'}" data-i="${i}">${l.text ? esc(l.text) : '• • •'}</div>`).join('') + credit;
  $$('.ly-line', box).forEach(el => el.addEventListener('click', () => { seekTo(L.lines[+el.dataset.i].t); if (!isPlaying()) togglePlay(); }));
  box.scrollTop = 0;
}
function syncLyrics() {
  if (np.open && np.lyrics && np.lyr && np.lyr.synced) {
    const lines = np.lyr.lines, t = curTime() + 0.15;
    let lo = 0, hi = lines.length - 1, idx = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].t <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
    if (idx !== np.idx) {
      np.idx = idx;
      const box = $('#lyScroll');
      $$('.ly-line', box).forEach((el, i) => { el.classList.toggle('on', i === idx); el.classList.toggle('past', i < idx); });
      const cur = idx >= 0 ? $(`.ly-line[data-i="${idx}"]`, box) : null;
      if (cur) box.scrollTo({ top: cur.offsetTop - box.clientHeight * 0.38, behavior: 'smooth' });
    }
  }
  requestAnimationFrame(syncLyrics);
}
requestAnimationFrame(syncLyrics);

// объёмный наклон обложки за мышью
$('#np').addEventListener('mousemove', e => {
  const cv = $('#npCover'), r = cv.getBoundingClientRect();
  const x = (e.clientX - (r.left + r.width / 2)) / window.innerWidth, y = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
  cv.style.transform = `rotateY(${(x * 22).toFixed(2)}deg) rotateX(${(-y * 18).toFixed(2)}deg) translateZ(20px)`;
});
$('#np').addEventListener('mouseleave', () => { $('#npCover').style.transform = ''; });
$('#npClose').addEventListener('click', closeNp);
$('#npPlay').addEventListener('click', togglePlay);
$('#npPrev').addEventListener('click', prev);
$('#npNext').addEventListener('click', () => next(true));
$('#npLike').addEventListener('click', () => state.current && toggleLike(state.current));
$('#npLyr').addEventListener('click', () => setLyricsMode(!np.lyrics));
$('#npVol').addEventListener('input', e => { audio.volume = +e.target.value; $('#pVol').value = e.target.value; });
$('#npVol').addEventListener('change', e => API.setVolume(+e.target.value));
$('#pVol').addEventListener('input', e => { $('#npVol').value = e.target.value; });
$('#npBar').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect(), d = curDur();
  if (d) seekTo((e.clientX - r.left) / r.width * d);
});
$('#pCover').addEventListener('click', () => np.open ? closeNp() : openNp(false));
$('#pTitle').addEventListener('click', () => np.open ? closeNp() : openNp(false));
$('#pExpand').addEventListener('click', () => np.open ? closeNp() : openNp(false));
$('#pLyrics').addEventListener('click', () => {
  if (np.open && np.lyrics) { setLyricsMode(false); return; }
  if (!np.open) openNp(true); else setLyricsMode(true);
});

/* ---------- подгонка длинных заголовков ---------- */
function splitWords(text, step = 0.03) {
  let i = 0;
  return String(text).split(/\s+/).filter(Boolean).map(w => `<span class="w">${[...w].map(c => `<span class="ch" style="animation-delay:${(i++ * step).toFixed(3)}s">${esc(c)}</span>`).join('')}</span>`).join(' ');
}
function fitText(el, max, min) {
  if (!el || !el.isConnected) return;
  el.classList.remove('two');
  el.style.fontSize = max + 'px';
  let size = max;
  while (size > min && el.scrollWidth > el.clientWidth + 1) { size -= 4; el.style.fontSize = size + 'px'; }
  if (el.scrollWidth <= el.clientWidth + 1) return;
  // не влезло в одну строку даже мелко: две строки крупнее
  el.classList.add('two');
  size = max;
  el.style.fontSize = size + 'px';
  const fits = () => el.scrollHeight <= size * 0.9 * 2 + 6 && el.scrollWidth <= el.clientWidth + 1;
  while (size > min && !fits()) { size -= 4; el.style.fontSize = size + 'px'; }
}
function fitAll() {
  fitText($('#waveTitle'), Math.min(76, Math.max(44, window.innerWidth * 0.055)), 26);
  if (np.open) fitText($('#npTitle'), Math.min(54, Math.max(34, window.innerWidth * 0.04)), 22);
  const dn = $('.dt-name'); if (dn) fitText(dn, Math.min(84, Math.max(48, window.innerWidth * 0.06)), 28);
}
window.addEventListener('resize', () => { clearTimeout(fitAll._t); fitAll._t = setTimeout(fitAll, 60); });

/* ---------- волна по времени суток ---------- */
function effectiveWave() {
  const w = { ...state.wave };
  if (state.prefs.timeOfDay && w.moodEnergy === 'all') {
    const h = new Date().getHours();
    if (h >= 6 && h < 11) w.moodEnergy = 'active';
    else if (h >= 22 || h < 6) w.moodEnergy = 'calm';
  }
  return w;
}
let lastEffMood = null;
setInterval(() => {
  const m = effectiveWave().moodEnergy;
  if (lastEffMood !== null && m !== lastEffMood && state.mode === 'wave') applyWaveSettings();
  lastEffMood = m;
}, 5 * 60 * 1000);

/* ---------- очередь ---------- */
const Q = { open: false, dragFrom: null };
function toggleQueue(force) {
  Q.open = force !== undefined ? force : !Q.open;
  $('#queue').classList.toggle('hidden', !Q.open);
  $('#queue').classList.toggle('over-np', np.open);
  $('#pQueue').classList.toggle('on', Q.open); $('#npQueue').classList.toggle('on', Q.open);
  if (Q.open) renderQueue();
}
function renderQueue() {
  if (!Q.open) return;
  const body = $('#qBody');
  const cur = state.current;
  const upcoming = state.queue.slice(state.qi + 1, state.qi + 201);
  const qrow = (t, idx, isCur) => `<div class="q-row${isCur ? ' cur' : ''}" ${isCur ? '' : `draggable="true" data-qi="${idx}"`}>
      ${isCur ? '' : '<span class="q-grip"><svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/></svg></span>'}
      <div class="r-cover" style="background-image:${esc(cssUrl(t.cover))}"></div>
      <div class="r-main"><div class="r-title">${esc(t.title)}</div><div class="r-artist">${esc(t.artist)}</div></div>
      ${isCur ? '<span class="q-now">Сейчас</span>' : `<button class="ibtn q-rm" title="Убрать из очереди"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button>`}
    </div>`;
  body.innerHTML = (cur ? `<div class="q-sec">Сейчас играет</div>${qrow(cur, state.qi, true)}` : '')
    + `<div class="q-sec">${state.mode === 'wave' ? 'Дальше в волне' : 'Дальше'}${upcoming.length ? `, ${upcoming.length}` : ''}</div>`
    + (upcoming.length ? upcoming.map((t, i) => qrow(t, state.qi + 1 + i, false)).join('') : '<div class="q-empty">Очередь пуста. Нажмите правой кнопкой на любой трек, чтобы добавить</div>');
  $$('.q-row[data-qi]', body).forEach(row => {
    const idx = +row.dataset.qi;
    row.addEventListener('dblclick', () => { state.qi = idx; playTrack(state.queue[idx]); renderQueue(); });
    $('.r-cover', row).addEventListener('click', () => { state.qi = idx; playTrack(state.queue[idx]); renderQueue(); });
    $('.q-rm', row).addEventListener('click', () => { state.queue.splice(idx, 1); renderQueue(); });
    row.addEventListener('dragstart', e => { Q.dragFrom = idx; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); $$('.q-row').forEach(r => r.classList.remove('drop-above', 'drop-below')); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      const r = row.getBoundingClientRect(), below = e.clientY > r.top + r.height / 2;
      $$('.q-row').forEach(x => x.classList.remove('drop-above', 'drop-below'));
      row.classList.add(below ? 'drop-below' : 'drop-above');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      const from = Q.dragFrom; if (from == null) return;
      const r = row.getBoundingClientRect(); let to = idx + (e.clientY > r.top + r.height / 2 ? 1 : 0);
      const [t] = state.queue.splice(from, 1); if (from < to) to--;
      state.queue.splice(Math.max(state.qi + 1, to), 0, t);
      Q.dragFrom = null; renderQueue();
    });
  });
}
function queueNext(t) {
  if (!state.current) { playQueue([t], 0); return; }
  state.queue.splice(state.qi + 1, 0, t); renderQueue(); toast(`«${t.title}» заиграет следующим`);
}
function queueEnd(t) {
  if (!state.current) { playQueue([t], 0); return; }
  if (state.mode === 'wave') { queueNext(t); return; }
  state.queue.push(t); renderQueue(); toast(`«${t.title}» добавлен в конец очереди`);
}
$('#pQueue').addEventListener('click', () => toggleQueue());
$('#npQueue').addEventListener('click', () => toggleQueue());
$('#qClose').addEventListener('click', () => toggleQueue(false));
$('#qClear').addEventListener('click', () => {
  state.queue = state.queue.slice(0, state.qi + 1);
  if (state.mode === 'wave') loadMoreWave().then(renderQueue);
  renderQueue();
});

/* ---------- контекстное меню ---------- */
function openCtx(e, t, extra = {}) {
  e.preventDefault();
  const items = [
    ['Играть следующим', () => queueNext(t)],
    ['В конец очереди', () => queueEnd(t)],
    null,
    ...(t.artists && t.artists.length && t.source !== 'local' ? [['Перейти к артисту', () => openArtist(t.artists[0].source, t.artists[0].id)]] : []),
    ...(t.albumId && t.source === 'ya' ? [['Перейти к альбому', () => openAlbum('ya', t.albumId)]] : []),
    ['Волна по треку', () => startStation(stationFromTrack(t))],
    ...(t.artist ? [['Волна по артисту', () => startStation(stationFromArtist(t.artists && t.artists[0], (t.artist || '').split(',')[0].trim()))]] : []),
    ['Добавить в плейлист…', () => pickPlaylist(t)],
    ...(t.source !== 'local' ? [['Отправить другу…', () => setTimeout(() => pickFriend(t, e.clientX, e.clientY))]] : []),
    ...(extra.playlistId ? [['Убрать из плейлиста', () => removeFromPlaylist(extra.playlistId, t)]] : []),
    null,
    ...(t.source !== 'local' ? [[state.liked.has(key(t)) ? 'Убрать из «Моей музыки»' : 'Нравится', () => toggleLike(t)]] : []),
    ...(t.source === 'sc' && t.downloadable && !state.offlineKeys.has(key(t)) ? [['Скачать', () => download(t, { disabled: false })]] : []),
    ...(state.offlineKeys.has(key(t)) ? [['Удалить загрузку', async () => { await API.removeDownload(key(t)); await loadOffline(); renderLibrary(); toast('Файл перемещён в корзину'); }]] : []),
  ].filter((x, i, arr) => x || (i > 0 && arr[i - 1]));
  const m = $('#ctx');
  m.innerHTML = items.map((it, i) => it ? `<button data-i="${i}">${esc(it[0])}</button>` : '<hr>').join('');
  $$('button', m).forEach(b => b.addEventListener('click', () => { closeCtx(); items[+b.dataset.i][1](); }));
  m.classList.remove('hidden');
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(e.clientX, window.innerWidth - w - 8) + 'px';
  m.style.top = Math.min(e.clientY, window.innerHeight - h - 8) + 'px';
}
function closeCtx() { $('#ctx').classList.add('hidden'); }
document.addEventListener('click', e => { if (!e.target.closest('#ctx')) closeCtx(); if (!e.target.closest('#sleepPop') && !e.target.closest('#pSleep') && !e.target.closest('#npSleep')) closeSleepPop(); });
window.addEventListener('blur', closeCtx);
document.addEventListener('scroll', closeCtx, true);

/* ---------- диалог ввода ---------- */
function ask(title, value = '', placeholder = '') {
  return new Promise(resolve => {
    $('#askTitle').textContent = title;
    const inp = $('#askInput'); inp.value = value; inp.placeholder = placeholder;
    $('#ask').classList.remove('hidden'); setTimeout(() => inp.focus(), 30);
    const done = v => { $('#ask').classList.add('hidden'); cleanup(); resolve(v); };
    const ok = () => done(inp.value.trim() || null), cancel = () => done(null);
    const key = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { e.stopPropagation(); cancel(); } };
    $('#askOk').addEventListener('click', ok); $('#askCancel').addEventListener('click', cancel); inp.addEventListener('keydown', key);
    function cleanup() { $('#askOk').removeEventListener('click', ok); $('#askCancel').removeEventListener('click', cancel); inp.removeEventListener('keydown', key); }
  });
}

/* ---------- плейлисты ---------- */
state.playlists = [];
async function loadPlaylists() { try { state.playlists = await API.playlists(); } catch { state.playlists = []; } }
const mosaic = pl => {
  if (pl.cover) return `<div class="al-cover" style="background-image:${esc(cssUrl(pl.cover))}"></div>`;
  const covers = [...new Set((pl.tracks || []).map(t => t.cover).filter(Boolean))].slice(0, 4);
  if (!covers.length) return '<div class="al-cover pl-empty"><svg viewBox="0 0 24 24"><path d="M4 6h11M4 10.5h11M4 15h6"/><path d="M15.5 19.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm2-2V9.5l3-1"/></svg></div>';
  return `<div class="al-cover mosaic">${[0, 1, 2, 3].map(i => `<i style="background-image:${esc(cssUrl(covers[i % covers.length]))}"></i>`).join('')}</div>`;
};
function renderPlaylistsGrid(container) {
  container.innerHTML = `<div class="smart-row">${SMART.map(([k, n, d]) => `<div class="smart-card smart-${k}" data-smart="${k}"><b>${n}</b><small>${d}</small></div>`).join('')}</div>` + `<div class="pl-actions"><button class="btn primary" id="plNew"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2"/></svg>Новый плейлист</button><button class="btn" id="plImport">Импорт по ссылке</button></div>`
    + (state.playlists.length ? `<div class="albums">${state.playlists.map((pl, i) => `<div class="al-card" data-i="${i}" style="animation-delay:${Math.min(i, 16) * 0.03}s">${mosaic(pl)}<div class="al-title">${esc(pl.name)}</div><div class="al-sub">${plural((pl.tracks || []).length, 'трек', 'трека', 'треков')}${pl.link ? ', импорт' : ''}</div></div>`).join('')}</div>`
      : '<div class="empty">Соберите свой плейлист из треков Яндекса, SoundCloud и файлов или вставьте ссылку на готовый</div>');
  $('#plNew').addEventListener('click', async () => {
    const name = await ask('Название плейлиста', '', 'Например, «Ночная дорога»'); if (!name) return;
    await API.playlistSave({ name, tracks: [] }); await loadPlaylists(); renderLibrary();
  });
  $('#plImport').addEventListener('click', async () => {
    const link = await ask('Ссылка на плейлист или альбом', '', 'music.yandex.ru/… или soundcloud.com/…'); if (!link) return;
    toast('Импортируем…');
    try { const pl = await API.importPlaylist(link); await loadPlaylists(); renderLibrary(); toast(`Готово: «${pl.name}», ${plural(pl.tracks.length, 'трек', 'трека', 'треков')}`); }
    catch (e) { toast('Не получилось: ' + e.message); }
  });
  $$('.al-card', container).forEach(c => c.addEventListener('click', () => openPlaylist(state.playlists[+c.dataset.i].id)));
  $$('[data-smart]', container).forEach(c => c.addEventListener('click', () => openSmart(c.dataset.smart)));
}
function openPlaylist(id) { closeNp(); nav.stack.push({ type: 'playlist', id }); renderDetail(); }
async function pickPlaylist(t) {
  await loadPlaylists();
  const m = $('#ctx');
  const items = [['Новый плейлист…', async () => { const name = await ask('Название плейлиста'); if (!name) return; await API.playlistSave({ name, tracks: [t] }); await loadPlaylists(); renderLibrary(); toast(`Создан «${name}»`); }],
    ...state.playlists.map(pl => [pl.name, async () => {
      if ((pl.tracks || []).some(x => key(x) === key(t))) { toast('Этот трек уже в плейлисте'); return; }
      await API.playlistSave({ ...pl, tracks: [...(pl.tracks || []), t] }); await loadPlaylists(); renderLibrary(); toast(`Добавлено в «${pl.name}»`);
    }])];
  m.innerHTML = '<div class="ctx-title">В плейлист</div>' + items.map((it, i) => `<button data-i="${i}">${esc(it[0])}</button>`).join('');
  $$('button', m).forEach(b => b.addEventListener('click', () => { closeCtx(); items[+b.dataset.i][1](); }));
  m.classList.remove('hidden');
}
async function removeFromPlaylist(id, t) {
  const pl = state.playlists.find(p => p.id === id); if (!pl) return;
  await API.playlistSave({ ...pl, tracks: pl.tracks.filter(x => key(x) !== key(t)) });
  await loadPlaylists();
  const top = nav.stack[nav.stack.length - 1]; if (top && top.type === 'playlist') renderDetail();
}
function renderPlaylistPage(page, pl) {
  const total = (pl.tracks || []).reduce((s, t) => s + (t.duration || 0), 0);
  page.innerHTML = `
    <button class="dt-back" id="dtBack">${BACK_SVG}Назад</button>
    <header class="dt-hero">
      <div class="dt-art square pl-art">${mosaic(pl)}</div>
      <div class="dt-info">
        <div class="dt-kind">${pl.link ? 'Импортированный плейлист' : 'Ваш плейлист'}</div>
        <div class="dt-name display">${splitWords(pl.name)}</div>
        <div class="dt-meta"><span>${plural(pl.tracks.length, 'трек', 'трека', 'треков')}, ${Math.round(total / 60)} мин</span></div>
        <div class="dt-actions">
          <button class="btn primary" id="plPlay"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>Слушать</button>
          <button class="btn" id="plRename">Переименовать</button>
          <button class="btn danger" id="plDelete">Удалить</button>
        </div>
      </div>
    </header>
    <section class="sec"><div class="list" id="plTracks"></div></section>`;
  $('#dtBack').addEventListener('click', goBack);
  const cov = pl.cover || (pl.tracks[0] && pl.tracks[0].cover); tint($('.dt-hero', page), cov);
  const ctxKeys = { type: 'playlist', keys: new Set(pl.tracks.map(key)) };
  renderList($('#plTracks'), pl.tracks, 'Плейлист пуст. Добавляйте треки через правый клик → «Добавить в плейлист»', { numbered: true, playlistId: pl.id, context: ctxKeys });
  $('#plPlay').addEventListener('click', () => pl.tracks.length && playQueue(pl.tracks, 0, 'list', ctxKeys));
  $('#plRename').addEventListener('click', async () => { const n = await ask('Новое название', pl.name); if (!n) return; await API.playlistSave({ ...pl, name: n }); await loadPlaylists(); renderDetail(); });
  $('#plDelete').addEventListener('click', async () => {
    const ok = await ask(`Удалить «${pl.name}»? Напишите «да», чтобы подтвердить`); if (!ok || !/^да$/i.test(ok)) return;
    await API.playlistDelete(pl.id); await loadPlaylists(); renderLibrary(); goBack();
  });
  requestAnimationFrame(fitAll);
}

/* ---------- таймер сна: всплывающее окно с циферблатом ---------- */
let dialVal = 30;
function renderSleepBadge() {
  const b = $('#sleepBadge'), on = !!sleep.mode;
  $('#pSleep').classList.toggle('on', on); $('#npSleep').classList.toggle('on', on);
  b.textContent = sleep.mode === 'minutes' ? Math.ceil((sleep.endsAt - Date.now()) / 60000) + '′' : sleep.mode ? '•' : (state.prefs.alarm && state.prefs.alarm.on ? '⏰' : '');
  if ($('#sleepPop') && !$('#sleepPop').classList.contains('hidden') && sleep.mode === 'minutes') {
    const v = $('#dialVal'); if (v) v.textContent = fmtMin(Math.max(0, (sleep.endsAt - Date.now()) / 60000));
  }
}
function openSleepPop(anchor) {
  const pop = $('#sleepPop');
  renderSleepPop();
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - pop.offsetWidth - 12, Math.max(12, r.left + r.width / 2 - pop.offsetWidth / 2)) + 'px';
  pop.style.top = Math.max(12, r.top - pop.offsetHeight - 12) + 'px';
}
function closeSleepPop() { $('#sleepPop').classList.add('hidden'); }
function renderSleepPop() {
  const pop = $('#sleepPop');
  const R = 92, C = 2 * Math.PI * R, active = sleep.mode === 'minutes';
  const val = active ? Math.max(0, (sleep.endsAt - Date.now()) / 60000) : dialVal;
  const frac = Math.min(1, val / 60);
  const ang = frac * 2 * Math.PI - Math.PI / 2;
  const kx = 110 + R * Math.cos(ang), ky = 110 + R * Math.sin(ang);
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = i / 60 * 2 * Math.PI - Math.PI / 2, r1 = i % 5 ? 104 : 101; return `<line x1="${110 + r1 * Math.cos(a)}" y1="${110 + r1 * Math.sin(a)}" x2="${110 + 107 * Math.cos(a)}" y2="${110 + 107 * Math.sin(a)}" class="${i % 5 ? 't' : 't5'}"/>`; }).join('');
  const labels = [0, 15, 30, 45].map(m => { const a = m / 60 * 2 * Math.PI - Math.PI / 2; return `<text x="${110 + 74 * Math.cos(a)}" y="${110 + 74 * Math.sin(a) + 4}">${m || 60}</text>`; }).join('');
  if (spTab === 'alarm') {
    pop.innerHTML = `<div class="sp-tabs"><button class="tab" data-sp="sleep">Таймер сна</button><button class="tab active" data-sp="alarm">Будильник</button></div><div id="alBox"></div>`;
    $$('[data-sp]', pop).forEach(b => b.addEventListener('click', () => { spTab = b.dataset.sp; renderSleepPop(); }));
    renderAlarmPane($('#alBox', pop));
    return;
  }
  pop.innerHTML = `
    <div class="sp-tabs"><button class="tab active" data-sp="sleep">Таймер сна</button><button class="tab" data-sp="alarm">Будильник</button></div>
    <div class="sp-modes">
      <button class="chip${sleep.mode === 'track' ? ' active' : ''}" data-m="track">Конец трека</button>
      <button class="chip${sleep.mode === 'release' ? ' active' : ''}" data-m="release">Конец выпуска</button>
    </div>
    <div class="dial${active ? ' running' : ''}">
      <svg viewBox="0 0 220 220" id="dialSvg">
        ${ticks}${labels}
        <circle cx="110" cy="110" r="${R}" class="d-track"/>
        <circle cx="110" cy="110" r="${R}" class="d-arc" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" transform="rotate(-90 110 110)"/>
        <circle cx="${kx}" cy="${ky}" r="11" class="d-knob"/>
      </svg>
      <div class="dial-center">
        <div class="dial-val" id="dialVal">${fmtMin(val)}</div>
        <div class="dial-sub">${active ? 'осталось' : 'минут'}</div>
      </div>
    </div>
    <div class="sp-actions">${sleep.mode ? '<button class="btn" id="spOff">Выключить таймер</button>' : ''}${active ? '' : '<button class="btn primary" id="spStart">Запустить</button>'}</div>
    <div class="sp-hint">${sleep.mode === 'release' ? 'Остановим после последнего трека альбома, плейлиста или выпуска подкаста' : 'Потяните по кругу или нажмите в нужное место. Шаг 30 секунд'}</div>`;
  $$('[data-sp]', pop).forEach(b => b.addEventListener('click', () => { spTab = b.dataset.sp; renderSleepPop(); }));
  $$('.sp-modes .chip', pop).forEach(b => b.addEventListener('click', () => { sleepSet(b.dataset.m); renderSleepPop(); }));
  const off = $('#spOff', pop); if (off) off.addEventListener('click', () => { sleepClear(); renderSleepPop(); toast('Таймер выключен'); });
  const st = $('#spStart', pop); if (st) st.addEventListener('click', () => { sleepSet('minutes', dialVal); renderSleepPop(); });
  const svg = $('#dialSvg', pop);
  if (!active) {
    let dragging = false, prevVal = dialVal;
    const setFrom = e => {
      const r = svg.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      let a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += 2 * Math.PI;
      let v = Math.round((a / (2 * Math.PI)) * 60 * 2) / 2;
      if (dragging) { if (prevVal > 50 && v < 10) v = 60; else if (prevVal < 10 && v > 50) v = 1; }
      v = Math.min(60, Math.max(1, v || 60 * (prevVal > 30 ? 1 : 0) || 1));
      prevVal = v; dialVal = v;
      const f = v / 60, an = f * 2 * Math.PI - Math.PI / 2;
      $('.d-arc', svg).setAttribute('stroke-dashoffset', C * (1 - f));
      $('.d-knob', svg).setAttribute('cx', 110 + R * Math.cos(an)); $('.d-knob', svg).setAttribute('cy', 110 + R * Math.sin(an));
      $('#dialVal').textContent = fmtMin(v);
    };
    svg.addEventListener('pointerdown', e => { dragging = false; prevVal = dialVal; setFrom(e); dragging = true; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => { if (dragging) setFrom(e); });
    svg.addEventListener('pointerup', () => { dragging = false; });
  }
}
$('#pSleep').addEventListener('click', e => { e.stopPropagation(); $('#sleepPop').classList.contains('hidden') ? openSleepPop($('#pSleep')) : closeSleepPop(); });
$('#npSleep').addEventListener('click', e => { e.stopPropagation(); $('#sleepPop').classList.contains('hidden') ? openSleepPop($('#npSleep')) : closeSleepPop(); });

/* ---------- профиль и настройки по вкладкам ---------- */
function showSetTab(t) {
  $$('#setTabs .tab').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  $$('.set-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t));
  if (t === 'wrapped') renderWrMonths();
}
$$('#setTabs .tab').forEach(b => b.addEventListener('click', () => showSetTab(b.dataset.t)));
function renderProfile() {
  const { ya, sc } = state.accounts;
  const name = (ya && ya.name) || (state.accounts.zv && state.accounts.zv.name) || (sc && sc.name) || '';
  const letter = name ? name.trim()[0].toUpperCase() : '?';
  $('#avatar').textContent = letter; $('#avatarBig').textContent = letter;
  $('#profileName').textContent = name || 'Профиль';
  $('#setTitle').textContent = name || 'Профиль';
  const A = state.accounts;
  const names = [ya ? (ya.plus ? 'Яндекс Плюс' : 'Яндекс') : null, A.zv ? 'Звук' : null, sc ? 'SoundCloud' : null, A.am ? 'Apple Music' : null].filter(Boolean);
  $('#setSub').textContent = names.length ? names.join(', ') : 'Гостевой режим: независимая музыка без входа';
  $('#avatar').classList.toggle('on', !!name); $('#avatarBig').classList.toggle('on', !!name);
}
function renderPrefs() {
  const p = state.prefs;
  $$('[data-pref]').forEach(i => { i.checked = !!p[i.dataset.pref]; });
  $('#mixPref').checked = !!state.wave.mix;
  $('#xfRange').value = p.crossfade;
  $('#xfLabel').textContent = p.crossfade ? `${p.crossfade} с: конец трека плавно перетекает в следующий` : 'Выключен';
  $('#eqBox').classList.toggle('off', !p.eqOn);
  $('#eqPresets').innerHTML = Object.entries(EQ_PRESETS).map(([k, [n]]) => `<button class="chip${p.eqPreset === k ? ' active' : ''}" data-preset="${k}">${n}</button>`).join('');
  $('#eqBands').innerHTML = EQ_FREQS.map((f, i) => `<div class="eq-band"><span class="eq-db">${p.eqBands[i] > 0 ? '+' : ''}${p.eqBands[i]}</span><input type="range" min="-12" max="12" step="1" value="${p.eqBands[i]}" data-band="${i}" orient="vertical"><span class="eq-f">${f >= 1000 ? (f / 1000) + 'k' : f}</span></div>`).join('');
  $$('[data-preset]').forEach(b => b.addEventListener('click', () => { savePrefs({ eqPreset: b.dataset.preset, eqBands: [...EQ_PRESETS[b.dataset.preset][1]], eqOn: true }); }));
  $$('[data-band]').forEach(r => {
    r.addEventListener('input', () => { const bands = [...state.prefs.eqBands]; bands[+r.dataset.band] = +r.value; state.prefs.eqBands = bands; state.prefs.eqPreset = 'custom'; applyEq(); r.parentElement.querySelector('.eq-db').textContent = (+r.value > 0 ? '+' : '') + r.value; $$('[data-preset]').forEach(b => b.classList.remove('active')); });
    r.addEventListener('change', () => savePrefs({ eqBands: state.prefs.eqBands, eqPreset: 'custom', eqOn: true }));
  });
}
async function savePrefs(p) {
  state.prefs = { ...state.prefs, ...p };
  applyEq(); renderPrefs();
  if (state.current && 'normalize' in p) { const g = fx.gains.get(audio); if (g) g.gain.setTargetAtTime(normGain(state.current), fx.ctx.currentTime, 0.2); }
  try { await API.setPrefs(p); } catch (e) { toast(e.message); }
  if ('timeOfDay' in p) applyWaveSettings();
  if ('lite' in p) applyLite();
  if ('discord' in p) pushPresence();
}
$$('[data-pref]').forEach(i => i.addEventListener('change', () => savePrefs({ [i.dataset.pref]: i.checked })));
$('#mixPref').addEventListener('change', e => { state.wave.mix = e.target.checked; renderWaveChips(); applyWaveSettings(); });
$('#xfRange').addEventListener('input', e => { $('#xfLabel').textContent = +e.target.value ? `${e.target.value} с: конец трека плавно перетекает в следующий` : 'Выключен'; });
$('#xfRange').addEventListener('change', e => savePrefs({ crossfade: +e.target.value }));

/* ---------- итоги месяца ---------- */
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ym = d => `${d.getFullYear()}-${d.getMonth() + 1}`;
async function renderWrMonths() {
  const now = new Date(), list = [];
  for (let i = 0; i < 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); list.push(d); }
  const box = $('#wrMonths');
  box.innerHTML = list.map(d => `<button class="wr-m" data-ym="${ym(d)}"><span>${MONTHS[d.getMonth()][0].toUpperCase() + MONTHS[d.getMonth()].slice(1)} ${d.getFullYear()}</span><small>…</small></button>`).join('');
  for (const b of $$('.wr-m', box)) {
    const w = await API.wrapped(b.dataset.ym).catch(() => null);
    $('small', b).textContent = w && w.plays ? `${plural(w.minutes, 'минута', 'минуты', 'минут')}, ${plural(w.uniqueTracks, 'трек', 'трека', 'треков')}` : 'пока пусто';
    b.disabled = !(w && w.plays);
    b.addEventListener('click', () => { $('#settings').classList.add('hidden'); openWrapped(b.dataset.ym); });
  }
}
async function updateWrappedPill() {
  const now = new Date();
  const w = await API.wrapped(ym(now)).catch(() => null);
  const pill = $('#wrappedPill');
  const show = w && w.plays >= 10;
  pill.classList.toggle('hidden', !show);
  if (show) pill.innerHTML = `<span class="wp-dot"></span>Итоги ${MONTHS_GEN[now.getMonth()]}`;
}
$('#wrappedPill').addEventListener('click', () => openWrapped(ym(new Date())));
async function openWrapped(ymStr) {
  const w = await API.wrapped(ymStr);
  const card = $('#wrCard');
  const top = w.topTracks[0];
  card.innerHTML = `
    <div class="wr-bg" style="background-image:${esc(cssUrl(top && top.cover))}"></div>
    <div class="wr-inner" id="wrInner">
      <div class="wr-brand"><span class="deco">СПЛАВ</span><span>${MONTHS[w.month - 1]} ${w.year}</span></div>
      <div class="wr-big display">${splitWords(String(w.minutes))}</div>
      <div class="wr-big-sub">минут музыки</div>
      <div class="wr-stats"><div><b>${w.uniqueTracks}</b><span>треков</span></div><div><b>${w.uniqueArtists}</b><span>артистов</span></div><div><b>${w.plays}</b><span>прослушиваний</span></div></div>
      <div class="wr-cols">
        <div><div class="wr-h">Топ треков</div>${w.topTracks.map((t, i) => `<div class="wr-item"><span class="wr-n">${i + 1}</span><i style="background-image:${esc(cssUrl(t.cover))}"></i><span class="wr-t"><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></span></div>`).join('')}</div>
        <div><div class="wr-h">Топ артистов</div>${w.topArtists.map((a, i) => `<div class="wr-item"><span class="wr-n">${i + 1}</span><i class="round" style="background-image:${esc(cssUrl(a.cover))}"></i><span class="wr-t"><b>${esc(a.name)}</b><small>${plural(Math.round(a.seconds / 60), 'минута', 'минуты', 'минут')}</small></span></div>`).join('')}</div>
      </div>
    </div>
    <div class="wr-actions"><button class="btn ghost" id="wrClose">Закрыть</button><button class="btn primary" id="wrSave">Сохранить картинкой</button></div>`;
  $('#wrapped').classList.remove('hidden');
  $('#wrClose').addEventListener('click', () => $('#wrapped').classList.add('hidden'));
  $('#wrSave').addEventListener('click', async () => {
    const r = card.getBoundingClientRect(), z = window.devicePixelRatio ? 1 : 1;
    $('.wr-actions', card).style.visibility = 'hidden';
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    try {
      const file = await API.saveImage({ x: Math.round(r.left * z), y: Math.round(r.top * z), width: Math.round(r.width * z), height: Math.round(r.height * z) }, `Сплав — итоги, ${MONTHS[w.month - 1]} ${w.year}`);
      if (file) toast('Картинка сохранена');
    } catch (e) { toast(e.message); }
    $('.wr-actions', card).style.visibility = '';
  });
}
$('#wrapped').addEventListener('click', e => { if (e.target.id === 'wrapped') $('#wrapped').classList.add('hidden'); });

/* ---------- мини-плеер в строке меню ---------- */
let trayLyric = '', npColor = null;
function pushTray() {
  const t = state.current;
  API.npUpdate(t ? { title: t.title, artist: t.artist, cover: t.cover, playing: isPlaying(), liked: state.liked.has(key(t)), canLike: t.source !== 'local', lyric: trayLyric, color: npColor } : null);
}
const trayLy = { key: null, data: null };
async function prefetchTrayLyrics(t) {
  trayLyric = ''; trayLy.key = key(t); trayLy.data = null;
  if (!state.prefs.tray) return;
  try { const d = await API.lyrics({ source: t.source, rawId: t.rawId, title: t.title, artist: t.artist, duration: t.duration }); if (trayLy.key === key(t)) trayLy.data = d; } catch {}
}
setInterval(() => {
  if (!state.current || !trayLy.data || !trayLy.data.synced) return;
  const lines = trayLy.data.lines, tt = curTime() + 0.15;
  let idx = -1; for (let i = 0; i < lines.length && lines[i].t <= tt; i++) idx = i;
  const text = idx >= 0 ? lines[idx].text : '';
  if (text !== trayLyric) { trayLyric = text; pushTray(); }
}, 250);
API.onCmd(c => {
  if (c === 'toggle') togglePlay();
  if (c === 'next') next(true);
  if (c === 'prev') prev();
  if (c === 'like' && state.current) toggleLike(state.current);
});

/* ---------- гостевой онбординг ---------- */
const GENRE_LIST = [['rap', 'Рэп'], ['phonk', 'Фонк'], ['pop', 'Поп'], ['indie', 'Инди'], ['rock', 'Рок'], ['electronic', 'Электроника'], ['techno', 'Техно'], ['house', 'Хаус'], ['lofi', 'Лоу-фай'], ['ambient', 'Эмбиент'], ['jazz', 'Джаз'], ['classical', 'Классика'], ['rnb', 'R&B']];
function renderOnboarding() {
  const show = state.guest && !(state.prefs.guestGenres || []).length && !state.likes.guest.length;
  $('#onboarding').classList.toggle('hidden', !show);
  $('#waveSettings').classList.toggle('hidden', show);
  if (!show) return;
  const sel = new Set(state.prefs.guestGenres || []);
  $('#obGenres').innerHTML = GENRE_LIST.map(([k, n]) => `<button class="chip${sel.has(k) ? ' active' : ''}" data-g="${k}">${n}</button>`).join('');
  $$('#obGenres .chip').forEach(b => b.addEventListener('click', () => b.classList.toggle('active')));
}
$('#obStart').addEventListener('click', async () => {
  const g = $$('#obGenres .chip.active').map(b => b.dataset.g);
  await savePrefs({ guestGenres: g.length ? g : ['electronic', 'indie', 'rap'] });
  renderOnboarding(); startWave();
});
$('#obLogin').addEventListener('click', () => openSettings('accounts'));

function applyLite() {
  const lite = !!state.prefs.lite;
  document.body.classList.toggle('lite', lite);
  if (window.Wave3D) { Wave3D.lite = lite; Wave3D.setVisible(!lite && $('#page-wave').classList.contains('active') && !np.open); }
}

/* ---------- волна по треку и артисту ---------- */
function startStation(st) {
  state.station = st;
  renderStationChip();
  showPage('wave');
  startWave(st);
}
function stationFromTrack(t) {
  return { type: 'track', source: t.source, id: t.source === 'ya' ? t.rawId : t.rawId, title: t.title, artist: (t.artist || '').split(',')[0].trim(), genre: t._genre || '', label: `по треку «${t.title}»` };
}
function stationFromArtist(a, fallbackName) {
  if (a && (a.source === 'ya' || a.source === 'sc' || a.source === 'au' || a.source === 'ja')) return { type: 'artist', source: a.source, id: a.id, artist: a.name, label: `по артисту ${a.name}` };
  return { type: 'artist', source: 'none', id: null, artist: fallbackName, label: `по артисту ${fallbackName}` };
}
function renderStationChip() {
  const chip = $('#stationChip');
  chip.classList.toggle('hidden', !state.station);
  if (state.station) $('span', chip).textContent = 'Волна ' + state.station.label;
}
$('#stationChip button').addEventListener('click', () => { state.station = null; renderStationChip(); startWave(); });

/* ---------- умные плейлисты ---------- */
const SMART = [
  ['top30', 'Чаще всего за месяц', 'То, что вы включали больше всего за 30 дней'],
  ['fresh', 'Свежие лайки', 'Последние треки, которым вы поставили лайк'],
  ['forgotten', 'Давно не слушали', 'Любимое, к которому вы не возвращались полтора месяца'],
  ['finds', 'Находки волны', 'Дослушали в волне, но ещё не лайкнули'],
];
let statsCache = { at: 0, data: [] };
async function historyStats() {
  if (Date.now() - statsCache.at < 60000) return statsCache.data;
  try { statsCache = { at: Date.now(), data: await API.historyStats() }; } catch {}
  return statsCache.data;
}
async function smartTracks(kind) {
  const L = state.likes;
  const likedAll = [...L.ya, ...L.zv, ...L.sc, ...L.guest, ...L.local];
  const stats = await historyStats();
  const byKey = new Map(stats.map(s => [s.key, s]));
  if (kind === 'top30') return stats.filter(s => s.plays30 > 0 && s.t).sort((a, b) => b.plays30 - a.plays30 || b.secs - a.secs).slice(0, 50).map(s => s.t);
  if (kind === 'fresh') { const out = [], lists = [L.ya, L.zv, L.sc, L.guest].map(l => l.slice(0, 25)); for (let i = 0; out.length < 60 && lists.some(l => l.length); i++) { const l = lists[i % lists.length]; if (l.length) out.push(l.shift()); } return out; }
  if (kind === 'forgotten') {
    const cut = Date.now() - 45 * 864e5;
    const played = likedAll.filter(t => { const s = byKey.get(key(t)); return s && s.last < cut; });
    const never = likedAll.filter(t => !byKey.get(key(t))).slice(-40);
    return [...played, ...never].sort(() => Math.random() - 0.5).slice(0, 60);
  }
  if (kind === 'finds') return stats.filter(s => s.t && s.wave > 0 && (s.full > 0 || s.plays > 1) && !state.liked.has(s.key)).sort((a, b) => b.last - a.last).slice(0, 50).map(s => s.t);
  return [];
}
function openSmart(kind) { closeNp(); nav.stack.push({ type: 'smart', id: kind }); renderDetail(); }
async function renderSmartPage(page, kind) {
  const meta = SMART.find(s => s[0] === kind);
  const tracks = await smartTracks(kind);
  page.innerHTML = `
    <button class="dt-back" id="dtBack">${BACK_SVG}Назад</button>
    <header class="dt-hero">
      <div class="dt-art square smart-art smart-${kind}"><span>${meta[1].split(' ')[0]}</span></div>
      <div class="dt-info">
        <div class="dt-kind">Собирается сам</div>
        <div class="dt-name display">${splitWords(meta[1])}</div>
        <div class="dt-meta"><span>${meta[2]}</span><span>${plural(tracks.length, 'трек', 'трека', 'треков')}</span></div>
        <div class="dt-actions">
          <button class="btn primary" id="smPlay"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>Слушать</button>
          <button class="btn" id="smSave">Сохранить как плейлист</button>
        </div>
      </div>
    </header>
    <section class="sec"><div class="list" id="smTracks"></div></section>`;
  $('#dtBack').addEventListener('click', goBack);
  renderList($('#smTracks'), tracks, kind === 'top30' || kind === 'finds' ? 'Наполнится, когда вы послушаете музыку в Сплаве' : 'Пока пусто', { numbered: true });
  $('#smPlay').addEventListener('click', () => tracks.length && playQueue(tracks, 0));
  $('#smSave').addEventListener('click', async () => {
    if (!tracks.length) return;
    const name = await ask('Название плейлиста', `${meta[1]}, ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`); if (!name) return;
    await API.playlistSave({ name, tracks }); await loadPlaylists(); toast(`Сохранено: «${name}»`);
  });
  requestAnimationFrame(fitAll);
}

/* ---------- будильник ---------- */
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
let spTab = 'sleep';
function alarmPrefs() { return { on: false, time: '07:30', days: [0, 1, 2, 3, 4], source: 'wave', ramp: 60, ...(state.prefs.alarm || {}) }; }
function renderAlarmPane(box) {
  const a = alarmPrefs();
  const [hh, mm] = a.time.split(':').map(Number);
  const srcName = a.source === 'wave' ? 'Моя волна' : ((state.playlists.find(p => 'pl:' + p.id === a.source) || {}).name || 'Моя волна');
  box.innerHTML = `
    <div class="al-time">
      <div class="al-col"><button class="car-arrow" data-h="1">${ARROW_UP}</button><div class="al-num" id="alH">${String(hh).padStart(2, '0')}</div><button class="car-arrow" data-h="-1">${ARROW_DOWN}</button></div>
      <div class="al-sep">:</div>
      <div class="al-col"><button class="car-arrow" data-m="5">${ARROW_UP}</button><div class="al-num" id="alM">${String(mm).padStart(2, '0')}</div><button class="car-arrow" data-m="-5">${ARROW_DOWN}</button></div>
    </div>
    <div class="al-days">${DAYS.map((d, i) => `<button class="chip${a.days.includes(i) ? ' active' : ''}" data-d="${i}">${d}</button>`).join('')}</div>
    <button class="al-src" id="alSrc"><span>Разбудит</span><b>${esc(srcName)}</b>${ARROW_R}</button>
    <label class="opt al-on"><span><b>${a.on ? 'Будильник включён' : 'Будильник выключен'}</b><small>${a.on ? alarmLeft(a) : 'Громкость нарастает плавно за минуту'}</small></span><input type="checkbox" class="tgl" id="alOn" ${a.on ? 'checked' : ''}></label>
    <div class="sp-hint">Сплав должен быть открыт, а Mac не спать: крышка открыта, режим сна не наступил</div>`;
  const save = p => { savePrefs({ alarm: { ...alarmPrefs(), ...p } }).then(() => renderAlarmPane(box)); renderSleepBadge(); };
  $$('[data-h]', box).forEach(b => b.addEventListener('click', () => { const [h, m] = alarmPrefs().time.split(':').map(Number); save({ time: `${String((h + +b.dataset.h + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}` }); }));
  $$('[data-m]', box).forEach(b => b.addEventListener('click', () => { const [h, m] = alarmPrefs().time.split(':').map(Number); save({ time: `${String(h).padStart(2, '0')}:${String((m + +b.dataset.m + 60) % 60).padStart(2, '0')}` }); }));
  $$('.al-num', box).forEach((el, i) => el.addEventListener('wheel', e => { e.preventDefault(); const [h, m] = alarmPrefs().time.split(':').map(Number); const d = e.deltaY < 0 ? 1 : -1; save({ time: i === 0 ? `${String((h + d + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}` : `${String(h).padStart(2, '0')}:${String((m + d + 60) % 60).padStart(2, '0')}` }); }, { passive: false }));
  $$('[data-d]', box).forEach(b => b.addEventListener('click', () => { const d = +b.dataset.d; const days = new Set(alarmPrefs().days); days.has(d) ? days.delete(d) : days.add(d); save({ days: [...days].sort() }); }));
  $('#alSrc', box).addEventListener('click', () => {
    const opts = ['wave', ...state.playlists.map(p => 'pl:' + p.id)];
    const i = opts.indexOf(alarmPrefs().source); save({ source: opts[(i + 1) % opts.length] });
  });
  $('#alOn', box).addEventListener('change', e => save({ on: e.target.checked }));
}
function alarmLeft(a) {
  const now = new Date(); const [h, m] = a.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m);
    if (d > now && (a.days.length ? a.days : [0, 1, 2, 3, 4, 5, 6]).includes((d.getDay() + 6) % 7)) {
      const mins = Math.round((d - now) / 60000);
      return `Зазвонит через ${mins >= 60 ? Math.floor(mins / 60) + ' ч ' : ''}${mins % 60} мин`;
    }
  }
  return 'Выберите дни';
}
const ARROW_UP = '<svg viewBox="0 0 24 24"><path d="m6 14.5 6-6 6 6"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 24 24"><path d="m6 9.5 6 6 6-6"/></svg>';
async function fireAlarm(a) {
  closeSleepPop();
  const target = state.volume || 0.8;
  setVolume(0.03);
  if (a.source && a.source.startsWith('pl:')) {
    await loadPlaylists();
    const pl = state.playlists.find(p => 'pl:' + p.id === a.source);
    if (pl && pl.tracks.length) playQueue(pl.tracks, 0); else { state.station = null; startWave(); }
  } else { state.station = null; startWave(); }
  const steps = 30, ramp = (a.ramp || 60) * 1000;
  for (let i = 1; i <= steps; i++) setTimeout(() => { setVolume(0.03 + (target - 0.03) * i / steps); $('#pVol').value = state.volume; }, ramp * i / steps);
  toast('Доброе утро');
  if (a.once) state.prefs.alarm = { ...a, on: false };
}

/* ---------- слушать вместе ---------- */
const room = { role: null, code: null, hostKey: null, v: 0, host: '', members: [], poll: null, ping: null, pubTimer: null, lastKey: null, lastHostKey: null, lastSent: 0, applying: false };
const myName = () => { const A = state.accounts; return (A.ya && A.ya.name) || (A.zv && A.zv.name) || (A.sc && A.sc.name) || 'Гость'; };
const roomTrack = t => t ? { source: t.source, rawId: t.rawId, title: t.title, artist: t.artist, album: t.album || '', cover: t.cover && /^https:/.test(t.cover) ? t.cover : null, duration: t.duration || 0, albumId: t.albumId || null } : null;
function roomPublish(force) {
  if (room.role !== 'host') return;
  clearTimeout(room.pubTimer);
  room.pubTimer = setTimeout(async () => {
    try {
      const t0 = Date.now(); const ru = await API.room({ action: 'update', code: room.code, hostKey: room.hostKey, state: { track: roomTrack(state.current), playing: isPlaying(), position: curTime() + (isPlaying() ? (room.rtt || 150) / 2000 : 0) } }); room.rtt = room.rtt ? room.rtt * 0.7 + (Date.now() - t0) * 0.3 : Date.now() - t0;
      room.lastSent = Date.now();
    } catch (e) { toast('Комната: ' + e.message); }
  }, force ? 0 : 120);
}
async function roomCreate(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Создаём…'; }
  try {
    const r = await API.room({ action: 'create', name: myName(), state: { track: roomTrack(state.current), playing: isPlaying(), position: curTime() + (isPlaying() ? (room.rtt || 150) / 2000 : 0) } });
    Object.assign(room, { role: 'host', code: r.code, hostKey: r.hostKey, v: r.v || 1, host: myName(), members: [], lastSent: Date.now() });
    clearInterval(room.poll); room.poll = setInterval(roomHostTick, 10000);
    renderRoomBadge();
  } catch (e) { toast(e.message); renderTogether(); }
}
async function roomHostTick() {
  if (room.role !== 'host') return;
  if (Date.now() - room.lastSent > 20000) roomPublish(true);        // сверка позиции раз в 20 секунд
  try { const d = await API.room({ action: 'state', code: room.code, v: room.v, members: true }); room.members = d.members || []; renderRoomBadge(); } catch {}
}
async function roomJoin(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) { toast('Код комнаты — 6 цифр'); return false; }
  try {
    const t0 = Date.now();
    const d = await API.room({ action: 'state', code, v: 0, members: true });
    room.bestRtt = undefined; roomClock(d, t0, Date.now());
    if (d.closed) { toast('Эта комната уже закрыта'); return false; }
    roomLeave(true);
    Object.assign(room, { role: 'guest', code, v: 0, host: d.host, members: d.members || [], lastKey: null });
    API.room({ action: 'ping', code, name: myName() }).catch(() => {});
    clearInterval(room.ping); room.ping = setInterval(() => API.room({ action: 'ping', code: room.code, name: myName() }).catch(() => {}), 15000);
    clearInterval(room.poll); room.poll = setInterval(roomGuestTick, 1000);
    renderRoomBadge();
    toast(`Вы слушаете вместе с ${d.host}`);
    await roomApply(d);
    return true;
  } catch (e) { toast(e.message); return false; }
}
let guestTicks = 0;
async function roomGuestTick() {
  if (room.role !== 'guest') return;
  guestTicks++;
  try {
    const t0 = Date.now();
    const d = await API.room({ action: 'state', code: room.code, v: room.v, members: guestTicks % 10 === 0 });
    roomClock(d, t0, Date.now());
    if (d.members) room.members = d.members;
    if (d.closed) { toast('Хозяин завершил комнату'); roomLeave(true); return; }
    await roomApply(d);
  } catch (e) { if (/не найдена/.test(e.message)) { toast('Комната закрыта'); roomLeave(true); } }
}

// ---------- точная синхронизация комнаты ----------
// часы сервера: запоминаем сдвиг по самому быстрому запросу, чтобы сеть не «съедала» доли секунды
function roomClock(d, t0, t1) {
  const rtt = t1 - t0;
  if (!(room.bestRtt <= rtt) || Date.now() - (room.bestAt || 0) > 60000) { room.bestRtt = rtt; room.bestAt = Date.now(); room.clockOff = d.now + rtt / 2 - t1; }
  room.rtt = room.rtt ? room.rtt * 0.7 + rtt * 0.3 : rtt;
}
function roomExpected() {
  const st = room.st; if (!st) return 0;
  return st.playing ? st.position + (Date.now() + (room.clockOff || 0) - st.ts) / 1000 : st.position;
}
// маленькое расхождение догоняем скоростью (незаметно на слух), большое — перемоткой
function roomDrift() {
  const el = audio; if (!el || !room.st || !room.st.playing || el.paused) { if (el) el.playbackRate = 1; return; }
  const diff = roomExpected() - el.currentTime;
  if (Math.abs(diff) > 0.6) { el.playbackRate = 1; seekTo(Math.max(0, roomExpected() + 0.08)); }
  else if (Math.abs(diff) > 0.06) el.playbackRate = 1 + Math.max(-0.06, Math.min(0.06, diff * 0.5));
  else el.playbackRate = 1;
}
async function roomApply(d) {
  if (d.state) { room.v = d.v; room.st = d.state; }
  const st = room.st; if (!st) return;
  const t = st.track;
  const k = t ? t.source + ':' + t.rawId : null;
  if (k && k !== room.lastHostKey) {
    room.lastHostKey = k;
    const mine = await roomResolve(t);
    if (!mine) { toast(`«${t.title}» недоступен у вас: нет подходящего источника`); return; }
    room.applying = true;
    state.mode = 'room'; state.queue = [mine]; state.qi = 0;
    const done = () => { if (!room.applying) return; room.applying = false; if (room.st.playing) seekTo(Math.max(0, roomExpected() + 0.08)); else { seekTo(room.st.position); if (am.active) { API.amCmd('pause'); am.playing = false; } else audio.pause(); } };
    if (am.active) { await playTrack(mine); setTimeout(done, 900); return; }
    // как только трек реально заиграл — сразу встаём в ту же секунду, что и хозяин
    await playTrack(mine);
    const el = audio;
    if (!el.paused && el.readyState >= 3) setTimeout(done, 60);
    else {
      const onPlaying = () => { el.removeEventListener('playing', onPlaying); setTimeout(done, 60); };
      el.addEventListener('playing', onPlaying);
      setTimeout(() => { el.removeEventListener('playing', onPlaying); done(); }, 8000);
    }
    return;
  }
  if (!state.current || room.applying) return;
  if (st.playing && !isPlaying()) { if (am.active) { API.amCmd('play'); am.playing = true; } else audio.play().catch(() => {}); }
  if (!st.playing && isPlaying()) { if (am.active) { API.amCmd('pause'); am.playing = false; } else audio.pause(); }
  if (!st.playing && Math.abs(curTime() - st.position) > 0.5) seekTo(st.position);
  if (!am.active) roomDrift();
  else if (st.playing && Math.abs(curTime() - roomExpected()) > 1.5) seekTo(Math.max(0, roomExpected()));
  syncPlaying();
}
async function roomResolve(t) {
  const A = state.accounts;
  const direct = t.source === 'sc' || t.source === 'au' || (t.source === 'ya' && A.ya) || (t.source === 'zv' && A.zv) || (t.source === 'ja' && state.keys.jamendo);
  if (direct) return { ...t, id: t.source === 'ya' && t.albumId ? `ya:${t.rawId}:${t.albumId}` : `${t.source}:${t.rawId}`, artists: [], available: true };
  try {
    const r = await API.search(`${(t.artist || '').split(',')[0]} ${t.title}`);
    const n = s => (s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
    const pool = (r.tracks || []).filter(x => !x.locked && x.available !== false);
    return pool.find(x => n(x.title) === n(t.title)) || pool.find(x => n(x.title).includes(n(t.title))) || null;
  } catch { return null; }
}
function roomLeave(silent) {
  if (room.role === 'guest' && room.code) API.room({ action: 'leave', code: room.code, name: myName() }).catch(() => {});
  if (room.role === 'host' && room.code && !silent) API.room({ action: 'close', code: room.code, hostKey: room.hostKey }).catch(() => {});
  clearInterval(room.poll); clearInterval(room.ping);
  if (audio) audio.playbackRate = 1;
  Object.assign(room, { role: null, code: null, hostKey: null, v: 0, members: [], lastHostKey: null, st: null });
  if (state.mode === 'room') state.mode = 'list';
  renderRoomBadge();
}
function renderRoomBadge() {
  $('#pRoom').classList.toggle('on', !!room.role);
  $('#npRoom').classList.toggle('on', !!room.role);
  $('#roomBar').classList.toggle('hidden', !room.role);
  if (room.role) $('#roomBar').innerHTML = room.role === 'host'
    ? `<span class="rb-dot"></span><span>Комната <b>${room.code}</b><small>${room.members.length ? plural(room.members.length, 'слушатель', 'слушателя', 'слушателей') : 'ждём друзей'}</small></span>`
    : `<span class="rb-dot"></span><span>Вместе с <b>${esc(room.host)}</b><small>комната ${room.code}</small></span>`;
  renderTogether();
}
const hasServer = () => !!(state.keyValues && state.keyValues.server);
const frVisible = () => $('#page-friends').classList.contains('active');

/* ---------- карточка «Слушать вместе» ---------- */
let dbWarn = null;
function renderTogether() {
  const el = $('#togetherCard'); if (!el) return;
  if (!hasServer()) {
    el.innerHTML = `<div class="fc-title">Слушать вместе</div><div class="fc-text">Для комнат и друзей нужен сервер Сплава. Укажите его адрес в Профиле, на вкладке «Интеграции».</div><button class="btn primary" id="tgSet">Открыть настройки</button>`;
    $('#tgSet', el).addEventListener('click', () => openSettings('integrations'));
    return;
  }
  const warn = dbWarn ? `<div class="fc-warn">${esc(dbWarn)}</div>` : '';
  const members = room.members.length ? room.members.map(m => `<span class="rp-m">${esc(m)}</span>`).join('') : '<span class="rp-none">Пока никого</span>';
  if (room.role === 'host') {
    el.innerHTML = `<div class="fc-title">Ваша комната</div>
      <div class="tg-code">${room.code.split('').map(d => `<span>${d}</span>`).join('')}</div>
      <div class="fc-text">Продиктуйте код другу: он введёт его у себя на этой же странице.</div>
      <div class="fc-row"><button class="btn primary" id="tgCopy">Скопировать код</button><button class="btn danger" id="tgEnd">Завершить</button></div>
      <div class="rp-sub">Слушают</div><div class="rp-members">${members}</div>${warn}`;
    $('#tgCopy', el).addEventListener('click', () => navigator.clipboard.writeText(room.code).then(() => toast('Код скопирован')));
    $('#tgEnd', el).addEventListener('click', () => { roomLeave(false); toast('Комната завершена'); });
    return;
  }
  if (room.role === 'guest') {
    el.innerHTML = `<div class="fc-title">Вы слушаете вместе с ${esc(room.host)}</div>
      <div class="fc-text">Музыку выбирает ${esc(room.host)}: пауза и перемотка повторяются у вас сразу же. Комната ${room.code}.</div>
      <div class="rp-sub">Слушают</div><div class="rp-members">${members}</div>
      <div class="fc-row"><button class="btn" id="tgLeave">Выйти из комнаты</button></div>${warn}`;
    $('#tgLeave', el).addEventListener('click', () => { roomLeave(true); toast('Вы вышли из комнаты'); });
    return;
  }
  el.innerHTML = `<div class="fc-title">Слушать вместе</div>
    <div class="fc-text">Друзья слышат то же, что и вы, в ту же секунду. Каждый слушает через свои источники.</div>
    <button class="btn primary fc-wide" id="tgCreate">Создать комнату</button>
    <div class="tg-or">Есть код от друга?</div>
    <div class="code-cells" id="tgCells">${'<input inputmode="numeric" maxlength="1" autocomplete="off">'.repeat(6)}</div>${warn}`;
  $('#tgCreate', el).addEventListener('click', e => roomCreate(e.currentTarget));
  bindCodeCells($('#tgCells', el));
}
function bindCodeCells(box) {
  const cells = $$('input', box);
  const value = () => cells.map(c => c.value).join('');
  const fill = (from, digits) => { digits.split('').forEach((d, i) => { if (cells[from + i]) cells[from + i].value = d; }); };
  const submit = async () => {
    if (value().length !== 6) return;
    box.classList.add('busy'); cells.forEach(c => c.disabled = true);
    const ok = await roomJoin(value());
    if (!ok) { box.classList.remove('busy'); box.classList.add('shake'); setTimeout(() => box.classList.remove('shake'), 450); cells.forEach(c => { c.disabled = false; c.value = ''; }); cells[0].focus(); }
  };
  cells.forEach((c, i) => {
    c.addEventListener('input', () => {
      const d = c.value.replace(/\D/g, '');
      if (d.length > 1) { fill(i, d.slice(0, 6 - i)); } else c.value = d;
      const next = cells.findIndex(x => !x.value); if (next >= 0) cells[next].focus(); else submit();
    });
    c.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !c.value && i > 0) { cells[i - 1].value = ''; cells[i - 1].focus(); e.preventDefault(); }
      if (e.key === 'ArrowLeft' && i > 0) cells[i - 1].focus();
      if (e.key === 'ArrowRight' && i < 5) cells[i + 1].focus();
    });
    c.addEventListener('paste', e => { e.preventDefault(); const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); if (!d) return; cells.forEach(x => x.value = ''); fill(0, d); const next = cells.findIndex(x => !x.value); if (next >= 0) cells[next].focus(); else submit(); });
    c.addEventListener('focus', () => c.select());
  });
}

/* ---------- друзья ---------- */
const social = { me: null, read: {}, ver: null, since: 0, friends: [], incoming: [], outgoing: [], inbox: [], sel: null, chat: [], loaded: false, lastSync: 0, busy: false };
const fname = id => { const f = social.friends.find(x => x.id === id); return f ? f.name : ''; };
const unreadOf = id => social.inbox.filter(m => m.f === id && m.ts > (social.read[id] || 0)).length;
function updateFrCount() {
  const n = social.friends.reduce((a, f) => a + unreadOf(f.id), 0) + social.incoming.length;
  const el = $('#frCount'); el.textContent = n > 99 ? '99+' : n; el.classList.toggle('hidden', !n);
}
async function socialInit() {
  try { const me = await API.social({ action: 'local' }); if (me) { social.me = me; social.read = me.read || {}; } } catch {}
  renderFriends(); renderChat();
  if (social.me) socialSync();
  setInterval(() => {
    if (!social.me || document.hidden && !frVisible()) return;
    if (Date.now() - social.lastSync > (frVisible() ? 5000 : 30000)) socialSync();
  }, 5000);
}
async function socialSync() {
  if (!social.me || !hasServer() || social.busy) return;
  social.busy = true; social.lastSync = Date.now();
  try {
    const d = await API.social({ action: 'sync', ver: social.ver, since: social.since });
    if (d.same) return;
    const first = !social.loaded;
    const fresh = (d.inbox || []).filter(m => !social.inbox.some(x => x.id === m.id));
    if (!first) {
      for (const m of fresh) if (!(frVisible() && social.sel === m.f && document.hasFocus())) notify(`Трек от @${m.fn}`, `«${m.t.title}», ${m.t.artist}`, () => { showPage('friends'); openChat(m.f); });
      for (const r of d.incoming) if (!social.incoming.some(x => x.id === r.id)) notify('Заявка в друзья', `@${r.name} хочет добавить вас в друзья`, () => showPage('friends'));
    }
    Object.assign(social, { ver: d.ver, me: { ...social.me, name: d.me.name }, friends: d.friends, incoming: d.incoming, outgoing: d.outgoing, loaded: true });
    social.inbox = [...fresh, ...social.inbox].slice(0, 300);
    social.since = Math.max(social.since, ...social.inbox.map(m => m.ts), 0);
    if (social.sel && !social.friends.some(f => f.id === social.sel)) social.sel = null;
    const forChat = fresh.filter(m => m.f === social.sel);
    if (forChat.length) { social.chat = [...social.chat, ...forChat.reverse()]; markRead(social.sel); }
    renderFriends(); if (forChat.length || !social.sel) renderChat();
  } catch (e) {
    if (/создайте его заново/.test(e.message)) { social.me = null; renderFriends(); renderChat(); toast(e.message); }
  } finally { social.busy = false; updateFrCount(); }
}
function markRead(id) {
  const ts = Date.now(); social.read[id] = ts; API.social({ action: 'read', id, ts }).catch(() => {}); updateFrCount();
}
const timeAgo = ts => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'только что'; if (m < 60) return m + ' мин назад';
  const h = Math.round(m / 60); if (h < 24) return h + ' ч назад';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};
const ava = name => `<span class="fr-ava">${esc((name || '?')[0].toUpperCase())}</span>`;

function renderFriends() {
  const el = $('#friendsCard'); if (!el) return;
  $('#frMe').innerHTML = social.me ? `Вы <button class="fr-handle" id="frHandle" title="Скопировать имя">@${esc(social.me.name)}</button>` : 'Комнаты и треки для друзей';
  const h = $('#frHandle'); if (h) h.addEventListener('click', () => navigator.clipboard.writeText('@' + social.me.name).then(() => toast('Имя скопировано: отправьте его другу')));
  if (!hasServer()) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (!social.me) {
    el.innerHTML = `<div class="fc-title">Друзья</div>
      <div class="fc-text">Придумайте имя. По нему друзья найдут вас и смогут присылать треки.</div>
      <form class="fr-add" id="frReg"><span class="at">@</span><input id="frRegName" maxlength="20" placeholder="например, lesha.music" spellcheck="false" autocomplete="off"><button class="btn primary">Создать профиль</button></form>
      <div class="fc-hint">Латинские буквы, цифры, точка и подчёркивание, от 3 до 20 знаков.</div>`;
    $('#frReg', el).addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#frRegName', el).value.trim(); if (!name) return;
      try { social.me = await API.social({ action: 'register', name }); social.read = {}; toast(`Профиль @${social.me.name} создан`); renderFriends(); renderChat(); socialSync(); }
      catch (err) { toast(err.message); }
    });
    return;
  }
  const req = social.incoming.length ? `<div class="rp-sub">Хотят дружить</div>${social.incoming.map(r => `<div class="fr-row req" data-id="${esc(r.id)}">${ava(r.name)}<span class="fr-name">@${esc(r.name)}</span><button class="btn primary sm" data-act="accept">Принять</button><button class="ibtn" data-act="decline" title="Отклонить"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div>`).join('')}` : '';
  const list = social.friends.length ? social.friends.map(f => { const n = unreadOf(f.id); return `<button class="fr-row fr-friend${social.sel === f.id ? ' sel' : ''}" data-id="${esc(f.id)}">${ava(f.name)}<span class="fr-name">@${esc(f.name)}<small>${f.last ? timeAgo(f.last) : 'ещё ничего не отправляли'}</small></span>${n ? `<span class="fr-unread">${n}</span>` : ''}</button>`; }).join('')
    : (social.loaded ? '<div class="fc-empty">Пока никого. Добавьте друга по имени или отправьте ему своё.</div>' : '<div class="fc-empty">Загружаем…</div>');
  const out = social.outgoing.length ? `<div class="rp-sub">Ждут ответа</div>${social.outgoing.map(r => `<div class="fr-row muted" data-id="${esc(r.id)}">${ava(r.name)}<span class="fr-name">@${esc(r.name)}</span><button class="btn ghost sm" data-act="cancel">Отменить</button></div>`).join('')}` : '';
  el.innerHTML = `<div class="fc-title">Друзья</div>
    <form class="fr-add" id="frAdd"><span class="at">@</span><input id="frAddName" maxlength="21" placeholder="имя друга" spellcheck="false" autocomplete="off"><button class="btn">Добавить</button></form>
    ${req}<div class="fr-list">${list}</div>${out}`;
  $('#frAdd', el).addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#frAddName', el).value.trim(); if (!name) return;
    try {
      const r = await API.social({ action: 'request', name });
      toast(r.status === 'friends' ? `@${name.replace(/^@/, '')} теперь в друзьях` : 'Заявка отправлена. Друг увидит её у себя на странице «Вместе»');
      social.ver = null; await socialSync();
    } catch (err) { toast(err.message); }
  });
  $$('[data-act]', el).forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const id = b.closest('[data-id]').dataset.id;
    try { await API.social({ action: b.dataset.act, id }); social.ver = null; await socialSync(); } catch (err) { toast(err.message); }
  }));
  $$('.fr-friend', el).forEach(b => b.addEventListener('click', () => openChat(b.dataset.id)));
}

async function openChat(id) {
  social.sel = id; social.chat = []; renderFriends(); renderChat(true);
  try { const d = await API.social({ action: 'chat', id }); if (social.sel !== id) return; social.chat = (d.messages || []).slice().reverse(); }
  catch (e) { toast(e.message); }
  markRead(id); renderFriends(); renderChat();
}
function renderChat(loading) {
  const el = $('#frChat'); if (!el) return;
  if (!social.me || !social.sel) {
    el.innerHTML = `<div class="chat-empty"><svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg><div>${social.me ? 'Выберите друга, чтобы увидеть треки, которые вы друг другу прислали' : 'Здесь появятся треки, которые вам пришлют друзья'}</div><small>Отправить трек можно правой кнопкой мыши по нему или из полноэкранного плеера</small></div>`;
    return;
  }
  const name = fname(social.sel);
  const msgs = social.chat.map(m => {
    const mine = m.f === social.me.id, t = m.t;
    return `<div class="msg${mine ? ' mine' : ''}" data-id="${esc(m.id)}"><div class="msg-card"><div class="r-cover" style="background-image:${esc(cssUrl(t.cover))}"></div><div class="msg-main"><div class="r-title">${esc(t.title)}</div><div class="r-artist">${esc(t.artist)}</div></div><span class="badge">${SOURCE_NAME[t.source] || ''}</span></div><div class="msg-time">${mine ? 'вы, ' : ''}${timeAgo(m.ts)}</div></div>`;
  }).join('');
  el.innerHTML = `<div class="chat-head">${ava(name)}<div class="chat-name">@${esc(name)}</div><button class="btn primary" id="chSendNow"${state.current ? '' : ' disabled'}>Отправить то, что играет</button><button class="ibtn" id="chMore" title="Ещё"><svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/></svg></button></div>
    <div class="chat-body" id="chBody">${loading ? '<div class="fc-empty">Загружаем…</div>' : msgs || `<div class="fc-empty">Пока пусто. Отправьте @${esc(name)} первый трек.</div>`}</div>`;
  const body = $('#chBody', el); body.scrollTop = body.scrollHeight;
  $('#chSendNow', el).addEventListener('click', () => state.current && sendTrack(social.sel, state.current));
  $('#chMore', el).addEventListener('click', e => {
    e.stopPropagation();
    const m = $('#ctx'); m.innerHTML = `<button data-x="rm">Удалить @${esc(name)} из друзей</button>`;
    m.classList.remove('hidden'); const r = e.currentTarget.getBoundingClientRect();
    m.style.left = Math.min(r.left, window.innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = (r.bottom + 6) + 'px';
    $('[data-x]', m).addEventListener('click', async () => { closeCtx(); try { await API.social({ action: 'remove', id: social.sel }); social.sel = null; social.ver = null; await socialSync(); renderChat(); toast(`@${name} больше не в друзьях`); } catch (err) { toast(err.message); } });
  });
  $$('.msg', el).forEach(row => row.querySelector('.msg-card').addEventListener('click', () => playShared(social.chat.find(m => m.id === row.dataset.id).t)));
}
async function playShared(t) {
  toast(`Ищем «${t.title}»…`);
  const mine = await roomResolve(t);
  if (!mine) { toast(`«${t.title}» недоступен у вас: нет подходящего источника`); return; }
  playQueue([mine], 0, 'list');
}
async function sendTrack(id, t) {
  try {
    const d = await API.social({ action: 'send', id, track: roomTrack(t) });
    if (social.sel === id) { social.chat.push(d.msg); renderChat(); }
    const f = social.friends.find(x => x.id === id); if (f) f.last = d.msg.ts;
    toast(`Отправлено @${fname(id)}`); renderFriends();
  } catch (e) { toast(e.message); }
}
function pickFriend(t, x, y) {
  if (!social.me) { showPage('friends'); toast('Сначала создайте профиль на странице «Вместе»'); return; }
  if (!social.friends.length) { showPage('friends'); toast('Добавьте друга, чтобы отправлять ему треки'); return; }
  const m = $('#ctx');
  m.innerHTML = `<div class="ctx-title">Отправить «${esc(t.title)}»</div>` + social.friends.map((f, i) => `<button data-i="${i}">@${esc(f.name)}</button>`).join('');
  $$('button', m).forEach(b => b.addEventListener('click', () => { closeCtx(); sendTrack(social.friends[+b.dataset.i].id, t); }));
  m.classList.remove('hidden');
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
}
async function onFriendsShown() {
  renderTogether(); renderFriends();
  if (social.sel) { markRead(social.sel); renderFriends(); }
  if (social.me) { social.lastSync = 0; socialSync(); }
  if (hasServer() && dbWarn === null) {
    try { const h = await API.health(); dbWarn = h.db === 'memory' ? 'Сервер не видит базу: комнаты будут пропадать. В Vercel подключите Upstash к проекту и нажмите Redeploy.' : ''; }
    catch { dbWarn = ''; }
    if (dbWarn) renderTogether();
  }
}
for (const id of ['#pCover', '#pMeta', '#npCover']) $(id).addEventListener('contextmenu', e => { if (state.current) openCtx(e, state.current); });
$('#npShare').addEventListener('click', e => {
  e.stopPropagation(); if (!state.current) return;
  const r = e.currentTarget.getBoundingClientRect(); pickFriend(state.current, r.left, r.top - 8);
  const m = $('#ctx'); if (!m.classList.contains('hidden')) m.style.top = Math.max(8, r.top - m.offsetHeight - 8) + 'px';
});
const goTogether = e => { e.stopPropagation(); showPage('friends'); };
$('#pRoom').addEventListener('click', goTogether);
$('#npRoom').addEventListener('click', goTogether);
$('#roomBar').addEventListener('click', () => showPage('friends'));

/* ---------- обновления ---------- */
const upd = { info: null, busy: false };
async function checkUpdates(manual) {
  try {
    const r = await API.updateCheck();
    if (r.available) { upd.info = r; renderUpdateBar(); }
    else if (manual) toast(r.reason === 'no-feed' ? 'Обновления появятся, когда будет указан сервер Сплава' : 'У вас последняя версия');
  } catch (e) { if (manual) toast('Не удалось проверить обновления'); }
}
function renderUpdateBar(progress) {
  const bar = $('#updateBar');
  bar.classList.toggle('hidden', !upd.info);
  if (!upd.info) return;
  bar.innerHTML = upd.busy
    ? `<span>Скачиваем версию ${esc(upd.info.version)}… ${progress ? Math.round(progress * 100) + '%' : ''}</span><i style="width:${Math.round((progress || 0) * 100)}%"></i>`
    : `<span>Доступна версия ${esc(upd.info.version)}${upd.info.notes ? ': ' + esc(upd.info.notes) : ''}</span><button class="btn primary" id="updGo">Обновить</button><button class="ibtn" id="updLater" title="Позже"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button>`;
  const go = $('#updGo', bar);
  if (go) go.addEventListener('click', async () => {
    upd.busy = true; renderUpdateBar(0);
    try { await API.updateInstall(); } catch (e) { upd.busy = false; renderUpdateBar(); toast(e.message); }
  });
  const later = $('#updLater', bar); if (later) later.addEventListener('click', () => bar.classList.add('hidden'));
}

/* ---------- команды из главного процесса ---------- */
API.onCmd(c => {
  if (!c || typeof c !== 'object') return;
  if (c.alarm) fireAlarm(c.alarm);
  if (c.join) roomJoin(c.join);
  if (c.updateProgress !== undefined) renderUpdateBar(c.updateProgress);
});

/* ---------- старт ---------- */
(async function init() {
  renderNowPlaying();
  if (window.Wave3D) Wave3D.init($('#wave3d'));
  buildCarousels();
  try { await refreshState(); } catch (e) { toast(e.message); }
  loadLikes();
  updateWrappedPill(); setInterval(updateWrappedPill, 10 * 60 * 1000);
  API.pendingLink().then(code => { if (code) roomJoin(code); }).catch(() => {});
  socialInit();
  setTimeout(() => checkUpdates(false), 6000); setInterval(() => checkUpdates(false), 6 * 3600 * 1000);
  API.appVersion().then(v => { const el = $('#appVer'); if (el) el.textContent = 'Версия ' + v; }).catch(() => {});
})();
$('#checkUpd').addEventListener('click', () => checkUpdates(true));
