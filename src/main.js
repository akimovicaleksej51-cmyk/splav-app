// Сплав — main process
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, session, nativeImage, protocol, Tray, screen } = require('electron');
const { Readable } = require('stream');
const { execFile } = require('child_process');
const net = require('net');

// свой протокол для локальных файлов: поддержка перемотки и CORS (нужно для эквалайзера и кроссфейда)
protocol.registerSchemesAsPrivileged([{ scheme: 'splav', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aiff': 'audio/aiff' };
const mediaUrl = file => 'splav://media/' + encodeURIComponent(file);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---------- хранилище настроек ----------
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
let config = { yaToken: null, scToken: null, zvToken: null, lfmSession: null, lfmUser: null, keys: {}, scClientId: null, localFolders: [], waveSettings: { diversity: 'default', moodEnergy: 'all', language: 'any', mix: true }, volume: 0.8,
  prefs: { crossfade: 0, normalize: false, eqOn: false, eqBands: [0, 0, 0, 0, 0], eqPreset: 'flat', timeOfDay: true, tray: true, lite: false, guestGenres: [], lastfm: false, discord: false } };

function enc(s) {
  if (!s) return null;
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64'); } catch {}
  return s;
}
function dec(s) {
  if (!s) return null;
  if (s.startsWith('enc:')) { try { return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); } catch { return null; } }
  return s;
}
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
    config = { ...config, ...raw, yaToken: dec(raw.yaToken), scToken: dec(raw.scToken), zvToken: dec(raw.zvToken), lfmSession: dec(raw.lfmSession) };
    if (raw.social) config.social = { ...raw.social, secret: dec(raw.social.secret) };
  } catch {}
}
function saveConfig() {
  const out = { ...config, yaToken: enc(config.yaToken), scToken: enc(config.scToken), zvToken: enc(config.zvToken), lfmSession: enc(config.lfmSession) };
  if (config.social) out.social = { ...config.social, secret: enc(config.social.secret) };
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(out, null, 2));
}

const DOWNLOAD_DIR = () => path.join(app.getPath('music'), 'Сплав');
const DL_INDEX = () => path.join(app.getPath('userData'), 'downloads.json');
let downloads = {};   // key -> { file, track, at }
function loadDownloads() { try { downloads = JSON.parse(fs.readFileSync(DL_INDEX(), 'utf8')); } catch { downloads = {}; } }
function saveDownloads() { fs.writeFileSync(DL_INDEX(), JSON.stringify(downloads, null, 2)); }
function liveDownloads() {
  let changed = false;
  for (const [k, d] of Object.entries(downloads)) if (!fs.existsSync(d.file)) { delete downloads[k]; changed = true; }
  if (changed) saveDownloads();
  return downloads;
}

// ---------- Яндекс Музыка (неофициальный API) ----------
const YA_API = 'https://api.music.yandex.net';
const YA_CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d';
let yaUid = null;

async function ya(pathname, { method = 'GET', form, json, query } = {}) {
  const url = new URL(YA_API + pathname);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const headers = { 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621', 'Accept-Language': 'ru' };
  if (config.yaToken) headers.Authorization = 'OAuth ' + config.yaToken;
  let body;
  if (form) { body = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (json) { body = JSON.stringify(json); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, { method, headers, body });
  if (res.status === 401) throw new Error('YA_AUTH');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Яндекс: ' + (data?.error?.message || res.status));
  return data.result;
}

function yaCover(uri, size = '400x400') {
  if (!uri) return null;
  return 'https://' + uri.replace('%%', size);
}
function yaTrack(t) {
  if (!t || !t.id) return null;
  const album = (t.albums && t.albums[0]) || {};
  return {
    id: 'ya:' + t.id + (album.id ? ':' + album.id : ''),
    rawId: String(t.id),
    source: 'ya',
    title: t.title + (t.version ? ' (' + t.version + ')' : ''),
    artist: (t.artists || []).map(a => a.name).join(', ') || 'Неизвестный исполнитель',
    album: album.title || '',
    duration: Math.round((t.durationMs || 0) / 1000),
    cover: yaCover(t.coverUri || album.coverUri),
    artists: (t.artists || []).map(a => ({ id: String(a.id), name: a.name, source: 'ya' })),
    albumId: album.id ? String(album.id) : null,
    r128: t.r128 && typeof t.r128.i === 'number' ? { i: t.r128.i } : null,
    albumType: album.metaType || album.type || null,
    year: album.year || null,
    hasLyrics: !!(t.lyricsInfo && (t.lyricsInfo.hasAvailableSyncLyrics || t.lyricsInfo.hasAvailableTextLyrics)),
    available: t.available !== false,
  };
}

async function yaEnsureUid() {
  if (yaUid) return yaUid;
  const st = await ya('/account/status');
  yaUid = st.account.uid;
  return yaUid;
}

async function yaTracksByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await ya('/tracks', { method: 'POST', form: { 'track-ids': chunk.join(','), 'with-positions': 'false' } });
    for (const t of res) { const m = yaTrack(t); if (m) out.push(m); }
  }
  return out;
}

async function yaStreamUrl(rawId) {
  const infos = await ya(`/tracks/${rawId}/download-info`);
  const mp3 = infos.filter(i => i.codec === 'mp3').sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0] || infos[0];
  if (!mp3) throw new Error('Трек недоступен');
  const xml = await (await fetch(mp3.downloadInfoUrl)).text();
  const get = tag => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];
  const host = get('host'), p = get('path'), ts = get('ts'), s = get('s');
  const sign = crypto.createHash('md5').update('XGRlBW9FXlekgbPrRHuSiA' + p.slice(1) + s).digest('hex');
  return `https://${host}/get-mp3/${sign}/${ts}${p}`;
}

// «Моя волна» — станция user:onyourwave
const WAVE = 'user:onyourwave';
let waveBatchId = null, curStation = WAVE;
async function yaWaveTracks(lastId, station = WAVE) {
  curStation = station;
  const res = await ya(`/rotor/station/${station}/tracks`, { query: { settings2: 'true', queue: lastId || undefined } });
  waveBatchId = res.batchId;
  return (res.sequence || []).map(s => yaTrack(s.track)).filter(Boolean);
}
async function yaWaveFeedback(type, extra = {}) {
  try {
    await ya(`/rotor/station/${curStation}/feedback`, {
      method: 'POST',
      query: { 'batch-id': waveBatchId || undefined },
      json: { type, timestamp: new Date().toISOString(), from: curStation === WAVE ? 'mobile-radio-user-onyourwave' : 'mobile-radio-' + curStation.replace(':', '-'), ...extra },
    });
  } catch (e) { /* фидбэк не критичен */ }
}
async function yaWaveSettings(s) {
  try {
    await ya(`/rotor/station/${WAVE}/settings3`, {
      method: 'POST',
      json: { moodEnergy: s.moodEnergy, diversity: s.diversity, language: s.language, type: 'rotor' },
    });
  } catch (e) {
    await ya(`/rotor/station/${WAVE}/settings2`, {
      method: 'POST',
      json: { moodEnergy: s.moodEnergy, diversity: s.diversity, language: s.language, type: 'rotor' },
    }).catch(() => {});
  }
}

// ---------- SoundCloud (api-v2, как у веб-версии) ----------
const SC_API = 'https://api-v2.soundcloud.com';
let scUserId = null;

async function scClientId(force = false) {
  if (config.scClientId && !force) return config.scClientId;
  // просим страницу как обычный браузер на компьютере: телефону SoundCloud отдаёт мобильную версию без нужных скриптов
  const desk = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Accept-Language': 'ru,en;q=0.8' };
  const html = await (await fetch('https://soundcloud.com/discover', { headers: desk })).text();
  const scripts = [...new Set([...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]))].reverse();
  for (const src of scripts) {
    const js = await (await fetch(src, { headers: desk })).text();
    const m = js.match(/client_id\s*[:=]\s*"([0-9a-zA-Z]{32})"/) || js.match(/client_id=([0-9a-zA-Z]{32})/);
    if (m) { config.scClientId = m[1]; saveConfig(); return m[1]; }
  }
  throw new Error('Не удалось подключиться к SoundCloud');
}

async function sc(pathnameOrUrl, query = {}, retry = true, noAuth = false) {
  const url = new URL(pathnameOrUrl.startsWith('http') ? pathnameOrUrl : SC_API + pathnameOrUrl);
  url.searchParams.set('client_id', await scClientId());
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
  const headers = {};
  if (config.scToken && !noAuth) headers.Authorization = 'OAuth ' + config.scToken;
  const res = await fetch(url, { headers });
  if ((res.status === 401 || res.status === 403) && retry) {
    await scClientId(true);
    return sc(pathnameOrUrl, query, false, noAuth);
  }
  if (!res.ok) throw new Error('SoundCloud: ' + res.status);
  return res.json();
}

function scSplit(t) {
  const pub = t.publisher_metadata && t.publisher_metadata.artist;
  const user = (t.user && t.user.username) || '';
  if (pub) return { artist: pub, title: t.title };
  const m = /^(.{1,60}?)\s[-–—]\s(.+)$/.exec(t.title || '');
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: user, title: t.title };
}
function scTrack(t) {
  if (!t || t.kind !== 'track') return null;
  const art = t.artwork_url || (t.user && t.user.avatar_url);
  return {
    id: 'sc:' + t.id,
    rawId: String(t.id),
    source: 'sc',
    title: scSplit(t).title,
    artist: scSplit(t).artist,
    album: '',
    duration: Math.round((t.full_duration || t.duration || 0) / 1000),
    _genre: t.genre || '', _tags: t.tag_list || '', plays: t.playback_count || 0,
    cover: art ? art.replace('-large', '-t500x500') : null,
    downloadable: !!(t.downloadable && t.has_downloads_left !== false),
    permalink: t.permalink_url,
    artists: t.user ? [{ id: String(t.user.id), name: scSplit(t).artist, source: 'sc' }] : [],
    snipped: t.policy === 'SNIP',
    _media: t.media, _auth: t.track_authorization,
    available: t.policy !== 'BLOCK',
  };
}

const scCache = new Map();
function remember(list) { for (const t of list) if (t && t.source === 'sc') scCache.set(t.rawId, t); return list; }

