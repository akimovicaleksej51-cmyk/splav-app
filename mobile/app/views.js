// Экраны: волна, поиск, моя музыка, артист, альбом, плейлист, профиль и вход
import { API } from './api.js';
import { $, $$, esc, cssUrl, key, ico, toast, haptic, state, sheet, actions, trackHead, renderList, push, pop, plural, prompt, onTab, showTab, SOURCE } from './lib.js';
import { playQueue, startWave, applyWaveSettings, isPlaying, togglePlay, toggleLike, dislike, queueNext, queueEnd, startStation, stationFromTrack, stationFromArtist, openPlayer, closePlayer } from './player.js';
import { pickFriend } from './together.js';

const avatarBtn = () => {
  const A = state.accounts; const n = (A.ya && A.ya.name) || (A.zv && A.zv.name) || (A.sc && A.sc.name) || '';
  return `<button class="avatar-btn" data-profile aria-label="Профиль и настройки">${n ? esc(n[0].toUpperCase()) : ico('user')}</button>`;
};
document.addEventListener('click', e => { if (e.target.closest('[data-profile]')) openProfile(); });

/* ================= ВОЛНА ================= */
const WAVE_OPTIONS = {
  diversity: ['Характер', [['default', 'Любой'], ['favorite', 'Любимое'], ['discover', 'Незнакомое'], ['popular', 'Популярное']]],
  moodEnergy: ['Настроение', [['all', 'Любое'], ['active', 'Бодрое'], ['fun', 'Весёлое'], ['calm', 'Спокойное'], ['sad', 'Грустное']]],
  language: ['Язык', [['any', 'Любой'], ['russian', 'Русский'], ['not-russian', 'Иностранный'], ['without-words', 'Без слов']]],
};
const GENRES = [['rap', 'Рэп'], ['phonk', 'Фонк'], ['pop', 'Поп'], ['indie', 'Инди'], ['rock', 'Рок'], ['electronic', 'Электроника'], ['techno', 'Техно'], ['house', 'Хаус'], ['lofi', 'Лоу-фай'], ['ambient', 'Эмбиент'], ['jazz', 'Джаз'], ['classical', 'Классика'], ['rnb', 'R&B']];
const MOODS = [['all', 'Любое'], ['active', 'Бодрое'], ['fun', 'Весёлое'], ['calm', 'Спокойное'], ['sad', 'Грустное']];
export function renderWave() {
  const el = $('#tab-wave');
  const settingsSummary = Object.entries(WAVE_OPTIONS).map(([k, [, opts]]) => (opts.find(o => o[0] === state.wave[k]) || opts[0])).filter(o => !['default', 'all', 'any'].includes(o[0])).map(o => o[1]).join(', ');
  const needOnb = state.guest && !(state.prefs.guestGenres || []).length && !state.likes.guest.length;
  el.innerHTML = `
    <div class="wave-hero" id="waveHero">
      <div class="wave-top"><div class="wave-logo"><i></i>СПЛАВ</div>${avatarBtn()}</div>
      <div class="wv-stage" id="wvStage">
        <div class="wv-glow"></div>
        <div class="wv-rings"><i></i><i></i><i></i></div>
        <div class="wv-sparks">${Array.from({ length: 14 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${6 + (i * 7) % 9}s;--dl:${-(i * 1.3).toFixed(1)}s;--s:${2 + (i % 3)}px"></i>`).join('')}</div>
        <div class="orb" id="wvOrb"><i></i><i></i><i></i></div>
        <div class="wv-art" id="wvArtA"></div><div class="wv-art" id="wvArtB"></div>
      </div>
      <button class="wave-title" id="wvTitle"></button>
      <div class="wave-sub" id="wvSub"></div>
      <div class="wv-ctrl" id="wvCtrl">
        <button class="wv-side" id="wvDislike" aria-label="Не нравится">${ico('ban')}</button>
        <button class="wave-play" id="wavePlay" aria-label="Слушать волну">${ico('play')}</button>
        <button class="wv-side" id="wvNext" aria-label="Следующий трек">${ico('next')}</button>
        <button class="wv-side" id="wvLike" aria-label="Нравится">${ico('heart')}</button>
      </div>
      <div class="wave-actions">
        ${state.station ? `<span class="station"><span>Волна ${esc(state.station.label)}</span><button id="stOff" aria-label="Вернуться к «Моей волне»">${ico('close')}</button></span>` : ''}
        <button class="btn sm" id="waveSet">${ico('sliders')}${settingsSummary ? esc(settingsSummary) : 'Настроить'}</button>
        ${settingsSummary || state.station ? `<button class="btn sm" id="waveReset" aria-label="Сбросить настройки волны">${ico('close')}Сбросить</button>` : ''}
      </div>
    </div>
    <div id="updWave"></div>
    ${needOnb ? `<div class="onb"><div class="onb-title">Что вам нравится?</div><div class="onb-text">Отметьте пару жанров, и волна начнётся с них. Без входа звучит музыка из SoundCloud, Audius и Jamendo.</div><div class="chips wrap" id="obG">${GENRES.map(([k, n]) => `<button class="chip" data-g="${k}">${n}</button>`).join('')}</div><button class="btn primary wide" id="obGo">Слушать волну</button><button class="btn ghost wide" id="obLogin" style="margin-top:6px">У меня есть Яндекс или Звук</button></div>` : ''}
    <div class="sec-title">Настроение</div>
    <div class="chips" id="wvMood">${MOODS.map(([v, n]) => `<button class="chip${state.wave.moodEnergy === v ? ' active' : ''}" data-v="${v}">${n}</button>`).join('')}</div>
    <div class="sec-title">Волна по жанру</div>
    <div class="genre-grid" id="wvGenres">${GENRES.map(([k, n], i) => `<button class="genre${state.station && state.station.type === 'genre' && state.station.id === k ? ' on' : ''}" data-g="${k}" style="--h:${(i * 27) % 360}">${n}</button>`).join('')}</div>
    <div id="wvNextBox"></div>`;
  $('#wavePlay', el).onclick = () => { haptic(); if (state.mode === 'wave' && state.current) togglePlay(); else startWave(state.station); };
  $('#wvNext', el).onclick = async () => { haptic(); (await import('./player.js')).next(true); };
  $('#wvLike', el).onclick = () => state.current && toggleLike(state.current);
  $('#wvDislike', el).onclick = () => state.current && dislike(state.current);
  $('#wvTitle', el).onclick = () => { const t = state.mode === 'wave' && state.current; if (!t) return; const a = t.artists && t.artists[0]; if (a && (a.source === 'ya' || a.source === 'sc')) openArtist(a.source, a.id, a.name); else openPlayer(); };
  $('#wvStage', el).onclick = () => { if (state.mode === 'wave' && state.current) openPlayer(); };
  $('#waveSet', el).onclick = openWaveSettings;
  const wr = $('#waveReset', el); if (wr) wr.onclick = resetWave;
  $$('#wvMood .chip', el).forEach(b => b.onclick = () => {
    haptic(); state.wave.moodEnergy = b.dataset.v;
    $$('#wvMood .chip', el).forEach(c => c.classList.toggle('active', c === b));
    applyWaveSettings(); if (state.mode !== 'wave' || !state.current) startWave(state.station);
  });
  $$('#wvGenres .genre', el).forEach(b => b.onclick = () => {
    haptic('medium');
    const name = (GENRES.find(g => g[0] === b.dataset.g) || [])[1] || b.dataset.g;
    $('#tab-wave').scrollTo({ top: 0, behavior: 'smooth' });
    startWave({ type: 'genre', source: 'mix', id: b.dataset.g, label: `«${name}»` });
  });
  import('./main.js').then(m => m.renderUpdate($('#updWave'))).catch(() => {});
  const so = $('#stOff', el); if (so) so.onclick = () => { state.station = null; startWave(); };
  if (needOnb) {
    $$('#obG .chip', el).forEach(b => b.onclick = () => { b.classList.toggle('active'); haptic(); });
    $('#obGo', el).onclick = async () => {
      const g = $$('#obG .chip.active', el).map(b => b.dataset.g);
      if (!g.length) { toast('Выберите хотя бы один жанр'); return; }
      state.prefs = await API.setPrefs({ guestGenres: g }); renderWave(); startWave();
    };
    $('#obLogin', el).onclick = openProfile;
  }
  wvShown = null; updateWaveNow();
}

// фото артиста: у Яндекса и SoundCloud берём портрет, у остальных — обложку
const photoCache = new Map();
async function artistPhoto(t) {
  const a = t.artists && t.artists[0];
  if (!a || !(a.source === 'ya' || a.source === 'sc')) return t.cover;
  const k = a.source + ':' + a.id;
  if (!photoCache.has(k)) photoCache.set(k, API.artist(a.source, a.id).then(r => (r && r.cover) || t.cover).catch(() => t.cover));
  return photoCache.get(k);
}
let wvShown = null, wvFlip = false;
export async function updateWaveNow() {
  const el = $('#tab-wave'); const hero = $('#waveHero', el); if (!hero) return;
  const t = state.mode === 'wave' ? state.current : null;
  hero.classList.toggle('live', !!t);
  $('#wvTitle', el).textContent = t ? (t.artist || '').split(',')[0] : (state.station ? 'Волна' : 'Моя волна');
  $('#wvSub', el).textContent = state.waveStatus || (t ? t.title : state.station ? state.station.label : 'Бесконечный поток музыки под ваш вкус');
  $('#wavePlay', el).innerHTML = ico(t && isPlaying() ? 'pause' : 'play');
  $('#wvDislike', el).classList.toggle('hidden', !t);
  $('#wvNext', el).classList.toggle('hidden', !t);
  const lk = $('#wvLike', el); lk.classList.toggle('hidden', !t); lk.classList.toggle('on', !!(t && state.liked.has(key(t))));
  // «дальше в волне»
  const nb = $('#wvNextBox', el);
  const up = t ? state.queue.slice(state.qi + 1, state.qi + 5) : [];
  nb.innerHTML = up.length ? `<div class="sec-title">Дальше в волне</div><div class="list" id="wvUp"></div>` : '';
  if (up.length) renderList($('#wvUp', nb), up, { onPlay: i => { state.qi = state.qi + 1 + i; import('./player.js').then(m => m.playTrack(state.queue[state.qi])); }, onMore: x => trackMenu(x) });
  // цвет свечения
  if (t && t.cover) API.coverColor(t.cover).then(c => { if (c) hero.style.setProperty('--wc', `${c.join(',')}`); }).catch(() => {});
  const k = t ? key(t) : null;
  if (k === wvShown) return;
  wvShown = k;
  const show = $('#' + (wvFlip ? 'wvArtA' : 'wvArtB'), el), hide = $('#' + (wvFlip ? 'wvArtB' : 'wvArtA'), el);
  wvFlip = !wvFlip;
  if (!t) { show.classList.remove('on'); hide.classList.remove('on'); return; }
  const url = await artistPhoto(t);
  if (wvShown !== k) return;
  const img = new Image();
  img.onload = img.onerror = () => { if (wvShown !== k) return; show.style.backgroundImage = cssUrl(url); show.classList.add('on'); hide.classList.remove('on'); };
  img.src = url || '';
}
document.addEventListener('now-changed', () => updateWaveNow());
document.addEventListener('play-state', () => { const b = $('#wavePlay'); if (b) b.innerHTML = ico(state.mode === 'wave' && state.current && isPlaying() ? 'pause' : 'play'); });
document.addEventListener('likes-changed', () => { const lk = $('#wvLike'); if (lk && state.current) lk.classList.toggle('on', state.liked.has(key(state.current))); });
const WAVE_DEFAULTS = { diversity: 'default', moodEnergy: 'all', language: 'any' };
const isWaveDefault = () => Object.entries(WAVE_DEFAULTS).every(([k, v]) => state.wave[k] === v);
// сброс: обычная «Моя волна» без настроек и без станции по треку или артисту
function resetWave() {
  const hadStation = !!state.station;
  Object.assign(state.wave, WAVE_DEFAULTS); state.station = null; haptic('medium');
  applyWaveSettings();
  if (hadStation || state.mode !== 'wave') startWave(); else renderWave();
  toast('Играет обычная «Моя волна»');
}
function openWaveSettings() {
  const body = Object.entries(WAVE_OPTIONS).map(([k, [label, opts]]) => `<div class="opt-group"><div class="opt-label">${label}</div><div class="chips wrap" data-k="${k}">${opts.map(([v, n]) => `<button class="chip${state.wave[k] === v ? ' active' : ''}" data-v="${v}">${n}</button>`).join('')}</div></div>`).join('');
  const s = sheet(`<div class="sh-head"><div class="sh-title">Настроить волну</div><button class="btn sm" id="wsReset">Сбросить</button></div><div class="sh-body">${body}
    ${state.accounts.sc ? `<button class="row-toggle" id="wsMix"><span class="rt-t"><b>SoundCloud в волне</b><span>Подмешивать треки из ваших лайков SoundCloud</span></span><span class="tgl${state.wave.mix ? ' on' : ''}"></span></button>` : ''}
    <button class="row-toggle" id="wsTod"><span class="rt-t"><b>По времени суток</b><span>Утром бодрее, ночью спокойнее, если настроение «Любое»</span></span><span class="tgl${state.prefs.timeOfDay !== false ? ' on' : ''}"></span></button></div>`,
  { onClose: () => { if (changed) { renderWave(); applyWaveSettings(); } } });
  let changed = false;
  $('#wsReset', s.el).onclick = () => {
    Object.assign(state.wave, WAVE_DEFAULTS); changed = true; haptic('medium');
    $$('.chips[data-k]', s.el).forEach(row => $$('.chip', row).forEach(c => c.classList.toggle('active', c.dataset.v === WAVE_DEFAULTS[row.dataset.k])));
  };
  $$('.chips[data-k]', s.el).forEach(row => row.onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.wave[row.dataset.k] = b.dataset.v; changed = true; haptic();
    $$('.chip', row).forEach(c => c.classList.toggle('active', c === b));
  });
  const mix = $('#wsMix', s.el); if (mix) mix.onclick = () => { state.wave.mix = !state.wave.mix; changed = true; $('.tgl', mix).classList.toggle('on', state.wave.mix); };
  $('#wsTod', s.el).onclick = async () => { const on = state.prefs.timeOfDay === false; state.prefs = await API.setPrefs({ timeOfDay: on }); changed = true; $('#wsTod .tgl', s.el).classList.toggle('on', on); };
}

/* ================= ПОИСК ================= */
const RECENT = 'splav.recent2';
// недавние: { k: 'q', q } — запрос, { k: 'a', a } — артист, { k: 't', t } — трек
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch { return []; } };
const recentKey = r => r.k === 'q' ? 'q:' + r.q.toLowerCase() : r.k === 'a' ? 'a:' + r.a.source + r.a.id : 't:' + key(r.t);
function addRecent(item) {
  const k = recentKey(item);
  localStorage.setItem(RECENT, JSON.stringify([item, ...recent().filter(x => recentKey(x) !== k)].slice(0, 16)));
}
const search = { q: '', res: null, token: 0, timer: null, built: false };
function buildSearch() {
  const el = $('#tab-search');
  el.innerHTML = `<div class="head"><h1>Поиск</h1>${avatarBtn()}</div>
    <div class="search-wrap"><div class="search-field">${ico('search')}<input id="sIn" type="search" placeholder="Артист или трек" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"><button class="clear hidden" id="sClear" aria-label="Очистить">${ico('close')}</button></div></div>
    <div id="sRes"></div>`;
  const inp = $('#sIn', el);
  inp.addEventListener('input', () => { search.q = inp.value.trim(); $('#sClear', el).classList.toggle('hidden', !inp.value); clearTimeout(search.timer); search.timer = setTimeout(runSearch, 380); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { inp.blur(); clearTimeout(search.timer); runSearch(); } });
  $('#sClear', el).onclick = () => { inp.value = ''; search.q = ''; search.res = null; $('#sClear', el).classList.add('hidden'); renderSearchRes(); inp.focus(); };
  el.addEventListener('touchstart', e => { if (!e.target.closest('.search-field')) inp.blur(); }, { passive: true });
  search.built = true;
}
function renderSearch() { if (!search.built) buildSearch(); renderSearchRes(); }
async function runSearch() {
  const q = search.q, token = ++search.token;
  if (!q) { search.res = null; renderSearchRes(); return; }
  $('#sRes').innerHTML = '<div class="skeleton" style="height:116px;margin:6px 16px 10px"></div>' + '<div class="skeleton"></div>'.repeat(5);
  try {
    const r = await API.search(q);
    if (token !== search.token) return;
    search.res = r; addRecent({ k: 'q', q }); renderSearchRes();
  } catch (e) { if (token === search.token) $('#sRes').innerHTML = `<div class="empty">Не получилось найти: ${esc(e.message)}</div>`; }
}
function renderSearchRes() {
  const box = $('#sRes');
  if (!search.q || !search.res) {
    const r = recent();
    if (!r.length) { box.innerHTML = '<div id="disc"></div>'; renderDiscover(); return; }
    const arts = r.filter(x => x.k === 'a').slice(0, 10), trks = r.filter(x => x.k === 't').slice(0, 6), qs = r.filter(x => x.k === 'q').slice(0, 6);
    box.innerHTML = `<div class="sec-title">Недавнее<button id="rcClear">Очистить</button></div>
      ${arts.length ? `<div class="artist-row recent-artists">${arts.map((x, i) => `<div class="ar-item"><button class="ar-img" data-ra="${i}" style="background-image:${esc(cssUrl(x.a.cover))}"></button><button class="ar-play" data-rp="${i}" aria-label="Слушать ${esc(x.a.name)}">${ico('play')}</button><div class="ar-name">${esc(x.a.name)}</div></div>`).join('')}</div>` : ''}
      ${trks.length ? '<div class="list" id="rcTracks"></div>' : ''}
      ${qs.map(x => `<button class="recent-row" data-q="${esc(x.q)}">${ico('clock')}<span>${esc(x.q)}</span></button>`).join('')}
      <div id="disc"></div>`;
    renderDiscover();
    $$('[data-ra]', box).forEach(b => b.onclick = () => { const a = arts[+b.dataset.ra].a; openArtist(a.source, a.id, a.name); });
    $$('[data-rp]', box).forEach(b => b.onclick = async () => {
      const a = arts[+b.dataset.rp].a; haptic('medium'); toast(`Включаем ${a.name}…`);
      try { const d = await API.artist(a.source, a.id); const list = d.popular || []; if (list.length) playQueue(list, 0, 'list', a.name); else toast('У артиста нет доступных треков'); } catch (e) { toast(e.message); }
    });
    if (trks.length) { const list = trks.map(x => x.t); renderList($('#rcTracks', box), list, { onPlay: i => playQueue(list, i, 'list', 'Недавнее'), onMore: t => trackMenu(t) }); }
    $$('.recent-row', box).forEach(b => b.onclick = () => { const inp = $('#sIn'); inp.value = b.dataset.q; search.q = b.dataset.q; $('#sClear').classList.remove('hidden'); runSearch(); });
    $('#rcClear', box).onclick = () => { localStorage.removeItem(RECENT); renderSearchRes(); };
    return;
  }
  const { tracks = [], artists = [], locked = [] } = search.res;
  const [best, ...others] = artists;
  let html = '';
  if (best) {
    html += `<button class="artist-best" data-a="0"><div class="ab-img" style="background-image:${esc(cssUrl(best.cover))}"></div><div><div class="ab-name">${esc(best.name)}</div><div class="ab-sub">Артист${best.source === 'sc' ? ' в SoundCloud' : best.genre ? ', ' + esc(best.genre) : ''}</div></div><span class="chev">${ico('chev')}</span></button>`;
    if (others.length) html += `<div class="artist-row">${others.map((a, i) => `<button class="ar-item" data-a="${i + 1}"><div class="ar-img" style="background-image:${esc(cssUrl(a.cover))}"></div><div class="ar-name">${esc(a.name)}</div></button>`).join('')}</div>`;
  }
  html += tracks.length ? `<div class="sec-title">Треки</div><div class="list" id="sTracks"></div>` : (!best ? '<div class="empty">Ничего не нашлось. Попробуйте написать иначе</div>' : '');
  if (locked.length) html += `<div class="locked-card"><b>Ещё ${plural(locked.length, 'трек', 'трека', 'треков')} в Яндекс Музыке</b><p>Войдите в Яндекс с подпиской Плюс, чтобы слушать весь каталог.</p><button class="btn sm red" id="sLogin">Войти в Яндекс</button></div>`;
  box.innerHTML = html;
  $$('[data-a]', box).forEach(b => b.onclick = () => { const a = artists[+b.dataset.a]; haptic(); addRecent({ k: 'a', a: { source: a.source, id: a.id, name: a.name, cover: a.cover } }); openArtist(a.source, a.id, a.name); });
  if (tracks.length) renderList($('#sTracks', box), tracks, { onPlay: i => { addRecent({ k: 't', t: tracks[i] }); playQueue(tracks, i, 'list', 'Поиск'); }, onMore: t => trackMenu(t) });
  const l = $('#sLogin', box); if (l) l.onclick = () => login('ya');
}

/* ---------- новинки, новое у ваших артистов, чарт ---------- */
const disc = { data: null, at: 0, loading: null };
function myArtists() {
  const cnt = new Map();
  for (const t of [...state.likes.ya, ...state.likes.sc]) {
    const a = t.artists && t.artists[0]; if (!a || !(a.source === 'ya' || a.source === 'sc')) continue;
    const k = a.source + ':' + a.id; const c = cnt.get(k) || { source: a.source, id: String(a.id), name: a.name, n: 0 }; c.n++; cnt.set(k, c);
  }
  return [...cnt.values()].sort((a, b) => b.n - a.n).slice(0, 14).map(({ n, ...a }) => a);
}
async function loadDiscover() {
  if (disc.data && Date.now() - disc.at < 3600e3) return disc.data;
  disc.loading ||= API.discover({ artists: myArtists() }).then(d => { disc.data = d; disc.at = Date.now(); return d; }).finally(() => { disc.loading = null; });
  return disc.loading;
}
const relSub = x => x.kind === 'album' ? [x.artist, TYPES[String(x.type || '').toLowerCase()] || ''].filter(Boolean).join(', ') : x.artist;
function openRelease(x) { haptic(); if (x.kind === 'album') openAlbum(x.source, x.id); else playQueue([x.track], 0, 'list', 'Новинки'); }
async function renderDiscover() {
  const box = $('#disc'); if (!box) return;
  if (!disc.data) box.innerHTML = '<div class="sec-title">Новинки недели</div><div class="cards">' + '<div class="card"><div class="c-img skeleton" style="margin:0"></div></div>'.repeat(3) + '</div>';
  let d; try { d = await loadDiscover(); } catch { box.innerHTML = ''; return; }
  if (!$('#disc') || state.tab !== 'search' || search.q) return;
  const { releases = [], fresh = [], chart = [] } = d;
  box.innerHTML = `
    ${releases.length ? `<div class="sec-title">Новинки недели<span class="sec-note">обновятся в пятницу</span></div><div class="cards" id="dRel">${releases.map((x, i) => `<button class="card" data-i="${i}"><div class="c-img" style="background-image:${esc(cssUrl(x.cover))}"></div><div class="c-title">${esc(x.title)}</div><div class="c-sub">${esc(relSub(x))}</div></button>`).join('')}</div>` : ''}
    ${fresh.length ? `<div class="sec-title">Новое у ваших артистов</div><div class="cards" id="dFresh">${fresh.map((f, i) => `<button class="fresh-card" data-i="${i}"><div class="fc-art" style="background-image:${esc(cssUrl(f.artist.cover))}"></div><div class="fc-rel" style="background-image:${esc(cssUrl(f.release.cover))}"></div><div class="fc-name">${esc(f.artist.name)}</div><div class="fc-title">${esc(f.release.title)}</div><span class="fc-play">${ico('play')}</span></button>`).join('')}</div>` : ''}
    ${chart.length ? `<div class="sec-title">Чарт<span class="sec-note">обновится в четверг</span><button id="dAll">Весь чарт</button></div><div class="list" id="dChart"></div>` : ''}`;
  $$('#dRel .card', box).forEach(b => b.onclick = () => openRelease(releases[+b.dataset.i]));
  $$('#dFresh .fresh-card', box).forEach(b => b.onclick = e => {
    const f = fresh[+b.dataset.i];
    if (e.target.closest('.fc-play') || e.target.closest('.fc-rel')) openRelease(f.release); else openArtist(f.artist.source, f.artist.id, f.artist.name);
  });
  if (chart.length) {
    const top = chart.slice(0, 10);
    renderList($('#dChart', box), top, { onPlay: i => playQueue(chart, i, 'list', 'Чарт'), onMore: t => trackMenu(t), numbered: false });
    $$('#dChart .trk', box).forEach((row, i) => row.insertAdjacentHTML('afterbegin', `<span class="chart-pos">${i + 1}</span>`));
    $('#dAll', box).onclick = () => push('Чарт', (pg, page, setTitle) => {
      setTitle('Чарт');
      pg.innerHTML = '<div class="head" style="position:static;padding-top:4px"><h1>Чарт</h1></div><div class="note" style="padding-top:0">Обновляется по четвергам</div><div class="list" id="chAll" style="margin-top:10px"></div>';
      renderList($('#chAll', pg), chart, { onPlay: i => playQueue(chart, i, 'list', 'Чарт'), onMore: t => trackMenu(t) });
      $$('#chAll .trk', pg).forEach((row, i) => row.insertAdjacentHTML('afterbegin', `<span class="chart-pos">${i + 1}</span>`));
    });
  }
}

/* ================= МОЯ МУЗЫКА ================= */
const lib = { f: 'all', text: '' };
function libAll() {
  const L = state.likes;
  const map = { ya: L.ya, sc: L.sc, zv: L.zv || [], guest: L.guest };
  if (lib.f !== 'all') return map[lib.f] || [];
  const seen = new Set(); const out = [];
  for (const t of [...L.ya, ...(L.zv || []), ...L.sc, ...L.guest]) { const k = key(t); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}
function renderLibrary() {
  const el = $('#tab-library');
  const A = state.accounts, L = state.likes;
  const tabs = [['all', 'Все'], ...(A.ya ? [['ya', 'Яндекс']] : []), ...(A.zv ? [['zv', 'Звук']] : []), ...(A.sc ? [['sc', 'SoundCloud']] : []), ...(L.guest.length ? [['guest', 'Сохранённые']] : []), ['playlists', 'Плейлисты']];
  if (!tabs.some(t => t[0] === lib.f)) lib.f = 'all';
  const isPl = lib.f === 'playlists';
  const all = isPl ? [] : libAll();
  const q = lib.text.toLowerCase();
  const list = q ? all.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(q)) : all;
  el.innerHTML = `<div class="head"><h1>Моя музыка</h1>${avatarBtn()}</div>
    <button class="wr-card" id="wrCard"><span><b>Итоги ${MONTHS_IN[new Date().getMonth()]}</b><small id="wrMini">Ваши артисты и треки за месяц</small></span>${ico('chev')}</button>
    <div class="lib-tools"><div class="chips" id="libTabs">${tabs.map(([k, n]) => `<button class="chip${lib.f === k ? ' active' : ''}" data-f="${k}">${n}</button>`).join('')}</div></div>
    ${isPl ? '<div id="plBox"></div>' : `
      ${all.length ? `<div class="btn-row" style="margin-top:10px"><button class="btn primary" id="libPlay">${ico('play', 'fillsvg')}Слушать</button><button class="btn" id="libShuf">${ico('shuffle')}Вперемешку</button></div>
      <div class="lib-filter"><div class="search-field">${ico('search')}<input id="libQ" type="search" placeholder="Найти в моей музыке" value="${esc(lib.text)}" autocomplete="off" spellcheck="false"></div></div>` : ''}
      <div class="list" id="libList" style="margin-top:6px"></div>`}`;
  $$('#libTabs .chip', el).forEach(b => b.onclick = () => { lib.f = b.dataset.f; haptic(); renderLibrary(); });
  $('#wrCard', el).onclick = () => openWrapped();
  API.wrapped().then(w => { const m = $('#wrMini'); if (m && w.minutes) m.textContent = `${plural(w.minutes, 'минута', 'минуты', 'минут')} музыки${w.topArtists[0] ? ', чаще всего ' + w.topArtists[0].name : ''}`; }).catch(() => {});
  if (isPl) { renderPlaylists($('#plBox', el)); return; }
  const empty = state.guest ? '<b>Здесь будут ваши лайки</b>Нажмите на сердце в плеере, или войдите в Яндекс, Звук или SoundCloud в профиле' : '<b>Пока пусто</b>Лайкайте треки, и они появятся здесь';
  renderList($('#libList', el), list, { onPlay: i => playQueue(list, i, 'list', 'Моя музыка'), onMore: t => trackMenu(t), empty, noLiked: true });
  const p = $('#libPlay', el); if (p) p.onclick = () => playQueue(list, 0, 'list', 'Моя музыка');
  const sh = $('#libShuf', el); if (sh) sh.onclick = () => { const s = [...list].sort(() => Math.random() - 0.5); playQueue(s, 0, 'list', 'Моя музыка'); };
  const qi = $('#libQ', el); if (qi) qi.oninput = () => { lib.text = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const pos = qi.selectionStart; renderLibrary(); const n = $('#libQ'); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
}
document.addEventListener('likes-changed', () => { if (state.tab === 'library') renderLibrary(); });
export async function loadLikes() {
  try {
    const r = await API.likes();
    state.likes = { ya: r.ya || [], sc: r.sc || [], zv: r.zv || [], guest: r.guest || [] };
    state.liked = new Set([...state.likes.ya, ...state.likes.sc, ...state.likes.zv, ...state.likes.guest].map(key));
    for (const [k, n] of [['yaError', 'Яндекс'], ['scError', 'SoundCloud'], ['zvError', 'Звук']]) if (r[k]) toast(n + ': ' + r[k]);
  } catch (e) { toast(e.message); }
  if (state.tab === 'library') renderLibrary();
  if (state.tab === 'wave') renderWave();
}

/* ---------- плейлисты ---------- */
async function loadPlaylists() { try { state.playlists = await API.playlists(); } catch { state.playlists = []; } }
async function renderPlaylists(box) {
  await loadPlaylists();
  const cover = pl => { const c = pl.cover || ((pl.tracks || []).find(t => t.cover) || {}).cover; return c ? `style="background-image:${esc(cssUrl(c))}"` : ''; };
  box.innerHTML = `<div class="btn-row" style="margin-top:10px"><button class="btn primary" id="plNew">${ico('plus')}Новый</button><button class="btn" id="plImp">${ico('link')}По ссылке</button></div>
    ${state.playlists.length ? `<div class="grid2" style="margin-top:18px">${state.playlists.map((pl, i) => `<button class="card" data-i="${i}"><div class="c-img" ${cover(pl)}></div><div class="c-title">${esc(pl.name)}</div><div class="c-sub">${plural((pl.tracks || []).length, 'трек', 'трека', 'треков')}</div></button>`).join('')}</div>`
      : '<div class="empty"><b>Плейлистов пока нет</b>Соберите свой из треков разных сервисов или вставьте ссылку на плейлист Яндекса или SoundCloud</div>'}`;
  $('#plNew', box).onclick = async () => { const name = await prompt('Новый плейлист', { placeholder: 'Например, «Ночная дорога»', ok: 'Создать' }); if (!name) return; await API.playlistSave({ name, tracks: [] }); renderLibrary(); };
  $('#plImp', box).onclick = async () => {
    const link = await prompt('Ссылка на плейлист', { placeholder: 'music.yandex.ru/… или soundcloud.com/…', ok: 'Импортировать' }); if (!link) return;
    toast('Импортируем…');
    try { const pl = await API.importPlaylist(link); toast(`Готово: «${pl.name}», ${plural(pl.tracks.length, 'трек', 'трека', 'треков')}`); renderLibrary(); } catch (e) { toast('Не получилось: ' + e.message); }
  };
  $$('.card', box).forEach(c => c.onclick = () => openPlaylist(state.playlists[+c.dataset.i].id));
}
function openPlaylist(id) {
  push('', (pg, page, setTitle) => {
    const draw = () => {
      const pl = state.playlists.find(p => p.id === id); if (!pl) { pop(); return; }
      setTitle(pl.name);
      const tracks = pl.tracks || [];
      const c = pl.cover || (tracks.find(t => t.cover) || {}).cover;
      pg.innerHTML = `<div class="alb-head"><div class="alb-cover" style="background-image:${esc(cssUrl(c))}"></div><div class="alb-title">${esc(pl.name)}</div><div class="alb-meta">${plural(tracks.length, 'трек', 'трека', 'треков')}</div></div>
        <div class="actions"><button class="btn primary" id="pp">${ico('play', 'fillsvg')}Слушать</button><button class="round" id="ps" aria-label="Вперемешку">${ico('shuffle')}</button><button class="round" id="pm" aria-label="Ещё">${ico('more')}</button></div>
        <div class="list" id="pt" style="margin-top:10px"></div>`;
      renderList($('#pt', pg), tracks, { onPlay: i => playQueue(tracks, i, 'list', pl.name), onMore: t => trackMenu(t, { playlistId: id, onChange: async () => { await loadPlaylists(); draw(); } }), empty: 'Добавляйте треки через меню трека: «В плейлист»' });
      $('#pp', pg).onclick = () => tracks.length && playQueue(tracks, 0, 'list', pl.name);
      $('#ps', pg).onclick = () => { const s = [...tracks].sort(() => Math.random() - 0.5); s.length && playQueue(s, 0, 'list', pl.name); };
      $('#pm', pg).onclick = () => actions(`<div class="sh-head"><div class="sh-title">${esc(pl.name)}</div></div>`, [
        ['lyrics', 'Переименовать', async () => { const n = await prompt('Название плейлиста', { value: pl.name }); if (!n) return; await API.playlistSave({ ...pl, name: n }); await loadPlaylists(); draw(); }],
        ['trash', 'Удалить плейлист', async () => { await API.playlistDelete(id); await loadPlaylists(); pop(); if (state.tab === 'library') renderLibrary(); toast('Плейлист удалён'); }, { danger: true }],
      ]);
    };
    draw();
  });
}
async function pickPlaylist(t) {
  await loadPlaylists();
  const items = [['plus', 'Новый плейлист', async () => { const name = await prompt('Новый плейлист', { ok: 'Создать' }); if (!name) return; await API.playlistSave({ name, tracks: [t] }); toast(`Создан «${name}»`); }],
    ...state.playlists.map(pl => ['list', pl.name, async () => {
      if ((pl.tracks || []).some(x => key(x) === key(t))) { toast('Этот трек уже в плейлисте'); return; }
      await API.playlistSave({ ...pl, tracks: [...(pl.tracks || []), t] }); toast(`Добавлено в «${pl.name}»`);
    }])];
  actions(`<div class="sh-head"><div class="sh-title">В плейлист</div></div>`, items);
}

/* ================= ИТОГИ МЕСЯЦА ================= */
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_IN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function openWrapped() {
  const now = new Date(); let y = now.getFullYear(), m = now.getMonth() + 1;
  push('Итоги', (pg, page, setTitle) => {
    const draw = async () => {
      setTitle(`Итоги: ${MONTHS[m - 1]}`);
      pg.innerHTML = `<div class="wr-head"><button class="icon-btn" id="wrPrev" aria-label="Прошлый месяц">${ico('back')}</button><div class="wr-month">${MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1)} ${y}</div><button class="icon-btn" id="wrNext" aria-label="Следующий месяц" ${y === now.getFullYear() && m === now.getMonth() + 1 ? 'disabled style="opacity:.25"' : ''}>${ico('chev')}</button></div><div class="skeleton" style="height:180px;margin:0 16px"></div>`;
      $('#wrPrev', pg).onclick = () => { m--; if (m < 1) { m = 12; y--; } draw(); };
      $('#wrNext', pg).onclick = () => { if (y === now.getFullYear() && m === now.getMonth() + 1) return; m++; if (m > 12) { m = 1; y++; } draw(); };
      let w; try { w = await API.wrapped(`${y}-${m}`); } catch (e) { pg.querySelector('.skeleton').outerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      const body = !w.plays ? `<div class="empty"><b>В этом месяце пока тихо</b>Слушайте музыку, и здесь появятся ваши любимые артисты и треки</div>` : `
        <div class="wr-hero"><div class="wr-big">${w.minutes.toLocaleString('ru-RU')}</div><div class="wr-cap">${plural(w.minutes, 'минута', 'минуты', 'минут').replace(/^[\d\s]+/, '')} музыки</div>
          <div class="wr-stats"><span><b>${w.plays}</b>прослушиваний</span><span><b>${w.uniqueArtists}</b>артистов</span><span><b>${w.uniqueTracks}</b>треков</span></div></div>
        <div class="sec-title">Артисты месяца</div>
        <div class="wr-list">${w.topArtists.map((a, i) => `<div class="wr-row"><span class="wr-n">${i + 1}</span><div class="wr-cv round" style="background-image:${esc(cssUrl(a.cover))}"></div><div class="tm"><div class="tt">${esc(a.name)}</div><div class="ta"><span>${plural(a.plays, 'прослушивание', 'прослушивания', 'прослушиваний')}</span></div></div></div>`).join('')}</div>
        <div class="sec-title">Треки месяца</div>
        <div class="wr-list">${w.topTracks.map((t, i) => `<div class="wr-row"><span class="wr-n">${i + 1}</span><div class="wr-cv" style="background-image:${esc(cssUrl(t.cover))}"></div><div class="tm"><div class="tt">${esc(t.title)}</div><div class="ta"><span>${esc(t.artist)}, ${plural(t.plays, 'раз', 'раза', 'раз')}</span></div></div></div>`).join('')}</div>
        <div style="padding:20px"><button class="btn primary wide" id="wrShare">${ico('send')}Поделиться в сторис</button></div>`;
      pg.querySelector('.skeleton').outerHTML = body;
      const sh = $('#wrShare', pg); if (sh) sh.onclick = () => shareWrapped(w);
    };
    draw();
  });
}
// картинка 1080×1920 для сторис: рисуем сами, без внешних картинок, чтобы холст можно было сохранить
async function shareWrapped(w) {
  haptic('medium');
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const g = c.getContext('2d');
  await document.fonts.ready.catch(() => {});
  const bg = g.createLinearGradient(0, 0, 1080, 1920); bg.addColorStop(0, '#2a0610'); bg.addColorStop(.45, '#0e0e12'); bg.addColorStop(1, '#060608');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1920);
  const glow = g.createRadialGradient(780, 520, 40, 780, 520, 620); glow.addColorStop(0, 'rgba(209,42,63,.75)'); glow.addColorStop(1, 'rgba(209,42,63,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 1080, 1300);
  g.fillStyle = '#ecebee'; g.textBaseline = 'alphabetic';
  g.font = '800 46px Unbounded'; g.fillText('СПЛАВ', 90, 170);
  g.font = '700 46px Manrope'; g.fillStyle = 'rgba(236,235,238,.7)'; g.fillText(`Итоги: ${MONTHS[w.month - 1]} ${w.year}`, 90, 250);
  g.fillStyle = '#ecebee'; g.font = '800 230px Unbounded'; g.fillText(w.minutes.toLocaleString('ru-RU'), 80, 640);
  g.font = '700 56px Manrope'; g.fillStyle = 'rgba(236,235,238,.8)'; g.fillText(plural(w.minutes, 'минута', 'минуты', 'минут').replace(/^[\d\s]+/, '') + ' музыки', 92, 730);
  const fit = (txt, max, font) => { g.font = font; let t = txt; while (g.measureText(t).width > max && t.length > 1) t = t.slice(0, -2); return t === txt ? t : t + '…'; };
  let yy = 900;
  g.fillStyle = '#d12a3f'; g.font = '800 40px Manrope'; g.fillText('АРТИСТЫ МЕСЯЦА', 92, yy); yy += 90;
  w.topArtists.slice(0, 5).forEach((a, i) => { g.fillStyle = 'rgba(236,235,238,.45)'; g.font = '800 60px Unbounded'; g.fillText(String(i + 1), 92, yy); g.fillStyle = '#ecebee'; g.fillText(fit(a.name, 820, '800 60px Unbounded'), 170, yy); yy += 92; });
  yy += 40; g.fillStyle = '#d12a3f'; g.font = '800 40px Manrope'; g.fillText('ТРЕК МЕСЯЦА', 92, yy); yy += 80;
  const tt = w.topTracks[0]; if (tt) { g.fillStyle = '#ecebee'; g.fillText(fit(tt.title, 900, '800 58px Manrope'), 92, yy); yy += 66; g.fillStyle = 'rgba(236,235,238,.6)'; g.fillText(fit(tt.artist, 900, '600 46px Manrope'), 92, yy); }
  g.fillStyle = 'rgba(236,235,238,.4)'; g.font = '700 38px Manrope'; g.fillText(`${w.plays} прослушиваний, ${w.uniqueArtists} артистов`, 92, 1820);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], `splav-${w.year}-${w.month}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Мои итоги в Сплаве' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  // запасной путь: показать картинку — её можно сохранить долгим нажатием
  const url = URL.createObjectURL(blob);
  sheet(`<div class="sh-head"><div class="sh-title">Картинка для сторис</div></div><div class="sh-body sh-pad"><img src="${url}" style="width:100%;border-radius:16px;-webkit-touch-callout:default" alt="Итоги месяца"><div class="note" style="padding:12px 0">Зажмите картинку и выберите «Сохранить в Фото»</div></div>`, { full: true });
}

