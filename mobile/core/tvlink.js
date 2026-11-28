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

// данные кладём в поля «трека» комнаты: у сервера каждое поле ограничено, поэтому делим на части
const PART = 190;
export async function seal(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(unb64u(key), 'encrypt'), new TextEncoder().encode(JSON.stringify(obj)));
  const text = b64u(iv) + '.' + b64u(data);
  if (text.length > PART * 3) throw new Error('Слишком длинные данные входа');
  return { source: 'tvlogin', rawId: '', title: text.slice(0, PART), artist: text.slice(PART, PART * 2), album: text.slice(PART * 2) };
}
export async function open(track, key) {
  if (!track || track.source !== 'tvlogin') return null;
  const [iv, data] = ((track.title || '') + (track.artist || '') + (track.album || '')).split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aes(unb64u(key), 'decrypt'), unb64u(data));
  return JSON.parse(new TextDecoder().decode(plain));
}