async function scStream(rawId) {
  let t = scCache.get(rawId);
  // берём свежие данные трека: ссылки на потоки и track_authorization быстро устаревают
  try { t = scTrack(await sc(`/tracks/${rawId}`)); scCache.set(rawId, t); } catch (e) { if (!t) throw e; }
  const tr = ((t._media && t._media.transcodings) || []).filter(x => !x.snipped || t.snipped);
  // только открытые форматы: зашифрованные потоки (DRM) не трогаем
  const open = tr.filter(x => x.format && (x.format.protocol === 'progressive' || x.format.protocol === 'hls'));
  const rank = x => x.format.protocol === 'progressive' ? 0
    : /mp4|aac/.test(x.format.mime_type) ? 1
    : /mpeg/.test(x.format.mime_type) ? 2 : 9;  // opus/ogg hls.js не играет
  const candidates = open.filter(x => rank(x) < 9).sort((a, b) => rank(a) - rank(b));
  if (!candidates.length) {
    throw new Error(tr.length ? 'SoundCloud отдаёт этот трек только в защищённом формате' : 'SoundCloud не даёт слушать этот трек');
  }
  let lastErr;
  for (const pick of candidates) {
    for (const noAuth of [false, true]) {
      try {
        const r = await sc(pick.url, { track_authorization: t._auth }, true, noAuth);
        if (r && r.url) return { url: r.url, hls: pick.format.protocol === 'hls', preview: t.snipped };
      } catch (e) { lastErr = e; }
      if (!config.scToken) break;
    }
  }
  if (t.snipped) throw new Error('Это превью трека SoundCloud Go+, полная версия недоступна');
  throw lastErr || new Error('SoundCloud не отдал поток');
}

// ---------- локальные файлы ----------
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.aiff']);
async function scanFolder(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await scanFolder(full, out, depth + 1);
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}
const coverDir = () => path.join(app.getPath('userData'), 'covers');
async function localTracks() {
  const mm = require('music-metadata');
  const folders = [...new Set([DOWNLOAD_DIR(), ...config.localFolders])];
  const files = [];
  for (const f of folders) await scanFolder(f, files);
  fs.mkdirSync(coverDir(), { recursive: true });
  const out = [];
  const indexed = new Set(Object.values(liveDownloads()).map(d => d.file));
  for (const file of files) {
    if (indexed.has(file)) continue;
    let meta = {};
    try { meta = await mm.parseFile(file, { duration: true }); } catch {}
    const c = meta.common || {};
    let cover = null;
    const pic = c.picture && c.picture[0];
    if (pic) {
      const h = crypto.createHash('md5').update(file).digest('hex');
      const cp = path.join(coverDir(), h + (pic.format.includes('png') ? '.png' : '.jpg'));
      if (!fs.existsSync(cp)) { try { fs.writeFileSync(cp, pic.data); } catch {} }
      cover = 'file://' + cp;
    }
    const base = path.basename(file, path.extname(file));
    const [fa, ft] = base.includes(' - ') ? base.split(' - ', 2) : [null, base];
    out.push({
      id: 'local:' + file, rawId: file, source: 'local',
      title: c.title || ft, artist: c.artist || fa || 'Локальный файл', album: c.album || '',
      duration: Math.round((meta.format && meta.format.duration) || 0),
      cover, url: mediaUrl(file), available: true,
    });
  }
  return out;
}

function safeName(s) { return s.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 150); }

async function downloadTo(url, file, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Ошибка загрузки: ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

// ---------- окна входа ----------
function yandexLogin() {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ width: 480, height: 720, title: 'Вход в Яндекс', parent: mainWindow, modal: true, webPreferences: { partition: 'persist:yandex' } });
    let done = false;
    const check = (url) => {
      const m = /access_token=([^&]+)/.exec(url);
      if (m && !done) { done = true; config.yaToken = decodeURIComponent(m[1]); yaUid = null; saveConfig(); win.close(); resolve(true); }
    };
    win.webContents.on('will-redirect', (_e, url) => check(url));
    win.webContents.on('will-navigate', (_e, url) => check(url));
    win.webContents.on('did-navigate', (_e, url) => check(url));
    win.webContents.on('did-navigate-in-page', (_e, url) => check(url));
    win.on('closed', () => { if (!done) reject(new Error('Вход отменён')); });
    win.loadURL(`https://oauth.yandex.ru/authorize?response_type=token&client_id=${YA_CLIENT_ID}`);
  });
}

function soundcloudLogin() {
  return new Promise((resolve, reject) => {
    const ses = session.fromPartition('persist:soundcloud');
    const win = new BrowserWindow({ width: 520, height: 760, title: 'Вход в SoundCloud', parent: mainWindow, modal: true, webPreferences: { partition: 'persist:soundcloud' } });
    let done = false;
    const timer = setInterval(async () => {
      const cookies = await ses.cookies.get({ name: 'oauth_token' }).catch(() => []);
      if (cookies.length && !done) {
        done = true; clearInterval(timer);
        config.scToken = cookies[0].value; scUserId = null; saveConfig();
        win.close(); resolve(true);
      }
    }, 1000);
    win.on('closed', () => { clearInterval(timer); if (!done) reject(new Error('Вход отменён')); });
    win.loadURL('https://soundcloud.com/signin');
  });
}

// ---------- IPC ----------
function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
}

handle('state', async () => {
  const st = { ya: null, sc: null, localFolders: config.localFolders, downloadDir: DOWNLOAD_DIR(), waveSettings: config.waveSettings, volume: config.volume, prefs: config.prefs };
  if (config.yaToken) {
    try { const s = await ya('/account/status'); yaUid = s.account.uid; st.ya = { name: s.account.displayName || s.account.login, plus: !!(s.plus && s.plus.hasPlus) }; }
    catch (e) { if (e.message === 'YA_AUTH') { config.yaToken = null; saveConfig(); } else st.ya = { name: 'Яндекс', offline: true }; }
  }
  if (config.scToken) {
    try { const me = await sc('/me'); scUserId = me.id; st.sc = { name: me.username }; }
    catch { st.sc = null; }
  }
  if (config.zvToken) {
    try { const pr = await zvProfile(config.zvToken); st.zv = pr && !pr.anon ? { name: pr.name || 'Звук', sub: pr.sub } : null; if (!st.zv) { config.zvToken = null; saveConfig(); } }
    catch (e) { st.zv = { name: 'Звук', offline: true }; }
  }
  st.am = process.platform === 'darwin' && !!config.prefs.appleMusic ? { name: 'Apple Music' } : null;
  st.amAvailable = process.platform === 'darwin';
  st.lfm = config.lfmSession ? { name: config.lfmUser } : null;
  st.keys = { jamendo: !!K('jamendo'), lastfm: !!(K('lastfmKey') && K('lastfmSecret')), discord: !!K('discordId') };
  st.keyValues = { server: config.keys.server || bundledKeys.server || '', jamendo: config.keys.jamendo || '', lastfmKey: config.keys.lastfmKey || '', lastfmSecret: config.keys.lastfmSecret ? '••••••' : '', discordId: config.keys.discordId || '' };
  st.guest = !st.ya && !st.sc && !st.zv && !st.am;
  return st;
});

handle('login', async (service) => {
  if (service === 'ya') await yandexLogin();
  if (service === 'sc') await soundcloudLogin();
  if (service === 'zv') await zvukLogin();
  if (service === 'am') { await amCheck(); config.prefs.appleMusic = true; saveConfig(); }
  if (service === 'lfm') await lastfmLogin();
  return true;
});
handle('zvToken', async (token) => { const pr = await zvProfile(token.trim()); if (!pr || pr.anon) throw new Error('Это гостевой токен, войдите в аккаунт Звука'); config.zvToken = token.trim(); saveConfig(); return true; });
handle('setKeys', async (k) => { for (const [a, b] of Object.entries(k)) if (b !== '••••••') config.keys[a] = String(b || '').trim(); saveConfig(); return true; });
handle('yaToken', async (token) => { config.yaToken = token.trim(); yaUid = null; saveConfig(); await ya('/account/status'); return true; });
handle('logout', async (service) => {
  if (service === 'ya') { config.yaToken = null; yaUid = null; await session.fromPartition('persist:yandex').clearStorageData(); }
  if (service === 'sc') { config.scToken = null; scUserId = null; await session.fromPartition('persist:soundcloud').clearStorageData(); }
  if (service === 'zv') { config.zvToken = null; await session.fromPartition('persist:zvuk').clearStorageData(); }
  if (service === 'am') { config.prefs.appleMusic = false; }
  if (service === 'lfm') { config.lfmSession = null; config.lfmUser = null; }
  saveConfig(); return true;
});

handle('likes', async () => {
  const out = { ya: [], sc: [], local: [] };
  const jobs = [];
  if (config.yaToken) jobs.push((async () => {
    const uid = await yaEnsureUid();
    const lib = await ya(`/users/${uid}/likes/tracks`);
    const ids = (lib.library.tracks || []).map(t => t.albumId ? `${t.id}:${t.albumId}` : String(t.id));
    out.ya = await yaTracksByIds(ids);
  })().catch(e => { out.yaError = e.message; }));
  if (config.scToken) jobs.push((async () => {
    if (!scUserId) scUserId = (await sc('/me')).id;
    let next = `/users/${scUserId}/track_likes`, pages = 0;
    let q = { limit: 200, linked_partitioning: 1 };
    while (next && pages < 10) {
      const r = await sc(next, q);
      out.sc.push(...(r.collection || []).map(x => scTrack(x.track)).filter(Boolean));
      next = r.next_href; q = {}; pages++;
    }
    remember(out.sc);
  })().catch(e => { out.scError = e.message; }));
  if (config.zvToken) jobs.push(zvLikes().then(l => { out.zv = l; }).catch(e => { out.zvError = e.message; }));
  if (process.platform === 'darwin' && config.prefs.appleMusic) jobs.push(amLibrary().then(l => { out.am = l; }).catch(e => { out.amError = e.message; }));
  jobs.push(localTracks().then(l => { out.local = l; }).catch(() => {}));
  await Promise.all(jobs);
  out.guest = guestLikes.map(x => x.track);
  remember(out.guest.filter(t => t.source === 'sc'));
  return out;
});

const norm = s => (s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]|feat\.?.*$|ft\.?.*$/g, '').replace(/[^a-zа-яё0-9]+/gi, ' ').trim();

// артисты для поиска: сначала точное совпадение имени, потом начало имени
function rankArtists(text, list) {
  const q = norm(text);
  const score = a => { const n = norm(a.name); return n === q ? 3 : n.startsWith(q) || (q.startsWith(n) && n.length > 2) ? 2 : n.includes(q) ? 1 : 0; };
  return list.map((a, i) => ({ a, s: score(a), i }))
    .filter(x => x.s > 0 && (x.a.source !== 'sc' || x.s === 3 || x.a.followers > 2000))
    .sort((x, y) => y.s - x.s || (x.a.source === 'ya' ? -1 : 0) - (y.a.source === 'ya' ? -1 : 0) || x.i - y.i)
    .map(x => x.a).slice(0, 10);
}
async function searchArtists(text) {
  const [yaA, scA] = await Promise.all([
    ya('/search', { query: { text, type: 'artist', page: 0, nocorrect: 'false' } })
      .then(r => ((r && r.artists && r.artists.results) || []).slice(0, 8).map(a => ({ source: 'ya', id: String(a.id), name: a.name, cover: yaCover(a.cover && a.cover.uri, '300x300') || yaCover(a.ogImage, '300x300'), genre: (a.genres || [])[0] || '' })))
      .catch(() => []),
    sc('/search/users', { q: text, limit: 6 })
      .then(r => ((r && r.collection) || []).map(u => ({ source: 'sc', id: String(u.id), name: u.username, cover: u.avatar_url ? u.avatar_url.replace('-large', '-t300x300') : null, followers: u.followers_count || 0 })))
      .catch(() => []),
  ]);
  return rankArtists(text, [...yaA, ...scA]);
}