/* ================= МЕНЮ ТРЕКА ================= */
export function trackMenu(t, opts = {}) {
  const a = t.artists && t.artists[0];
  const canArtist = a && (a.source === 'ya' || a.source === 'sc');
  const liked = state.liked.has(key(t));
  actions(trackHead(t), [
    ...(opts.inPlayer ? [] : [['next1', 'Играть следующим', () => queueNext(t)], ['addq', 'В конец очереди', () => queueEnd(t)], null]),
    [liked ? 'heart' : 'heart', liked ? 'Убрать из «Моей музыки»' : 'Нравится', () => toggleLike(t)],
    ['send', 'Отправить другу', () => pickFriend(t)],
    ['list', 'Добавить в плейлист', () => pickPlaylist(t)],
    ...(opts.playlistId ? [['trash', 'Убрать из плейлиста', async () => { const pl = state.playlists.find(p => p.id === opts.playlistId); if (!pl) return; await API.playlistSave({ ...pl, tracks: pl.tracks.filter(x => key(x) !== key(t)) }); opts.onChange && opts.onChange(); }]] : []),
    null,
    ['radio', 'Волна по треку', () => startStation(stationFromTrack(t))],
    ...(t.artist ? [['radio', 'Волна по артисту', () => startStation(stationFromArtist(a, (t.artist || '').split(',')[0].trim()))]] : []),
    ...(canArtist ? [['user', 'Перейти к артисту', () => { closePlayer(); openArtist(a.source, a.id, a.name); }]] : []),
    ...(t.albumId && t.source === 'ya' ? [['album', 'Перейти к альбому', () => { closePlayer(); openAlbum('ya', t.albumId); }]] : []),
    null, ['ban', 'Не нравится, не рекомендовать', () => dislike(t), { danger: true }],
  ]);
}

