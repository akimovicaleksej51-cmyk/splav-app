// Обновления по одной кнопке: новая версия выходит релизом tv-vX.Y.Z на GitHub,
// Сплав замечает её сам, скачивает APK и открывает установщик Android
import { Native, isNative } from '../../mobile/core/native.js';
import pkg from '../package.json';
import { $, $$, esc, ico, toast } from './lib.js';

const REPO = 'akimovicaleksej51-cmyk/splav-app';
export const upd = { version: null, url: null, busy: false, checkedAt: 0 };
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

export async function checkUpdates(manual = false) {
  upd.checkedAt = Date.now();
  try {
    const list = await (await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } })).json();
    const rel = (Array.isArray(list) ? list : []).filter(r => !r.draft && /^tv-v\d/.test(r.tag_name)).sort((a, b) => cmpVer(b.tag_name.slice(4), a.tag_name.slice(4)))[0];
    const asset = rel && (rel.assets || []).find(a => /\.apk$/i.test(a.name));
    if (rel && asset && cmpVer(rel.tag_name.slice(4), pkg.version) > 0) {
      const fresh = upd.version !== rel.tag_name.slice(4);
      upd.version = rel.tag_name.slice(4); upd.url = asset.browser_download_url;
      if (fresh) { toast(`Вышел Сплав ${upd.version}. Нажмите «Обновить» на главной`); document.dispatchEvent(new Event('update-ready')); }
    } else if (manual) toast(`У вас последняя версия, ${pkg.version}`);
  } catch { if (manual) toast('Не удалось проверить обновления. Проверьте интернет'); }
}

export async function installUpdate() {
  if (!upd.url || upd.busy) return;
  if (!isNative) { toast('Обновление ставится только на телевизоре'); return; }
  upd.busy = true; renderBanners();
  const sub = await Native.addListener('updateProgress', e => { if (e.percent >= 0) setLabel(`Скачиваем… ${e.percent}%`); });
  try {
    toast(`Скачиваем Сплав ${upd.version}…`);
    await Native.installUpdate({ url: upd.url });
    toast('Нажмите «Установить» в окне Android');
  } catch (e) {
    toast(e.message || 'Обновление не скачалось');
  } finally { sub.remove(); upd.busy = false; renderBanners(); }
}

// плашка на главной и в «Аккаунтах»
export const updateBanner = () => upd.version
  ? `<div class="upd" data-zone="upd"><div class="upd-t"><b>Вышел Сплав ${esc(upd.version)}</b><span>Обновление скачается и установится поверх, входы в сервисы сохранятся</span></div><button class="f btn primary" data-upd>${ico('refresh')}<span>${upd.busy ? 'Скачиваем…' : 'Обновить'}</span></button></div>`
  : '';
function setLabel(text) { $$('[data-upd] span').forEach(s => { s.textContent = text; }); }
export function renderBanners() { $$('[data-upd-box]').forEach(b => { b.innerHTML = updateBanner(); }); }
document.addEventListener('update-ready', renderBanners);
document.addEventListener('click', e => { if (e.target.closest('[data-upd]')) installUpdate(); });

// проверяем через несколько секунд после запуска и потом раз в 6 часов
setTimeout(() => checkUpdates(false), 6000);
setInterval(() => checkUpdates(false), 6 * 3600e3);
export const VERSION = pkg.version;