handle('search', async (text) => {
  const res = { tracks: [] };
  const artistsP = searchArtists(text);
  const [yaRes, scRes, zvRes, auRes, jaRes] = await Promise.all([
    ya('/search', { query: { text, type: 'track', page: 0, nocorrect: 'false' } }).catch(() => null),
    sc('/search/tracks', { q: text, limit: 30 }).catch(() => null),
    config.zvToken ? zvSearch(text).catch(() => []) : [],
    auSearch(text).catch(() => []),
    K('jamendo') ? jaSearch(text).catch(() => []) : [],
  ]);
  let yaList = ((yaRes && yaRes.tracks && yaRes.tracks.results) || []).map(yaTrack).filter(Boolean);
  if (!config.yaToken) yaList = yaList.map(t => ({ ...t, locked: 'ya' }));   // гостю — подсказка «войдите»
  const scList = remember(((scRes && scRes.collection) || []).map(scTrack).filter(Boolean));
  const open = [...(config.yaToken ? yaList : []), ...zvRes];
  const seen = new Set(open.map(t => norm(t.artist.split(',')[0]) + '|' + norm(t.title)));
  const uniq = list => list.filter(t => { const k = norm(t.artist.split(',')[0]) + '|' + norm(t.title); if (seen.has(k)) return false; seen.add(k); return true; });
  const rest = [...uniq(scList), ...uniq(auRes), ...uniq(jaRes)];
  const merged = [];
  let ri = 0;
  open.forEach((t, i) => { merged.push(t); if (i % 3 === 2 && ri < rest.length) merged.push(rest[ri++]); });
  while (ri < rest.length) merged.push(rest[ri++]);
  res.tracks = merged;
  res.artists = await artistsP;
  if (!config.yaToken) {
    const have = new Set(merged.map(t => norm(t.artist.split(',')[0]) + '|' + norm(t.title)));
    res.locked = yaList.filter(t => !have.has(norm(t.artist.split(',')[0]) + '|' + norm(t.title))).slice(0, 8);
  }
  return res;
});

handle('stream', async (track) => {
  const off = liveDownloads()[track.source + ':' + track.rawId];
  if (off) return { url: mediaUrl(off.file), hls: false, offline: true };
  if (track.source === 'ya') return { url: await yaStreamUrl(track.rawId), hls: false };
  if (track.source === 'sc') return scStream(track.rawId);
  if (track.source === 'zv') return { url: await zvStream(track.rawId), hls: false };
  if (track.source === 'au') return { url: `${AU_API}/tracks/${encodeURIComponent(track.rawId)}/stream?app_name=${AU_APP}`, hls: false };
  if (track.source === 'ja') return { url: track.url || await jaStreamUrl(track.rawId), hls: false };
  if (track.source === 'local') return { url: track.url && track.url.startsWith('file://') ? mediaUrl(decodeURIComponent(track.url.slice(7))) : track.url, hls: false };
  throw new Error('Неизвестный источник');
});

// ---------- SoundCloud в волне: слушается настроек ----------
const CYR = /[а-яё]/i;
const INSTR = /(instrumental|инструментал|ambient|lo-?fi|piano|пианино|chillhop|downtempo|idm|techno|house|trance|drum ?(&|and|n|'n') ?bass|dnb|classical|soundtrack|\bost\b|cinematic|electronic|synthwave|jazz|beats?\b|minimal|deep house|chillout|instru)/i;
const VOCAL_HINT = /(rap|рэп|hip ?hop|хип|trap|drill|vocal|song|feat\.|ft\.|remix by|\(lyrics\))/i;
const MOOD_GENRES = {
  calm: ['ambient', 'lofi', 'chillout', 'piano', 'downtempo'],
  sad: ['piano', 'ambient', 'downtempo', 'sad', 'indie'],
  active: ['techno', 'drum & bass', 'house', 'phonk', 'trance'],
  fun: ['house', 'disco', 'funk', 'dance', 'nu disco'],
  all: ['electronic', 'indie', 'house', 'ambient', 'lofi', 'alternative'],
};
const LANG_GENRES = {
  'without-words': ['ambient', 'lofi', 'piano', 'techno', 'deep house', 'downtempo', 'chillout', 'instrumental'],
  'not-russian': ['indie', 'electronic', 'alternative', 'house', 'r&b', 'hip hop'],
  russian: ['русский рэп', 'русский инди', 'пост-панк', 'русская поп'],
};
const recentSc = { ids: [], artists: [] };
function rememberRecent(t) {
  recentSc.ids.push(t.rawId); recentSc.artists.push((t.artist || '').toLowerCase());
  if (recentSc.ids.length > 120) recentSc.ids.shift();
  if (recentSc.artists.length > 25) recentSc.artists.shift();
}
function scFits(t, ws) {
  if (!t || t.snipped || t.available === false || t.duration < 60 || t.duration > 900) return false;
  const text = `${t.title} ${t.artist}`;
  const meta = `${t._genre} ${t._tags} ${t.title}`;
  if (ws.language === 'russian' && !CYR.test(text)) return false;
  if (ws.language === 'not-russian' && CYR.test(text)) return false;
  if (ws.language === 'without-words' && (CYR.test(text) || !INSTR.test(meta) || VOCAL_HINT.test(meta))) return false;
  if (ws.moodEnergy && ws.moodEnergy !== 'all') {
    const g = MOOD_GENRES[ws.moodEnergy] || [];
    const hard = /(rap|рэп|trap|drill|phonk|metal|hardstyle)/i.test(meta);
    if ((ws.moodEnergy === 'calm' || ws.moodEnergy === 'sad') && hard) return false;
    if (t._genre && g.length && !g.some(x => meta.toLowerCase().includes(x.split(' ')[0])) && ws.language === 'without-words') return false;
  }
  if (recentSc.ids.includes(t.rawId)) return false;
  if (recentSc.artists.slice(-12).includes((t.artist || '').toLowerCase())) return false;
  return true;
}
async function scGenrePool(ws, genres) {
  const fromUser = (genres || []).map(g => GENRES[g] && GENRES[g].sc).filter(Boolean);
  const pool = ws.language === 'russian' || ws.language === 'without-words' || !fromUser.length
    ? [...(LANG_GENRES[ws.language] || []), ...(MOOD_GENRES[ws.moodEnergy] || MOOD_GENRES.all), ...fromUser]
    : [...fromUser, ...fromUser, ...(MOOD_GENRES[ws.moodEnergy] || [])];
  const genre = pool[Math.floor(Math.random() * pool.length)];
  const r = await sc('/search/tracks', { q: genre, 'filter.genre_or_tag': genre, limit: 50, offset: Math.floor(Math.random() * 4) * 50 });
  return (r.collection || []).map(scTrack).filter(Boolean);
}
async function scWaveTracks(likedIds, ws, need, genres) {
  const likedSet = new Set(likedIds);
  const likedArtists = new Set(likedIds.map(id => scCache.get(id)).filter(Boolean).map(t => (t.artist || '').toLowerCase()));
  let seeds = likedIds.map(id => scCache.get(id)).filter(t => t && scFits({ ...t, rawId: '_' }, { ...ws, moodEnergy: 'all' }) );
  seeds = seeds.sort(() => Math.random() - 0.5).slice(0, 3);
  let cands = [];
  for (const seed of seeds) {
    try { const r = await sc(`/tracks/${seed.rawId}/related`, { limit: 30 }); cands.push(...(r.collection || []).map(scTrack).filter(Boolean)); } catch {}
  }
  const filterAll = list => {
    let out = list.filter(t => scFits(t, ws));
    if (ws.diversity === 'discover') out = out.filter(t => !likedSet.has(t.rawId) && !likedArtists.has((t.artist || '').toLowerCase()));
    if (ws.diversity === 'favorite') out = out.sort((a, b) => (likedArtists.has((b.artist || '').toLowerCase()) ? 1 : 0) - (likedArtists.has((a.artist || '').toLowerCase()) ? 1 : 0));
    else if (ws.diversity === 'popular') out = out.sort((a, b) => b.plays - a.plays);
    else out = out.sort(() => Math.random() - 0.5);
    const seenA = new Set(), uniq = [];
    for (const t of out) { const a = (t.artist || '').toLowerCase(); if (seenA.has(a)) continue; seenA.add(a); uniq.push(t); }
    return uniq;
  };
  let picked = filterAll(cands);
  for (let tries = 0; picked.length < need && tries < 3; tries++) {
    try { picked = filterAll([...picked, ...(await scGenrePool(ws, genres))]); } catch { break; }
  }
  picked = remember(picked.slice(0, need));
  picked.forEach(rememberRecent);
  return picked;
}

handle('waveNext', async ({ lastYaId, mix, likedSc, settings, station }) => {
  const ws = { ...config.waveSettings, ...(settings || {}) };
  if (station) return stationTracks(station, lastYaId, ws);
  if (!config.yaToken) return guestWave(ws, likedSc || []);
  let list = [];
  if (config.yaToken) list = await yaWaveTracks(lastYaId);
  if (mix && config.scToken) {
    try {
      const scList = await scWaveTracks(likedSc || [], ws, list.length ? 2 : 8);
      if (list.length) scList.forEach((t, i) => list.splice(Math.min(list.length, 2 + i * 3), 0, t));
      else list = scList;
    } catch {}
  } else if (!list.length && config.scToken) {
    list = await scWaveTracks(likedSc || [], ws, 8);
  }
  return list;
});
handle('waveFeedback', async ({ type, track, played }) => {
  if (!track || track.source !== 'ya') return true;
  if (type === 'radioStarted') return yaWaveFeedback('radioStarted');
  const trackId = track.rawId + (track.id.split(':')[2] ? ':' + track.id.split(':')[2] : '');
  if (type === 'trackStarted') return yaWaveFeedback('trackStarted', { trackId });
  if (type === 'trackFinished') return yaWaveFeedback('trackFinished', { trackId, totalPlayedSeconds: played || 0 });
  if (type === 'skip') return yaWaveFeedback('skip', { trackId, totalPlayedSeconds: played || 0 });
  return true;
});
handle('waveSettings', async (s, effective) => {
  config.waveSettings = { ...config.waveSettings, ...s }; saveConfig();
  if (config.yaToken) await yaWaveSettings({ ...config.waveSettings, ...(effective || {}) });
  return config.waveSettings;
});
handle('setPrefs', async (p) => { config.prefs = { ...config.prefs, ...p }; saveConfig(); if ('tray' in p) setupTray(); if ('discord' in p) { if (p.discord) rpcConnect(); else if (rpc.sock) { setPresence(null); } } if ('alarm' in p) alarmTick(); return config.prefs; });

