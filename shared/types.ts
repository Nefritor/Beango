import type { AvatarId } from './catalog.js';

export type Phase = 'lobby' | 'playing' | 'finished';
export type CommonPermission = 'host' | 'everyone';

export interface Entry {
  id: string;
  text: string;
  super: boolean;
  marked: boolean;
}

export interface CommonCell { id: string; text: string; marked: boolean }

export interface Settings {
  competitiveCount: number;
  commonSize: 3 | 4;
  commonPermission: CommonPermission;
}

export interface PlayerView {
  id: string;
  name: string;
  avatarId: AvatarId;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  score: number;
  normalHits: number;
  superHits: number;
  entries: Entry[];
}

export interface RoomView {
  id: string;
  roundId: string;
  version: number;
  phase: Phase;
  hostId: string | null;
  players: PlayerView[];
  settings: Settings;
  commonCells: CommonCell[];
  startedAt: number | null;
  finishedAt: number | null;
  canStart: boolean;
  canUndo: boolean;
  lastAction: string | null;
}

export interface SessionState {
  self: { id: string; isHost: boolean } | null;
  room: RoomView;
  canClaimHost: boolean;
  canRecoverHost: boolean;
  isLocal: boolean;
}

export interface BingoEvent {
  id: string;
  key: string;
  kind: 'competitive' | 'common';
  playerId: string | null;
  playerName: string;
  text: string;
  points: number;
  at: number;
}

export type ServerMessage =
  | { type: 'state'; state: SessionState; event?: BingoEvent; notice?: string }
  | { type: 'expired' };

export type GameAction =
  | { type: 'dictionary'; entries: string[]; superEntry: string; ready: boolean }
  | { type: 'unready' }
  | { type: 'profile'; name: string; avatarId: string }
  | { type: 'settings'; settings: Settings; commonWords: string[] }
  | { type: 'start' }
  | { type: 'mark'; playerId: string; entryId: string; marked?: boolean }
  | { type: 'common'; cellId: string; marked?: boolean }
  | { type: 'undo' }
  | { type: 'finish' }
  | { type: 'newGame'; clearDictionaries?: boolean }
  | { type: 'remove'; playerId: string }
  | { type: 'claimHost' };

export interface NetworkInfo { localUrls: string[]; publicUrl: string | null; port: number }
