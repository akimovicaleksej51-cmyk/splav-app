// «Вместе»: комнаты по коду из 6 цифр, друзья и отправка треков
import { API } from './api.js';
import { $, $$, esc, cssUrl, ico, toast, haptic, state, sheet, actions, push, pop, plural, onTab, timeAgo, bindRows, SOURCE } from './lib.js';
import { playTrack, playQueue, seekTo, curTime, isPlaying, audio, syncPlaying } from './player.js';

import { LocalNotifications } from '@capacitor/local-notifications';
import { isNative } from '../core/native.js';

/* ---------- уведомления: в приложении — всплывашка, в фоне — системное ---------- */
let notifId = 1;
const notifRoutes = new Map();
async function notify(title, body, go) {
  if (!document.hidden || !isNative) { toast(`${title}: ${body}`, go); return; }
  const id = notifId++; notifRoutes.set(id, go);
  LocalNotifications.schedule({ notifications: [{ id, title, body }] }).catch(() => {});
}
if (isNative) {
  LocalNotifications.addListener('localNotificationActionPerformed', e => {
    const go = notifRoutes.get(e.notification.id); if (go) setTimeout(go, 300);
  });
}
const goChat = id => async () => { (await import('./player.js')).closePlayer(); const { showTab } = await import('./lib.js'); showTab('together'); setTimeout(() => openChat(id), 120); };