handle('like', async ({ track, on }) => {
  if (track.source === 'au' || track.source === 'ja' || (track.source === 'sc' && !config.scToken)) { setGuestLike(track, on); return true; }
  if (track.source === 'zv') { await zv('mutation like($id: ID, $type: CollectionItemType) { collection { ' + (on ? 'addItem' : 'removeItem') + '(id: $id, type: $type) } }', { id: track.rawId, type: 'track' }); return true; }
  if (track.source === 'ya') {
    const uid = await yaEnsureUid();
    const id = track.id.slice(3);
    await ya(`/users/${uid}/likes/tracks/${on ? 'add-multiple' : 'remove'}`, { method: 'POST', form: { 'track-ids': id } });
    if (on) yaWaveFeedback('like', { trackId: id });
  } else if (track.source === 'sc') {
    if (!scUserId) scUserId = (await sc('/me')).id;
    const url = `${SC_API}/users/${scUserId}/track_likes/${track.rawId}?client_id=${await scClientId()}`;
    const r = await fetch(url, { method: on ? 'PUT' : 'DELETE', headers: { Authorization: 'OAuth ' + config.scToken } });
    if (!r.ok) throw new Error('SoundCloud: ' + r.status);
  }
  return true;
});
handle('dislike', async ({ track }) => {
  if (track.source === 'ya') {
    const uid = await yaEnsureUid();
    const id = track.id.slice(3);
    await ya(`/users/${uid}/dislikes/tracks/add-multiple`, { method: 'POST', form: { 'track-ids': id } });
    yaWaveFeedback('dislike', { trackId: id });
  }
  return true;
});

// Скачивание: только SoundCloud-треки, для которых автор разрешил загрузку
handle('download', async (track) => {
  if (track.source !== 'sc' && !(track.source === 'ja' && track.dlUrl)) throw new Error('Скачивание доступно для треков SoundCloud и Jamendo, где автор его разрешил');
  let url;
  if (track.source === 'ja') url = track.dlUrl;
  else { const r = await sc(`/tracks/${track.rawId}/download`); url = r.redirectUri; }
  if (!url) throw new Error('Автор не разрешил скачивание этого трека');
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  let ext = '.mp3';
  const cd = head && head.headers.get('content-disposition');
  const m = cd && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (m) ext = path.extname(decodeURIComponent(m[1])) || ext;
  const file = path.join(DOWNLOAD_DIR(), safeName(`${track.artist} - ${track.title}`) + ext);
  await downloadTo(url, file);
  const meta = { ...track }; delete meta._media; delete meta._auth;
  if (track.cover && /^https:/.test(track.cover)) {
    try {
      const cp = path.join(coverDir(), 'dl-' + track.rawId + '.jpg');
      fs.mkdirSync(coverDir(), { recursive: true });
      fs.writeFileSync(cp, Buffer.from(await (await fetch(track.cover)).arrayBuffer()));
      meta.cover = 'file://' + cp;
    } catch {}
  }
  downloads[track.source + ':' + track.rawId] = { file, track: meta, at: Date.now() };
  saveDownloads();
  return file;
});

handle('downloads', async () => Object.values(liveDownloads()).sort((a, b) => b.at - a.at).map(d => ({ ...d.track, offline: true })));
handle('removeDownload', async (k) => {
  const d = downloads[k]; if (!d) return true;
  const trash = path.join(DOWNLOAD_DIR(), '.удалённые'); fs.mkdirSync(trash, { recursive: true });
  try { await shell.trashItem(d.file); } catch { try { fs.renameSync(d.file, path.join(trash, path.basename(d.file))); } catch {} }
  delete downloads[k]; saveDownloads(); return true;
});

handle('addFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Папка с музыкой' });
  if (r.canceled || !r.filePaths[0]) return config.localFolders;
  if (!config.localFolders.includes(r.filePaths[0])) config.localFolders.push(r.filePaths[0]);
  saveConfig(); return config.localFolders;
});
handle('removeFolder', async (dir) => { config.localFolders = config.localFolders.filter(f => f !== dir); saveConfig(); return config.localFolders; });
handle('openDownloads', async () => { fs.mkdirSync(DOWNLOAD_DIR(), { recursive: true }); shell.openPath(DOWNLOAD_DIR()); return true; });
handle('reveal', async (file) => { shell.showItemInFolder(file); return true; });
handle('setVolume', async (v) => { config.volume = v; saveConfig(); return true; });
handle('openExternal', async (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });


// ---------- артисты и альбомы ----------
function yaAlbum(a) {
  return { id: String(a.id), source: 'ya', title: a.title, year: a.year || null, cover: yaCover(a.coverUri, '400x400'), type: a.type || 'album', count: a.trackCount || 0 };
}
function scAlbum(p) {
  const art = p.artwork_url || (p.tracks && p.tracks[0] && p.tracks[0].artwork_url) || (p.user && p.user.avatar_url);
  return { id: String(p.id), source: 'sc', title: p.title, year: p.release_date ? new Date(p.release_date).getFullYear() : (p.created_at ? new Date(p.created_at).getFullYear() : null), cover: art ? art.replace('-large', '-t500x500') : null, type: p.set_type || 'album', count: p.track_count || 0 };
}
async function scFillTracks(list) {
  // в плейлистах SoundCloud часть треков приходит «пустыми» — догружаем пачкой
  const full = list.filter(t => t && t.title), stub = list.filter(t => t && !t.title).map(t => t.id);
  const loaded = new Map(full.map(t => [t.id, t]));
  for (let i = 0; i < stub.length; i += 50) {
    const r = await sc('/tracks', { ids: stub.slice(i, i + 50).join(',') });
    for (const t of r) loaded.set(t.id, t);
  }
  return list.map(t => loaded.get(t.id)).filter(Boolean).map(scTrack).filter(Boolean);
}

handle('artist', async ({ source, id }) => {
  if (source === 'ya') {
    const r = await ya(`/artists/${id}/brief-info`);
    const a = r.artist || {};
    let albums = (r.albums || []).map(yaAlbum);
    try {
      const d = await ya(`/artists/${id}/direct-albums`, { query: { page: 0, 'page-size': 50, 'sort-by': 'year' } });
      if (d && d.albums && d.albums.length) albums = d.albums.map(yaAlbum);
    } catch {}
    let liked = false;
    try { const uid = await yaEnsureUid(); const la = await ya(`/users/${uid}/likes/artists`, { query: { 'with-timestamps': 'false' } }); liked = (la || []).some(x => String((x.artist || x).id) === String(id)); } catch {}
    return {
      id: String(a.id), source: 'ya', name: a.name,
      cover: yaCover(a.cover && a.cover.uri, '400x400') || yaCover(a.ogImage, '400x400'),
      listeners: (r.stats && r.stats.lastMonthListeners) || null,
      popular: (r.popularTracks || []).map(yaTrack).filter(Boolean),
      albums, liked,
    };
  }
  if (source === 'sc') {
    const [u, top, albums, playlists] = await Promise.all([
      sc(`/users/${id}`),
      sc(`/users/${id}/toptracks`, { limit: 10 }).catch(() => ({ collection: [] })),
      sc(`/users/${id}/albums`, { limit: 30 }).catch(() => ({ collection: [] })),
      sc(`/users/${id}/playlists_without_albums`, { limit: 30 }).catch(() => ({ collection: [] })),
    ]);
    let popular = remember((top.collection || []).map(scTrack).filter(Boolean));
    if (!popular.length) popular = remember(((await sc(`/users/${id}/tracks`, { limit: 10 })).collection || []).map(scTrack).filter(Boolean));
    return {
      id: String(u.id), source: 'sc', name: u.username,
      cover: u.avatar_url ? u.avatar_url.replace('-large', '-t500x500') : null,
      listeners: u.followers_count || null, listenersLabel: 'подписчиков',
      popular,
      albums: [...(albums.collection || []), ...(playlists.collection || [])].map(scAlbum),
      liked: false,
    };
  }
  throw new Error('Неизвестный источник');
});

handle('artistTracks', async ({ source, id }) => {
  if (source === 'ya') {
    const out = [];
    for (let page = 0; page < 10; page++) {
      const r = await ya(`/artists/${id}/tracks`, { query: { page, 'page-size': 100 } });
      out.push(...(r.tracks || []).map(yaTrack).filter(Boolean));
      const total = r.pager ? r.pager.total : 0;
      if (!r.tracks || !r.tracks.length || out.length >= total) break;
    }
    return out;
  }
  if (source === 'sc') {
    const out = []; let next = `/users/${id}/tracks`, q = { limit: 200, linked_partitioning: 1 }, pages = 0;
    while (next && pages < 5) { const r = await sc(next, q); out.push(...(r.collection || []).map(scTrack).filter(Boolean)); next = r.next_href; q = {}; pages++; }
    return remember(out);
  }
  return [];
});

handle('album', async ({ source, id }) => {
  if (source === 'ya') {
    const a = await ya(`/albums/${id}/with-tracks`);
    const tracks = (a.volumes || []).flat().map(yaTrack).filter(Boolean);
    return { ...yaAlbum(a), artists: (a.artists || []).map(x => ({ id: String(x.id), name: x.name, source: 'ya' })), tracks };
  }
  if (source === 'sc') {
    const p = await sc(`/playlists/${id}`);
    const tracks = remember(await scFillTracks(p.tracks || []));
    return { ...scAlbum(p), artists: p.user ? [{ id: String(p.user.id), name: p.user.username, source: 'sc' }] : [], tracks };
  }
  throw new Error('Неизвестный источник');
});

handle('likeArtist', async ({ id, on }) => {
  const uid = await yaEnsureUid();
  await ya(`/users/${uid}/likes/artists/${on ? 'add-multiple' : 'remove'}`, { method: 'POST', form: { 'artist-ids': id } });
  return true;
});

// ---------- цвет обложки ----------
const colorCache = new Map();
handle('coverColor', async (url) => {
  if (!url) return null;
  if (colorCache.has(url)) return colorCache.get(url);
  let img;
  if (url.startsWith('file://')) img = nativeImage.createFromPath(decodeURIComponent(url.slice(7)));
  else {
    const res = await fetch(url.replace(/400x400|t500x500/, m => m === '400x400' ? '50x50' : 't67x67'));
    img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
  }
  if (img.isEmpty()) return null;
  const small = img.resize({ width: 24, height: 24, quality: 'good' });
  const bmp = small.toBitmap(); // BGRA
  let r = 0, g = 0, b = 0, wsum = 0;
  for (let i = 0; i < bmp.length; i += 4) {
    const B = bmp[i], G = bmp[i + 1], R = bmp[i + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    const sat = mx ? (mx - mn) / mx : 0, lum = (mx + mn) / 510;
    const w = 0.15 + sat * 1.5 * (1 - Math.abs(lum - 0.5));
    r += R * w; g += G * w; b += B * w; wsum += w;
  }
  const c = [Math.round(r / wsum), Math.round(g / wsum), Math.round(b / wsum)];
  colorCache.set(url, c);
  return c;
});

// ---------- тексты песен ----------
const LYRICS_KEY = 'p93jhgh689SBReK6ghtw62';
function parseLrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) {
      const t = (+m[1]) * 60 + (+m[2]) + (m[3] ? +('0.' + m[3].padStart(2, '0')) : 0);
      lines.push({ t, text: body });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}
