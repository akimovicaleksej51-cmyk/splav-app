// Экраны телевизора: Главная (волна, чарт, новинки, жанры), Чарт, Моя музыка, Поиск, Аккаунты, альбомы
import { API } from '../../mobile/app/api.js';
import { $, $$, esc, cssUrl, bigCover, key, ico, toast, state, plural, SOURCE, focus, focusFirst, remember, menu } from './lib.js';
import { playQueue, startWave, togglePlay, next, toggleLike, dislike, openPlayer, isPlaying, effectiveWave } from './player.js';

/* ---------- боковое меню ---------- */
const TABS = [['wave', 'wave', 'Главная'], ['chart', 'chart', 'Чарт'], ['library', 'heart', 'Моя музыка'], ['search', 'search', 'Поиск'], ['accounts', 'user', 'Аккаунты']];
$('#side').innerHTML = `<div class="logo"><i></i><span>СПЛАВ</span></div>${TABS.map(([k, i, n]) => `<button class="f tab" data-tab="${k}">${ico(i)}<span>${n}</span></button>`).join('')}`;
$$('#side .tab').forEach(b => {
  b.onclick = () => { showTab(b.dataset.tab); focusFirst($('#main')); };
  b.addEventListener('focus', () => document.body.classList.add('side-open'));
  b.addEventListener('blur', () => setTimeout(() => { if (!document.activeElement || !document.activeElement.closest('#side')) document.body.classList.remove('side-open'); }, 0));
});
const renderers = {};
let sub = null;   // открытая поверх вкладки страница (альбом)
let subReturn = null;   // куда вернуть фокус, когда страницу закроют
export function showTab(name) {
  state.tab = name; sub = null;
  document.body.dataset.tab = name;
  $$('#side .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  remember('side', $(`#side .tab[data-tab="${name}"]`));
  $('#main').scrollTop = 0;
  renderers[name]();
}
export const rerender = () => (sub ? sub() : renderers[state.tab]());
// «Назад» со страницы альбома возвращает на вкладку
export function closeSub() {
  if (!sub) return false;
  const sel = subReturn; subReturn = null;
  showTab(state.tab); focusFirst($('#main'));
  // карусели дорисовываются чуть позже — ждём их и возвращаемся на карточку
  if (sel) { let n = 0; const t = setInterval(() => { const el = $(sel); if (el) { focus(el); clearInterval(t); } else if (++n > 20) clearInterval(t); }, 50); }
  return true;
}

/* ---------- строки треков ---------- */
const eq = '<span class="eq"><i></i><i></i><i></i></span>';
const dur = s => s ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '';
const moveBadge = t => t.move === 'up' ? `<span class="mv up">${ico('up')}</span>` : t.move === 'down' ? `<span class="mv down">${ico('down')}</span>` : t.move === 'new' ? '<span class="mv new">NEW</span>' : '<span class="mv"></span>';
const trackRow = (t, i, ranked) => `<div class="row${state.current && key(state.current) === key(t) ? ' now' : ''}${ranked && i < 3 ? ' top' : ''}" data-k="${esc(key(t))}">
  <button class="f r-main" data-i="${i}">${ranked ? `<span class="rank">${t.pos || i + 1}</span>${moveBadge(t)}` : ''}<div class="r-cv" style="background-image:${esc(cssUrl(t.cover))}">${eq}</div>
    <div class="r-meta"><b>${esc(t.title)}</b><span>${esc(t.artist)}${SOURCE[t.source] ? '  ·  ' + SOURCE[t.source] : ''}${t.locked ? '  ·  нужен вход' : ''}</span></div>
    <div class="r-dur">${dur(t.duration)}</div></button>
  <button class="f r-act${state.liked.has(key(t)) ? ' on' : ''}" data-like="${i}" aria-label="Нравится">${ico('heart')}</button>
  <button class="f r-act" data-more="${i}" aria-label="Ещё">${ico('radio')}</button></div>`;
// длинные списки рисуем частями, чтобы телевизор не задумывался
function renderList(box, list, { onPlay, empty = '', chunk = 60, ranked = false } = {}) {
  let shown = 0;
  const more = () => {
    const part = list.slice(shown, shown + chunk);
    const btn = $('.more', box); if (btn) btn.remove();
    box.insertAdjacentHTML('beforeend', part.map((t, j) => trackRow(t, shown + j, ranked)).join(''));
    shown += part.length;
    if (shown < list.length) {
      box.insertAdjacentHTML('beforeend', `<button class="f btn more">Показать ещё ${Math.min(chunk, list.length - shown)}</button>`);
      $('.more', box).onclick = () => { const first = shown; more(); focus($(`[data-i="${first}"]`, box)); };
    }
  };
  box.innerHTML = list.length ? '' : `<div class="empty">${empty}</div>`;
  if (list.length) more();
  box.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.i !== undefined) onPlay(+b.dataset.i);
    else if (b.dataset.like !== undefined) { const t = list[+b.dataset.like]; toggleLike(t); b.classList.toggle('on', state.liked.has(key(t))); }
    else if (b.dataset.more !== undefined) trackMenu(list[+b.dataset.more]);
  };
}
export function trackMenu(t) {
  menu(`${t.title} — ${t.artist}`, [
    ['radio', 'Волна по этому треку', () => startWave({ type: 'track', source: t.source, id: t.rawId, title: t.title, artist: (t.artist || '').split(',')[0].trim(), genre: t._genre || '', label: `по треку «${t.title}»` })],
    ['queue', 'Сыграть следующим', () => { state.queue.splice(state.qi + 1, 0, t); if (state.qi < 0) playQueue([t], 0); else toast('Сыграет следующим'); }],
    [state.liked.has(key(t)) ? 'close' : 'heart', state.liked.has(key(t)) ? 'Убрать из «Моей музыки»' : 'Добавить в «Мою музыку»', () => toggleLike(t)],
    ['ban', 'Не рекомендовать', () => dislike(t)],
  ]);
}
// подсветка играющего трека в списках и карточках
document.addEventListener('now-changed', () => {
  const k = state.current && key(state.current);
  $$('#main [data-k]').forEach(r => r.classList.toggle('now', r.dataset.k === k));
  if (state.tab === 'wave' && !sub) renderWaveNow();
});

