import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/app.js';
import { GameStore } from '../server/game.js';
import type { ServerMessage, SessionState } from '../shared/types.js';

async function setup(isLocal = true) {
  const server = createGameServer({ store: new GameStore(), isLocalPeer: () => isLocal });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const address = server.http.address(); assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}
async function join(url: string, name: string, extraHeaders = {}) {
  const response = await fetch(`${url}/api/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify({ name, avatarId: '01-cat' }) });
  const state = await response.json() as SessionState;
  return { response, state, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
}
async function connect(url: string, cookie: string) {
  const socket = new WebSocket(`${url.replace('http:', 'ws:')}/ws`, { headers: { Cookie: cookie, Origin: url } });
  await once(socket, 'open'); return socket;
}
function waitFor(socket: WebSocket, predicate: (message: ServerMessage) => boolean) {
  return new Promise<ServerMessage>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('WebSocket update timeout')); }, 3000);
    const listener = (raw: WebSocket.RawData) => {
      const data = JSON.parse(raw.toString()) as ServerMessage;
      if (predicate(data)) { clearTimeout(timer); socket.off('message', listener); resolve(data); }
    };
    socket.on('message', listener);
  });
}

test('реальные HTTP и WebSocket синхронизируют игру, права, очки и повторный вход', async (t) => {
  const { server, url } = await setup(); t.after(() => server.close());
  const host = await join(url, 'Аня'); assert.equal(host.response.status, 200); assert.equal(host.state.self!.isHost, true);
  assert.match(host.response.headers.get('set-cookie')!, /HttpOnly/);
  const hostWs = await connect(url, host.cookie);
  const guest = await join(url, 'Макс'); assert.equal(guest.state.self!.isHost, false);
  const guestWs = await connect(url, guest.cookie);
  const act = async (cookie: string, action: unknown) => fetch(`${url}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: url }, body: JSON.stringify({ roundId: host.state.room.roundId, action }) });
  for (const cookie of [host.cookie, guest.cookie]) {
    const response = await act(cookie, { type: 'dictionary', entries: ['Кот', 'Смех', 'Чай', 'Курьер'], superEntry: 'Все вместе', ready: true });
    assert.equal(response.status, 200);
  }
  assert.equal((await act(guest.cookie, { type: 'start' })).status, 403);
  const started = waitFor(guestWs, (data) => data.type === 'state' && data.state.room.phase === 'playing');
  assert.equal((await act(host.cookie, { type: 'start' })).status, 200); await started;
  const bingo = waitFor(guestWs, (data) => data.type === 'state' && data.event?.points === 2);
  assert.equal((await act(host.cookie, { type: 'mark', playerId: guest.state.self!.id, entryId: 'super' })).status, 200);
  const message = await bingo; assert.equal(message.type, 'state');
  if (message.type === 'state') assert.equal(message.state.room.players.find((player) => player.id === guest.state.self!.id)!.score, 2);
  await act(host.cookie, { type: 'mark', playerId: guest.state.self!.id, entryId: 'super' });
  const resumed = await fetch(`${url}/api/session`, { headers: { Cookie: guest.cookie } });
  const state = await resumed.json() as SessionState;
  assert.equal(state.self!.id, guest.state.self!.id); assert.equal(state.room.players[1].score, 2);
  const unchecked = waitFor(guestWs, (data) => data.type === 'state' && data.state.room.players[1].score === 0);
  assert.equal((await act(host.cookie, { type: 'mark', playerId: guest.state.self!.id, entryId: 'super', marked: false })).status, 200);
  const uncheckedMessage = await unchecked;
  assert.equal(uncheckedMessage.type, 'state');
  if (uncheckedMessage.type === 'state') {
    assert.equal(uncheckedMessage.event, undefined);
    assert.equal(uncheckedMessage.state.room.players[1].entries.find((entry) => entry.super)!.marked, false);
  }
  await act(guest.cookie, { type: 'common', cellId: 'common-1', marked: true });
  const commonUnchecked = waitFor(hostWs, (data) => data.type === 'state' && !data.state.room.commonCells[0].marked);
  assert.equal((await act(guest.cookie, { type: 'common', cellId: 'common-1', marked: false })).status, 200);
  await commonUnchecked;
  assert.equal((await act(host.cookie, { type: 'finish' })).status, 200);
  hostWs.close(); guestWs.close();
});

test('подмена заголовков не выдаёт внешнему гостю роль ведущего; чужой Origin и Host отклоняются', async (t) => {
  const { server, url } = await setup(false); t.after(() => server.close());
  const guest = await join(url, 'Гость', { 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '192.168.31.1' });
  assert.equal(guest.state.isLocal, false); assert.equal(guest.state.self!.isHost, false);
  const recover = await fetch(`${url}/api/host/recover`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: guest.cookie }, body: '{}' });
  assert.equal(recover.status, 403);
  assert.equal((await fetch(`${url}/api/session`, { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  const invalidHostStatus = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${url}/api/session`, { headers: { Host: 'unrelated.example' } }, (response) => {
      response.resume(); resolve(response.statusCode!);
    });
    request.on('error', reject); request.end();
  });
  assert.equal(invalidHostStatus, 421);
  const failed = new WebSocket(`${url.replace('http:', 'ws:')}/ws`, { headers: { Cookie: guest.cookie, Origin: 'https://unrelated.example' } });
  const [error] = await once(failed, 'error'); assert.match(String(error), /403/);
});