/* ---------- комната ---------- */
export const room = { role: null, code: null, hostKey: null, v: 0, host: '', members: [], poll: null, ping: null, pubTimer: null, lastHostKey: null, lastSent: 0, applying: false, st: null };
const myName = () => { const A = state.accounts; return (social.me && '@' + social.me.name) || (A.ya && A.ya.name) || (A.zv && A.zv.name) || (A.sc && A.sc.name) || 'Гость'; };
export const roomTrack = t => t ? { source: t.source, rawId: t.rawId, title: t.title, artist: t.artist, album: t.album || '', cover: t.cover && /^https:/.test(t.cover) ? t.cover : null, duration: t.duration || 0, albumId: t.albumId || null } : null;
export function roomPublish(force) {
  if (room.role !== 'host') return;
  clearTimeout(room.pubTimer);
  room.pubTimer = setTimeout(async () => {
    try { const t0 = Date.now(); const ru = await API.room({ action: 'update', code: room.code, hostKey: room.hostKey, state: { track: roomTrack(state.current), playing: isPlaying(), position: curTime() + (isPlaying() ? (room.rtt || 150) / 2000 : 0) } }); room.rtt = room.rtt ? room.rtt * 0.7 + (Date.now() - t0) * 0.3 : Date.now() - t0; room.lastSent = Date.now(); }
    catch (e) { toast('Комната: ' + e.message); }
  }, force ? 0 : 120);
}
async function roomCreate(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Создаём…'; }
  try {
    const r = await API.room({ action: 'create', name: myName(), state: { track: roomTrack(state.current), playing: isPlaying(), position: curTime() + (isPlaying() ? (room.rtt || 150) / 2000 : 0) } });
    Object.assign(room, { role: 'host', code: r.code, hostKey: r.hostKey, v: r.v || 1, host: myName(), members: [], lastSent: Date.now() });
    clearInterval(room.poll); room.poll = setInterval(roomHostTick, 10000);
    haptic('medium');
  } catch (e) { toast(e.message); }
  renderTogether();
}
async function roomHostTick() {
  if (room.role !== 'host') return;
  if (Date.now() - room.lastSent > 20000) roomPublish(true);
  try { const d = await API.room({ action: 'state', code: room.code, v: room.v, members: true }); room.members = d.members || []; if (state.tab === 'together') renderTogether(); } catch {}
}
export async function roomJoin(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) { toast('Код комнаты — 6 цифр'); return false; }
  try {
    const t0 = Date.now();
    const d = await API.room({ action: 'state', code, v: 0, members: true });
    room.bestRtt = undefined; roomClock(d, t0, Date.now());
    if (d.closed) { toast('Эта комната уже закрыта'); return false; }
    roomLeave(true);
    Object.assign(room, { role: 'guest', code, v: 0, host: d.host, members: d.members || [], lastHostKey: null });
    API.room({ action: 'ping', code, name: myName() }).catch(() => {});
    clearInterval(room.ping); room.ping = setInterval(() => API.room({ action: 'ping', code: room.code, name: myName() }).catch(() => {}), 15000);
    clearInterval(room.poll); room.poll = setInterval(roomGuestTick, 1000);
    haptic('medium'); toast(`Вы слушаете вместе с ${d.host}`);
    renderTogether();
    await roomApply(d);
    return true;
  } catch (e) { toast(e.message); return false; }
}
let ticks = 0;
async function roomGuestTick() {
  if (room.role !== 'guest') return;
  ticks++;
  try {
    const t0 = Date.now();
    const d = await API.room({ action: 'state', code: room.code, v: room.v, members: ticks % 10 === 0 });
    roomClock(d, t0, Date.now());
    if (d.members) room.members = d.members;
    if (d.closed) { toast('Хозяин завершил комнату'); roomLeave(true); return; }
    await roomApply(d);
  } catch (e) { if (/нет|не найдена/i.test(e.message)) { toast('Комната закрыта'); roomLeave(true); } }
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
    const mine = await resolveTrack(t);
    if (!mine) { toast(`«${t.title}» недоступен у вас: нет подходящего источника`); return; }
    room.applying = true;
    state.mode = 'room'; state.queue = [mine]; state.qi = 0;
    const done = () => { if (!room.applying) return; room.applying = false; if (room.st.playing) seekTo(Math.max(0, roomExpected() + 0.08)); else { seekTo(room.st.position); audio.pause(); } };
    if (false) { await playTrack(mine); setTimeout(done, 900); return; }
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
  if (st.playing && !isPlaying()) { audio.play().catch(() => {}); }
  if (!st.playing && isPlaying()) { audio.pause(); }
  if (!st.playing && Math.abs(curTime() - st.position) > 0.5) seekTo(st.position);
  if (!false) roomDrift();
  else if (st.playing && Math.abs(curTime() - roomExpected()) > 1.5) seekTo(Math.max(0, roomExpected()));
  syncPlaying();
}
// трек друга может быть из сервиса, которого у вас нет: тогда ищем такой же в доступных
export async function resolveTrack(t) {
  const A = state.accounts;
  const direct = t.source === 'sc' || t.source === 'au' || (t.source === 'ya' && A.ya) || (t.source === 'zv' && A.zv) || (t.source === 'ja' && state.keys.jamendo);
  if (direct) return { ...t, id: t.source === 'ya' && t.albumId ? `ya:${t.rawId}:${t.albumId}` : `${t.source}:${t.rawId}`, artists: t.artists || [], available: true };
  try {
    const r = await API.search(`${(t.artist || '').split(',')[0]} ${t.title}`);
    const n = s => (s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
    const pool = (r.tracks || []).filter(x => !x.locked && x.available !== false);
    return pool.find(x => n(x.title) === n(t.title)) || pool.find(x => n(x.title).includes(n(t.title))) || null;
  } catch { return null; }
}
export function roomLeave(silent) {
  if (room.role === 'guest' && room.code) API.room({ action: 'leave', code: room.code, name: myName() }).catch(() => {});
  if (room.role === 'host' && room.code && !silent) API.room({ action: 'close', code: room.code, hostKey: room.hostKey }).catch(() => {});
  clearInterval(room.poll); clearInterval(room.ping);
  if (audio) audio.playbackRate = 1;
  Object.assign(room, { role: null, code: null, hostKey: null, v: 0, members: [], lastHostKey: null, st: null });
  if (state.mode === 'room') state.mode = 'list';
  if (state.tab === 'together') renderTogether();
}

/* ---------- друзья ---------- */
const social = { reactions: {}, me: null, read: {}, ver: null, since: 0, friends: [], incoming: [], outgoing: [], inbox: [], loaded: false, lastSync: 0, busy: false, chatWith: null, chat: [], chatEl: null };
const hasServer = () => !!(state.keyValues && state.keyValues.server);
const unreadOf = id => social.inbox.filter(m => m.f === id && m.type !== 'react' && m.ts > (social.read[id] || 0)).length;
const fname = id => (social.friends.find(f => f.id === id) || {}).name || '';
function updateCount() {
  const n = social.friends.reduce((a, f) => a + unreadOf(f.id), 0) + social.incoming.length;
  const el = $('#tbCount'); el.textContent = n > 99 ? '99+' : n; el.classList.toggle('hidden', !n);
}
export async function socialInit() {
  try { const me = await API.social({ action: 'local' }); if (me) { social.me = me; social.read = me.read || {}; } } catch {}
  if (social.me) { socialSync(); if (isNative) LocalNotifications.requestPermissions().catch(() => {}); }
  setInterval(() => {
    if (!social.me || (document.hidden && !isPlaying())) return;
    if (Date.now() - social.lastSync > (state.tab === 'together' ? 5000 : 30000)) socialSync();
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && social.me) { social.lastSync = 0; socialSync(); } });
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
      for (const m of fresh) {
        if (m.type === 'react') { if (social.chatWith !== m.f || document.hidden) notify(`@${m.fn} ${m.e}`, `на «${m.title || 'трек'}»`, goChat(m.f)); continue; }
        if (social.chatWith !== m.f || document.hidden) notify(`Трек от @${m.fn}`, `«${m.t.title}», ${m.t.artist}`, goChat(m.f));
      }
      for (const r of d.incoming) if (!social.incoming.some(x => x.id === r.id)) notify('Заявка в друзья', `@${r.name} хочет добавить вас в друзья`, async () => { const { showTab } = await import('./lib.js'); showTab('together'); });
    }
    Object.assign(social, { ver: d.ver, me: { ...social.me, name: d.me.name }, friends: d.friends, incoming: d.incoming, outgoing: d.outgoing, loaded: true });
    social.inbox = [...fresh, ...social.inbox].slice(0, 300);
    social.since = Math.max(social.since, ...social.inbox.map(m => m.ts), 0);
    const forChat = fresh.filter(m => m.f === social.chatWith && m.type !== 'react');
    if (forChat.length) { social.chat.push(...forChat.reverse()); markRead(social.chatWith); renderChat(); }
    for (const r of fresh.filter(m => m.type === 'react' && m.f === social.chatWith)) { (social.reactions[r.msg] ||= {})[r.f] = r.e; renderChat(); }
    if (state.tab === 'together') renderTogether();
  } catch (e) {
    if (/создайте его заново/.test(e.message)) { social.me = null; toast(e.message); if (state.tab === 'together') renderTogether(); }
  } finally { social.busy = false; updateCount(); }
}
function markRead(id) { const ts = Date.now(); social.read[id] = ts; API.social({ action: 'read', id, ts }).catch(() => {}); updateCount(); }
const ava = name => `<span class="fr-ava">${esc((name || '?')[0].toUpperCase())}</span>`;

