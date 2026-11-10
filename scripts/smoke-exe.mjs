import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';

const original = resolve('release/Beango-win-x64/Beango.exe');
const directory = await mkdtemp(join(tmpdir(), 'beango-exe-test-'));
const executable = join(directory, 'Beango.exe');
await copyFile(original, executable);
const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const url = `http://127.0.0.1:${port}`;
let processHandle, socket;
let output = '';
async function start() {
  processHandle = spawn(executable, ['--no-open'], { windowsHide: true, cwd: tmpdir(), env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: join(directory, 'data'),
    PUBLIC_URL: 'http://203.0.113.10:4321', PATH: join(process.env.SystemRoot, 'System32'), NODE_OPTIONS: '',
  } });
  processHandle.stdout.on('data', (data) => { output += data; });
  processHandle.stderr.on('data', (data) => { output += data; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (processHandle.exitCode !== null) throw new Error(output);
    try { if ((await (await fetch(`${url}/api/health`)).json()).app === 'beango') return; } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Exe did not start: ${output}`);
}
async function stop() {
  socket?.close(); socket = undefined;
  if (processHandle && processHandle.exitCode === null) {
    const closed = once(processHandle, 'exit'); processHandle.kill(); await closed;
  }
}
try {
  await start();
  const html = await (await fetch(url)).text(); assert.match(html, /Beango/);
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(url + asset)).status, 200);
  assert.equal((await fetch(`${url}/avatars/01-cat.webp`)).status, 200);
  const joined = await fetch(`${url}/api/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Соло', avatarId: '01-cat' }) });
  const cookie = joined.headers.getSetCookie()[0].split(';')[0];
  const state = await joined.json(); assert.equal(state.self.isHost, true);
  const getState = async () => (await fetch(`${url}/api/session`, { headers: { Cookie: cookie } })).json();
  const act = async (action) => {
    const response = await fetch(`${url}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ roundId: state.room.roundId, action }) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  socket = new WebSocket(url.replace('http:', 'ws:') + '/ws', { headers: { Cookie: cookie, Origin: url } });
  await once(socket, 'open');
  assert.equal((await (await fetch(`${url}/api/invite`, { headers: { Cookie: cookie } })).json()).publicUrl, 'http://203.0.113.10:4321');
  await act({ type: 'dictionary', entries: ['Один', 'Два', 'Три', 'Четыре'], superEntry: 'Пять', ready: true });
  for (let i = 0; i < 20 && !(await getState()).room.canStart; i++) await new Promise((done) => setTimeout(done, 50));
  await act({ type: 'start' });
  const marked = await act({ type: 'mark', playerId: state.self.id, entryId: 'super', marked: true });
  assert.equal(marked.room.players[0].score, 2);
  const unmarked = await act({ type: 'mark', playerId: state.self.id, entryId: 'super', marked: false });
  assert.equal(unmarked.room.players[0].score, 0);
  await act({ type: 'finish' });
  await stop(); await start();
  const restored = await getState();
  assert.equal(restored.room.phase, 'finished'); assert.equal(restored.self.id, state.self.id);
  console.log('EXE OK: isolated folder, no Node.js in PATH, embedded assets, invite URL, solo, score, uncheck, restart persistence.');
} finally {
  await stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('beango-exe-test-'));
  await rm(directory, { recursive: true, force: true });
}
