// Только то, что нужно main.js: md5, sha256, hmac-sha256
import md5 from 'js-md5';
import { sha256 } from 'js-sha256';
const toB64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
const out = (bytes, hexFn, enc) => enc === 'hex' ? hexFn() : enc === 'base64' ? toB64(bytes()) : bytes();
export function createHash(alg) {
  let h = alg === 'md5' ? md5.create() : sha256.create();
  return { update(d) { h.update(typeof d === 'string' ? d : new Uint8Array(d)); return this; }, digest(enc) { return out(() => h.arrayBuffer(), () => h.hex(), enc); } };
}
export function createHmac(alg, key) {
  const h = sha256.hmac.create(key);
  return { update(d) { h.update(d); return this; }, digest(enc) { return out(() => h.arrayBuffer(), () => h.hex(), enc); } };
}
export const randomUUID = () => crypto.randomUUID();
export const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));
export default { createHash, createHmac, randomUUID, randomBytes };
