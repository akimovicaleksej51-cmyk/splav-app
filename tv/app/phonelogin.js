// «Войти с телефона»: QR-код на экране, Сплав на iPhone передаёт входы в Яндекс, SoundCloud и Звук
import qrcode from 'qrcode-generator';
import { API } from '../../mobile/app/api.js';
import { call } from '../../mobile/core/entry.js';
import { newKey, linkUrl, readPart, openText } from '../../mobile/core/tvlink.js';
import { $, ico, toast, pushLayer, popLayer, focusFirst } from './lib.js';

const NAMES = { ya: 'Яндекс', sc: 'SoundCloud', zv: 'Звук' };

export async function openPhoneLogin(onDone) {
  const el = document.createElement('div'); el.className = 'modal';
  el.innerHTML = `<div class="m-box pl-login"><div class="ql-qr" id="qlQr"><div class="ql-wait">Готовим код…</div></div>
    <div class="ql-t"><div class="m-title">Вход с телефона</div>
      <ol><li>Откройте камеру на iPhone и наведите на код</li><li>Нажмите «Открыть в Сплаве»</li><li>Подтвердите на телефоне — телевизор войдёт в те же сервисы</li></ol>
      <div class="ql-status" id="qlStatus">Ждём телефон…</div>
      <button class="f btn" id="qlClose" data-autofocus>${ico('close')}<span>Закрыть</span></button></div></div>`;
  document.body.appendChild(el);
  let closed = false, room = null, timer = null;
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer);
    if (room) API.room({ action: 'close', code: room.code, hostKey: room.hostKey }).catch(() => {});
    popLayer(el); el.remove();
  };
  pushLayer(el, close);
  $('#qlClose', el).onclick = close;
  focusFirst(el);

  const key = newKey();
  try { room = await API.room({ action: 'create', name: 'Телевизор', state: {} }); }
  catch (e) { $('#qlQr', el).innerHTML = `<div class="ql-wait">Сервер недоступен</div>`; $('#qlStatus', el).textContent = e.message; return; }
  if (closed) { API.room({ action: 'close', code: room.code, hostKey: room.hostKey }).catch(() => {}); return; }
  const qr = qrcode(0, 'M'); qr.addData(linkUrl(room.code, room.hostKey, key)); qr.make();
  $('#qlQr', el).innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });

  // ждём, пока телефон положит входы в комнату; код живёт 10 минут
  const until = Date.now() + 10 * 60e3;
  let v = 0;
  const got = new Map();   // части данных: телефон шлёт их по очереди, телевизор подтверждает каждую
  const poll = async () => {
    if (closed) return;
    if (Date.now() > until) { $('#qlStatus', el).textContent = 'Код устарел. Закройте окно и откройте снова'; return; }
    try {
      const r = await API.room({ action: 'state', code: room.code, v });
      v = r.v;
      const part = r.state && readPart(r.state.track);
      if (part && !got.has(part.i)) {
        got.set(part.i, part.chunk);
        if (got.size === part.n) {
          const text = [...Array(part.n).keys()].map(i => got.get(i)).join('');
          const data = await openText(text, key).catch(() => null);
          if (data) { await apply(data); return; }
          $('#qlStatus', el).textContent = 'Данные пришли повреждёнными. Закройте окно и попробуйте снова'; return;
        }
        $('#qlStatus', el).textContent = `Получаем данные… ${got.size} из ${part.n}`;
        await API.room({ action: 'update', code: room.code, hostKey: room.hostKey, state: { track: { source: 'tvack', rawId: String(part.i), title: 'ok' }, playing: false, position: 0 } });
      }
    } catch {}
    timer = setTimeout(poll, 1000);
  };
  const apply = async data => {
    $('#qlStatus', el).textContent = 'Входим…';
    const ok = [], fail = [];
    for (const [k, h] of [['ya', 'yaToken'], ['sc', 'scToken'], ['zv', 'zvToken']]) {
      if (!data[k]) continue;
      try { await call(h, data[k]); ok.push(NAMES[k]); } catch { fail.push(NAMES[k]); }
    }
    close();
    if (ok.length) toast(`Готово: вошли в ${ok.join(', ')}${fail.length ? `. Не получилось: ${fail.join(', ')}` : ''}`);
    else toast(fail.length ? `Не получилось войти: ${fail.join(', ')}` : 'На телефоне нет входов в сервисы');
    if (onDone) onDone();
  };
  poll();
}
