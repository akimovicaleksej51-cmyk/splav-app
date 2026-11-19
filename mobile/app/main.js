// Точка входа Сплава для iPhone
import { startCore, override, Native, isNative } from '../core/entry.js';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
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

/* ---------- обновления ---------- */
// 1) интерфейс и логика (почти все изменения) обновляются сами: скачиваем в фоне, включаем при следующем запуске;
// 2) нативная часть — через SideStore, об этом показываем полосу.
const SOURCE_URL = keys.iosSource || '';
const WEB_URL = keys.iosWeb || '';
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
let upd = null, nativeVer = pkg.nativeVersion || pkg.version;
async function builtin() { if (!isNative) return nativeVer; try { return (await CapacitorUpdater.getBuiltinVersion()).version || nativeVer; } catch { return nativeVer; } }
const fresh = u => u + (u.includes('?') ? '&' : '?') + 't=' + Date.now();

// уже скачанное обновление новее текущего — включаем сразу при запуске или когда музыка не играет
async function applyDownloaded() {
  if (!isNative) return false;
  try {
    const { bundles } = await CapacitorUpdater.list();
    const ready = (bundles || []).filter(b => b.status === 'success' && b.version && cmpVer(b.version, pkg.version) > 0).sort((a, b) => cmpVer(b.version, a.version))[0];
    if (!ready) return false;
    localStorage.setItem('splav.updatedTo', ready.version);
    await CapacitorUpdater.set({ id: ready.id });
    return true;
  } catch { return false; }
}
let lastWebError = '';
async function checkWeb(manual) {
  if (!isNative || !WEB_URL) return false;
  let step = 'проверка';
  try {
    const m = await (await fetch(fresh(WEB_URL))).json();
    if (!m.version || cmpVer(m.version, pkg.version) <= 0) return false;
    step = 'версия основы';
    const nat = await builtin();
    if (m.minNative && cmpVer(nat, m.minNative) < 0) return false;   // нужна новая нативная часть — это через SideStore
    step = 'список загрузок';
    const { bundles } = await CapacitorUpdater.list();
    if (!(bundles || []).some(b => b.version === m.version && b.status === 'success')) {
      step = 'скачивание';
      if (manual) toast(`Скачиваем версию ${m.version}…`);
      await CapacitorUpdater.download({ url: m.url, version: m.version, checksum: m.checksum || '' });
    }
    if (manual) toast(`Версия ${m.version} скачана. Применяем…`);
    step = 'применение';
    if (manual || !document.body.classList.contains('playing')) await applyDownloaded();
    return true;
  } catch (e) {
    lastWebError = `${step}: ${e && e.message || e}`;
    if (manual) { toast('Обновление не скачалось (' + lastWebError + ')'); return true; }
    return false;
  }
}
export async function checkUpdates(manual) {
  if (await checkWeb(manual)) return;
  if (!SOURCE_URL) { if (manual) toast('У вас последняя версия'); return; }
  try {
    const src = await (await fetch(fresh(SOURCE_URL))).json();
    const app = (src.apps || [])[0] || {};
    const v = (app.versions && app.versions[0]) || app;
    if (v.version && cmpVer(v.version, await builtin()) > 0) { upd = { version: v.version }; renderUpdateEverywhere(); if (manual) toast('Нужно обновить Сплав в SideStore'); }
    else if (manual) toast('У вас последняя версия');
  } catch { if (manual) toast('Не удалось проверить обновления'); }
}
export function renderUpdate(box) {
  if (!box) return;
  box.innerHTML = upd ? `<div class="upd"><span>Версия ${esc(upd.version)} — обновите в SideStore</span><button class="btn sm primary" data-upd>Открыть</button></div>` : '';
}
function renderUpdateEverywhere() { const bar = $('#updWave'); if (bar) renderUpdate(bar); }
async function openSideStore() {
  haptic();
  const url = 'sidestore://source?url=' + encodeURIComponent(SOURCE_URL);
  if (isNative) { try { await Native.openUrl({ url }); return; } catch {} }
  toast('Откройте SideStore и нажмите «Обновить» рядом со Сплавом');
}
document.addEventListener('click', e => { if (e.target.closest('[data-upd]')) openSideStore(); });
export const versionLabel = async () => { const n = await builtin(); return n === pkg.version ? pkg.version : `${pkg.version} (основа ${n})`; };

/* ---------- запуск ---------- */
$$('.tb-ico').forEach(s => s.innerHTML = ico(s.dataset.ico));
$$('.tb').forEach(b => b.onclick = () => { haptic(); showTab(b.dataset.tab); });

(async function init() {
  if (isNative) {
    CapacitorUpdater.notifyAppReady().catch(() => {});
    if (await applyDownloaded()) return;   // перезапуск в новую версию
    const was = localStorage.getItem('splav.updatedTo');
    if (was && was === pkg.version) { localStorage.removeItem('splav.updatedTo'); setTimeout(() => toast(`Сплав обновился до версии ${pkg.version}`), 1500); }
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    App.addListener('appUrlOpen', ({ url }) => { const m = /^splavapp:\/\/(?:room|join)\/(\d{6})/.exec(url || ''); if (m) { showTab('together'); roomJoin(m[1]); } });
  }
  renderWave(); renderNow(); syncPlaying();
  try { await startCore(); await refreshState(); } catch (e) { toast(e.message); }
  rerenderAll();
  if (isNative) SplashScreen.hide().catch(() => {});
  loadLikes();
  socialInit();
  setTimeout(() => checkUpdates(false), 3000);
  // при возвращении в приложение: если музыка не играет — включаем скачанное, и раз в час проверяем новое
  let lastChk = Date.now();
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (!document.body.classList.contains('playing') && await applyDownloaded()) return;
    if (Date.now() - lastChk > 3600e3) { lastChk = Date.now(); checkUpdates(false); }
  });
})();

// для автоматических проверок интерфейса
window.__splav = { override, state, showTab, refresh: async () => { await refreshState(); await loadLikes(); rerenderAll(); }, socialInit };
