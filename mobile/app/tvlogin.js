// Вход на телевизоре: телевизор показывает QR-код, камера iPhone открывает Сплав по ссылке splavapp://tv/…,
// и Сплав передаёт на телевизор свои входы в Яндекс, SoundCloud и Звук (в зашифрованном виде)
import { call } from '../core/entry.js';
import { API } from './api.js';
import { parseLink, parseRemote, sealParts } from '../core/tvlink.js';
import { actions, toast, haptic } from './lib.js';

const NAMES = { ya: 'Яндекс', sc: 'SoundCloud', zv: 'Звук' };

let lastUrl = '', lastAt = 0;
export function tvLogin(url) {
  const link = parseLink(url);
  if (!link) return false;
  // при холодном запуске ссылка приходит дважды — показываем вопрос один раз
  if (url === lastUrl && Date.now() - lastAt < 10000) return true;
  lastUrl = url; lastAt = Date.now();
  actions('<div class="sh-head"><div class="sh-t"><b>Войти на телевизоре?</b><span>Телевизор войдёт в те же сервисы, что и Сплав на этом iPhone</span></div></div>', [
    ['user', 'Передать входы на телевизор', () => send(link)],
  ]);
  return true;
}

// телевизор подтверждает каждую часть, кроме последней; ждём до 30 секунд
async function waitAck(link, i) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 700));
    const d = await API.room({ action: 'state', code: link.code, v: 0 });
    const t = d.state && d.state.track;
    if (t && t.source === 'tvack' && t.rawId === String(i)) return;
  }
  throw new Error('телевизор не ответил. Проверьте, что на нём открыт QR-код');
}
async function send(link) {
  try {
    const tokens = await call('exportTokens');
    const have = Object.keys(NAMES).filter(k => tokens[k]);
    if (!have.length) { toast('В Сплаве на телефоне нет входов. Войдите в Яндекс, SoundCloud или Звук в профиле'); return; }
    const parts = await sealParts(tokens, link.key);
    for (let i = 0; i < parts.length; i++) {
      await API.room({ action: 'update', code: link.code, hostKey: link.hostKey, state: { track: parts[i], playing: false, position: 0 } });
      if (i < parts.length - 1) await waitAck(link, i);
    }
    haptic('medium');
    toast(`Готово: передали ${have.map(k => NAMES[k]).join(', ')}. Смотрите на телевизор`);
  } catch (e) {
    toast(/хозяин|Комнаты/.test(e.message) ? 'Код на телевизоре устарел. Откройте его заново' : 'Не получилось: ' + e.message);
  }
}

// QR «Пульт с телефона» на телевизоре
export function tvRemote(url) {
  const link = parseRemote(url);
  if (!link) return false;
  if (url === lastUrl && Date.now() - lastAt < 10000) return true;
  lastUrl = url; lastAt = Date.now();
  actions('<div class="sh-head"><div class="sh-t"><b>Управлять телевизором?</b><span>Выбирайте музыку на телефоне — играть она будет на телевизоре</span></div></div>', [
    ['people', 'Подключить телевизор', async () => { const { remoteConnect } = await import('./together.js'); remoteConnect(link); }],
  ]);
  return true;
}