const TYPES = { album: 'Альбом', single: 'Сингл', compilation: 'Сборник', ep: 'EP', playlist: 'Плейлист', podcast: 'Подкаст' };
const typeLabel = t => TYPES[String(t || '').toLowerCase()] || '';

/* ================= АРТИСТ ================= */
export function openArtist(source, id, name = '') {
  push(name, async (pg, page, setTitle) => {
    pg.innerHTML = `<div class="hero"><div class="hero-img"></div><div class="hero-text"><div class="hero-name">${esc(name)}</div></div></div><div style="height:16px"></div>${'<div class="skeleton"></div>'.repeat(5)}`;
    let a;
    try { a = await API.artist(source, id); } catch (e) { pg.innerHTML = `<div class="empty" style="margin-top:80px">Не удалось открыть артиста: ${esc(e.message)}</div>`; return; }
    setTitle(a.name);
    const popular = a.popular || [];
    const lbl = a.listenersLabel || 'слушателей за месяц';
    pg.innerHTML = `<div class="hero"><div class="hero-img" style="background-image:${esc(cssUrl(a.cover))}"></div><div class="hero-text"><div class="hero-name">${esc(a.name)}</div>${a.listeners ? `<div class="hero-sub">${Number(a.listeners).toLocaleString('ru-RU')} ${lbl}</div>` : ''}</div></div>
      <div class="actions"><button class="btn primary" id="arPlay">${ico('play', 'fillsvg')}Слушать</button><button class="round" id="arWave" aria-label="Волна по артисту">${ico('radio')}</button>${source === 'ya' && state.accounts.ya ? `<button class="round${a.liked ? ' on' : ''}" id="arLike" aria-label="Нравится">${ico('heart')}</button>` : ''}</div>
      ${popular.length ? `<div class="sec-title">Популярное<button id="arAll">Все треки</button></div><div class="list" id="arTop"></div>` : ''}
      ${(a.albums || []).length ? `<div class="sec-title">Альбомы и релизы</div><div class="cards">${a.albums.map((al, i) => `<button class="card" data-i="${i}"><div class="c-img" style="background-image:${esc(cssUrl(al.cover))}"></div><div class="c-title">${esc(al.title)}</div><div class="c-sub">${esc([al.year, typeLabel(al.type)].filter(Boolean).join(', '))}</div></button>`).join('')}</div>` : ''}`;
    if (popular.length) renderList($('#arTop', pg), popular.slice(0, 10), { onPlay: i => playQueue(popular, i, 'list', a.name), onMore: t => trackMenu(t), noSource: true });
    $('#arPlay', pg).onclick = () => popular.length && playQueue(popular, 0, 'list', a.name);
    $('#arWave', pg).onclick = () => startStation(stationFromArtist({ source, id, name: a.name }, a.name));
    const lk = $('#arLike', pg); if (lk) lk.onclick = async () => { const on = !lk.classList.contains('on'); lk.classList.toggle('on', on); haptic(); try { await API.likeArtist(id, on); } catch (e) { lk.classList.toggle('on', !on); toast(e.message); } };
    const all = $('#arAll', pg); if (all) all.onclick = () => openArtistTracks(source, id, a.name);
    $$('.card', pg).forEach(c => c.onclick = () => { const al = a.albums[+c.dataset.i]; openAlbum(source, al.id); });
  });
}
function openArtistTracks(source, id, name) {
  push(name, async (pg, page, setTitle) => {
    setTitle(name);
    pg.innerHTML = `<div class="head" style="position:static;padding-top:6px"><h1>Все треки</h1></div>${'<div class="skeleton"></div>'.repeat(8)}`;
    try {
      const tracks = await API.artistTracks(source, id);
      pg.innerHTML = `<div class="head" style="position:static;padding-top:6px"><h1>Все треки</h1></div><div class="note" style="padding-top:0">${esc(name)}, ${plural(tracks.length, 'трек', 'трека', 'треков')}</div><div class="list" id="atl" style="margin-top:10px"></div>`;
      renderList($('#atl', pg), tracks, { onPlay: i => playQueue(tracks, i, 'list', name), onMore: t => trackMenu(t), noSource: true });
    } catch (e) { pg.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  });
}

/* ================= АЛЬБОМ ================= */
export function openAlbum(source, id) {
  push('', async (pg, page, setTitle) => {
    pg.innerHTML = `<div class="alb-head"><div class="alb-cover"></div></div>${'<div class="skeleton"></div>'.repeat(6)}`;
    let al;
    try { al = await API.album(source, id); } catch (e) { pg.innerHTML = `<div class="empty" style="margin-top:80px">${esc(e.message)}</div>`; return; }
    setTitle(al.title);
    const tracks = al.tracks || [];
    const ar = (al.artists || [])[0];
    pg.innerHTML = `<div class="alb-head"><div class="alb-cover" style="background-image:${esc(cssUrl(al.cover))}"></div><div class="alb-title">${esc(al.title)}</div>${ar ? `<button class="alb-artist" id="alAr">${esc((al.artists || []).map(x => x.name).join(', '))}</button>` : ''}<div class="alb-meta">${esc([typeLabel(al.type), al.year || '', plural(tracks.length, 'трек', 'трека', 'треков')].filter(Boolean).join(', '))}</div></div>
      <div class="actions"><button class="btn primary" id="alPlay">${ico('play', 'fillsvg')}Слушать</button><button class="round" id="alShuf" aria-label="Вперемешку">${ico('shuffle')}</button></div>
      <div class="list" id="alT" style="margin-top:10px"></div>`;
    renderList($('#alT', pg), tracks, { onPlay: i => playQueue(tracks, i, 'list', al.title), onMore: t => trackMenu(t), numbered: true });
    $('#alPlay', pg).onclick = () => tracks.length && playQueue(tracks, 0, 'list', al.title);
    $('#alShuf', pg).onclick = () => { const s = [...tracks].sort(() => Math.random() - 0.5); s.length && playQueue(s, 0, 'list', al.title); };
    const b = $('#alAr', pg); if (b) b.onclick = () => openArtist(ar.source, ar.id, ar.name);
  });
}

/* ================= ПРОФИЛЬ И ВХОД ================= */
const SERVICES = [
  ['ya', 'Яндекс Музыка', 'Я', '#ffcc00', '#000', 'Весь каталог и «Моя волна». Нужна подписка Плюс'],
  ['zv', 'Звук', 'З', '#7b4dff', '#fff', 'Каталог Звука и ваша коллекция'],
  ['sc', 'SoundCloud', 'SC', '#ff5500', '#fff', 'Ваши лайки и подписки. Без входа SoundCloud тоже играет'],
];
export async function refreshState() {
  const s = await API.state();
  state.accounts = { ya: s.ya, sc: s.sc, zv: s.zv };
  state.guest = !!s.guest; state.prefs = s.prefs || {}; state.keys = s.keys || {}; state.keyValues = s.keyValues || {};
  if (s.waveSettings) state.wave = { ...state.wave, ...s.waveSettings };
  if (s.scExpired) toast('Вход в SoundCloud устарел. Войдите заново в профиле');
  return s;
}
export function askLogin(service) {
  const s = SERVICES.find(x => x[0] === service) || SERVICES[0];
  actions(`<div class="sh-head"><div class="sh-t"><b>Этот трек из ${s[1] === 'Яндекс Музыка' ? 'Яндекс Музыки' : s[1]}</b><span>Войдите, чтобы слушать его целиком</span></div></div>`, [['user', 'Войти в ' + (s[0] === 'ya' ? 'Яндекс' : s[1]), () => login(s[0])]]);
}
export async function login(service) {
  try {
    await API.login(service);
    toast('Готово, вход выполнен');
    await refreshState(); await loadLikes(); rerenderAll();
    return true;
  } catch (e) { if (!/отмен/i.test(e.message)) toast(e.message); return false; }
}
let profileSheet = null;
export function openProfile() {
  const A = state.accounts;
  const acc = SERVICES.map(([k, name, logo, bg, fg, hint]) => `<div class="acc"><div class="acc-logo" style="background:${bg};color:${fg}">${logo}</div><div class="acc-t"><b>${name}</b>${A[k] ? `<span class="ok">Подключено${A[k].name ? ': ' + esc(A[k].name) : ''}</span>` : `<span>${hint}</span>`}</div>${A[k] ? `<button class="btn sm" data-out="${k}">Выйти</button>` : `<button class="btn sm red" data-in="${k}">Войти</button>`}</div>`).join('');
  profileSheet = sheet(`<div class="sh-head"><div class="sh-title">Профиль</div></div><div class="sh-body">
    <div id="updBox"></div>
    <div class="g-title">Музыкальные сервисы</div><div class="group">${acc}</div>
    ${state.guest ? '<div class="note" style="padding:0 24px 14px">Без входа Сплав играет независимую музыку из SoundCloud, Audius и Jamendo, а лайки хранит на телефоне.</div>' : ''}
    <div class="g-title">Яндекс без окна входа</div><div class="group"><button class="act" id="yaTok">${ico('link')}<span>Вставить токен Яндекса</span></button></div>
    <div class="g-title">Приложение</div><div class="group"><div class="acc"><div class="acc-t"><b>Сплав для iPhone</b><span id="verLbl">Версия…</span></div><button class="btn sm" id="updChk">Проверить</button></div></div>
    <div style="height:10px"></div></div>`, { full: true, onClose: () => { profileSheet = null; } });
  const el = profileSheet.el;
  $$('[data-in]', el).forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'Входим…'; const ok = await login(b.dataset.in); if (profileSheet) { profileSheet.close(); if (ok) openProfile(); } });
  $$('[data-out]', el).forEach(b => b.onclick = () => actions('', [['logout', 'Выйти из ' + SERVICES.find(s => s[0] === b.dataset.out)[1], async () => { await API.logout(b.dataset.out); await refreshState(); await loadLikes(); rerenderAll(); profileSheet && profileSheet.close(); openProfile(); }, { danger: true }]]));
  $('#yaTok', el).onclick = async () => { const t = await prompt('Токен Яндекс Музыки', { placeholder: 'y0_…', ok: 'Подключить' }); if (!t) return; try { await API.setYaToken(t); await refreshState(); await loadLikes(); rerenderAll(); toast('Яндекс подключён'); profileSheet && profileSheet.close(); } catch (e) { toast('Токен не подошёл: ' + e.message); } };
  import('./main.js').then(m => m.versionLabel()).then(v => { const l = $('#verLbl', el); if (l) l.textContent = 'Версия ' + v + '. Обновляется сама'; }).catch(() => {});
  $('#updChk', el).onclick = async () => { const { checkUpdates } = await import('./main.js'); checkUpdates(true); };
  import('./main.js').then(m => m.renderUpdate($('#updBox', el)));
}
export function rerenderAll() {
  const r = { wave: renderWave, search: renderSearch, library: renderLibrary }[state.tab];
  r && r();
  // аватар во всех шапках
  $$('[data-profile]').forEach(b => { const A = state.accounts; const n = (A.ya && A.ya.name) || (A.zv && A.zv.name) || (A.sc && A.sc.name) || ''; b.innerHTML = n ? esc(n[0].toUpperCase()) : ico('user'); });
}

onTab('wave', renderWave);
onTab('search', renderSearch);
onTab('library', renderLibrary);
export { openPlayer, SOURCE };
