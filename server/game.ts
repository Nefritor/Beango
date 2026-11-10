import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_COMMON_WORDS, isAvatarId, MAX_NAME_LENGTH, MAX_PHRASE_LENGTH,
  MAX_PLAYERS, MIN_PLAYERS, type AvatarId,
} from '../shared/catalog.js';
import type { BingoEvent, CommonCell, Entry, Phase, SessionState, Settings } from '../shared/types.js';

export class GameError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Player {
  id: string; sessionHash: string; name: string; avatarId: AvatarId;
  ready: boolean; entries: Entry[];
}
interface HistoryItem {
  kind: 'competitive' | 'common'; playerId: string | null; targetId: string; description: string;
}
export interface GameData {
  schema: 1; id: string; roundId: string; version: number; phase: Phase;
  hostId: string | null; players: Player[]; settings: Settings;
  commonCells: CommonCell[]; history: HistoryItem[];
  startedAt: number | null; finishedAt: number | null;
}
export interface Actor { playerId: string; isLocal: boolean }
export interface Mutation { changed: boolean; event?: BingoEvent; notice?: string }

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GameError(400, 'Не удалось прочитать запрос. Обновите страницу и попробуйте ещё раз.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new GameError(400, `Заполните поле «${label}».`);
  const cleaned = value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!allowEmpty && !cleaned) throw new GameError(400, `Заполните поле «${label}».`);
  if (cleaned.length > max) throw new GameError(400, `В поле «${label}» должно быть не больше ${max} символов.`);
  return cleaned;
}

function settingsFrom(value: unknown): Settings {
  const data = asRecord(value);
  if (!Number.isInteger(data.competitiveCount) || Number(data.competitiveCount) < 4 || Number(data.competitiveCount) > 8) {
    throw new GameError(400, 'Выберите от 4 до 8 обычных вариантов.');
  }
  if (data.commonSize !== 3 && data.commonSize !== 4) throw new GameError(400, 'Выберите поле 3 × 3 или 4 × 4.');
  if (data.commonPermission !== 'host' && data.commonPermission !== 'everyone') throw new GameError(400, 'Выберите, кто отмечает общее поле.');
  return { competitiveCount: Number(data.competitiveCount), commonSize: data.commonSize, commonPermission: data.commonPermission };
}

function uniqueTexts(values: string[], label: string) {
  const normalized = values.filter(Boolean).map((value) => value.toLocaleLowerCase('ru'));
  if (new Set(normalized).size !== normalized.length) throw new GameError(400, `${label}: варианты не должны повторяться.`);
}

function entriesFor(count: number, previous: Entry[] = [], clear = false): Entry[] {
  return [
    ...Array.from({ length: count }, (_, index) => ({
      id: `regular-${index + 1}`, text: clear ? '' : previous.filter((entry) => !entry.super)[index]?.text ?? '',
      super: false, marked: false,
    })),
    { id: 'super', text: clear ? '' : previous.find((entry) => entry.super)?.text ?? '', super: true, marked: false },
  ];
}

export function newGameData(): GameData {
  return {
    schema: 1, id: randomUUID(), roundId: randomUUID(), version: 0,
    phase: 'lobby', hostId: null, players: [],
    settings: { competitiveCount: 4, commonSize: 3, commonPermission: 'everyone' },
    commonCells: DEFAULT_COMMON_WORDS.map((word, index) => ({ id: `common-${index + 1}`, text: word, marked: false })),
    history: [], startedAt: null, finishedAt: null,
  };
}