/* ---------- экран «Вместе» ---------- */
let dbWarn = null;
export function renderTogether() {
  const el = $('#tab-together');
  const scroll = el.scrollTop;
  el.innerHTML = `<div class="head"><h1>Комната</h1>${social.me ? `<button class="btn sm" id="meH">@${esc(social.me.name)}</button>` : ''}</div>
    <div class="card-box" id="tgRoom"></div><div class="card-box" id="tgFriends"></div>`;
  const h = $('#meH', el); if (h) h.onclick = () => navigator.clipboard.writeText('@' + social.me.name).then(() => { haptic(); toast('Имя скопировано: отправьте его другу'); }).catch(() => toast('@' + social.me.name));
  renderRoomCard($('#tgRoom', el)); renderFriendsCard($('#tgFriends', el));
  el.scrollTop = scroll;
}
function renderRoomCard(box) {
  if (!hasServer()) { box.innerHTML = `<div class="cb-title">Слушать вместе</div><div class="cb-text">Сервер Сплава не указан, поэтому комнаты и друзья недоступны.</div>`; return; }
  const warn = dbWarn ? `<div class="cb-warn">${esc(dbWarn)}</div>` : '';
  const members = room.members.length ? room.members.map(m => `<span class="member">${esc(m)}</span>`).join('') : '<span class="note" style="padding:0">Пока никого</span>';
  if (room.role === 'host') {
    box.innerHTML = `<div class="cb-title">Ваша комната</div><div class="code-big">${room.code.split('').map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cb-text">Продиктуйте код другу: он введёт его у себя в Сплаве, на вкладке «Комната».</div>
      <button class="btn primary wide" id="rInvite">${ico('send')}Пригласить ссылкой</button>
      <div class="btn-row" style="padding:0;margin-top:10px"><button class="btn" id="rCopy">${ico('copy')}Код</button><button class="btn" id="rEnd">Завершить</button></div>
      <div class="sub-label">Слушают</div><div class="members">${members}</div>${warn}`;
    $('#rCopy', box).onclick = () => navigator.clipboard.writeText(room.code).then(() => { haptic(); toast('Код скопирован'); });
    $('#rInvite', box).onclick = async () => {
      haptic();
      const url = `${state.keyValues.server.replace(/\/+$/, '')}/api/join?c=${room.code}`;
      try { await navigator.share({ title: 'Слушаем вместе в Сплаве', text: `Заходи в мою комнату в Сплаве, код ${room.code}`, url }); }
      catch (e) { if (e && e.name === 'AbortError') return; navigator.clipboard.writeText(url).then(() => toast('Ссылка скопирована: отправьте её другу')); }
    };
    $('#rEnd', box).onclick = () => { roomLeave(false); toast('Комната завершена'); };
    return;
  }
  if (room.role === 'guest') {
    box.innerHTML = `<div class="cb-title">Вы слушаете вместе с ${esc(room.host)}</div><div class="cb-text">Музыку выбирает ${esc(room.host)}: пауза и перемотка повторяются у вас. Комната ${room.code}.</div>
      <div class="sub-label">Слушают</div><div class="members">${members}</div><button class="btn wide" id="rLeave" style="margin-top:16px">Выйти из комнаты</button>${warn}`;
    $('#rLeave', box).onclick = () => { roomLeave(true); toast('Вы вышли из комнаты'); };
    return;
  }
  box.innerHTML = `<div class="cb-title">Слушать вместе</div><div class="cb-text">Друзья слышат то же, что и вы, в ту же секунду. Каждый слушает через свои сервисы.</div>
    <button class="btn primary wide" id="rCreate">Создать комнату</button>
    <div class="tg-or">Есть код от друга?</div>
    <div class="code-cells" id="rCells">${'<input inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="one-time-code">'.repeat(6)}</div>${warn}`;
  $('#rCreate', box).onclick = e => roomCreate(e.currentTarget);
  bindCells($('#rCells', box));
}
function bindCells(box) {
  const cells = $$('input', box);
  const value = () => cells.map(c => c.value).join('');
  const fill = (from, d) => d.split('').forEach((x, i) => { if (cells[from + i]) cells[from + i].value = x; });
  const submit = async () => {
    if (value().length !== 6) return;
    cells.forEach(c => c.blur()); box.classList.add('busy');
    const ok = await roomJoin(value());
    if (!ok) { box.classList.remove('busy'); box.classList.add('shake'); haptic('medium'); setTimeout(() => box.classList.remove('shake'), 450); cells.forEach(c => c.value = ''); }
  };
  cells.forEach((c, i) => {
    c.addEventListener('input', () => {
      const d = c.value.replace(/\D/g, '');
      if (d.length > 1) fill(i, d.slice(0, 6 - i)); else c.value = d;
      const nx = cells.findIndex(x => !x.value); if (nx >= 0) cells[nx].focus(); else submit();
    });
    c.addEventListener('keydown', e => { if (e.key === 'Backspace' && !c.value && i > 0) { cells[i - 1].value = ''; cells[i - 1].focus(); e.preventDefault(); } });
    c.addEventListener('focus', () => { const first = cells.findIndex(x => !x.value); if (first >= 0 && first < i) cells[first].focus(); });
  });
}
function renderFriendsCard(box) {
  if (!hasServer()) { box.classList.add('hidden'); return; }
  if (!social.me) {
    box.innerHTML = `<div class="cb-title">Друзья</div><div class="cb-text">Придумайте имя. По нему друзья найдут вас и смогут присылать треки.</div>
      <div class="field"><span class="at">@</span><input id="regN" maxlength="20" placeholder="например, lesha.music" autocapitalize="none" autocorrect="off" spellcheck="false"></div>
      <button class="btn primary wide" id="regGo" style="margin-top:12px">Создать профиль</button>
      <div class="note" style="padding:10px 2px 0">Латинские буквы, цифры, точка и подчёркивание, от 3 до 20 знаков.</div>`;
    const go = async () => {
      const name = $('#regN', box).value.trim(); if (!name) return;
      try { social.me = await API.social({ action: 'register', name }); social.read = {}; haptic('medium'); toast(`Профиль @${social.me.name} создан`); renderTogether(); socialSync(); }
      catch (e) { toast(e.message); }
    };
    $('#regGo', box).onclick = go; $('#regN', box).onkeydown = e => { if (e.key === 'Enter') go(); };
    return;
  }
  const req = social.incoming.length ? `<div class="sub-label">Хотят дружить</div>${social.incoming.map(r => `<div class="fr-row" data-id="${esc(r.id)}">${ava(r.name)}<span class="fr-name">@${esc(r.name)}</span><button class="btn sm primary" data-act="accept">Принять</button><button class="icon-btn" data-act="decline" aria-label="Отклонить">${ico('close')}</button></div>`).join('')}` : '';
  const list = social.friends.length ? social.friends.map(f => { const n = unreadOf(f.id); return `<button class="fr-row" data-friend="${esc(f.id)}">${ava(f.name)}<span class="fr-name">@${esc(f.name)}<small>${f.last ? timeAgo(f.last) : 'ещё ничего не отправляли'}</small></span>${n ? `<span class="fr-unread">${n}</span>` : ''}<span class="chev">${ico('chev')}</span></button>`; }).join('')
    : `<div class="note" style="padding:6px 0">${social.loaded ? 'Пока никого. Добавьте друга по имени или отправьте ему своё.' : 'Загружаем…'}</div>`;
  const out = social.outgoing.length ? `<div class="sub-label">Ждут ответа</div>${social.outgoing.map(r => `<div class="fr-row" data-id="${esc(r.id)}" style="opacity:.6">${ava(r.name)}<span class="fr-name">@${esc(r.name)}</span><button class="btn sm ghost" data-act="cancel">Отменить</button></div>`).join('')}` : '';
  box.innerHTML = `<div class="cb-title">Друзья</div>
    <div class="field"><span class="at">@</span><input id="addN" maxlength="21" placeholder="имя друга" autocapitalize="none" autocorrect="off" spellcheck="false"><button class="btn sm" id="addGo">Добавить</button></div>
    ${req}<div class="sub-label">Друзья</div>${list}${out}`;
  const add = async () => {
    const name = $('#addN', box).value.trim(); if (!name) return;
    try { const r = await API.social({ action: 'request', name }); haptic(); toast(r.status === 'friends' ? `@${name.replace(/^@/, '')} теперь в друзьях` : 'Заявка отправлена'); social.ver = null; socialSync(); }
    catch (e) { toast(e.message); }
  };
  $('#addGo', box).onclick = add; $('#addN', box).onkeydown = e => { if (e.key === 'Enter') add(); };
  $$('[data-act]', box).forEach(b => b.onclick = async e => { e.stopPropagation(); const id = b.closest('[data-id]').dataset.id; try { await API.social({ action: b.dataset.act, id }); haptic(); social.ver = null; socialSync(); } catch (err) { toast(err.message); } });
  $$('[data-friend]', box).forEach(b => b.onclick = () => openChat(b.dataset.friend));
}