async function yaLyrics(rawId) {
  for (const format of ['LRC', 'TEXT']) {
    try {
      const ts = Math.floor(Date.now() / 1000);
      const sign = crypto.createHmac('sha256', LYRICS_KEY).update(`${rawId}${ts}`).digest('base64');
      const r = await ya(`/tracks/${rawId}/lyrics`, { query: { format, timeStamp: ts, sign } });
      if (!r || !r.downloadUrl) continue;
      const text = await (await fetch(r.downloadUrl)).text();
      const writers = (r.writers || []).join(', ');
      if (format === 'LRC') { const lines = parseLrc(text); if (lines.length) return { synced: true, lines, source: 'Яндекс Музыка', writers }; }
      else if (text.trim()) return { synced: false, text: text.trim(), source: 'Яндекс Музыка', writers };
    } catch {}
  }
  return null;
}
async function lrclib(artist, title, duration) {
  const clean = s => (s || '').replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const headers = { 'User-Agent': 'Splav/1.2 (desktop music player)' };
  const pick = d => d && (d.syncedLyrics ? { synced: true, lines: parseLrc(d.syncedLyrics), source: 'LRCLIB' } : d.plainLyrics ? { synced: false, text: d.plainLyrics.trim(), source: 'LRCLIB' } : null);
  try {
    const u = new URL('https://lrclib.net/api/get');
    u.searchParams.set('artist_name', clean(artist).split(',')[0]); u.searchParams.set('track_name', clean(title));
    if (duration) u.searchParams.set('duration', String(Math.round(duration)));
    const r = await fetch(u, { headers });
    if (r.ok) { const p = pick(await r.json()); if (p) return p; }
  } catch {}
  try {
    const u = new URL('https://lrclib.net/api/search');
    u.searchParams.set('q', `${clean(artist).split(',')[0]} ${clean(title)}`);
    const r = await fetch(u, { headers });
    if (r.ok) {
      const list = await r.json();
      const best = list.find(d => d.syncedLyrics && (!duration || Math.abs(d.duration - duration) < 4)) || list.find(d => d.syncedLyrics) || list[0];
      return pick(best);
    }
  } catch {}
  return null;
}
const lyricsCache = new Map();
handle('lyrics', async (track) => {
  const k = track.source + ':' + track.rawId;
  if (lyricsCache.has(k)) return lyricsCache.get(k);
  let res = null;
  if (track.source === 'ya') res = await yaLyrics(track.rawId);
  if (!res || !res.synced) {
    const alt = await lrclib(track.artist, track.title, track.duration);
    if (alt && (!res || alt.synced)) res = alt;
  }
  lyricsCache.set(k, res);
  return res;
});


// ---------- плейлисты ----------
const PL_PATH = () => path.join(app.getPath('userData'), 'playlists.json');
let playlists = [];
function loadPlaylists() { try { playlists = JSON.parse(fs.readFileSync(PL_PATH(), 'utf8')); } catch { playlists = []; } }
function savePlaylists() { fs.writeFileSync(PL_PATH(), JSON.stringify(playlists)); }
const slim = t => { const o = { ...t }; delete o._media; delete o._auth; return o; };
handle('playlists', async () => playlists);
handle('playlistSave', async (pl) => {
  pl = { ...pl, tracks: (pl.tracks || []).map(slim), updatedAt: Date.now() };
  if (!pl.id) { pl.id = 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); pl.createdAt = Date.now(); playlists.unshift(pl); }
  else { const i = playlists.findIndex(x => x.id === pl.id); if (i >= 0) playlists[i] = { ...playlists[i], ...pl }; else playlists.unshift(pl); }
  savePlaylists(); return pl;
});
handle('playlistDelete', async (id) => { playlists = playlists.filter(p => p.id !== id); savePlaylists(); return true; });
handle('importPlaylist', async (link) => {
  const url = new URL(link.trim());
  let name = 'Импортированный плейлист', tracks = [], cover = null;
  if (/music\.yandex\./.test(url.hostname)) {
    let m;
    if ((m = /\/users\/([^/]+)\/playlists\/(\d+)/.exec(url.pathname))) {
      const p = await ya(`/users/${m[1]}/playlists/${m[2]}`);
      name = p.title; cover = p.cover && p.cover.uri ? yaCover(p.cover.uri) : null;
      const items = p.tracks || [];
      const full = items.map(x => x.track).filter(Boolean).map(yaTrack).filter(Boolean);
      tracks = full.length === items.length ? full : await yaTracksByIds(items.map(x => x.albumId ? `${x.id}:${x.albumId}` : String(x.id)));
    } else if ((m = /\/playlists?\/([\w.-]+)/.exec(url.pathname))) {
      const p = await ya(`/playlist/${m[1]}`);
      name = p.title; cover = p.cover && p.cover.uri ? yaCover(p.cover.uri) : null;
      const items = p.tracks || [];
      const full = items.map(x => x.track).filter(Boolean).map(yaTrack).filter(Boolean);
      tracks = full.length ? full : await yaTracksByIds(items.map(x => String(x.id)));
    } else if ((m = /\/album\/(\d+)/.exec(url.pathname))) {
      const a = await ya(`/albums/${m[1]}/with-tracks`);
      name = a.title; cover = yaCover(a.coverUri); tracks = (a.volumes || []).flat().map(yaTrack).filter(Boolean);
    } else throw new Error('Не понял ссылку Яндекс Музыки: нужна ссылка на плейлист или альбом');
  } else if (/soundcloud\.com$/.test(url.hostname) || /on\.soundcloud\.com$/.test(url.hostname)) {
    const r = await sc('/resolve', { url: link.trim() });
    if (r.kind === 'playlist') { name = r.title; tracks = remember(await scFillTracks(r.tracks || [])); cover = scAlbum(r).cover; }
    else if (r.kind === 'track') { const t = scTrack(r); name = t.title; tracks = remember([t]); cover = t.cover; }
    else throw new Error('Нужна ссылка на плейлист, альбом или трек SoundCloud');
  } else throw new Error('Поддерживаются ссылки Яндекс Музыки и SoundCloud');
  const pl = { id: 'pl' + Date.now().toString(36), name, cover, link: link.trim(), createdAt: Date.now(), updatedAt: Date.now(), tracks: tracks.map(slim) };
  playlists.unshift(pl); savePlaylists();
  return pl;
});

// ---------- история и итоги месяца ----------
const HIST_PATH = () => path.join(app.getPath('userData'), 'history.json');
let history = [];
function loadHistory() { try { history = JSON.parse(fs.readFileSync(HIST_PATH(), 'utf8')); } catch { history = []; } }
let histTimer = null;
handle('historyAdd', async (e) => {
  history.push({ ...e, ts: Date.now() });
  if (history.length % 50 === 0) alarmTick();
  if (history.length > 30000) history = history.slice(-30000);
  clearTimeout(histTimer); histTimer = setTimeout(() => fs.writeFile(HIST_PATH(), JSON.stringify(history), () => {}), 1500);
  return true;
});
handle('wrapped', async (ym) => {
  const [y, m] = ym ? ym.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  const from = new Date(y, m - 1, 1).getTime(), to = new Date(y, m, 1).getTime();
  const items = history.filter(h => h.ts >= from && h.ts < to);
  const tracks = new Map(), artists = new Map();
  let seconds = 0;
  for (const h of items) {
    seconds += h.seconds || 0;
    const t = tracks.get(h.key) || { key: h.key, title: h.title, artist: h.artist, cover: h.cover, plays: 0, seconds: 0 };
    t.plays++; t.seconds += h.seconds || 0; tracks.set(h.key, t);
    for (const name of (h.artistNames && h.artistNames.length ? h.artistNames : [h.artist])) {
      const a = artists.get(name) || { name, plays: 0, seconds: 0, cover: h.cover }; a.plays++; a.seconds += h.seconds || 0; artists.set(name, a);
    }
  }
  const byPlays = (a, b) => b.plays - a.plays || b.seconds - a.seconds;
  return { year: y, month: m, plays: items.length, minutes: Math.round(seconds / 60), uniqueTracks: tracks.size, uniqueArtists: artists.size,
    topTracks: [...tracks.values()].sort(byPlays).slice(0, 5), topArtists: [...artists.values()].sort(byPlays).slice(0, 5) };
});
handle('saveImage', async ({ rect, name }) => {
  const img = await mainWindow.webContents.capturePage(rect);
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('pictures'), name + '.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, img.toPNG());
  return r.filePath;
});

// ---------- мини-плеер в строке меню ----------
let tray = null, trayWin = null, lastNp = null;
function setupTray() {
  if (!config.prefs.tray) { if (tray) { tray.destroy(); tray = null; } if (trayWin) { trayWin.destroy(); trayWin = null; } return; }
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Сплав');
  trayWin = new BrowserWindow({
    width: 340, height: 148, show: false, frame: false, resizable: false, movable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, transparent: true, hasShadow: true, vibrancy: 'hud', visualEffectState: 'active',
    webPreferences: { preload: path.join(__dirname, 'tray', 'tray-preload.js'), contextIsolation: true },
  });
  trayWin.loadFile(path.join(__dirname, 'tray', 'tray.html'));
  trayWin.on('blur', () => { if (trayWin && !trayWin.webContents.isDevToolsOpened()) trayWin.hide(); });
  trayWin.webContents.on('did-finish-load', () => { if (lastNp) trayWin.webContents.send('np', lastNp); });
  tray.on('click', () => {
    if (!trayWin) return;
    if (trayWin.isVisible()) { trayWin.hide(); return; }
    const b = tray.getBounds(), w = trayWin.getBounds();
    const disp = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
    const x = Math.min(Math.max(disp.x + 8, Math.round(b.x + b.width / 2 - w.width / 2)), disp.x + disp.width - w.width - 8);
    trayWin.setPosition(x, Math.round(b.y + b.height + 6));
    trayWin.show(); trayWin.focus();
  });
}
ipcMain.on('np:update', (_e, data) => { lastNp = data; if (trayWin) trayWin.webContents.send('np', data); });
ipcMain.on('tray:cmd', (_e, cmd) => {
  if (cmd === 'open') { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } if (trayWin) trayWin.hide(); return; }
  if (mainWindow) mainWindow.webContents.send('cmd', cmd);
});

