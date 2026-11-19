// Точка входа Сплава для iPhone
import { startCore, override, Native, isNative } from '../core/entry.js';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import keys from '../../src/keys.json';
import pkg from '../package.json';
import { $, $$, ico, toast, esc, state, showTab, haptic } from './lib.js';
import { refreshState, loadLikes, renderWave, rerenderAll } from './views.js';
import { renderNow, syncPlaying } from './player.js';
import { roomJoin, socialInit } from './together.js';

/* ---------- подмены обработчиков, которым на телефоне нужна своя реализация ---------- */
// цвет обложки для фона плеера: считаем по картинке на холсте
override('coverColor', url => new Promise(resolve => {
  if (!url) return resolve(null);
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      let r = 0, gg = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const sat = mx ? (mx - mn) / mx : 0, lum = (mx + mn) / 510, k = 0.15 + sat * 1.5 * (1 - Math.abs(lum - 0.5));
        r += R * k; gg += G * k; b += B * k; w += k;
      }
      resolve([Math.round(r / w), Math.round(gg / w), Math.round(b / w)]);
    } catch { resolve(null); }
  };
  img.onerror = () => resolve(null);
  img.src = url.replace(/400x400|t500x500/, m => m === '400x400' ? '50x50' : 't67x67');
}));
override('appVersion', () => pkg.version);
override('download', () => { throw new Error('Скачивание на iPhone появится в следующей версии'); });
override('downloads', () => []);

/* ---------- обновления через SideStore ---------- */
const SOURCE_URL = keys.iosSource || '';
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
let upd = null;
export async function checkUpdates(manual) {
  if (!SOURCE_URL) { if (manual) toast('Источник обновлений не настроен'); return; }
  try {
    const r = await fetch(SOURCE_URL + (SOURCE_URL.includes('?') ? '&' : '?') + 't=' + Date.now());
    const src = await r.json();
    const app = (src.apps || [])[0] || {};
    const v = (app.versions && app.versions[0]) || app;
    if (v.version && cmpVer(v.version, pkg.version) > 0) { upd = { version: v.version, notes: v.localizedDescription || '' }; renderUpdateEverywhere(); if (manual) toast('Доступна версия ' + v.version); }
    else if (manual) toast('У вас последняя версия');
  } catch { if (manual) toast('Не удалось проверить обновления'); }
}
export function renderUpdate(box) {
  if (!box) return;
  box.innerHTML = upd ? `<div class="upd"><span>Доступна версия ${esc(upd.version)}</span><button class="btn sm primary" data-upd>Обновить</button></div>` : '';
}
function renderUpdateEverywhere() {
  const bar = $('#updWave');
  if (bar) renderUpdate(bar);
  $$('[data-upd]').forEach(b => b.onclick = openSideStore);
}
async function openSideStore() {
  haptic();
  const url = 'sidestore://source?url=' + encodeURIComponent(SOURCE_URL);
  if (isNative) { try { await Native.openUrl({ url }); return; } catch {} }
  toast('Откройте SideStore и нажмите «Обновить» рядом со Сплавом');
}
document.addEventListener('click', e => { if (e.target.closest('[data-upd]')) openSideStore(); });

/* ---------- запуск ---------- */
$$('.tb-ico').forEach(s => s.innerHTML = ico(s.dataset.ico));
$$('.tb').forEach(b => b.onclick = () => { haptic(); showTab(b.dataset.tab); });

(async function init() {
  if (isNative) {
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    App.addListener('appUrlOpen', ({ url }) => { const m = /^splavapp:\/\/(?:room|join)\/(\d{6})/.exec(url || ''); if (m) { showTab('together'); roomJoin(m[1]); } });
  }
  renderWave(); renderNow(); syncPlaying();
  try { await startCore(); await refreshState(); } catch (e) { toast(e.message); }
  rerenderAll();
  if (isNative) SplashScreen.hide().catch(() => {});
  loadLikes();
  socialInit();
  setTimeout(() => checkUpdates(false), 4000);
  // при возвращении в приложение — проверить обновления не чаще раза в 6 часов
  let lastChk = Date.now();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastChk > 6 * 3600e3) { lastChk = Date.now(); checkUpdates(false); } });
})();

// для автоматических проверок интерфейса
window.__splav = { override, state, showTab, refresh: async () => { await refreshState(); await loadLikes(); rerenderAll(); }, socialInit };
