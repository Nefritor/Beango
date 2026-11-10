import { resolve } from 'node:path';
import { persistentGame } from './game.js';
import { createGameServer } from './app.js';
import { localPeerChecker, localUrls } from './network.js';

const port = Number(process.env.PORT || 4321);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть числом от 1 до 65535.');
const host = process.env.HOST || '0.0.0.0';
const store = persistentGame(resolve(process.env.DATA_DIR || 'data'));
const server = createGameServer({
  store, port, publicUrl: process.env.PUBLIC_URL,
  allowedHosts: (process.env.ALLOWED_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  isLocalPeer: localPeerChecker((process.env.TRUSTED_LAN_CIDRS || '').split(',').map((value) => value.trim()).filter(Boolean)),
});
server.http.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `Порт ${port} уже занят. Выберите другой PORT в .env.` : error.message);
  process.exitCode = 1;
});
server.http.listen(port, host, () => {
  console.log('\n  BEANGO — Стикер пати\n');
  console.log(`  На этом компьютере: http://localhost:${port}`);
  if (host === '0.0.0.0' || host === '::') for (const url of localUrls(port)) console.log(`  В локальной сети:   ${url}`);
  if (process.env.PUBLIC_URL) console.log(`  Для гостей:         ${process.env.PUBLIC_URL}`);
  console.log('\n  Первый игрок из локальной сети становится ведущим.\n  Для остановки нажмите Ctrl+C.\n');
});
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  try { await server.close(); } catch { process.exitCode = 1; }
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
