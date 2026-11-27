// Сборка Сплава для телевизора: то же ядро, что на Маке и iPhone (src/main.js с подменами из mobile/core),
// и свой интерфейс под пульт (tv/app) → tv/www
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(root, 'www');
const require = createRequire(import.meta.url);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
const shim = f => path.join(root, '..', 'mobile', 'core', f);
// пакеты берём из tv/node_modules, даже когда их импортирует код из mobile/core
const pkgDir = name => path.dirname(require.resolve(name + '/package.json'));
await esbuild.build({
  entryPoints: [path.join(root, 'app', 'main.js')],
  bundle: true, format: 'iife', platform: 'browser', target: ['chrome80'],
  outfile: path.join(out, 'app.js'), minify: process.argv.includes('--min'), sourcemap: false, legalComments: 'none',
  alias: {
    electron: shim('electron.js'), fs: shim('fs.js'), crypto: shim('crypto.js'), stream: shim('empty.js'), child_process: shim('empty.js'), net: shim('empty.js'), path: 'path-browserify',
    '@capacitor/core': pkgDir('@capacitor/core'), '@capacitor/preferences': pkgDir('@capacitor/preferences'), 'js-md5': pkgDir('js-md5'), 'js-sha256': pkgDir('js-sha256'),
  },
  nodePaths: [path.join(root, 'node_modules')],
  external: ['music-metadata'],
  define: { 'process.platform': '"android"', 'process.pid': '1', '__dirname': '"/app"', 'process.env': '{}' },
  logLevel: 'warning',
});
for (const f of ['index.html', 'styles.css']) fs.copyFileSync(path.join(root, 'app', f), path.join(out, f));
const fonts = path.join(root, '..', 'src', 'renderer', 'fonts');
for (const f of fs.readdirSync(fonts)) fs.copyFileSync(path.join(fonts, f), path.join(out, 'fonts', f));
console.log('www готов');
