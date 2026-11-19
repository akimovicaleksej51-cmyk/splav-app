// Создаёт source.json для SideStore: версия, ссылка на .ipa, размер
import fs from 'node:fs';
const [ipa, repo, tag] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const raw = `https://raw.githubusercontent.com/${repo}/main/mobile`;
const src = {
  name: 'Сплав',
  identifier: 'com.splav.source',
  subtitle: 'Музыкальный плеер Сплав',
  iconURL: `${raw}/icon.png`,
  tintColor: '#b51d30',
  apps: [{
    name: 'Сплав',
    bundleIdentifier: 'com.splav.mobile',
    developerName: 'Сплав',
    subtitle: 'Яндекс, Звук и SoundCloud в одном плеере',
    localizedDescription: 'Музыкальный плеер: «Моя волна», поиск сразу по нескольким сервисам, тексты песен, комнаты «Слушать вместе» и отправка треков друзьям.',
    iconURL: `${raw}/icon.png`,
    tintColor: '#b51d30',
    category: 'entertainment',
    screenshots: [],
    versions: [{
      version: pkg.nativeVersion || pkg.version,
      buildVersion: process.env.GITHUB_RUN_NUMBER || '1',
      date: new Date().toISOString(),
      localizedDescription: pkg.releaseNotes || '',
      downloadURL: `https://github.com/${repo}/releases/download/${tag}/Splav.ipa`,
      size: fs.statSync(ipa).size,
      minOSVersion: '15.0',
    }],
    appPermissions: { entitlements: [], privacy: {} },
  }],
  news: [],
};
fs.writeFileSync(new URL('../source.json', import.meta.url), JSON.stringify(src, null, 2) + '\n');
console.log('source.json:', pkg.version);
