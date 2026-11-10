import express, { type ErrorRequestHandler, type Request } from 'express';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { asRecord, GameError, GameStore, type Mutation } from './game.js';
import { localPeerChecker, localUrls, validOrigin, validRequestHost } from './network.js';
import type { ServerMessage } from '../shared/types.js';
import { DEFAULT_PORT } from './config.js';

interface Options {
  store: GameStore; clientDirectory?: string; port?: number; publicUrl?: string;
  allowedHosts?: string[]; isLocalPeer?: (address: string | undefined) => boolean;
}
interface Peer { hash: string; isLocal: boolean; playerId: string; id: string; alive: boolean }

const COOKIE_NAME = 'sticker_bingo';
export const hashSession = (token: string) => createHash('sha256').update(token).digest('hex');

function sessionHash(request: { headers: { cookie?: string } }) {
  const value = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return value && /^[a-zA-Z0-9_-]{43}$/.test(value) ? hashSession(value) : undefined;
}

export function createGameServer(options: Options) {
  const { store } = options;
  const app = express();
  const http = createServer(app);
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const peers = new Map<WebSocket, Peer>();
  const isLocalPeer = options.isLocalPeer ?? localPeerChecker();
  const allowedHosts = options.allowedHosts ?? [];
  const clientDirectory = options.clientDirectory ?? resolve('dist/client');
  const rateLimits = new Map<string, { count: number; until: number }>();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  const isLocal = (request: Request) => isLocalPeer(request.socket.remoteAddress);
  const actor = (request: Request) => {
    const player = store.playerByHash(sessionHash(request));
    if (!player) throw new GameError(401, 'Присоединитесь к комнате ещё раз.');
    return { playerId: player.id, isLocal: isLocal(request) };
  };
  const send = (socket: WebSocket, peer: Peer, mutation?: Mutation) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!store.playerByHash(peer.hash)) { socket.send(JSON.stringify({ type: 'expired' })); socket.close(1000); return; }
    const message: ServerMessage = { type: 'state', state: store.view(peer.hash, peer.isLocal),
      ...(mutation?.event ? { event: mutation.event } : {}), ...(mutation?.notice ? { notice: mutation.notice } : {}) };
    if (socket.bufferedAmount > 1_000_000) { socket.terminate(); return; }
    socket.send(JSON.stringify(message));
  };
  const broadcast = (mutation?: Mutation) => { for (const [socket, peer] of peers) send(socket, peer, mutation); };

  app.use((request, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'",
    });
    if (!validRequestHost(request, allowedHosts)) return next(new GameError(421, 'Этот адрес сервера не разрешён. Используйте IP-адрес или добавьте домен в ALLOWED_HOSTS.'));
    if (request.path.startsWith('/api')) {
      response.set('Cache-Control', 'no-store');
      if (!validOrigin(request)) return next(new GameError(403, 'Запрос пришёл с другого сайта. Откройте адрес игры.'));
      const key = `${request.socket.remoteAddress}:${request.path === '/api/join' ? 'join' : 'api'}`;
      const now = Date.now();
      let bucket = rateLimits.get(key);
      if (!bucket || bucket.until <= now) { bucket = { count: 0, until: now + 60_000 }; rateLimits.set(key, bucket); }
      bucket.count += 1;
      if (bucket.count > (request.path === '/api/join' ? 20 : 360)) return next(new GameError(429, 'Слишком много действий. Подождите немного.'));
      if (request.method === 'POST' && !request.is('application/json')) return next(new GameError(415, 'Ожидается запрос в формате JSON.'));
    }
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));

  app.get('/api/health', (_request, response) => response.json({ ok: true, app: 'beango' }));
  app.get('/api/session', (request, response) => response.json(store.view(sessionHash(request), isLocal(request))));
  app.post('/api/join', (request, response) => {
    const body = asRecord(request.body);
    const existingHash = sessionHash(request);
    const token = randomBytes(32).toString('base64url');
    const hash = existingHash && store.playerByHash(existingHash) ? existingHash : hashSession(token);
    store.join(hash, body.name, body.avatarId, isLocal(request));
    if (hash !== existingHash) response.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 86_400_000, path: '/' });
    broadcast(); response.json(store.view(hash, isLocal(request)));
  });
  app.post('/api/host/recover', (request, response) => {
    const token = randomBytes(32).toString('base64url'); const hash = hashSession(token);
    store.recoverHost(hash, isLocal(request));
    response.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 86_400_000, path: '/' });
    broadcast(); response.json(store.view(hash, isLocal(request)));
  });
  app.post('/api/action', (request, response) => {
    const body = asRecord(request.body);
    const mutation = store.action(actor(request), body.action, body.roundId);
    if (mutation.changed) broadcast(mutation);
    response.json(store.view(sessionHash(request), isLocal(request)));
  });
  app.post('/api/leave', (request, response) => {
    store.leave(actor(request)); response.clearCookie(COOKIE_NAME, { path: '/' });
    broadcast(); response.json(store.view(undefined, isLocal(request)));
  });
  app.get('/api/network', (request, response) => {
    const current = actor(request);
    if (!store.view(sessionHash(request), current.isLocal).self?.isHost) throw new GameError(403, 'Сетевые настройки доступны ведущему.');
    const address = http.address(); const port = address && typeof address !== 'string' ? address.port : options.port ?? DEFAULT_PORT;
    response.json({ localUrls: localUrls(port), publicUrl: options.publicUrl || null, port });
  });
  app.get('/api/invite', (request, response) => {
    actor(request);
    response.json({ publicUrl: options.publicUrl || null });
  });
  app.use('/api', (_request, _response, next) => next(new GameError(404, 'Такого действия нет.')));
  app.use(express.static(clientDirectory, { index: false, maxAge: '1h', dotfiles: 'deny' }));
  app.get('/', (_request, response) => {
    const index = resolve(clientDirectory, 'index.html');
    if (!existsSync(index)) return response.status(503).type('text').send('Сначала выполните npm run build.');
    response.set('Cache-Control', 'no-cache').sendFile(index);
  });
  app.use((_request, _response, next) => next(new GameError(404, 'Страница не найдена.')));
  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof GameError) return response.status(error.status).json({ error: error.message });
    if (error?.type === 'entity.too.large') return response.status(413).json({ error: 'Запрос слишком большой.' });
    if (error instanceof SyntaxError) return response.status(400).json({ error: 'Не удалось прочитать запрос.' });
    console.error('Ошибка сервера:', error instanceof Error ? error.message : 'неизвестная ошибка');
    response.status(500).json({ error: 'Не удалось сохранить изменение. Повторите попытку.' });
  };
  app.use(handleError);

  http.on('upgrade', (request, socket, head) => {
    const refuse = (code: number) => { socket.write(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if (request.url !== '/ws' || !validRequestHost(request, allowedHosts) || !validOrigin(request)) { refuse(403); return; }
    const hash = sessionHash(request); const player = store.playerByHash(hash);
    if (!hash || !player) { refuse(401); return; }
    if ([...peers.values()].filter((peer) => peer.playerId === player.id).length >= 5) { refuse(429); return; }
    const peer: Peer = { hash, playerId: player.id, isLocal: isLocalPeer(request.socket.remoteAddress), id: randomUUID(), alive: true };
    websocket.handleUpgrade(request, socket, head, (client) => {
      peers.set(client, peer); store.presence(player.id, peer.id, peer.isLocal);
      client.on('pong', () => { peer.alive = true; });
      client.on('message', () => client.close(1008, 'Use the game API'));
      client.on('error', () => {});
      client.on('close', () => { peers.delete(client); store.presence(player.id, peer.id, null); broadcast(); });
      broadcast();
    });
  });
  const heartbeat = setInterval(() => {
    for (const [socket, peer] of peers) {
      if (!peer.alive) { socket.terminate(); continue; }
      peer.alive = false; socket.ping();
    }
    const now = Date.now(); for (const [key, value] of rateLimits) if (value.until <= now) rateLimits.delete(key);
  }, 25_000);
  heartbeat.unref();
  const close = async () => {
    clearInterval(heartbeat);
    for (const socket of peers.keys()) socket.terminate();
    await new Promise<void>((done) => websocket.close(() => done()));
    await new Promise<void>((done, reject) => http.close((error) => error ? reject(error) : done()));
  };
  return { app, http, store, close };
}