function validateSavedGame(value: unknown): GameData {
  const data = asRecord(value);
  if (data.schema !== 1 || typeof data.id !== 'string' || typeof data.roundId !== 'string'
    || !Number.isSafeInteger(data.version) || !['lobby', 'playing', 'finished'].includes(String(data.phase))
    || !Array.isArray(data.players) || data.players.length > MAX_PLAYERS
    || !Array.isArray(data.commonCells) || !Array.isArray(data.history) || data.history.length > 100) {
    throw new Error('Неверный формат сохранённой комнаты.');
  }
  const settings = settingsFrom(data.settings);
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const raw of data.players) {
    const player = asRecord(raw);
    if (typeof player.id !== 'string' || ids.has(player.id)
      || typeof player.sessionHash !== 'string' || !/^[a-f0-9]{64}$/.test(player.sessionHash)
      || hashes.has(player.sessionHash) || !isAvatarId(player.avatarId)
      || typeof player.ready !== 'boolean' || !Array.isArray(player.entries)
      || player.entries.length !== settings.competitiveCount + 1) throw new Error('Неверный формат игрока.');
    text(player.name, 'Имя', MAX_NAME_LENGTH);
    for (const [index, rawEntry] of player.entries.entries()) {
      const entry = asRecord(rawEntry);
      const isSuper = index === settings.competitiveCount;
      if (entry.id !== (isSuper ? 'super' : `regular-${index + 1}`) || entry.super !== isSuper || typeof entry.marked !== 'boolean') {
        throw new Error('Неверный формат словаря.');
      }
      text(entry.text, 'Вариант', MAX_PHRASE_LENGTH, data.phase === 'lobby');
    }
    ids.add(player.id); hashes.add(player.sessionHash);
  }
  if (data.hostId !== null && (typeof data.hostId !== 'string' || !ids.has(data.hostId))) throw new Error('Ведущий не найден.');
  if (data.commonCells.length !== settings.commonSize ** 2) throw new Error('Неверный размер общего поля.');
  for (const [index, raw] of data.commonCells.entries()) {
    const cell = asRecord(raw);
    if (cell.id !== `common-${index + 1}` || typeof cell.marked !== 'boolean') throw new Error('Неверный формат общего поля.');
    text(cell.text, 'Общее поле', MAX_PHRASE_LENGTH);
  }
  for (const raw of data.history) {
    const item = asRecord(raw);
    if (!['competitive', 'common'].includes(String(item.kind)) || typeof item.targetId !== 'string'
      || typeof item.description !== 'string' || (item.kind === 'competitive' && !ids.has(String(item.playerId)))) {
      throw new Error('Неверный формат истории.');
    }
  }
  for (const key of ['startedAt', 'finishedAt']) {
    if (data[key] !== null && (!Number.isSafeInteger(data[key]) || Number(data[key]) < 0)) throw new Error('Неверное время игры.');
  }
  return value as GameData;
}

export class GameStore {
  private data: GameData;
  private readonly connections = new Map<string, Map<string, boolean>>();

  constructor(initial: GameData = newGameData(), private readonly persist: (data: GameData) => void = () => {}) {
    this.data = structuredClone(initial);
  }

  snapshot(): GameData { return structuredClone(this.data); }
  playerByHash(hash: string | undefined) { return hash ? this.data.players.find((player) => player.sessionHash === hash) : undefined; }
  connected(id: string) { return Boolean(this.connections.get(id)?.size); }
  hostOnline() { return this.data.hostId ? [...(this.connections.get(this.data.hostId)?.values() ?? [])].some(Boolean) : false; }

  presence(id: string, connectionId: string, isLocal: boolean | null) {
    if (isLocal === null) {
      this.connections.get(id)?.delete(connectionId);
      if (!this.connections.get(id)?.size) this.connections.delete(id);
    } else if (this.data.players.some((player) => player.id === id)) {
      if (!this.connections.has(id)) this.connections.set(id, new Map());
      this.connections.get(id)!.set(connectionId, isLocal);
    }
  }

  private commit<T>(callback: () => T): T {
    const previous = this.snapshot();
    try {
      const result = callback();
      this.data.version += 1;
      this.persist(this.snapshot());
      return result;
    } catch (error) { this.data = previous; throw error; }
  }

  join(sessionHash: string, name: unknown, avatarId: unknown, isLocal: boolean): string {
    const existing = this.playerByHash(sessionHash);
    if (existing) return existing.id;
    if (this.data.phase !== 'lobby') throw new GameError(409, 'Игра уже началась. Присоединиться можно будет в следующем раунде.');
    if (this.data.players.length >= MAX_PLAYERS) throw new GameError(409, 'Все четыре места заняты. Попросите ведущего освободить место.');
    const cleanedName = text(name, 'Ваше имя', MAX_NAME_LENGTH);
    this.checkName(cleanedName);
    if (!isAvatarId(avatarId)) throw new GameError(400, 'Выберите аватарку.');
    return this.commit(() => {
      const id = randomUUID();
      this.data.players.push({ id, sessionHash, name: cleanedName, avatarId, ready: false, entries: entriesFor(this.data.settings.competitiveCount) });
      if (!this.data.hostId && isLocal) this.data.hostId = id;
      return id;
    });
  }

