// Ядро Сплава на iPhone: те же обработчики, что и на Маке (src/main.js)
import { hydrate } from './fs.js';
import { handlers } from './electron.js';
import { Native, isNative } from './native.js';

// URL-объекты в fetch превращаем в строки: так надёжнее для нативного HTTP
const origFetch = window.fetch.bind(window);
window.fetch = (r, o) => origFetch(r instanceof URL ? r.href : r, o);

let ready;
export function startCore() {
  ready ||= (async () => { await hydrate(); require('../../src/main.js'); await new Promise(r => setTimeout(r, 0)); })();
  return ready;
}
export async function call(name, ...args) {
  await startCore();
  const fn = handlers.get(name);
  if (!fn) throw new Error('Нет функции ' + name);
  const r = await fn(null, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
export function override(name, fn) {
  handlers.set(name, async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
}
export { Native, isNative };
