const fail = () => { throw new Error('Недоступно на iPhone'); };
export const Readable = { toWeb: fail };
export const execFile = (...a) => { const cb = a[a.length - 1]; if (typeof cb === 'function') cb(new Error('Недоступно на iPhone')); };
export const spawn = () => ({ unref() {} });
export const createConnection = () => { const s = { on: (ev, cb) => { if (ev === 'error') setTimeout(() => cb(new Error('нет')), 0); return s; }, write() {}, destroy() {} }; return s; };
export default { Readable, execFile, spawn, createConnection };
