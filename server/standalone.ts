import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getAsset, getAssetKeys } from 'node:sea';
import { loadEnvFile } from 'node:process';
import { execFile } from 'node:child_process';
import { persistentGame } from './game.js';
import { createGameServer } from './app.js';
import { localPeerChecker, localUrls } from './network.js';

declare const BEANGO_ASSET_VERSION: string;

async function main() {
  const directory = dirname(process.execPath);
  process.chdir(directory);
  if (existsSync(join(directory, '.env'))) loadEnvFile(join(directory, '.env'));
  const port = Number(process.env.PORT || 4321);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть числом от 1 до 65535.');
  const url = `http://localhost:${port}`;
  const open = () => {
    if (!process.argv.includes('--no-open')) execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => {});
  };
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1200) });
    const health = await response.json() as { app?: string };
    if (health.app === 'beango' || health.app === 'sticker-party-bingo') {
      console.log(`Beango уже запущена: ${url}`); open(); return;
    }
  } catch { /* Start a new server when no Beango instance is listening. */ }
  const clientDirectory = join(process.env.LOCALAPPDATA || directory, 'Beango', `client-${BEANGO_ASSET_VERSION}`);
  if (!existsSync(join(clientDirectory, '.ready'))) {
    for (const key of getAssetKeys().filter((key) => key.startsWith('client/'))) {
      const target = join(clientDirectory, key.slice('client/'.length));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(getAsset(key)));
    }
    writeFileSync(join(clientDirectory, '.ready'), BEANGO_ASSET_VERSION);
  }
  const server = createGameServer({
    store: persistentGame(resolve(process.env.DATA_DIR || 'data')), clientDirectory, port,
    publicUrl: process.env.PUBLIC_URL,
    allowedHosts: (process.env.ALLOWED_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
    isLocalPeer: localPeerChecker((process.env.TRUSTED_LAN_CIDRS || '').split(',').map((value) => value.trim()).filter(Boolean)),
  });
  server.http.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят другой программой. Измените PORT в .env.` : error.message);
    process.exitCode = 1;
  });
  server.http.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`\n  BEANGO — Стикер пати\n\n  На этом компьютере: ${url}`);
    for (const address of localUrls(port)) console.log(`  В локальной сети:   ${address}`);
    if (process.env.PUBLIC_URL) console.log(`  Для гостей:         ${process.env.PUBLIC_URL}`);
    else console.log('  Для доступа из интернета запустите Enable Internet.cmd, затем перезапустите Beango.');
    console.log('\n  Для остановки закройте это окно или нажмите Ctrl+C.\n'); open();
  });
  process.on('SIGINT', () => void server.close());
  process.on('SIGTERM', () => void server.close());
}

void main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
