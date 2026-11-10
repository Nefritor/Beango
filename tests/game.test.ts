import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { GameError, GameStore, persistentGame, type Actor } from '../server/game.js';
import { localPeerChecker } from '../server/network.js';

const hash = (name: string) => createHash('sha256').update(name).digest('hex');
const fails = (status: number) => (error: unknown) => error instanceof GameError && error.status === status;
function setup() {
  const store = new GameStore();
  const host: Actor = { playerId: store.join(hash('host'), 'Ведущий', '01-cat', true), isLocal: true };
  const guest: Actor = { playerId: store.join(hash('guest'), 'Гость', '11-octopus', false), isLocal: false };
  store.presence(host.playerId, 'host-socket', true); store.presence(guest.playerId, 'guest-socket', false);
  const act = (actor: Actor, action: unknown) => store.action(actor, action, store.snapshot().roundId);
  const ready = (actor: Actor) => act(actor, { type: 'dictionary', entries: ['Кот в кадре', 'Звонок', 'Смех', 'Чай'], superEntry: 'Все засмеялись', ready: true });
  return { store, host, guest, act, ready };
}

test('словари скрыты до старта; готовность, присутствие и минимум игроков проверяет сервер', () => {
  const { store, host, guest, act, ready } = setup();
  ready(host);
  assert.equal(store.view(hash('guest'), false).room.players.find((p) => p.id === host.playerId)!.entries.length, 0);
  assert.equal(store.view(hash('host'), true).room.players.find((p) => p.id === host.playerId)!.entries.length, 5);
  assert.throws(() => act(host, { type: 'start' }), fails(409));
  ready(guest); store.presence(guest.playerId, 'guest-socket', null);
  assert.throws(() => act(host, { type: 'start' }), fails(409));
  store.presence(guest.playerId, 'guest-socket', false);
  act(host, { type: 'start' });
  assert.equal(store.view(hash('guest'), false).room.players[0].entries.length, 5);
});

test('соло: готовый ведущий в сети запускает раунд, отмечает, снимает и завершает игру', () => {
  const store = new GameStore();
  const host: Actor = { playerId: store.join(hash('solo'), 'Соло', '01-cat', true), isLocal: true };
  const action = (input: unknown) => store.action(host, input, store.snapshot().roundId);
  assert.throws(() => action({ type: 'start' }), fails(409));
  action({ type: 'dictionary', entries: ['Раз', 'Два', 'Три', 'Четыре'], superEntry: 'Пять', ready: true });
  assert.throws(() => action({ type: 'start' }), fails(409));
  store.presence(host.playerId, 'solo-socket', true); action({ type: 'start' });
  action({ type: 'mark', playerId: host.playerId, entryId: 'super', marked: true });
  assert.equal(store.view(hash('solo'), true).room.players[0].score, 2);
  action({ type: 'mark', playerId: host.playerId, entryId: 'super', marked: false });
  assert.equal(store.view(hash('solo'), true).room.players[0].score, 0);
  action({ type: 'finish' });
  assert.equal(store.snapshot().phase, 'finished');
});

test('обычное бинго +1, супер +2, повторная отметка ничего не начисляет; отмена возвращает очки', () => {
  const { store, host, guest, act, ready } = setup(); ready(host); ready(guest); act(host, { type: 'start' });
  act(host, { type: 'mark', playerId: guest.playerId, entryId: 'regular-1' });
  const again = act(host, { type: 'mark', playerId: guest.playerId, entryId: 'regular-1' });
  assert.equal(again.changed, false); assert.equal(again.event, undefined);
  const special = act(host, { type: 'mark', playerId: guest.playerId, entryId: 'super' });
  assert.equal(special.event!.points, 2);
  assert.equal(store.view(hash('guest'), false).room.players[1].score, 3);
  act(host, { type: 'undo' });
  assert.equal(store.view(hash('guest'), false).room.players[1].score, 1);
  assert.equal(store.view(hash('guest'), false).room.players[1].entries.find((entry) => entry.super)!.marked, false);
});

test('гость не может управлять чужими очками, стартом и завершением; локальный токен снаружи тоже не даёт прав ведущего', () => {
  const { store, host, guest, act, ready } = setup(); ready(host); ready(guest);
  assert.throws(() => act(guest, { type: 'start' }), fails(403));
  act(host, { type: 'start' });
  assert.throws(() => act(guest, { type: 'mark', playerId: guest.playerId, entryId: 'super' }), fails(403));
  assert.throws(() => act(guest, { type: 'finish' }), fails(403));
  assert.throws(() => act({ ...host, isLocal: false }, { type: 'finish' }), fails(403));
  assert.equal(store.view(hash('host'), false).self!.isHost, false);
});