/* ---------- новинки и чарт: грузим один раз, ядро само обновляет их раз в неделю ---------- */
const disc = { data: null, loading: null };
function loadDiscover() {
  if (disc.data) return Promise.resolve(disc.data);
  disc.loading ||= API.discover({ artists: [] }).then(d => (disc.data = d)).finally(() => { disc.loading = null; });
  return disc.loading;
}
export function resetDiscover() { disc.data = null; }

/* ================= ГЛАВНАЯ ================= */
const MOODS = [['all', 'Любое'], ['active', 'Бодрое'], ['fun', 'Весёлое'], ['calm', 'Спокойное'], ['sad', 'Грустное']];
const LANGS = [['any', 'Любой язык'], ['russian', 'Русский'], ['not-russian', 'Иностранный'], ['without-words', 'Без слов']];
const GENRES = [['rap', 'Рэп'], ['phonk', 'Фонк'], ['pop', 'Поп'], ['indie', 'Инди'], ['rock', 'Рок'], ['electronic', 'Электроника'], ['techno', 'Техно'], ['house', 'Хаус'], ['lofi', 'Лоу-фай'], ['ambient', 'Эмбиент'], ['jazz', 'Джаз'], ['classical', 'Классика'], ['rnb', 'R&B']];
renderers.wave = () => {
  const el = $('#main');
  el.innerHTML = `
    <section class="hero" data-zone="hero">
      <div class="h-art" id="hArt"><div class="orb"><i></i><i></i><i></i></div><div class="h-cv" id="hCv"></div></div>
      <div class="h-info">
        <div class="h-kicker" id="hKick"></div>
        <div class="h-title" id="hTitle"></div>
        <div class="h-sub" id="hSub"></div>
        <div class="h-ctrl">
          <button class="f btn primary big" id="hPlay" data-autofocus></button>
          <button class="f btn round" id="hNext" aria-label="Следующий">${ico('next')}</button>
          <button class="f btn round" id="hLike" data-like-now aria-label="Нравится">${ico('heart')}</button>
          <button class="f btn round" id="hBan" aria-label="Не нравится">${ico('ban')}</button>
          <button class="f btn round" id="hOpen" aria-label="Плеер и текст песни">${ico('lyrics')}</button>
        </div>
      </div>
    </section>
    <div id="discBox"></div>
    <div class="sec-title">Настроение волны</div>
    <div class="chips" data-zone="mood" id="wMood">${MOODS.map(([v, n]) => `<button class="f chip${state.wave.moodEnergy === v ? ' active' : ''}" data-v="${v}">${n}</button>`).join('')}</div>
    <div class="chips" data-zone="lang" id="wLang">${LANGS.map(([v, n]) => `<button class="f chip${state.wave.language === v ? ' active' : ''}" data-v="${v}">${n}</button>`).join('')}</div>
    <div class="sec-title">Волна по жанру</div>
    <div class="genres" data-zone="genres">${GENRES.map(([k, n], i) => `<button class="f genre${state.station && state.station.type === 'genre' && state.station.id === k ? ' on' : ''}" data-g="${k}" style="--h:${(i * 27 + 330) % 360}"><span>${n}</span></button>`).join('')}</div>
    ${state.guest ? '<div class="note">Без входа волна собирается из SoundCloud, Audius и Jamendo. Войдите в Яндекс или Звук на вкладке «Аккаунты», чтобы слушать свою «Мою волну».</div>' : ''}`;
  $('#hPlay').onclick = () => { if (state.mode === 'wave' && state.current) togglePlay(); else startWave(state.station); };
  $('#hNext').onclick = () => (state.current ? next(true) : startWave(state.station));
  $('#hLike').onclick = () => state.current && toggleLike(state.current);
  $('#hBan').onclick = () => state.current && dislike(state.current);
  $('#hOpen').onclick = () => (state.current ? openPlayer() : startWave(state.station));
  const pickChip = (box, field) => $$('.chip', box).forEach(b => b.onclick = async () => {
    state.wave[field] = b.dataset.v;
    $$('.chip', box).forEach(c => c.classList.toggle('active', c === b));
    try { await API.waveSettings(state.wave, effectiveWave()); } catch (e) { toast(e.message); }
    if (state.mode === 'wave' && state.current) { state.queue = state.queue.slice(0, state.qi + 1); toast('Волна подстроится со следующего трека'); } else startWave(state.station);
  });
  pickChip($('#wMood'), 'moodEnergy'); pickChip($('#wLang'), 'language');
  $$('.genre', el).forEach(b => b.onclick = () => {
    const name = (GENRES.find(g => g[0] === b.dataset.g) || [])[1] || b.dataset.g;
    $$('.genre', el).forEach(g => g.classList.toggle('on', g === b));
    startWave({ type: 'genre', source: 'mix', id: b.dataset.g, label: `«${name}»` });
    focus($('#hPlay'));
  });
  renderWaveNow();
  renderDiscover();
};
async function renderDiscover() {
  const box = $('#discBox'); if (!box) return;
  if (!disc.data) box.innerHTML = '<div class="sec-title">Чарт</div><div class="cards skel">' + '<div class="card-skel"></div>'.repeat(6) + '</div>';
  let d; try { d = await loadDiscover(); } catch { box.innerHTML = ''; return; }
  if (!$('#discBox') || state.tab !== 'wave' || sub) return;
  const { chart = [], releases = [] } = d;
  box.innerHTML = `${chart.length ? `<div class="sec-title">Чарт недели<button class="f link" id="chAll">Весь чарт</button></div>
      <div class="cards" data-zone="chartrow">${chart.slice(0, 10).map((t, i) => `<button class="f tcard ranked" data-c="${i}" data-k="${esc(key(t))}"><span class="big-n">${i + 1}</span><i class="tc-cv" style="background-image:${esc(cssUrl(bigCover(t.cover)))}">${eq}</i><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></button>`).join('')}</div>` : ''}
    ${releases.length ? `<div class="sec-title">Новинки недели</div>
      <div class="cards" data-zone="relrow">${releases.slice(0, 16).map((x, i) => `<button class="f tcard" data-r="${i}"><i class="tc-cv" style="background-image:${esc(cssUrl(bigCover(x.cover)))}"></i><b>${esc(x.title)}</b><small>${esc(x.artist || (x.track && x.track.artist) || '')}</small></button>`).join('')}</div>` : ''}`;
  const k = state.current && key(state.current);
  $$('[data-k]', box).forEach(c => c.classList.toggle('now', c.dataset.k === k));
  $$('[data-c]', box).forEach(b => b.onclick = () => playQueue(chart, +b.dataset.c, 'list', 'Чарт'));
  $$('[data-r]', box).forEach(b => b.onclick = () => { subReturn = `[data-r="${b.dataset.r}"]`; openRelease(releases[+b.dataset.r]); });
  const all = $('#chAll'); if (all) all.onclick = () => { showTab('chart'); focusFirst($('#main')); };
}
function openRelease(x) {
  if (x.kind === 'album') openAlbum(x.source, x.id, x);
  else if (x.track) playQueue([x.track], 0, 'list', 'Новинки');
}
function renderWaveNow() {
  const art = $('#hArt'); if (!art) return;
  const t = state.mode === 'wave' ? state.current : null;
  art.classList.toggle('has-cover', !!t);
  $('#hCv').style.backgroundImage = t ? `${cssUrl(bigCover(t.cover))},${cssUrl(t.cover)}` : '';
  $('#hKick').textContent = state.station ? 'Волна ' + state.station.label : 'Моя волна';
  $('#hTitle').textContent = t ? t.title : (state.waveStatus || 'Музыка под ваше настроение');
  $('#hSub').textContent = t ? t.artist : (state.waveStatus ? '' : 'Нажмите «Слушать», и Сплав подберёт треки');
  const playing = state.mode === 'wave' && state.current && isPlaying();
  $('#hPlay').innerHTML = `${ico(playing ? 'pause' : 'play')}<span>${playing ? 'Пауза' : state.mode === 'wave' && state.current ? 'Продолжить' : 'Слушать'}</span>`;
  $('#hLike').classList.toggle('on', !!(state.current && state.liked.has(key(state.current))));
  document.body.classList.toggle('wave-now', !!t);
}
document.addEventListener('play-state', () => { if (state.tab === 'wave' && !sub) renderWaveNow(); });

