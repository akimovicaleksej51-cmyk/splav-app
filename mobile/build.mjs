// Сборка: ядро (src/main.js с подменами) + интерфейс → www/
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
const shim = f => path.join(root, 'core', f);
await esbuild.build({
  entryPoints: [path.join(root, 'app', 'main.js')],
  bundle: true, format: 'iife', platform: 'browser', target: ['safari16'],
  outfile: path.join(out, 'app.js'), minify: process.argv.includes('--min'), sourcemap: false, legalComments: 'none',
  alias: { electron: shim('electron.js'), fs: shim('fs.js'), crypto: shim('crypto.js'), stream: shim('empty.js'), child_process: shim('empty.js'), net: shim('empty.js'), path: 'path-browserify' },
  external: ['music-metadata'],
  define: { 'process.platform': '"ios"', 'process.pid': '1', '__dirname': '"/app"', 'process.env': '{}' },
  logLevel: 'warning',
});
for (const f of ['index.html', 'styles.css']) fs.copyFileSync(path.join(root, 'app', f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, '..', 'src', 'renderer', 'fonts'))) fs.copyFileSync(path.join(root, '..', 'src', 'renderer', 'fonts', f), path.join(out, 'fonts', f));
console.log('www готов');
