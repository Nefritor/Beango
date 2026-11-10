import { build } from 'esbuild';
import { inject } from 'postject';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Сборка рассчитана на Windows x64 и Node.js 24.');
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'release', 'Beango-win-x64');
const working = join(root, 'dist', 'sea');
await mkdir(working, { recursive: true });
await mkdir(join(output, 'scripts'), { recursive: true });
const assets = {};
const hash = createHash('sha256');
async function collect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await collect(path);
    else {
      const key = `client/${relative(join(root, 'dist/client'), path).replaceAll('\\', '/')}`;
      assets[key] = path; hash.update(key); hash.update(await readFile(path));
    }
  }
}
await collect(join(root, 'dist/client'));
const main = join(working, 'beango.cjs');
await build({ entryPoints: [join(root, 'server/standalone.ts')], outfile: main, bundle: true,
  platform: 'node', target: 'node24', format: 'cjs', minify: true, external: ['bufferutil', 'utf-8-validate'],
  define: { BEANGO_ASSET_VERSION: JSON.stringify(hash.digest('hex').slice(0, 16)), 'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"' },
});
const blob = join(working, 'beango.blob');
const config = join(working, 'sea-config.json');
await writeFile(config, JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, execArgvExtension: 'none', assets }));
const preparation = spawnSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit', cwd: root });
if (preparation.status !== 0) throw new Error('Не удалось подготовить исполняемый файл.');
const executable = join(output, 'Beango.exe');
await copyFile(process.execPath, executable);
await inject(executable, 'NODE_SEA_BLOB', await readFile(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
for (const name of ['Enable Internet.cmd', 'Disable Internet.cmd', '.env.example']) await copyFile(join(root, name), join(output, name));
await copyFile(join(root, 'scripts/Network-Access.ps1'), join(output, 'scripts/Network-Access.ps1'));
await copyFile(join(root, 'README.md'), join(output, 'README.md'));
await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), await readFile(join(root, 'docs', 'THIRD_PARTY_NOTICES.txt')));
console.log(`Готово: ${executable}`);
