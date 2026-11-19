// Файлы настроек живут в Preferences (UserDefaults): при старте всё читается в память,
// дальше чтение синхронное, а запись уходит в фон
import { Preferences } from '@capacitor/preferences';
import keys from '../../src/keys.json';

const mem = new Map();
const P = 'fs:';
let saveTimers = new Map();
export async function hydrate() {
  try {
    const { keys: all } = await Preferences.keys();
    await Promise.all(all.filter(k => k.startsWith(P)).map(async k => { const { value } = await Preferences.get({ key: k }); if (value != null) mem.set(k.slice(P.length), value); }));
  } catch {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(P)) mem.set(k.slice(P.length), localStorage.getItem(k)); }
  }
}
function persist(p) {
  clearTimeout(saveTimers.get(p));
  saveTimers.set(p, setTimeout(() => {
    const v = mem.get(p);
    Preferences.set({ key: P + p, value: v }).catch(() => { try { localStorage.setItem(P + p, v); } catch {} });
  }, 300));
}
const enoent = p => Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });
export function readFileSync(p) {
  if (p.endsWith('/keys.json')) return JSON.stringify(keys);
  if (!mem.has(p)) throw enoent(p);
  return mem.get(p);
}
export function writeFileSync(p, data) { mem.set(p, typeof data === 'string' ? data : String(data)); persist(p); }
export function writeFile(p, data, cb) { writeFileSync(p, data); cb && cb(null); }
export const existsSync = p => mem.has(p);
export const mkdirSync = () => {};
export const readdirSync = () => [];
export const statSync = p => { throw enoent(p); };
export const unlinkSync = p => { mem.delete(p); Preferences.remove({ key: P + p }).catch(() => {}); };
export const renameSync = () => {};
export const rmSync = () => {};
export const mkdtempSync = p => p + Date.now();
export const chmodSync = () => {};
export const createReadStream = () => { throw new Error('Недоступно на iPhone'); };
export const createWriteStream = () => { throw new Error('Недоступно на iPhone'); };
export default { readFileSync, writeFileSync, writeFile, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync, rmSync, mkdtempSync, chmodSync, createReadStream, createWriteStream };
