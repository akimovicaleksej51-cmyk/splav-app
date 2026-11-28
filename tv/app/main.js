// Точка входа Сплава для телевизора (Android TV / Google TV)
import { startCore, override, isNative } from '../../mobile/core/entry.js';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import pkg from '../package.json';
import { $, state, toast, move, back, onBack, focus, focusFirst, topLayer, setFast } from './lib.js';
import { renderNow, syncPlaying, mediaKey, openPlayer, playerOpen, wake } from './player.js';
import { showTab, refreshState, loadLikes, rerender, closeSub } from './views.js';
import './update.js';


/* ---------- подмены обработчиков ядра ----------
   Ядро при запуске регистрирует свои обработчики, поэтому подменяем их после startCore */
function overrides() {
// цвет обложки для подсветки плеера: считаем по картинке на холсте
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
  img.src = url;
}));
override('appVersion', () => pkg.version);
override('download', () => { throw new Error('Скачивание на телевизоре недоступно'); });
override('downloads', () => []);
}

/* ---------- пульт ---------- */
const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
document.addEventListener('keydown', e => {
  if (playerOpen()) wake();
  if (mediaKey(e)) { e.preventDefault(); return; }
  const dir = DIRS[e.key];
  if (dir) {
    const a = document.activeElement;
    // в поле ввода влево/вправо двигают курсор, пока он не упрётся в край
    if (a && a.tagName === 'INPUT' && (dir === 'left' || dir === 'right')) {
      const atEdge = dir === 'left' ? a.selectionStart === 0 : a.selectionEnd === a.value.length;
      if (!atEdge) return;
    }
    e.preventDefault();
    setFast(e.repeat);
    move(dir);
    return;
  }
  // на компьютере для проверки: Escape и Backspace вне поля — «Назад»
  if (e.key === 'Escape' || e.key === 'GoBack' || (e.key === 'Backspace' && document.activeElement.tagName !== 'INPUT')) { e.preventDefault(); handleBack(); }
});
// Назад: закрыть плеер или окно → вернуться в меню → в волну → свернуть приложение (музыка продолжит играть)
function handleBack() {
  if (back()) return;
  if (closeSub()) return;
  const a = document.activeElement;
  if (a && a.closest('#main')) { focus($(`#side .tab[data-tab="${state.tab}"]`)); return; }
  if (state.tab !== 'wave') { showTab('wave'); focus($('#side .tab[data-tab="wave"]')); return; }
  if (state.current && !playerOpen()) { openPlayer(); return; }
  if (isNative) App.minimizeApp().catch(() => {});
}
onBack(() => false);

/* ---------- запуск ---------- */
(async function init() {
  if (isNative) App.addListener('backButton', handleBack);
  showTab('wave'); renderNow(); syncPlaying();
  focusFirst($('#main'));
  try { await startCore(); overrides(); await refreshState(); } catch (e) { toast(e.message); }
  // после входа в сервисы перерисовываем экран и возвращаем фокус на ту же кнопку
  if (!topLayer()) {
    const id = document.activeElement && document.activeElement.id;
    rerender();
    const el = id && document.getElementById(id);
    if (el) focus(el); else focusFirst($('#main'));
  }
  if (isNative) SplashScreen.hide().catch(() => {});
  loadLikes();
})();
