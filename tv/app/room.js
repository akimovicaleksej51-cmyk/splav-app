// «Слушать вместе» на телевизоре: телевизор — гость комнаты и играет то же, что хозяин.
// Хозяином может быть друг (код из 6 цифр) или ваш iPhone в режиме пульта (QR-код).
// Логика синхронизации та же, что в Сплаве на iPhone (mobile/app/together.js).
import qrcode from 'qrcode-generator';
import { API } from '../../mobile/app/api.js';
import { remoteUrl } from '../../mobile/core/tvlink.js';
import { $, esc, cssUrl, ico, toast, state, pushLayer, popLayer, focusFirst } from './lib.js';
import { playTrack, seekTo, curTime, isPlaying, audio, syncPlaying, renderNow } from './player.js';

export const room = { role: null, code: null, v: 0, host: '', members: [], poll: null, ping: null, lastHostKey: null, applying: false, st: null };
const myName = () => 'Телевизор';
const emit = () => document.dispatchEvent(new Event('room-changed'));

export async function roomJoin(code, { quiet = false } = {}) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) { toast('Код комнаты — 6 цифр'); return false; }
  try {
    const t0 = Date.now();
    const d = await API.room({ action: 'state', code, v: 0, members: true });
    room.bestRtt = undefined; roomClock(d, t0, Date.now());
    if (d.closed) { toast('Эта комната уже закрыта'); return false; }
    roomLeave(true);
    Object.assign(room, { role: 'guest', code, v: 0, host: d.host, members: d.members || [], lastHostKey: null });
    state.roomRole = 'guest';
    API.room({ action: 'ping', code, name: myName() }).catch(() => {});
    clearInterval(room.ping); room.ping = setInterval(() => API.room({ action: 'ping', code: room.code, name: myName() }).catch(() => {}), 15000);
    clearInterval(room.poll); room.poll = setInterval(roomGuestTick, 1000);
    if (!quiet) toast(`Вы в комнате. Хозяин: ${d.host}`);
    emit();
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
    if (d.members) { room.members = d.members; emit(); }
    if (d.closed) { toast(`${room.host} завершил комнату`); roomLeave(true); return; }
    await roomApply(d);
  } catch (e) { if (/нет|не найдена/i.test(e.message)) { toast('Комната закрыта'); roomLeave(true); } }
}
// часы сервера: сдвиг по самому быстрому запросу, чтобы сеть не «съедала» доли секунды
function roomClock(d, t0, t1) {
  const rtt = t1 - t0;
  if (!(room.bestRtt <= rtt) || Date.now() - (room.bestAt || 0) > 60000) { room.bestRtt = rtt; room.bestAt = Date.now(); room.clockOff = d.now + rtt / 2 - t1; }
}
function roomExpected() {
  const st = room.st; if (!st) return 0;
  return st.playing ? st.position + (Date.now() + (room.clockOff || 0) - st.ts) / 1000 : st.position;
}
// маленькое расхождение догоняем скоростью (на слух незаметно), большое — перемоткой
function roomDrift() {
  const el = audio; if (!el || !room.st || !room.st.playing || el.paused) { if (el) el.playbackRate = 1; return; }
  const diff = roomExpected() - el.currentTime;
  if (Math.abs(diff) > 0.8) { el.playbackRate = 1; seekTo(Math.max(0, roomExpected() + 0.08)); }
  else if (Math.abs(diff) > 0.08) el.playbackRate = 1 + Math.max(-0.05, Math.min(0.05, diff * 0.5));
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
    if (!mine) { toast(`«${t.title}» недоступен на телевизоре: войдите в тот же сервис`); return; }
    room.applying = true;
    state.mode = 'room'; state.from = 'Комната: ' + room.host; state.queue = [mine]; state.qi = 0;
    await playTrack(mine, { room: true });
    const el = audio;
    const done = () => { if (!room.applying) return; room.applying = false; if (room.st.playing) seekTo(Math.max(0, roomExpected() + 0.08)); else { seekTo(room.st.position); audio.pause(); } };
    if (!el.paused && el.readyState >= 3) setTimeout(done, 60);
    else {
      const onPlaying = () => { el.removeEventListener('playing', onPlaying); setTimeout(done, 60); };
      el.addEventListener('playing', onPlaying);
      setTimeout(() => { el.removeEventListener('playing', onPlaying); done(); }, 8000);
    }
    return;
  }
  if (!state.current || room.applying) return;
  if (st.playing && !isPlaying()) audio.play().catch(() => {});
  if (!st.playing && isPlaying()) audio.pause();
  if (!st.playing && Math.abs(curTime() - st.position) > 0.5) seekTo(st.position);
  roomDrift();
  syncPlaying();
}
// трек хозяина может быть из сервиса, в который телевизор не вошёл: тогда ищем такой же в доступных
async function resolveTrack(t) {
  const A = state.accounts;
  const direct = t.source === 'sc' || t.source === 'au' || (t.source === 'ya' && A.ya) || (t.source === 'zv' && A.zv) || t.source === 'ja';
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
  clearInterval(room.poll); clearInterval(room.ping);
  if (audio) audio.playbackRate = 1;
  Object.assign(room, { role: null, code: null, v: 0, members: [], lastHostKey: null, st: null, applying: false });
  state.roomRole = null;
  if (state.mode === 'room') { state.mode = 'list'; state.from = ''; renderNow(); }
  if (!silent) toast('Вы вышли из комнаты');
  emit();
}