  recoverHost(sessionHash: string, isLocal: boolean): string {
    if (!isLocal) throw new GameError(403, 'Роль ведущего доступна только в локальной сети.');
    if (this.hostOnline()) throw new GameError(409, 'Ведущий уже подключён.');
    const host = this.data.players.find((player) => player.id === this.data.hostId);
    if (!host) throw new GameError(409, 'Для начала войдите в комнату.');
    return this.commit(() => { host.sessionHash = sessionHash; return host.id; });
  }

  leave(actor: Actor) {
    if (this.data.phase !== 'lobby') throw new GameError(409, 'Выйти из комнаты можно между играми. Во время игры достаточно закрыть вкладку.');
    this.requirePlayer(actor);
    this.commit(() => {
      this.data.players = this.data.players.filter((player) => player.id !== actor.playerId);
      if (this.data.hostId === actor.playerId) {
        this.data.hostId = this.data.players.find((player) => [...(this.connections.get(player.id)?.values() ?? [])].some(Boolean))?.id ?? null;
      }
    });
  }

  view(sessionHash: string | undefined, isLocal: boolean): SessionState {
    const viewer = this.playerByHash(sessionHash);
    const isHost = Boolean(viewer && viewer.id === this.data.hostId && isLocal);
    const players = this.data.players.map((player) => {
      const normalHits = player.entries.filter((entry) => !entry.super && entry.marked).length;
      const superHits = player.entries.filter((entry) => entry.super && entry.marked).length;
      return {
        id: player.id, name: player.name, avatarId: player.avatarId, ready: player.ready,
        isHost: player.id === this.data.hostId, connected: this.connected(player.id),
        score: normalHits + superHits * 2, normalHits, superHits,
        entries: this.data.phase !== 'lobby' || viewer?.id === player.id ? structuredClone(player.entries) : [],
      };
    });
    return {
      self: viewer ? { id: viewer.id, isHost } : null,
      isLocal,
      canClaimHost: Boolean(viewer && isLocal && viewer.id !== this.data.hostId && !this.hostOnline()),
      canRecoverHost: Boolean(!viewer && isLocal && this.data.hostId && !this.hostOnline()),
      room: {
        id: this.data.id, roundId: this.data.roundId, version: this.data.version, phase: this.data.phase,
        hostId: this.data.hostId, settings: { ...this.data.settings }, players,
        commonCells: structuredClone(this.data.commonCells), startedAt: this.data.startedAt, finishedAt: this.data.finishedAt,
        canStart: this.data.phase === 'lobby' && players.length >= MIN_PLAYERS && players.every((player) => player.ready && player.connected),
        canUndo: this.data.phase === 'playing' && this.data.history.length > 0,
        lastAction: this.data.history.at(-1)?.description ?? null,
      },
    };
  }

