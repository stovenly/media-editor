// Copies the pinned engine builds from node_modules into public/wasm and writes a manifest.
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'wasm');

const ENGINES = {
  vips: {
    pkg: 'wasm-vips',
    from: 'lib',
    files: ['vips-es6.js', 'vips.wasm', 'vips-jxl.wasm', 'vips-heif.wasm', 'vips-resvg.wasm'],
    notices: ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'versions.json'],
  },
  magick: {
    pkg: '@imagemagick/magick-wasm',
    from: 'dist/x86',
    files: ['magick.wasm'],
    notices: ['LICENSE', 'NOTICE'],
  },
  ffmpeg: {
    pkg: '@ffmpeg/core',
    from: 'dist/esm',
    files: ['ffmpeg-core.js', 'ffmpeg-core.wasm'],
    notices: [],
    notice: (version) =>
      [
        `FFmpeg, built by ffmpeg.wasm core ${version}, is licensed under the GNU General`,
        'Public License, version 2 or later: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',
        '',
        'Corresponding source, with the pinned versions of FFmpeg and every library in it:',
        `https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v${version}`,
        '',
      ].join('\n'),
  },
};

rmSync(out, { recursive: true, force: true });
const manifest = {};
for (const [name, engine] of Object.entries(ENGINES)) {
  const pkgDir = join(root, 'node_modules', ...engine.pkg.split('/'));
  const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const dir = `${name}-${version}`;
  mkdirSync(join(out, dir), { recursive: true });
  const files = {};
  for (const file of engine.files) {
    const source = join(pkgDir, engine.from, file);
    copyFileSync(source, join(out, dir, file));
    files[file] = statSync(source).size;
  }
  for (const file of engine.notices) copyFileSync(join(pkgDir, file), join(out, dir, file));
  if (engine.notice) writeFileSync(join(out, dir, 'NOTICE'), engine.notice(version));
  manifest[name] = { dir, files };
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Vendored ${Object.keys(manifest).join(', ')} into public/wasm`);