function registerMediaProtocol() {
  protocol.handle('splav', async (req) => {
    const u = new URL(req.url);
    const file = decodeURIComponent(u.pathname.replace(/^\//, ''));
    let st; try { st = fs.statSync(file); } catch { return new Response('not found', { status: 404 }); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.get('range');
    const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      let start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : st.size - 1;
      if (!m[1] && m[2]) { start = st.size - +m[2]; end = st.size - 1; }
      end = Math.min(end, st.size - 1);
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'Content-Length': String(st.size) } });
  });
}
function allowAudioCors() {
  // разрешаем Web Audio читать потоки (эквалайзер, кроссфейд, выравнивание громкости)
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!/^https?:/.test(details.url)) return cb({});
    const h = { ...details.responseHeaders };
    for (const k of Object.keys(h)) if (k.toLowerCase() === 'access-control-allow-origin') delete h[k];
    h['Access-Control-Allow-Origin'] = ['*'];
    cb({ responseHeaders: h });
  });
}


// ---------- общие ключи сервисов (можно вшить в сборку через keys.json) ----------
let bundledKeys = {};
try { bundledKeys = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys.json'), 'utf8')); } catch {}
const K = name => (config.keys && config.keys[name]) || bundledKeys[name] || '';

// ---------- жанры для гостевой волны ----------
const GENRES = {
  rap: { sc: 'rap', au: 'Hip-Hop/Rap', ja: 'hiphop' },
  phonk: { sc: 'phonk', au: 'Hip-Hop/Rap', ja: 'hiphop' },
  pop: { sc: 'pop', au: 'Pop', ja: 'pop' },
  indie: { sc: 'indie', au: 'Alternative', ja: 'indie' },
  rock: { sc: 'rock', au: 'Rock', ja: 'rock' },
  electronic: { sc: 'electronic', au: 'Electronic', ja: 'electronic' },
  techno: { sc: 'techno', au: 'Techno', ja: 'techno' },
  house: { sc: 'house', au: 'House', ja: 'house' },
  lofi: { sc: 'lofi', au: 'Lo-Fi', ja: 'lounge' },
  ambient: { sc: 'ambient', au: 'Ambient', ja: 'ambient' },
  jazz: { sc: 'jazz', au: 'Jazz', ja: 'jazz' },
  classical: { sc: 'classical', au: 'Classical', ja: 'classical' },
  rnb: { sc: 'r&b', au: 'R&B/Soul', ja: 'rnb' },
};
const MOOD_AU = { calm: ['Ambient', 'Lo-Fi', 'Jazz'], sad: ['Ambient', 'Alternative'], active: ['Techno', 'Drum & Bass', 'House', 'Dubstep'], fun: ['House', 'Pop', 'Disco'] };
const MOOD_JA = { calm: 'relaxation', sad: 'sad', active: 'energetic', fun: 'happy' };

// ---------- локальные лайки (гостевой режим) ----------
const GL_PATH = () => path.join(app.getPath('userData'), 'guest-likes.json');
let guestLikes = [];
function loadGuestLikes() { try { guestLikes = JSON.parse(fs.readFileSync(GL_PATH(), 'utf8')); } catch { guestLikes = []; } }
function setGuestLike(track, on) {
  const k = track.source + ':' + track.rawId;
  guestLikes = guestLikes.filter(x => x.track.source + ':' + x.track.rawId !== k);
  if (on) { const t = { ...track }; delete t._media; delete t._auth; guestLikes.unshift({ track: t, at: Date.now() }); }
  fs.writeFileSync(GL_PATH(), JSON.stringify(guestLikes));
}

// ---------- Audius (открытый API, бесплатно) ----------
const AU_API = 'https://api.audius.co/v1', AU_APP = 'Splav';
async function au(p, q = {}) {
  const u = new URL(AU_API + p); u.searchParams.set('app_name', AU_APP);
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Audius: ' + r.status);
  return (await r.json()).data;
}
function auTrack(t) {
  if (!t || !t.id) return null;
  return {
    id: 'au:' + t.id, rawId: String(t.id), source: 'au', title: t.title,
    artist: (t.user && t.user.name) || '', artists: t.user ? [{ id: String(t.user.id), name: t.user.name, source: 'au' }] : [],
    duration: t.duration || 0, cover: t.artwork ? (t.artwork['480x480'] || t.artwork['1000x1000'] || t.artwork['150x150']) : null,
    _genre: t.genre || '', _tags: [t.tags, t.mood].filter(Boolean).join(' '), plays: t.play_count || 0,
    available: t.is_streamable !== false && !t.is_stream_gated, permalink: t.permalink ? 'https://audius.co' + t.permalink : null,
  };
}
const auSearch = async q => ((await au('/tracks/search', { query: q })) || []).slice(0, 20).map(auTrack).filter(Boolean);
async function auWave(ws, genres, need) {
  const pool = [...(genres || []).map(g => GENRES[g] && GENRES[g].au).filter(Boolean), ...(MOOD_AU[ws.moodEnergy] || [])];
  const genre = pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
  const list = ((await au('/tracks/trending', { genre, time: Math.random() < 0.5 ? 'month' : 'allTime' })) || []).map(auTrack).filter(Boolean);
  return list.filter(t => t.available && scFits(t, ws)).sort(() => Math.random() - 0.5).slice(0, need);
}

// ---------- Jamendo (Creative Commons, нужен бесплатный client_id) ----------
const JA_API = 'https://api.jamendo.com/v3.0';
async function ja(p, q = {}) {
  const u = new URL(JA_API + p);
  u.searchParams.set('client_id', K('jamendo')); u.searchParams.set('format', 'json'); u.searchParams.set('include', 'musicinfo'); u.searchParams.set('audioformat', 'mp32');
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  const r = await fetch(u); const d = await r.json();
  if (!d.headers || d.headers.status !== 'success') throw new Error('Jamendo: ' + ((d.headers && d.headers.error_message) || r.status));
  return d.results || [];
}
function jaTrack(t) {
  const mi = t.musicinfo || {}, tags = mi.tags || {};
  return {
    id: 'ja:' + t.id, rawId: String(t.id), source: 'ja', title: t.name, artist: t.artist_name,
    artists: [{ id: String(t.artist_id), name: t.artist_name, source: 'ja' }],
    duration: t.duration || 0, cover: t.album_image || t.image || null, url: t.audio,
    dlUrl: t.audiodownload_allowed ? t.audiodownload : null, downloadable: !!t.audiodownload_allowed,
    _genre: (tags.genres || []).join(' '), _tags: [...(tags.vartags || []), ...(tags.instruments || []), mi.vocalinstrumental === 'instrumental' ? 'instrumental' : ''].join(' '),
    available: !!t.audio, permalink: t.shareurl,
  };
}
const jaSearch = async q => (await ja('/tracks/', { search: q, limit: 20 })).map(jaTrack);
async function jaStreamUrl(id) { const r = await ja('/tracks/', { id }); if (!r[0]) throw new Error('Трек Jamendo недоступен'); return r[0].audio; }
async function jaWave(ws, genres, need) {
  const liked = guestLikes.map(x => x.track).filter(t => t.source === 'ja');
  let list = [];
  if (liked.length && ws.diversity !== 'discover' && Math.random() < 0.6) {
    const seed = liked[Math.floor(Math.random() * liked.length)];
    try { list = (await ja('/tracks/similar/', { id: seed.rawId, limit: 20 })).map(jaTrack); } catch {}
  }
  if (list.length < need) {
    const tags = [...(genres || []).map(g => GENRES[g] && GENRES[g].ja).filter(Boolean)];
    const q = { limit: 30, order: ws.diversity === 'popular' ? 'popularity_total' : 'popularity_month', offset: Math.floor(Math.random() * 5) * 30 };
    if (tags.length) q.tags = tags[Math.floor(Math.random() * tags.length)];
    if (MOOD_JA[ws.moodEnergy]) q.fuzzytags = MOOD_JA[ws.moodEnergy];
    if (ws.language === 'without-words') q.vocalinstrumental = 'instrumental';
    try { list.push(...(await ja('/tracks/', q)).map(jaTrack)); } catch {}
  }
  return list.filter(t => t.available && scFits(t, ws)).sort(() => Math.random() - 0.5).slice(0, need);
}

// ---------- гостевая волна: SoundCloud + Audius + Jamendo по локальному вкусу ----------
async function guestWave(ws, likedScIds) {
  const genres = config.prefs.guestGenres || [];
  const localSc = guestLikes.map(x => x.track).filter(t => t.source === 'sc');
  remember(localSc);
  const seeds = [...new Set([...likedScIds, ...localSc.map(t => t.rawId)])];
  const ruOnly = ws.language === 'russian';
  const [scL, auL, jaL] = await Promise.all([
    scWaveTracks(seeds, ws, ruOnly ? 8 : 4, genres).catch(() => []),
    ruOnly ? [] : auWave(ws, genres, 3).catch(() => []),
    ruOnly || !K('jamendo') ? [] : jaWave(ws, genres, 3).catch(() => []),
  ]);
  const out = [], lists = [scL, auL, jaL];
  for (let i = 0; out.length < 12 && lists.some(l => l.length); i++) { const l = lists[i % 3]; if (l.length) out.push(l.shift()); }
  out.forEach(t => { if (t.source !== 'sc') rememberRecent(t); });
  return out;
}

// ---------- Звук (вход своим аккаунтом) ----------
const ZV_GQL = 'https://zvuk.com/api/v1/graphql', ZV_TINY = 'https://zvuk.com/api/tiny';
const ZV_HEAD = { Accept: 'application/json', 'Content-Type': 'application/json', Origin: 'https://zvuk.com', Referer: 'https://zvuk.com/', 'Accept-Language': 'ru-RU,ru;q=0.9', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
async function zv(query, variables = {}) {
  const r = await fetch(ZV_GQL, { method: 'POST', headers: { ...ZV_HEAD, 'X-Auth-Token': config.zvToken }, body: JSON.stringify({ query, variables }) });
  if (r.status === 401 || r.status === 403) throw new Error('Звук: войдите заново');
  const d = await r.json().catch(() => ({}));
  if (d.errors && d.errors.length && !d.data) throw new Error('Звук: ' + d.errors[0].message);
  return d.data || {};
}
async function zvProfile(token) {
  const r = await fetch(ZV_TINY + '/profile', { headers: { ...ZV_HEAD, 'X-Auth-Token': token } });
  const d = await r.json().catch(() => ({}));
  const res = d.result || {}, pr = res.profile || res;
  const anon = pr.is_anonymous ?? pr.isAnonymous ?? res.is_anonymous ?? (pr.is_registered === false);
  return { anon: !!anon, name: pr.name || [pr.first_name, pr.last_name].filter(Boolean).join(' ') || pr.email || '', token: res.token || pr.token, sub: !!(res.subscription || pr.subscription) };
}
const zvImg = src => { if (!src) return null; let u = src.startsWith('/') ? 'https://zvuk.com' + src : src; u = u.replace('{size}', '600x600'); return /size=/.test(u) ? u.replace(/size=[^&]*/, 'size=600x600') : u; };
const ZV_TRACK_FIELDS = 'id title duration explicit artists { id title } release { id title date image { src } }';
function zvTrack(t) {
  if (!t || !t.id) return null;
  const rel = t.release || {};
  return {
    id: 'zv:' + t.id, rawId: String(t.id), source: 'zv', title: t.title,
    artist: (t.artists || []).map(a => a.title).join(', '), artists: [],
    album: rel.title || '', albumId: null, duration: t.duration || 0, cover: zvImg(rel.image && rel.image.src), available: true,
  };
}
async function zvSearch(q) {
  const d = await zv(`query search($query: String, $limit: Int) { search(query: $query) { tracks(limit: $limit) { items { ${ZV_TRACK_FIELDS} } } } }`, { query: q, limit: 25 });
  return ((d.search && d.search.tracks && d.search.tracks.items) || []).map(zvTrack).filter(Boolean);
}
async function zvLikes() {
  const d = await zv('query userTracks($orderBy: TrackOrderByType, $orderDirection: OrderDirectionType) { collection { tracks(orderBy: $orderBy, orderDirection: $orderDirection) { id } } }', { orderBy: 'dateAdded', orderDirection: 'desc' });
  const ids = ((d.collection && d.collection.tracks) || []).map(t => String(t.id));
  const out = [];
  for (let i = 0; i < ids.length && i < 2000; i += 100) {
    const r = await zv(`query getTracks($ids: [ID!]!) { getTracks(ids: $ids) { ${ZV_TRACK_FIELDS} } }`, { ids: ids.slice(i, i + 100) });
    out.push(...(r.getTracks || []).map(zvTrack).filter(Boolean));
  }
  return out;
}
async function zvStream(id) {
  const d = await zv('query getStream($ids: [ID!]!) { mediaContents(ids: $ids) { ... on Track { stream { expire high mid } } } }', { ids: [String(id)] });
  const st = d.mediaContents && d.mediaContents[0] && d.mediaContents[0].stream;
  const url = st && (st.high || st.mid);
  if (!url) throw new Error('Звук не отдал трек: возможно, нужна подписка');
  return url;
}
function zvukLogin() {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ width: 520, height: 760, title: 'Вход в Звук', parent: mainWindow, modal: true, webPreferences: { partition: 'persist:zvuk' } });
    let done = false;
    const timer = setInterval(async () => {
      try {
        const r = await win.webContents.executeJavaScript("fetch('/api/tiny/profile', { credentials: 'include' }).then(r => r.json()).catch(() => null)");
        const res = (r && r.result) || {}, pr = res.profile || res;
        const anon = pr.is_anonymous ?? pr.isAnonymous ?? res.is_anonymous;
        const token = res.token || pr.token;
        if (token && anon === false && !done) { done = true; clearInterval(timer); config.zvToken = token; saveConfig(); win.close(); resolve(true); }
      } catch {}
    }, 2000);
    win.on('closed', () => { clearInterval(timer); if (!done) reject(new Error('Вход отменён')); });
    win.loadURL('https://zvuk.com/login');
  });
}