/* ================= ЧАРТ ================= */
renderers.chart = async () => {
  const el = $('#main');
  el.innerHTML = `<div class="page-head"><h1>Чарт</h1><span id="chSub">Обновляется по четвергам</span></div>
    <div class="chips" data-zone="chtop"><button class="f btn primary" id="cPlay" data-autofocus>${ico('play')}<span>Слушать чарт</span></button><button class="f btn" id="cShuf">${ico('shuffle')}<span>Вперемешку</span></button></div>
    <div class="list ranked-list" data-zone="list" id="cList"><div class="empty">Загружаем чарт…</div></div>`;
  let d; try { d = await loadDiscover(); } catch (e) { if (state.tab === 'chart') $('#cList').innerHTML = `<div class="empty">Чарт не загрузился: ${esc(e.message)}</div>`; return; }
  if (state.tab !== 'chart' || sub) return;
  const list = d.chart || [];
  $('#chSub').textContent = list.length ? `${plural(list.length, 'трек', 'трека', 'треков')} · обновляется по четвергам` : 'Обновляется по четвергам';
  renderList($('#cList'), list, { onPlay: i => playQueue(list, i, 'list', 'Чарт'), empty: 'Чарт пока недоступен', ranked: true });
  $('#cPlay').onclick = () => list.length && playQueue(list, 0, 'list', 'Чарт');
  $('#cShuf').onclick = () => { if (!list.length) return; playQueue([...list].sort(() => Math.random() - 0.5), 0, 'list', 'Чарт'); };
};