test('снятие обычного и супер бинго возвращает очки; отмена пропускает снятые клетки, повторный запрос не меняет счёт', () => {
  const { store, host, guest, act, ready } = setup(); ready(host); ready(guest); act(host, { type: 'start' });
  const regular = { type: 'mark', playerId: guest.playerId, entryId: 'regular-1' };
  const special = { type: 'mark', playerId: guest.playerId, entryId: 'super' };
  act(host, regular); act(host, special); act(guest, { type: 'common', cellId: 'common-1' });
  const removed = act(host, { ...regular, marked: false });
  assert.equal(removed.event, undefined);
  assert.equal(store.view(hash('guest'), false).room.players[1].score, 2);
  assert.equal(store.view(hash('guest'), false).room.players[1].normalHits, 0);
  act(guest, { type: 'common', cellId: 'common-1', marked: false });
  assert.equal(store.snapshot().commonCells[0].marked, false);
  act(host, { type: 'undo' });
  assert.equal(store.view(hash('guest'), false).room.players[1].score, 0);
  assert.equal(store.view(hash('host'), true).room.canUndo, false);
  const before = store.snapshot();
  assert.equal(act(host, { ...special, marked: false }).changed, false);
  assert.deepEqual(store.snapshot(), before);
  act(host, { ...special, marked: true });
  assert.equal(store.view(hash('guest'), false).room.players[1].score, 2);
  const restored = new GameStore(store.snapshot());
  restored.action(host, { ...special, marked: false }, restored.snapshot().roundId);
  assert.equal(restored.view(hash('guest'), false).room.players[1].score, 0);
});

test('снятие отметок проверяет роль, режим общего поля, завершение и тип состояния', () => {
  const { store, host, guest, act, ready } = setup(); ready(host); ready(guest); act(host, { type: 'start' });
  const mark = { type: 'mark', playerId: guest.playerId, entryId: 'super' };
  act(host, mark); act(guest, { type: 'common', cellId: 'common-1' });
  assert.throws(() => act(guest, { ...mark, marked: false }), fails(403));
  assert.throws(() => act({ ...host, isLocal: false }, { ...mark, marked: false }), fails(403));
  const current = store.snapshot();
  act(host, { type: 'settings', settings: { ...current.settings, commonPermission: 'host' }, commonWords: current.commonCells.map((cell) => cell.text) });
  assert.throws(() => act(guest, { type: 'common', cellId: 'common-1', marked: false }), fails(403));
  for (const marked of ['false', 0, null]) {
    assert.throws(() => act(host, { ...mark, marked }), fails(400));
    assert.throws(() => act(host, { type: 'common', cellId: 'common-1', marked }), fails(400));
  }
  act(host, { type: 'finish' });
  assert.throws(() => act(host, { ...mark, marked: false }), fails(409));
  assert.throws(() => act(host, { type: 'common', cellId: 'common-1', marked: false }), fails(409));
  assert.equal(store.view(hash('guest'), false).room.players[1].score, 2);
  assert.equal(store.snapshot().commonCells[0].marked, true);
});

test('права общего поля меняются на ходу; общее бинго не меняет личный счёт', () => {
  const { store, host, guest, act, ready } = setup(); ready(host); ready(guest); act(host, { type: 'start' });
  const current = store.snapshot();
  act(host, { type: 'settings', settings: { ...current.settings, commonPermission: 'host' }, commonWords: current.commonCells.map((cell) => cell.text) });
  assert.throws(() => act(guest, { type: 'common', cellId: 'common-1' }), fails(403));
  act(host, { type: 'settings', settings: { ...current.settings, commonPermission: 'everyone' }, commonWords: current.commonCells.map((cell) => cell.text) });
  act(guest, { type: 'common', cellId: 'common-1' });
  assert.equal(act(host, { type: 'common', cellId: 'common-1' }).changed, false);
  assert.equal(store.view(hash('guest'), false).room.players[1].score, 0);
  assert.equal(store.snapshot().commonCells[0].marked, true);
});