// ---------- Apple Music через приложение «Музыка» на Mac ----------
function jxa(code, timeout = 20000) {
  return new Promise((resolve, reject) => execFile('osascript', ['-l', 'JavaScript', '-e', code], { maxBuffer: 64 << 20, timeout }, (e, out, err) => e ? reject(new Error((err || e.message).trim())) : resolve(out.trim())));
}
async function amCheck() {
  if (process.platform !== 'darwin') throw new Error('Apple Music доступна только на Mac');
  try { await jxa("Application('Music').name()"); }
  catch (e) { throw new Error('Разрешите Сплаву управлять приложением «Музыка»: Системные настройки → Конфиденциальность → Автоматизация'); }
}
async function amLibrary() {
  const out = await jxa(`(() => { const M = Application('Music'); const t = M.libraryPlaylists[0].tracks; const n = Math.min(t.length, 5000);
    if (!n) return '[]'; const r = t.slice ? null : null;
    const names = t.name(), artists = t.artist(), albums = t.album(), durs = t.duration(), ids = t.persistentID();
    const res = []; for (let i = 0; i < n; i++) res.push([ids[i], names[i], artists[i], albums[i], durs[i]]); return JSON.stringify(res); })()`, 60000);
  return JSON.parse(out || '[]').map(([pid, title, artist, album, dur]) => ({ id: 'am:' + pid, rawId: pid, source: 'am', title, artist: artist || '', album: album || '', duration: Math.round(dur || 0), cover: null, artists: [], available: true }));
}
handle('amPlay', async (pid) => { await jxa(`(() => { const M = Application('Music'); const tr = M.libraryPlaylists[0].tracks.whose({ persistentID: ${JSON.stringify(pid)} })[0]; M.play(tr); return 'ok'; })()`); return true; });
handle('amState', async () => {
  try { const s = await jxa(`(() => { const M = Application('Music'); const st = M.playerState(); let id = '', d = 0, p = 0; try { id = M.currentTrack.persistentID(); d = M.currentTrack.duration(); p = M.playerPosition(); } catch (e) {} return JSON.stringify({ st, id, d, p }); })()`, 4000); return JSON.parse(s); }
  catch { return { st: 'stopped' }; }
});
handle('amCmd', async ({ cmd, value }) => {
  const c = cmd === 'pause' ? 'M.pause()' : cmd === 'play' ? 'M.play()' : cmd === 'toggle' ? 'M.playpause()' : cmd === 'seek' ? `M.playerPosition = ${Number(value) || 0}` : cmd === 'volume' ? `M.soundVolume = ${Math.round((Number(value) || 0) * 100)}` : '';
  if (c) await jxa(`(() => { const M = Application('Music'); ${c}; return 'ok'; })()`, 5000).catch(() => {});
  return true;
});
const itCache = new Map();
handle('amCover', async ({ artist, title }) => {
  const k = artist + '|' + title; if (itCache.has(k)) return itCache.get(k);
  try {
    const u = new URL('https://itunes.apple.com/search'); u.searchParams.set('term', `${artist} ${title}`); u.searchParams.set('entity', 'song'); u.searchParams.set('limit', '1');
    const d = await (await fetch(u)).json();
    const url = d.results && d.results[0] && d.results[0].artworkUrl100 ? d.results[0].artworkUrl100.replace('100x100bb', '600x600bb') : null;
    itCache.set(k, url); return url;
  } catch { return null; }
});