  private requirePlayer(actor: Actor) {
    const player = this.data.players.find((item) => item.id === actor.playerId);
    if (!player) throw new GameError(401, 'Вы больше не в комнате. Присоединитесь ещё раз.');
    return player;
  }
  private requireHost(actor: Actor) {
    const player = this.requirePlayer(actor);
    if (player.id !== this.data.hostId || !actor.isLocal) throw new GameError(403, 'Это действие доступно только ведущему в локальной сети.');
    return player;
  }
  private requirePhase(phase: Phase) {
    if (this.data.phase !== phase) throw new GameError(409, phase === 'lobby' ? 'Это можно изменить между играми.' : 'Сейчас игра не идёт.');
  }
  private checkName(name: string, exceptId?: string) {
    if (this.data.players.some((player) => player.id !== exceptId && player.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) {
      throw new GameError(409, 'Такое имя уже занято. Выберите другое.');
    }
  }

  action(actor: Actor, input: unknown, roundId: unknown): Mutation {
    const player = this.requirePlayer(actor);
    const action = asRecord(input);
    if (roundId !== this.data.roundId) throw new GameError(409, 'Уже начался другой раунд. Обновите страницу.');
    if ((action.type === 'mark' || action.type === 'common') && action.marked !== undefined && typeof action.marked !== 'boolean') {
      throw new GameError(400, 'Состояние отметки должно быть true или false.');
    }
    const marked = action.marked !== false;
    if (action.type === 'mark') {
      const entry = this.data.players.find((item) => item.id === action.playerId)?.entries.find((item) => item.id === action.entryId);
      this.requireHost(actor); this.requirePhase('playing');
      if (entry?.marked === marked) return { changed: false };
    }
    if (action.type === 'common') {
      this.requirePhase('playing');
      if (this.data.settings.commonPermission === 'host') this.requireHost(actor);
      if (this.data.commonCells.find((cell) => cell.id === action.cellId)?.marked === marked) return { changed: false };
    }
    return this.commit(() => {
      let event: BingoEvent | undefined;
      let notice: string | undefined;
      switch (action.type) {
        case 'dictionary': {
          this.requirePhase('lobby');
          if (!Array.isArray(action.entries) || action.entries.length !== this.data.settings.competitiveCount || typeof action.ready !== 'boolean') {
            throw new GameError(400, 'Проверьте количество вариантов в словаре.');
          }
          const values = action.entries.map((value) => text(value, 'Вариант', MAX_PHRASE_LENGTH, !action.ready));
          const special = text(action.superEntry, 'Супер бинго', MAX_PHRASE_LENGTH, !action.ready);
          uniqueTexts([...values, special], 'Личный словарь');
          player.entries = entriesFor(values.length).map((entry, index) => ({ ...entry, text: entry.super ? special : values[index] }));
          player.ready = action.ready;
          break;
        }
        case 'unready': this.requirePhase('lobby'); player.ready = false; break;
        case 'profile': {
          const name = text(action.name, 'Ваше имя', MAX_NAME_LENGTH);
          this.checkName(name, player.id);
          if (!isAvatarId(action.avatarId)) throw new GameError(400, 'Выберите аватарку.');
          player.name = name; player.avatarId = action.avatarId;
          break;
        }
        case 'settings': {
          this.requireHost(actor);
          const settings = settingsFrom(action.settings);
          if (!Array.isArray(action.commonWords) || action.commonWords.length !== settings.commonSize ** 2) {
            throw new GameError(400, `Заполните все ${settings.commonSize ** 2} клеток общего поля.`);
          }
          const words = action.commonWords.map((word) => text(word, 'Общее поле', MAX_PHRASE_LENGTH));
          uniqueTexts(words, 'Общее поле');
          if (this.data.phase !== 'lobby') {
            if (settings.competitiveCount !== this.data.settings.competitiveCount || settings.commonSize !== this.data.settings.commonSize
              || words.some((word, index) => word !== this.data.commonCells[index]?.text)) {
              throw new GameError(409, 'Словари и размер поля можно изменить между играми.');
            }
            this.data.settings.commonPermission = settings.commonPermission;
          } else {
            if (settings.competitiveCount !== this.data.settings.competitiveCount) {
              for (const item of this.data.players) { item.entries = entriesFor(settings.competitiveCount, item.entries); item.ready = false; }
            }
            this.data.settings = settings;
            this.data.commonCells = words.map((word, index) => ({ id: `common-${index + 1}`, text: word, marked: false }));
          }
          break;
        }
        case 'start': {
          this.requireHost(actor); this.requirePhase('lobby');
          if (!this.view(player.sessionHash, actor.isLocal).room.canStart) throw new GameError(409, 'Для старта нужны 1–4 подключённых игрока, готовых к игре.');
          this.data.phase = 'playing'; this.data.startedAt = Date.now();
          break;
        }
        case 'mark': {
          this.requireHost(actor); this.requirePhase('playing');
          const target = this.data.players.find((item) => item.id === action.playerId);
          const entry = target?.entries.find((item) => item.id === action.entryId);
          if (!target || !entry) throw new GameError(404, 'Этот вариант не найден.');
          entry.marked = marked;
          if (!marked) {
            this.data.history = this.data.history.filter((item) => !(item.kind === 'competitive' && item.playerId === target.id && item.targetId === entry.id));
            notice = `Отметка снята: ${target.name}: ${entry.text}`;
            break;
          }
          this.data.history.push({ kind: 'competitive', playerId: target.id, targetId: entry.id, description: `${target.name}: ${entry.text}` });
          event = { id: randomUUID(), key: `competitive:${target.id}:${entry.id}`, kind: 'competitive', playerId: target.id,
            playerName: target.name, text: entry.text, points: entry.super ? 2 : 1, at: Date.now() };
          break;
        }
        case 'common': {
          this.requirePhase('playing');
          if (this.data.settings.commonPermission === 'host') this.requireHost(actor);
          const cell = this.data.commonCells.find((item) => item.id === action.cellId);
          if (!cell) throw new GameError(404, 'Эта клетка не найдена.');
          cell.marked = marked;
          if (!marked) {
            this.data.history = this.data.history.filter((item) => !(item.kind === 'common' && item.targetId === cell.id));
            notice = `Отметка снята: ${cell.text}`;
            break;
          }
          this.data.history.push({ kind: 'common', playerId: null, targetId: cell.id, description: `Общее поле: ${cell.text}` });
          event = { id: randomUUID(), key: `common:${cell.id}`, kind: 'common', playerId: null,
            playerName: player.name, text: cell.text, points: 0, at: Date.now() };
          break;
        }
        case 'undo': {
          this.requireHost(actor); this.requirePhase('playing');
          const last = this.data.history.pop();
          if (!last) throw new GameError(409, 'Пока нечего отменять.');
          if (last.kind === 'common') {
            const cell = this.data.commonCells.find((item) => item.id === last.targetId);
            if (cell) cell.marked = false;
          } else {
            const entry = this.data.players.find((item) => item.id === last.playerId)?.entries.find((item) => item.id === last.targetId);
            if (entry) entry.marked = false;
          }
          notice = `Отметка отменена: ${last.description}`;
          break;
        }
        case 'finish': this.requireHost(actor); this.requirePhase('playing'); this.data.phase = 'finished'; this.data.finishedAt = Date.now(); break;
        case 'newGame': {
          this.requireHost(actor); this.requirePhase('finished');
          if (action.clearDictionaries !== undefined && typeof action.clearDictionaries !== 'boolean') throw new GameError(400, 'Проверьте настройки новой игры.');
          this.data.phase = 'lobby'; this.data.roundId = randomUUID(); this.data.history = [];
          this.data.startedAt = null; this.data.finishedAt = null;
          for (const item of this.data.players) { item.ready = false; item.entries = entriesFor(this.data.settings.competitiveCount, item.entries, Boolean(action.clearDictionaries)); }
          for (const cell of this.data.commonCells) cell.marked = false;
          break;
        }
        case 'remove': {
          this.requireHost(actor); this.requirePhase('lobby');
          if (action.playerId === player.id) throw new GameError(400, 'Чтобы выйти, используйте кнопку выхода из комнаты.');
          if (!this.data.players.some((item) => item.id === action.playerId)) throw new GameError(404, 'Игрок уже вышел.');
          this.data.players = this.data.players.filter((item) => item.id !== action.playerId);
          break;
        }
        case 'claimHost': {
          if (!actor.isLocal) throw new GameError(403, 'Ведущий должен находиться в локальной сети.');
          if (this.hostOnline() && this.data.hostId !== player.id) throw new GameError(409, 'Ведущий уже подключён.');
          this.data.hostId = player.id;
          break;
        }
        default: throw new GameError(400, 'Неизвестное действие. Обновите страницу.');
      }
      return { changed: true, ...(event ? { event } : {}), ...(notice ? { notice } : {}) };
    });
  }
}

export function persistentGame(directory: string): GameStore {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'room.json');
  let initial = newGameData();
  if (existsSync(file)) {
    try { initial = validateSavedGame(JSON.parse(readFileSync(file, 'utf8'))); }
    catch (error) { throw new Error(`Не удалось прочитать ${file}. Сохранение не изменено. ${error instanceof Error ? error.message : ''}`); }
  }
  const persist = (data: GameData) => {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(temporary, file);
  };
  if (!existsSync(file)) persist(initial);
  return new GameStore(initial, persist);
}