/* ================= АЛЬБОМ ================= */
export async function openAlbum(source, id, hint = {}) {
  const draw = async () => {
    const el = $('#main'); el.scrollTop = 0;
    el.innerHTML = `<section class="al-head" data-zone="alhead"><div class="al-cv" style="background-image:${esc(cssUrl(bigCover(hint.cover)))}"></div>
      <div class="al-info"><div class="h-kicker">Альбом</div><div class="al-title">${esc(hint.title || '')}</div><div class="h-sub">${esc(hint.artist || '')}</div>
      <div class="h-ctrl"><button class="f btn primary big" id="alPlay" data-autofocus>${ico('play')}<span>Слушать</span></button><button class="f btn" id="alShuf">${ico('shuffle')}<span>Вперемешку</span></button></div></div></section>
      <div class="list" data-zone="list" id="alList"><div class="empty">Загружаем треки…</div></div>`;
    focus($('#alPlay'));
    let a; try { a = await API.album(source, id); } catch (e) { $('#alList').innerHTML = `<div class="empty">Альбом не открылся: ${esc(e.message)}</div>`; return; }
    if (sub !== draw) return;
    const list = a.tracks || [];
    if (a.title) $('.al-title').textContent = a.title;
    if (a.cover) $('.al-cv').style.backgroundImage = cssUrl(bigCover(a.cover));
    const artist = a.artist || (a.artists || []).map(x => x.name).join(', ');
    $('.al-info .h-sub').textContent = [artist, a.year, list.length ? plural(list.length, 'трек', 'трека', 'треков') : ''].filter(Boolean).join('  ·  ');
    renderList($('#alList'), list, { onPlay: i => playQueue(list, i, 'list', a.title || 'Альбом'), empty: 'В альбоме нет доступных треков' });
    $('#alPlay').onclick = () => list.length && playQueue(list, 0, 'list', a.title || 'Альбом');
    $('#alShuf').onclick = () => list.length && playQueue([...list].sort(() => Math.random() - 0.5), 0, 'list', a.title || 'Альбом');
  };
  sub = draw;
  draw();
}