// ---------- Last.fm ----------
const LFM = 'https://ws.audioscrobbler.com/2.0/';
function lfmSig(params) { const str = Object.keys(params).filter(k => k !== 'format' && k !== 'callback').sort().map(k => k + params[k]).join('') + K('lastfmSecret'); return crypto.createHash('md5').update(str, 'utf8').digest('hex'); }
async function lfm(method, params = {}, post = false) {
  const p = { method, api_key: K('lastfmKey'), ...params };
  if (post || params.sk || method.startsWith('auth.')) p.api_sig = lfmSig(p);
  p.format = 'json';
  const body = new URLSearchParams(p).toString();
  const r = post ? await fetch(LFM, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }) : await fetch(LFM + '?' + body);
  const d = await r.json();
  if (d.error) throw new Error('Last.fm: ' + d.message);
  return d;
}
async function lastfmLogin() {
  if (!K('lastfmKey') || !K('lastfmSecret')) throw new Error('Сначала укажите API-ключ и секрет Last.fm');
  const { token } = await lfm('auth.getToken');
  shell.openExternal(`https://www.last.fm/api/auth/?api_key=${K('lastfmKey')}&token=${token}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try { const d = await lfm('auth.getSession', { token }); config.lfmSession = d.session.key; config.lfmUser = d.session.name; config.prefs.lastfm = true; saveConfig(); return true; } catch {}
  }
  throw new Error('Не дождались подтверждения на сайте Last.fm');
}
handle('scrobble', async ({ type, t, ts }) => {
  if (!config.lfmSession || !config.prefs.lastfm || !K('lastfmKey')) return false;
  const base = { artist: (t.artist || '').split(',')[0].trim(), track: t.title, sk: config.lfmSession };
  if (t.album) base.album = t.album;
  if (t.duration) base.duration = String(t.duration);
  if (type === 'now') await lfm('track.updateNowPlaying', base, true);
  else await lfm('track.scrobble', { ...base, timestamp: String(ts) }, true);
  return true;
});

// ---------- Discord: статус «Слушает» ----------
const rpc = { sock: null, ready: false, clientId: null, pending: null };
function rpcSend(op, payload) {
  if (!rpc.sock) return;
  const json = Buffer.from(JSON.stringify(payload)); const h = Buffer.alloc(8);
  h.writeUInt32LE(op, 0); h.writeUInt32LE(json.length, 4);
  rpc.sock.write(Buffer.concat([h, json]));
}
function rpcConnect() {
  const id = K('discordId'); if (!id || !config.prefs.discord) return;
  if (rpc.sock && rpc.clientId === id) return;
  if (rpc.sock) { try { rpc.sock.destroy(); } catch {} rpc.sock = null; }
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
  const tryN = n => {
    if (n > 9) return;
    const s = net.createConnection(path.join(base, `discord-ipc-${n}`));
    s.once('error', () => tryN(n + 1));
    s.once('connect', () => {
      rpc.sock = s; rpc.clientId = id; rpc.ready = false;
      s.on('data', buf => { try { const d = JSON.parse(buf.slice(8).toString()); if (d.evt === 'READY') { rpc.ready = true; if (rpc.pending) setPresence(rpc.pending); } } catch {} });
      s.on('close', () => { rpc.sock = null; rpc.ready = false; });
      s.on('error', () => {});
      rpcSend(0, { v: 1, client_id: id });
    });
  };
  tryN(0);
}
function setPresence(a) {
  rpc.pending = a;
  if (!rpc.sock) { rpcConnect(); return; }
  if (!rpc.ready) return;
  rpcSend(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: a }, nonce: crypto.randomUUID() });
}
handle('presence', async (d) => {
  if (!config.prefs.discord || !K('discordId')) { if (rpc.sock) setPresence(null); return false; }
  if (!d) { setPresence(null); return true; }
  const now = Date.now();
  const act = { type: 2, details: d.title.slice(0, 120), state: (d.artist || ' ').slice(0, 120), instance: false,
    assets: { large_image: d.cover && /^https:/.test(d.cover) ? d.cover : 'splav', large_text: (d.album || d.title).slice(0, 120), small_text: 'Сплав' } };
  if (d.playing && d.duration) act.timestamps = { start: now - d.position * 1000, end: now + (d.duration - d.position) * 1000 };
  if (!d.playing) act.state = 'На паузе: ' + act.state;
  setPresence(act);
  return true;
});


// ---------- волна по треку и по артисту ----------
async function stationTracks(st, lastYaId, ws) {
  const loose = { ...ws, language: 'any', moodEnergy: 'all' };      // у станции свой характер, языковые фильтры не мешают
  const fits = t => t && t.available !== false && !recentSc.ids.includes(t.rawId);
  let out = [];
  try {
    if (st.source === 'ya' && config.yaToken) {
      out = await yaWaveTracks(lastYaId, `${st.type}:${st.id}`);
    } else if (st.source === 'sc') {
      if (st.type === 'track') {
        const r = await sc(`/tracks/${st.id}/related`, { limit: 30 });
        out = (r.collection || []).map(scTrack).filter(fits);
      } else {
        const [top, rel] = await Promise.all([
          sc(`/users/${st.id}/toptracks`, { limit: 20 }).catch(() => ({ collection: [] })),
          sc(`/users/${st.id}/tracks`, { limit: 20 }).catch(() => ({ collection: [] })),
        ]);
        const own = [...(top.collection || []), ...(rel.collection || [])].map(scTrack).filter(fits);
        let related = [];
        if (own[0]) { try { related = ((await sc(`/tracks/${own[Math.floor(Math.random() * Math.min(5, own.length))].rawId}/related`, { limit: 20 })).collection || []).map(scTrack).filter(fits); } catch {} }
        out = [];
        for (let i = 0; out.length < 12 && (own.length || related.length); i++) out.push((i % 3 === 0 ? own : related).shift() || own.shift() || related.shift());
        out = out.filter(Boolean);
      }
      remember(out);
    } else if (st.source === 'au') {
      if (st.type === 'artist') out = ((await au(`/users/${st.id}/tracks`, { limit: 30 })) || []).map(auTrack).filter(fits);
      else { const g = st.genre; out = ((await au('/tracks/trending', { genre: g || undefined, time: 'month' })) || []).map(auTrack).filter(fits); }
    } else if (st.source === 'ja' && K('jamendo')) {
      out = st.type === 'track' ? (await ja('/tracks/similar/', { id: st.id, limit: 25 })).map(jaTrack) : (await ja('/tracks/', { artist_id: st.id, limit: 30, order: 'popularity_total' })).map(jaTrack);
      out = out.filter(fits);
    }
  } catch {}
  if (!out.length && st.artist) {
    // источник станции недоступен: ищем артиста там, где можно слушать
    const q = st.type === 'track' && st.title ? `${st.artist} ${st.title}` : st.artist;
    if (config.yaToken) {
      try {
        const r = await ya('/search', { query: { text: q, type: st.type === 'artist' ? 'artist' : 'track', page: 0 } });
        const hit = st.type === 'artist' ? r.artists && r.artists.results && r.artists.results[0] : r.tracks && r.tracks.results && r.tracks.results[0];
        if (hit) out = await yaWaveTracks(lastYaId, `${st.type}:${hit.id}`);
      } catch {}
    }
    if (!out.length) {
      try {
        const r = await sc('/search/tracks', { q, limit: 5 });
        const first = (r.collection || [])[0];
        if (first) out = ((await sc(`/tracks/${first.id}/related`, { limit: 25 })).collection || []).map(scTrack).filter(fits);
        remember(out);
      } catch {}
    }
  }
  out = out.sort(() => Math.random() - 0.5 * (st.source === 'ya' ? 0 : 1)).slice(0, 12);
  out.forEach(rememberRecent);
  void loose;
  return out;
}

// ---------- статистика для умных плейлистов ----------
handle('historyStats', async () => {
  const map = {};
  for (const h of history) {
    const m = map[h.key] || (map[h.key] = { key: h.key, plays: 0, secs: 0, last: 0, first: h.ts, plays30: 0, wave: 0, full: 0, t: null });
    m.plays++; m.secs += h.seconds || 0; m.last = Math.max(m.last, h.ts);
    if (h.ts > Date.now() - 30 * 864e5) m.plays30++;
    if (h.w) m.wave++;
    if (h.full) m.full++;
    if (h.t) m.t = h.t;
  }
  return Object.values(map);
});

// ---------- «Слушать вместе» ----------
const ROOM_SERVER = () => (K('server') || '').replace(/\/+$/, '');
handle('room', async (b) => {
  const base = ROOM_SERVER();
  if (!base) throw new Error('Не указан адрес сервера: Профиль → Интеграции → Сервер');
  if (b.action === 'state') {
    const u = new URL(base + '/api/room'); u.searchParams.set('code', b.code); u.searchParams.set('v', String(b.v || 0)); if (b.members) u.searchParams.set('members', '1');
    const r = await fetch(u); const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Сервер недоступен');
    return d;
  }
  const r = await fetch(base + '/api/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Сервер недоступен');
  return d;
});

handle('focusWindow', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); app.focus({ steal: true }); }
  return true;
});

handle('health', async () => {
  const base = ROOM_SERVER(); if (!base) return { ok: false, db: 'none' };
  const r = await fetch(base + '/api/health'); return r.json();
});

// ---------- друзья ----------
async function socialCall(body) {
  const base = ROOM_SERVER();
  if (!base) throw new Error('Не указан адрес сервера: Профиль → Интеграции → Сервер');
  const r = await fetch(base + '/api/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || 'Сервер недоступен'); e.status = r.status; throw e; }
  return d;
}
handle('social', async (b) => {
  const S = config.social;
  if (b.action === 'local') return S ? { name: S.name, id: S.uid, read: S.read || {} } : null;
  if (b.action === 'register') {
    const d = await socialCall({ action: 'register', name: b.name });
    config.social = { uid: d.id, secret: d.secret, name: d.name, read: {} }; saveConfig();
    return { name: d.name, id: d.id, read: {} };
  }
  if (b.action === 'read') { if (S) { S.read = { ...(S.read || {}), [b.id]: b.ts }; saveConfig(); } return true; }
  if (b.action === 'forget') { config.social = null; saveConfig(); return true; }
  if (!S || !S.secret) throw new Error('Сначала создайте профиль');
  try { return await socialCall({ ...b, uid: S.uid, secret: S.secret }); }
  catch (e) { if (e.status === 401) { config.social = null; saveConfig(); e.message = 'Профиль не найден на сервере, создайте его заново'; } throw e; }
});

// ---------- автообновления ----------
let pendingUpdate = null;
function cmpVer(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; }
handle('updateCheck', async () => {
  const base = K('updateFeed') || (ROOM_SERVER() ? ROOM_SERVER() + '/api/latest' : '');
  if (!base) return { available: false, reason: 'no-feed' };
  const r = await fetch(base, { cache: 'no-store' }); if (!r.ok) return { available: false };
  const d = await r.json();
  if (!d.version || !d.url || cmpVer(d.version, app.getVersion()) <= 0) return { available: false, current: app.getVersion() };
  pendingUpdate = d;
  return { available: true, version: d.version, notes: d.notes || '', current: app.getVersion() };
});
handle('updateInstall', async () => {
  const d = pendingUpdate; if (!d) throw new Error('Обновление не найдено');
  if (process.platform !== 'darwin') { shell.openExternal(d.url); return { manual: true }; }
  const exe = app.getPath('exe');                                  // …/Сплав.app/Contents/MacOS/Сплав
  const bundle = exe.slice(0, exe.indexOf('.app/') + 4);
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'splav-upd-'));
  const zip = path.join(tmp, 'update.zip');
  const res = await fetch(d.url);
  if (!res.ok) throw new Error('Не удалось скачать обновление: ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(zip); const h = crypto.createHash('sha256'); let got = 0;
  for await (const chunk of res.body) { out.write(chunk); h.update(chunk); got += chunk.length; if (total && mainWindow) mainWindow.webContents.send('cmd', { updateProgress: got / total }); }
  await new Promise(r => out.end(r));
  if (d.sha256 && h.digest('hex') !== String(d.sha256).toLowerCase()) throw new Error('Файл обновления повреждён, попробуйте ещё раз');
  await new Promise((resolve, reject) => execFile('/usr/bin/ditto', ['-x', '-k', zip, tmp], e => e ? reject(new Error('Не удалось распаковать обновление')) : resolve()));
  const fresh = fs.readdirSync(tmp).find(n => n.endsWith('.app'));
  if (!fresh) throw new Error('В обновлении нет приложения');
  const script = path.join(tmp, 'swap.sh');
  fs.writeFileSync(script, `#!/bin/bash
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
rm -rf "${bundle}.old"
mv "${bundle}" "${bundle}.old" && mv "${path.join(tmp, fresh)}" "${bundle}" && rm -rf "${bundle}.old"
xattr -dr com.apple.quarantine "${bundle}" 2>/dev/null
open "${bundle}"
`);
  fs.chmodSync(script, 0o755);
  require('child_process').spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 300);
  return { ok: true };
});

// ---------- будильник ----------
const { powerSaveBlocker } = require('electron');
let alarmBlocker = null, alarmFiredKey = null;
function alarmTick() {
  const a = config.prefs.alarm;
  const on = !!(a && a.on);
  if (on && alarmBlocker === null) alarmBlocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && alarmBlocker !== null) { powerSaveBlocker.stop(alarmBlocker); alarmBlocker = null; }
  if (!on) return;
  const now = new Date();
  const [hh, mm] = String(a.time || '07:30').split(':').map(Number);
  const day = (now.getDay() + 6) % 7;                  // 0 — понедельник
  const days = a.days && a.days.length ? a.days : [0, 1, 2, 3, 4, 5, 6];
  const k = now.toDateString() + a.time;
  if (now.getHours() === hh && now.getMinutes() === mm && days.includes(day) && alarmFiredKey !== k) {
    alarmFiredKey = k;
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('cmd', { alarm: a }); }
    if (a.once) { config.prefs.alarm = { ...a, on: false }; saveConfig(); }
  }
}
setInterval(alarmTick, 15000);

// ---------- окно ----------
let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 640,
    backgroundColor: '#0b0b0d',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let pendingLink = null;
function handleLink(url) {
  const m = /^splavapp:\/\/(?:room|join)\/(\d{6})/.exec(url || '');
  if (!m) return;
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) { mainWindow.show(); mainWindow.webContents.send('cmd', { join: m[1].toUpperCase() }); }
  else pendingLink = m[1].toUpperCase();
}
app.on('open-url', (e, url) => { e.preventDefault(); handleLink(url); });
app.on('second-instance', (_e, argv) => { const l = argv.find(a => a.startsWith('splavapp://')); if (l) handleLink(l); if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
app.setAsDefaultProtocolClient('splavapp');
handle('pendingLink', async () => { const l = pendingLink; pendingLink = null; return l; });
handle('appVersion', async () => app.getVersion());

app.whenReady().then(() => {
  loadConfig();
  config.prefs = { crossfade: 0, normalize: false, eqOn: false, eqBands: [0, 0, 0, 0, 0], eqPreset: 'flat', timeOfDay: true, tray: true, ...(config.prefs || {}) };
  loadDownloads(); loadPlaylists(); loadHistory(); loadGuestLikes();
  config.keys = config.keys || {};
  registerMediaProtocol(); allowAudioCors();
  createWindow();
  setupTray();
  alarmTick();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