/* ---------- пульт с телефона: QR-код, iPhone ведёт комнату, телевизор входит гостем ---------- */
export async function openRemotePair() {
  const el = document.createElement('div'); el.className = 'modal';
  el.innerHTML = `<div class="m-box pl-login"><div class="ql-qr" id="rqQr"><div class="ql-wait">Готовим код…</div></div>
    <div class="ql-t"><div class="m-title">Пульт с телефона</div>
      <ol><li>Наведите камеру iPhone на код</li><li>Нажмите «Открыть в Сплаве» и «Подключить телевизор»</li><li>Выбирайте музыку на телефоне — играть она будет здесь</li></ol>
      <div class="ql-status" id="rqStatus">Ждём телефон…</div>
      <button class="f btn" id="rqClose" data-autofocus>${ico('close')}<span>Закрыть</span></button></div></div>`;
  document.body.appendChild(el);
  let closed = false, pair = null, timer = null;
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); if (pair) API.room({ action: 'close', code: pair.code, hostKey: pair.hostKey }).catch(() => {}); popLayer(el); el.remove(); };
  pushLayer(el, close);
  $('#rqClose', el).onclick = close;
  focusFirst(el);
  try { pair = await API.room({ action: 'create', name: 'Телевизор', state: {} }); }
  catch (e) { $('#rqQr', el).innerHTML = '<div class="ql-wait">Сервер недоступен</div>'; $('#rqStatus', el).textContent = e.message; return; }
  if (closed) { API.room({ action: 'close', code: pair.code, hostKey: pair.hostKey }).catch(() => {}); return; }
  const qr = qrcode(0, 'M'); qr.addData(remoteUrl(pair.code, pair.hostKey)); qr.make();
  $('#rqQr', el).innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  const until = Date.now() + 10 * 60e3;
  let v = 0;
  const poll = async () => {
    if (closed) return;
    if (Date.now() > until) { $('#rqStatus', el).textContent = 'Код устарел. Закройте окно и откройте снова'; return; }
    try {
      const r = await API.room({ action: 'state', code: pair.code, v });
      v = r.v;
      const t = r.state && r.state.track;
      if (t && t.source === 'remote' && /^\d{6}$/.test(t.rawId)) {
        $('#rqStatus', el).textContent = 'Подключаемся…';
        const ok = await roomJoin(t.rawId, { quiet: true });
        close();
        if (ok) toast('Телефон стал пультом. Выбирайте музыку на нём');
        return;
      }
    } catch {}
    timer = setTimeout(poll, 1500);
  };
  poll();
}

/* ---------- экран «Вместе» ---------- */
export function renderTogether(el) {
  if (room.role === 'guest') {
    const t = state.current;
    el.innerHTML = `<div class="page-head"><h1>Вместе</h1><span>комната ${room.code}</span></div>
      <section class="hero tg-now" data-zone="tgnow">
        <div class="h-art${t ? ' has-cover' : ''}"><div class="h-cv" style="background-image:${t ? esc(cssUrl(t.cover)) : 'none'}"></div></div>
        <div class="h-info"><div class="h-kicker">Хозяин комнаты: ${esc(room.host)}</div>
          <div class="h-title">${t ? esc(t.title) : 'Ждём, что включит ' + esc(room.host)}</div><div class="h-sub">${t ? esc(t.artist) : ''}</div>
          <div class="tg-members">${room.members.map(m => `<span>${esc(m)}</span>`).join('')}</div>
          <div class="h-ctrl"><button class="f btn" id="tgLeave" data-autofocus>${ico('close')}<span>Выйти из комнаты</span></button></div></div>
      </section>
      <div class="note">Музыку выбирает ${esc(room.host)}: пауза, перемотка и переключение треков повторяются здесь сами.</div>`;
    $('#tgLeave', el).onclick = () => { roomLeave(false); renderTogether(el); focusFirst(el); };
    return;
  }
  el.innerHTML = `<div class="page-head"><h1>Вместе</h1></div>
    <div class="acc phone" data-zone="tgremote"><div class="acc-logo ph">${ico('people')}</div>
      <div class="acc-t"><b>Пульт с телефона</b><span>Выбирайте музыку в Сплаве на iPhone, а играть она будет на телевизоре. Удобно искать треки и собирать очередь</span></div>
      <button class="f btn primary" id="tgRemote" data-autofocus>Показать QR-код</button></div>
    <div class="sec-title">Войти в комнату по коду</div>
    <div class="search" data-zone="tgcode"><div class="s-field">${ico('people')}<input class="f" id="tgCode" type="tel" inputmode="numeric" maxlength="6" placeholder="Код из 6 цифр" autocomplete="off"></div>
      <button class="f btn primary" id="tgJoin">Войти</button></div>
    <div class="note">Код комнаты показывает Сплав у того, кто её создал: на iPhone или Mac, на вкладке «Комната». Телевизор будет играть то же, что и он, секунда в секунду.</div>`;
  $('#tgRemote', el).onclick = openRemotePair;
  const inp = $('#tgCode', el);
  const join = async () => { if (await roomJoin(inp.value)) { renderTogether(el); focusFirst(el); } };
  $('#tgJoin', el).onclick = join;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); join(); } });
}