/* ================= МОЯ МУЗЫКА ================= */
const lib = { f: 'all' };
const libList = () => {
  const L = state.likes;
  if (lib.f !== 'all') return L[lib.f] || [];
  return [...L.ya, ...L.zv, ...L.sc, ...L.guest];
};
renderers.library = () => {
  const el = $('#main');
  const L = state.likes;
  const filters = [['all', 'Все'], ['ya', 'Яндекс', L.ya.length], ['zv', 'Звук', L.zv.length], ['sc', 'SoundCloud', L.sc.length], ['guest', 'Без входа', L.guest.length]].filter(f => f[0] === 'all' || f[2]);
  const list = libList();
  el.innerHTML = `<div class="page-head"><h1>Моя музыка</h1><span>${plural(list.length, 'трек', 'трека', 'треков')}</span></div>
    <div class="chips" data-zone="libtop">
      <button class="f btn primary" id="lPlay" data-autofocus>${ico('play')}<span>Слушать</span></button>
      <button class="f btn" id="lShuf">${ico('shuffle')}<span>Вперемешку</span></button>
      <span class="chips-gap"></span>
      ${filters.length > 2 ? filters.map(([k, n]) => `<button class="f chip${lib.f === k ? ' active' : ''}" data-f="${k}">${n}</button>`).join('') : ''}
    </div>
    <div class="list" data-zone="list" id="lList"></div>`;
  renderList($('#lList'), list, { onPlay: i => playQueue(list, i, 'list', 'Моя музыка'), empty: state.guest ? '<b>Здесь будут ваши лайки</b>Нажмите на сердце в плеере или войдите в Яндекс, Звук или SoundCloud на вкладке «Аккаунты»' : '<b>Пока пусто</b>Лайкайте треки, и они появятся здесь' });
  $('#lPlay').onclick = () => list.length && playQueue(list, 0, 'list', 'Моя музыка');
  $('#lShuf').onclick = () => { if (!list.length) return; const s = [...list].sort(() => Math.random() - 0.5); playQueue(s, 0, 'list', 'Моя музыка'); };
  $$('[data-f]', el).forEach(b => b.onclick = () => { lib.f = b.dataset.f; renderers.library(); focus($(`[data-f="${lib.f}"]`)); });
};
document.addEventListener('likes-changed', () => { if (state.tab === 'library' && !sub && !$('#main').contains(document.activeElement)) renderers.library(); });
export async function loadLikes() {
  try {
    const r = await API.likes();
    state.likes = { ya: r.ya || [], sc: r.sc || [], zv: r.zv || [], guest: r.guest || [] };
    state.liked = new Set([...state.likes.ya, ...state.likes.sc, ...state.likes.zv, ...state.likes.guest].map(key));
    for (const [k, n] of [['yaError', 'Яндекс'], ['scError', 'SoundCloud'], ['zvError', 'Звук']]) if (r[k]) toast(n + ': ' + r[k]);
  } catch (e) { toast(e.message); }
  if (state.tab === 'library' && !sub && !$('#main').contains(document.activeElement)) renderers.library();
}