test('завершённая игра закрыта для отметок; новый раунд сохраняет словари и отклоняет старые команды', () => {
  const { store, host, guest, act, ready } = setup(); ready(host); ready(guest); act(host, { type: 'start' });
  const oldRound = store.snapshot().roundId;
  act(host, { type: 'mark', playerId: host.playerId, entryId: 'super' }); act(host, { type: 'finish' });
  assert.throws(() => act(host, { type: 'mark', playerId: host.playerId, entryId: 'regular-1' }), fails(409));
  act(host, { type: 'newGame' });
  assert.notEqual(store.snapshot().roundId, oldRound);
  assert.equal(store.snapshot().players[0].entries[0].text, 'Кот в кадре');
  assert.equal(store.view(hash('host'), true).room.players[0].score, 0);
  assert.equal(store.snapshot().players[0].ready, false);
  assert.throws(() => store.action(host, { type: 'start' }, oldRound), fails(409));
});

test('лимит четыре игрока, уникальность имён и запрет позднего входа', () => {
  const { store, host, guest, act, ready } = setup();
  assert.throws(() => store.join(hash('other'), ' гОСТЬ ', '01-cat', false), fails(409));
  ready(host); ready(guest); act(host, { type: 'start' });
  assert.throws(() => store.join(hash('late'), 'Опоздал', '01-cat', false), fails(409));
  act(host, { type: 'finish' }); act(host, { type: 'newGame' });
  store.join(hash('three'), 'Третий', '01-cat', false); store.join(hash('four'), 'Четвёртый', '01-cat', false);
  assert.throws(() => store.join(hash('five'), 'Пятый', '01-cat', false), fails(409));
});

test('ошибочный словарь и ошибка записи не оставляют частичных изменений', () => {
  const { store, host, act } = setup();
  const before = store.snapshot();
  assert.throws(() => act(host, { type: 'dictionary', entries: ['Раз', 'раз', '', ''], superEntry: '', ready: true }), fails(400));
  assert.deepEqual(store.snapshot(), before);
  const failing = new GameStore(before, () => { throw new Error('disk full'); });
  assert.throws(() => failing.action(host, { type: 'profile', name: 'Новое имя', avatarId: '01-cat' }, before.roundId), /disk full/);
  assert.deepEqual(failing.snapshot(), before);
});

test('сохранение восстанавливает игроков, словари и идентичность сессии после перезапуска', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'sticker-bingo-test-'));
  t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('sticker-bingo-test-')); rmSync(directory, { recursive: true, force: true }); });
  const first = persistentGame(directory);
  const id = first.join(hash('saved'), 'Сохранён', '11-octopus', true);
  first.action({ playerId: id, isLocal: true }, { type: 'dictionary', entries: ['Один', 'Два', 'Три', 'Четыре'], superEntry: 'Пять', ready: true }, first.snapshot().roundId);
  const second = persistentGame(directory);
  assert.equal(second.playerByHash(hash('saved'))!.id, id);
  assert.equal(second.view(hash('saved'), true).room.players[0].entries[4].text, 'Пять');
  assert.equal(second.view(hash('saved'), true).room.players[0].connected, false);
});

test('несколько вкладок одной сессии считаются одним игроком и не теряют присутствие при закрытии одной', () => {
  const { store, host } = setup();
  assert.equal(store.join(hash('host'), 'Другое имя', '03-fox', true), host.playerId);
  store.presence(host.playerId, 'second-tab', true);
  store.presence(host.playerId, 'host-socket', null);
  assert.equal(store.connected(host.playerId), true);
  assert.equal(store.hostOnline(), true);
});

test('роль ведущего можно восстановить только локально и только когда прежний ведущий не подключён', () => {
  const { store, host } = setup();
  assert.throws(() => store.recoverHost(hash('restore'), true), fails(409));
  store.presence(host.playerId, 'host-socket', null);
  assert.throws(() => store.recoverHost(hash('restore'), false), fails(403));
  assert.equal(store.recoverHost(hash('restore'), true), host.playerId);
  assert.equal(store.playerByHash(hash('host')), undefined);
  assert.equal(store.playerByHash(hash('restore'))!.id, host.playerId);
});

test('локальная роль определяется реальной подсетью, включая IPv4-mapped адреса', () => {
  const isLocal = localPeerChecker(['192.168.31.0/24', 'fd12:3456::/64'], {});
  assert.equal(isLocal('127.0.0.1'), true); assert.equal(isLocal('::1'), true);
  assert.equal(isLocal('::ffff:192.168.31.28'), true);
  assert.equal(isLocal('192.168.32.28'), false); assert.equal(isLocal('203.0.113.4'), false);
  assert.equal(isLocal('fd12:3456::5'), true); assert.equal(isLocal('2001:db8::5'), false);
  assert.equal(isLocal(undefined), false);
});