/* ---------- переписка треками ---------- */
function openChat(id) {
  social.chatWith = id; social.chat = [];
  const name = fname(id);
  const page = push('@' + name, async (pg, pageEl, setTitle) => {
    setTitle('@' + name);
    social.chatEl = pg;
    pg.innerHTML = `<div class="head" style="position:static;padding-top:4px">${ava(name)}<h1 style="font-size:24px">@${esc(name)}</h1><button class="icon-btn" id="chMore" aria-label="Ещё">${ico('more')}</button></div><div class="chat" id="chBody"><div class="skeleton"></div></div>
      <div class="chat-send"><button class="btn primary wide" id="chSend"${state.current ? '' : ' disabled'}>${ico('send')}Отправить то, что играет</button></div>`;
    $('#chSend', pg).onclick = () => state.current && sendTrack(id, state.current);
    $('#chMore', pg).onclick = () => actions('', [['trash', `Удалить @${name} из друзей`, async () => { try { await API.social({ action: 'remove', id }); pop(); social.ver = null; socialSync(); toast(`@${name} больше не в друзьях`); } catch (e) { toast(e.message); } }, { danger: true }]]);
    try { const d = await API.social({ action: 'chat', id }); if (social.chatWith !== id) return; social.chat = (d.messages || []).slice().reverse(); social.reactions = d.reactions || {}; } catch (e) { toast(e.message); }
    markRead(id); renderChat();
  });
  // при уходе со страницы переписки
  const obs = new MutationObserver(() => { if (!document.body.contains(page)) { social.chatWith = null; social.chatEl = null; obs.disconnect(); if (state.tab === 'together') renderTogether(); } });
  obs.observe($('#stack'), { childList: true });
}
function renderChat() {
  const pg = social.chatEl; if (!pg) return;
  const body = $('#chBody', pg); if (!body) return;
  const name = fname(social.chatWith);
  body.innerHTML = social.chat.length ? social.chat.map((m, i) => {
    const mine = m.f === social.me.id, t = m.t;
    const rx = Object.entries(social.reactions[m.id] || {});
    const mineR = (social.reactions[m.id] || {})[social.me.id];
    const rxHtml = rx.length ? `<div class="msg-rx">${[...new Set(rx.map(([, e]) => e))].map(e => `<span class="${e === mineR ? 'me' : ''}">${e}${rx.filter(([, x]) => x === e).length > 1 ? ' ' + rx.filter(([, x]) => x === e).length : ''}</span>`).join('')}</div>` : '';
    return `<div class="msg${mine ? ' mine' : ''}"><div class="msg-card" data-i="${i}"><div class="cv" style="background-image:${esc(cssUrl(t.cover))}"></div><div class="tm"><div class="tt">${esc(t.title)}</div><div class="ta"><span class="src">${({ ya: 'Я', sc: 'SC', zv: 'ЗВУК', au: 'AU', ja: 'JA' })[t.source] || ''}</span><span>${esc(t.artist)}</span></div></div></div>${rxHtml}<div class="msg-time">${mine ? 'вы, ' : ''}${timeAgo(m.ts)}<button class="msg-react" data-r="${i}" aria-label="Реакция">${mineR ? 'изменить реакцию' : 'реакция'}</button></div></div>`;
  }).join('') : `<div class="empty">Пока пусто. Отправьте @${esc(name)} первый трек: «Отправить другу» есть в меню любого трека и в плеере.</div>`;
  $$('.msg-card', body).forEach(c => c.onclick = () => playShared(social.chat[+c.dataset.i].t));
  $$('.msg-react', body).forEach(b => b.onclick = () => reactTo(social.chat[+b.dataset.r]));
  const sb = $('#chSend', pg); if (sb) sb.disabled = !state.current;
  const page = pg.closest('.page'); if (page) setTimeout(() => page.scrollTo({ top: page.scrollHeight, behavior: 'smooth' }), 30);
}
document.addEventListener('now-changed', () => { if (social.chatEl) { const sb = $('#chSend', social.chatEl); if (sb) sb.disabled = !state.current; } });
const REACTIONS = ['🔥', '❤️', '😂', '😮', '👎'];
function reactTo(m) {
  const mine = (social.reactions[m.id] || {})[social.me.id];
  const s = sheet(`<div class="sh-head"><div class="sh-t"><b>Реакция</b><span>${esc(m.t.title)}</span></div></div><div class="rx-pick">${REACTIONS.map(e => `<button data-e="${e}" class="${e === mine ? 'on' : ''}">${e}</button>`).join('')}</div>${mine ? '<button class="act" id="rxOff">Убрать реакцию</button>' : ''}`);
  const send = async e => {
    s.close(); haptic('medium');
    const prev = { ...(social.reactions[m.id] || {}) };
    social.reactions[m.id] = { ...prev }; if (e) social.reactions[m.id][social.me.id] = e; else delete social.reactions[m.id][social.me.id];
    renderChat();
    try { const r = await API.social({ action: 'react', id: social.chatWith, msg: m.id, e }); social.reactions[m.id] = r.reactions; renderChat(); }
    catch (err) { social.reactions[m.id] = prev; renderChat(); toast(err.message); }
  };
  $$('[data-e]', s.el).forEach(b => b.onclick = () => send(b.dataset.e === mine ? '' : b.dataset.e));
  const off = $('#rxOff', s.el); if (off) off.onclick = () => send('');
}
async function playShared(t) {
  haptic(); toast(`Ищем «${t.title}»…`);
  const mine = await resolveTrack(t);
  if (!mine) { toast(`«${t.title}» недоступен у вас: нет подходящего источника`); return; }
  playQueue([mine], 0, 'list', 'От друга');
}
async function sendTrack(id, t) {
  try {
    const d = await API.social({ action: 'send', id, track: roomTrack(t) });
    haptic('medium');
    if (social.chatWith === id) { social.chat.push(d.msg); renderChat(); }
    const f = social.friends.find(x => x.id === id); if (f) f.last = d.msg.ts;
    toast(`Отправлено @${fname(id)}`);
  } catch (e) { toast(e.message); }
}
export async function pickFriend(t) {
  const { showTab } = await import('./lib.js');
  if (!social.me) { toast('Сначала создайте профиль на вкладке «Комната»'); (await import('./player.js')).closePlayer(); showTab('together'); return; }
  if (!social.friends.length) { toast('Добавьте друга, чтобы отправлять ему треки'); (await import('./player.js')).closePlayer(); showTab('together'); return; }
  actions(`<div class="sh-head"><div class="sh-cv" style="background-image:${esc(cssUrl(t.cover))}"></div><div class="sh-t"><b>Отправить другу</b><span>${esc(t.title)}</span></div></div>`,
    social.friends.map(f => ['send', '@' + f.name, () => sendTrack(f.id, t)]));
}
async function onShown() {
  renderTogether();
  if (social.me) { social.lastSync = 0; socialSync(); }
  if (hasServer() && dbWarn === null) {
    try { const h = await API.health(); dbWarn = h.db === 'memory' ? 'Сервер не видит базу: комнаты будут пропадать.' : ''; } catch { dbWarn = ''; }
    if (dbWarn && state.tab === 'together') renderTogether();
  }
}
onTab('together', onShown);