/* ================= ПОИСК ================= */
const search = { q: '', res: null, token: 0 };
renderers.search = () => {
  const el = $('#main');
  el.innerHTML = `<div class="page-head"><h1>Поиск</h1></div>
    <div class="search" data-zone="sinput"><div class="s-field">${ico('search')}<input class="f" id="sIn" type="search" enterkeyhint="search" placeholder="Трек, артист или альбом" value="${esc(search.q)}" autocomplete="off" spellcheck="false" data-autofocus></div>
    <button class="f btn primary" id="sGo">Найти</button></div>
    <div id="sRes"></div>`;
  const inp = $('#sIn');
  const go = () => { search.q = inp.value.trim(); inp.blur(); runSearch(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  inp.addEventListener('change', () => { if (inp.value.trim() && inp.value.trim() !== search.q) go(); });
  $('#sGo').onclick = go;
  renderSearchRes();
};
async function runSearch() {
  const token = ++search.token;
  if (!search.q) { search.res = null; renderSearchRes(); return; }
  $('#sRes').innerHTML = '<div class="empty">Ищем…</div>';
  try {
    const r = await API.search(search.q);
    if (token !== search.token) return;
    search.res = r; renderSearchRes();
    const first = $('#sRes .f'); if (first) focus(first);
  } catch (e) { if (token === search.token) $('#sRes').innerHTML = `<div class="empty">Не получилось найти: ${esc(e.message)}</div>`; }
}
function renderSearchRes() {
  const box = $('#sRes'); if (!box) return;
  if (!search.res) { box.innerHTML = '<div class="empty">Нажмите на поле и наберите название на экранной клавиатуре или скажите его в микрофон пульта</div>'; return; }
  const { tracks = [], artists = [], locked = [] } = search.res;
  const list = [...tracks, ...locked];
  box.innerHTML = `${artists.length ? `<div class="sec-title">Артисты</div><div class="artists" data-zone="sart">${artists.slice(0, 10).map((a, i) => `<button class="f artist" data-a="${i}"><div class="a-img" style="background-image:${esc(cssUrl(a.cover))}"></div><span>${esc(a.name)}</span></button>`).join('')}</div>` : ''}
    <div class="sec-title">Треки</div><div class="list" data-zone="slist" id="sList"></div>`;
  renderList($('#sList'), list, { onPlay: i => playQueue(list, i, 'list', 'Поиск: ' + search.q), empty: 'Ничего не нашлось' });
  $$('[data-a]', box).forEach(b => b.onclick = async () => {
    const a = artists[+b.dataset.a]; toast(`Включаем ${a.name}…`);
    try { const d = await API.artist(a.source, a.id); const l = d.popular || []; if (l.length) playQueue(l, 0, 'list', a.name); else toast('У артиста нет доступных треков'); } catch (e) { toast(e.message); }
  });
}

/* ================= АККАУНТЫ ================= */
const SERVICES = [
  ['ya', 'Яндекс Музыка', 'Я', '#ffcc00', '#000', 'Весь каталог, чарт и «Моя волна». Нужна подписка Плюс. Удобнее всего войти по QR-коду из приложения Яндекса на телефоне'],
  ['zv', 'Звук', 'З', '#7b4dff', '#fff', 'Каталог Звука и ваша коллекция'],
  ['sc', 'SoundCloud', 'SC', '#ff5500', '#fff', 'Ваши лайки. Без входа SoundCloud тоже играет'],
];
export async function refreshState() {
  const s = await API.state();
  state.accounts = { ya: s.ya, sc: s.sc, zv: s.zv };
  state.guest = !!s.guest; state.prefs = s.prefs || {};
  if (s.waveSettings) state.wave = { ...state.wave, ...s.waveSettings };
  return s;
}
renderers.accounts = () => {
  const el = $('#main'), A = state.accounts;
  el.innerHTML = `<div class="page-head"><h1>Аккаунты</h1></div>
    <div class="accs" data-zone="accs">${SERVICES.map(([k, name, logo, bg, fg, hint]) => `<div class="acc">
      <div class="acc-logo" style="background:${bg};color:${fg}">${logo}</div>
      <div class="acc-t"><b>${name}</b>${A[k] ? `<span class="ok">Подключено${A[k].name ? ': ' + esc(A[k].name) : ''}${A[k].offline ? ' (нет связи)' : ''}</span>` : `<span>${hint}</span>`}</div>
      ${A[k] ? `<button class="f btn" data-out="${k}">${ico('logout')}<span>Выйти</span></button>` : `<button class="f btn primary" data-in="${k}">Войти</button>`}</div>`).join('')}</div>
    <div class="note">Вход открывается в окне браузера. Буквы набираются экранной клавиатурой пульта, кнопка «Назад» закрывает окно.</div>
    <div class="about" data-zone="about"><button class="f btn" id="aRefresh">${ico('refresh')}<span>Обновить музыку и чарт</span></button><span id="aVer"></span></div>`;
  $$('[data-in]', el).forEach(b => b.onclick = () => login(b.dataset.in));
  $$('[data-out]', el).forEach(b => b.onclick = async () => {
    const k = b.dataset.out;
    try { await API.logout(k); toast('Вы вышли'); await afterAccountChange(); } catch (e) { toast(e.message); }
  });
  $('#aRefresh').onclick = async () => { toast('Обновляем…'); resetDiscover(); await Promise.all([loadLikes(), API.discover({ artists: [], force: true }).then(d => { disc.data = d; }).catch(() => {})]); toast('Готово'); };
  import('./main.js').then(m => { $('#aVer').textContent = 'Сплав для ТВ ' + m.VERSION; }).catch(() => {});
};
async function afterAccountChange() {
  resetDiscover();
  await refreshState(); await loadLikes();
  if (state.tab === 'accounts' && !sub) { renderers.accounts(); focusFirst($('#main')); }
}
export async function login(service) {
  try {
    await API.login(service);
    toast('Готово, вход выполнен');
    await afterAccountChange();
    return true;
  } catch (e) { if (!/отмен/i.test(e.message)) toast(e.message); return false; }
}
