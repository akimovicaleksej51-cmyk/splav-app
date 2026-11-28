// Вход на телевизоре с телефона.
// Телевизор создаёт комнату на сервере «Слушать вместе» и показывает QR-код:
//   splavapp://tv/<код комнаты>?h=<ключ хозяина>#<ключ шифрования>
// Телефон шифрует свои входы этим ключом и кладёт их в комнату, телевизор забирает и расшифровывает.
// Ключ шифрования есть только в QR-коде: сервер видит лишь зашифрованные данные.
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const aes = (raw, use) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [use]);

export function newKey() { return b64u(crypto.getRandomValues(new Uint8Array(16))); }
export const linkUrl = (code, hostKey, key) => `splavapp://tv/${code}?h=${encodeURIComponent(hostKey)}#${key}`;
export function parseLink(url) {
  const m = /^splavapp:\/\/tv\/(\d{6})\?h=([^#&]+)#([A-Za-z0-9_-]{16,})$/.exec(url || '');
  return m ? { code: m[1], hostKey: decodeURIComponent(m[2]), key: m[3] } : null;
}

// Данные кладём в поля «трека» комнаты. Сервер ограничивает каждое поле, поэтому шифр режем
// на куски по полям, а если он длиннее одного «трека» — шлём частями: телефон кладёт часть,
// телевизор подтверждает её (source: 'tvack'), и только потом телефон кладёт следующую.
const FIELDS = [['rawId', 118, ''], ['title', 198, ''], ['artist', 198, ''], ['album', 198, ''], ['cover', 480, 'https://s/'], ['url', 480, 'https://s/']];
const CAP = FIELDS.reduce((n, f) => n + f[1], 0);
export async function sealParts(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(unb64u(key), 'encrypt'), new TextEncoder().encode(JSON.stringify(obj)));
  const text = b64u(iv) + '.' + b64u(data);
  const n = Math.ceil(text.length / CAP), parts = [];
  for (let i = 0; i < n; i++) {
    let chunk = text.slice(i * CAP, (i + 1) * CAP);
    const t = { source: 'tvlogin', albumId: `${i}/${n}` };
    for (const [f, len, pre] of FIELDS) { t[f] = pre + chunk.slice(0, len); chunk = chunk.slice(len); }
    parts.push(t);
  }
  return parts;
}
// одна часть: { i, n, chunk } или null, если это не часть входа
export function readPart(track) {
  if (!track || track.source !== 'tvlogin') return null;
  const m = /^(\d+)\/(\d+)$/.exec(track.albumId || '');
  const chunk = FIELDS.map(([f, , pre]) => String(track[f] || '').slice(pre.length)).join('');
  return m ? { i: +m[1], n: +m[2], chunk } : { i: 0, n: 1, chunk };
}
export async function openText(text, key) {
  const [iv, data] = text.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aes(unb64u(key), 'decrypt'), unb64u(data));
  return JSON.parse(new TextDecoder().decode(plain));
}

// пульт: телевизор ждёт в своей временной комнате, телефон сообщает ему код комнаты, которую ведёт сам
export const remoteUrl = (code, hostKey) => `splavapp://remote/${code}?h=${encodeURIComponent(hostKey)}`;
export function parseRemote(url) {
  const m = /^splavapp:\/\/remote\/(\d{6})\?h=([^#&]+)$/.exec(url || '');
  return m ? { code: m[1], hostKey: decodeURIComponent(m[2]) } : null;
}
