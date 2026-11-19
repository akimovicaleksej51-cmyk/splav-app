// Подмена Electron для iPhone: обработчики main.js регистрируются в обычной таблице,
// окна входа открываются нативным листом с WebView, всё остальное — пустышки
import { Native, isNative } from './native.js';
import pkg from '../package.json';

// пустышка, которую можно вызывать, создавать и читать вглубь
const noop = () => {};
const deep = () => new Proxy(noop, {
  get: (_t, k) => (k === 'then' || typeof k === 'symbol') ? undefined : deep(),
  apply: () => deep(),
  construct: () => deep(),
});

export const handlers = new Map();
export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on: noop, removeHandler: n => handlers.delete(n) };

export const app = {
  getPath: name => '/' + name,
  getVersion: () => pkg.version,
  whenReady: () => Promise.resolve(),
  requestSingleInstanceLock: () => true,
  setAsDefaultProtocolClient: noop,
  on: noop, quit: noop, getName: () => 'Сплав',
};

// ---------- окно входа ----------
let activeLogin = null;
class LoginWindow {
  constructor(opts = {}) {
    this.title = opts.title || 'Вход';
    this.ev = {}; this.wcEv = {}; this.subs = [];
    const self = this;
    this.webContents = {
      on(ev, cb) { (self.wcEv[ev] ||= []).push(cb); },
      executeJavaScript: code => Native.loginEval({ code }).then(r => { try { return JSON.parse((r && r.value) || 'null'); } catch { return null; } }),
      isLoading: () => false, send: noop,
    };
  }
  on(ev, cb) { (this.ev[ev] ||= []).push(cb); }
  emitNav(url) { for (const ev of ['will-redirect', 'will-navigate', 'did-navigate', 'did-navigate-in-page']) for (const cb of this.wcEv[ev] || []) try { cb({ preventDefault: noop }, url); } catch {} }
  async loadURL(url) {
    if (!isNative) { setTimeout(() => this.finish(), 0); return; }
    if (activeLogin && activeLogin !== this) activeLogin.close();
    activeLogin = this;
    this.subs.push(await Native.addListener('loginNav', e => this.emitNav(e.url)));
    this.subs.push(await Native.addListener('loginClosed', () => this.finish()));
    await Native.openLogin({ url, title: this.title });
  }
  finish() {
    if (this.closed) return; this.closed = true;
    for (const s of this.subs) s.remove(); this.subs = [];
    if (activeLogin === this) activeLogin = null;
    for (const cb of this.ev.closed || []) try { cb(); } catch {}
  }
  close() { if (isNative) Native.closeLogin().catch(noop); this.finish(); }
  show() {} focus() {} destroy() { this.close(); }
}
export function BrowserWindow(opts = {}) {
  if (/^Вход/.test(opts.title || '')) return new LoginWindow(opts);
  return deep();
}
BrowserWindow.getAllWindows = () => [];

// куки окна входа: сначала из хранилища WebView, а если там ещё пусто — прямо со страницы
// (SoundCloud после входа через Apple ставит ключ скриптом, и хранилище отдаёт его с задержкой)
async function loginCookies(name) {
  if (!isNative) return [];
  const list = (await Native.loginCookies({ name }).catch(() => ({}))).cookies || [];
  if (list.length || !name) return list;
  try {
    const r = await Native.loginEval({ code: `(() => { const m = document.cookie.match(/(?:^|; )${name}=([^;]+)/); if (m) return decodeURIComponent(m[1]); for (const k of Object.keys(localStorage)) { if (/oauth/i.test(k)) { const v = localStorage.getItem(k); const t = /(\\d-\\d{6}-\\d+-[A-Za-z0-9]+)/.exec(v || ''); if (t) return t[1]; } } return null; })()` });
    const v = JSON.parse((r && r.value) || 'null');
    return v ? [{ name, value: v }] : [];
  } catch { return []; }
}
const loginSession = {
  cookies: { get: async ({ name } = {}) => loginCookies(name) },
  clearStorageData: async () => { if (isNative) await Native.clearLogin().catch(noop); },
};
export const session = { fromPartition: () => loginSession, defaultSession: deep() };

export const safeStorage = { isEncryptionAvailable: () => false, encryptString: s => s, decryptString: s => String(s) };
export const shell = {
  openExternal: url => isNative ? Native.openUrl({ url }) : window.open(url, '_blank'),
  openPath: noop, showItemInFolder: noop, trashItem: async () => {},
};
export const dialog = deep(), nativeImage = deep(), protocol = deep(), Tray = function () { return deep(); }, screen = deep();
export const powerSaveBlocker = deep();
export default { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, session, nativeImage, protocol, Tray, screen, powerSaveBlocker };
