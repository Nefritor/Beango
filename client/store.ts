import { useSyncExternalStore } from 'react';
import type { BingoEvent, GameAction, ServerMessage, SessionState } from '../shared/types.js';

interface Notice { id: number; text: string; error: boolean }
interface ClientState {
  session: SessionState | null; loading: boolean; error: string | null;
  connection: 'idle' | 'connecting' | 'connected' | 'offline';
  bingo: BingoEvent | null; notice: Notice | null;
}

let state: ClientState = { session: null, loading: true, error: null, connection: 'idle', bingo: null, notice: null };
const listeners = new Set<() => void>();
let socket: WebSocket | null = null;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let publicPoll: ReturnType<typeof setInterval> | undefined;
let bingoTimer: ReturnType<typeof setTimeout> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let attempt = 0;
let noticeId = 0;
let initialized = false;
const eventIds = new Set<string>();

function update(patch: Partial<ClientState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store',
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось связаться с игрой. Повторите попытку.');
  return data as T;
}

function apply(session: SessionState) {
  if (state.session && session.room.id === state.session.room.id && session.room.version < state.session.room.version) return;
  const bingo = state.bingo;
  const stillMarked = bingo?.kind === 'common'
    ? session.room.commonCells.some((cell) => cell.id === bingo.key.slice('common:'.length) && cell.marked)
    : session.room.players.find((player) => player.id === bingo?.playerId)?.entries.some((entry) => `competitive:${bingo?.playerId}:${entry.id}` === bingo?.key && entry.marked);
  if (bingo && !stillMarked) clearTimeout(bingoTimer);
  update({ session, loading: false, error: null, ...(bingo && !stillMarked ? { bingo: null } : {}) });
}

function notify(text: string, error = false) {
  clearTimeout(noticeTimer);
  update({ notice: { id: ++noticeId, text, error } });
  noticeTimer = setTimeout(() => update({ notice: null }), error ? 6000 : 3500);
}

function disconnect() {
  clearTimeout(reconnect); reconnect = undefined;
  const previous = socket; socket = null;
  previous?.close();
}

function connect() {
  if (!state.session?.self || (socket && socket.readyState < WebSocket.CLOSING)) return;
  clearInterval(publicPoll); publicPoll = undefined;
  update({ connection: 'connecting' });
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket = current;
  current.onopen = () => { if (socket === current) { attempt = 0; update({ connection: 'connected' }); } };
  current.onmessage = (message) => {
    if (socket !== current) return;
    let data: ServerMessage;
    try { data = JSON.parse(String(message.data)); } catch { return; }
    if (data.type === 'expired') {
      generation += 1; disconnect(); update({ session: null, connection: 'idle' });
      void refresh(); notify('Место в комнате освободилось. Можно присоединиться заново.');
      return;
    }
    if (data.type !== 'state') return;
    apply(data.state);
    if (data.notice) notify(data.notice);
    if (data.event && !eventIds.has(data.event.id)) {
      eventIds.add(data.event.id);
      if (eventIds.size > 100) eventIds.delete(eventIds.values().next().value!);
      clearTimeout(bingoTimer); update({ bingo: data.event });
      bingoTimer = setTimeout(() => update({ bingo: null }), 1100);
    }
  };
  current.onerror = () => current.close();
  current.onclose = () => {
    if (socket !== current) return;
    socket = null;
    if (!state.session?.self) return;
    update({ connection: 'offline' });
    reconnect = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt++));
  };
}

async function refresh() {
  const before = generation;
  try {
    const session = await request<SessionState>('/api/session');
    if (before !== generation) return;
    apply(session);
    if (session.self) connect();
    else {
      disconnect(); update({ connection: 'idle' });
      publicPoll ??= setInterval(() => { if (!state.session?.self) void refresh(); }, 5000);
    }
  } catch (error) {
    if (before !== generation) return;
    update({ loading: false, error: error instanceof Error ? error.message : 'Нет соединения с сервером.' });
  }
}

export const gameClient = {
  initialize() { if (!initialized) { initialized = true; void refresh(); } },
  refresh,
  notify,
  async join(name: string, avatarId: string) {
    generation += 1;
    const session = await request<SessionState>('/api/join', { name, avatarId });
    apply(session); connect();
  },
  async recoverHost() {
    generation += 1;
    const session = await request<SessionState>('/api/host/recover', {});
    apply(session); connect();
  },
  async action(action: GameAction) {
    if (!state.session?.self || state.connection !== 'connected') throw new Error('Соединение восстанавливается. Подождите немного.');
    const session = await request<SessionState>('/api/action', { action, roundId: state.session.room.roundId });
    apply(session);
  },
  async leave() {
    const session = await request<SessionState>('/api/leave', {});
    generation += 1; disconnect(); apply(session); update({ connection: 'idle', bingo: null });
    void refresh();
  },
  network: () => request<import('../shared/types.js').NetworkInfo>('/api/network'),
  invite: () => request<{ publicUrl: string | null }>('/api/invite'),
  destroy() { disconnect(); clearInterval(publicPoll); clearTimeout(bingoTimer); clearTimeout(noticeTimer); },
};

export function useGame() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
}

if (import.meta.hot) import.meta.hot.dispose(() => gameClient.destroy());
