import { persistentGame } from './game.js';
import { createGameServer } from './app.js';
import { localPeerChecker, localUrls } from './network.js';
import { readConfiguration } from './config.js';

const config = readConfiguration(process.cwd(), process.env, process.env.NODE_ENV === 'development'
  ? { PORT: process.env.PORT, HOST: process.env.HOST } : {});
const { port, host } = config;
const store = persistentGame(config.dataDirectory);
const server = createGameServer({
  store, port, publicUrl: config.publicUrl, allowedHosts: config.allowedHosts,
  isLocalPeer: localPeerChecker(config.trustedLanCidrs),
});
server.http.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `Порт ${port} уже занят. Выберите другой PORT в .env.` : error.message);
  process.exitCode = 1;
});
server.http.listen(port, host, () => {
  console.log('\n  BEANGO — Стикер пати\n');
  console.log(config.loaded ? `  Конфигурация: ${config.envPath}` : `  Файл ${config.envPath} не найден.`);
  console.log(`  На этом компьютере: http://localhost:${port}`);
  if (host === '0.0.0.0' || host === '::') for (const url of localUrls(port)) console.log(`  В локальной сети:   ${url}`);
  if (config.publicUrl) console.log(`  Для гостей:         ${config.publicUrl}`);
  console.log('\n  Первый игрок из локальной сети становится ведущим.\n  Для остановки нажмите Ctrl+C.\n');
});
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  try { await server.close(); } catch { process.exitCode = 1; }
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
