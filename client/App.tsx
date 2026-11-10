import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Crown, Flag, LogOut, Pencil, Plus,
  Settings as SettingsIcon, Sparkles, Star, Trash2, Trophy, Undo2, Users, Volume2, VolumeX, WifiOff, X,
} from 'lucide-react';
import { AVATARS, avatarUrl, MAX_NAME_LENGTH, MAX_PHRASE_LENGTH, MAX_PLAYERS } from '../shared/catalog.js';
import type { BingoEvent, GameAction, NetworkInfo, PlayerView, RoomView, SessionState, Settings } from '../shared/types.js';
import { PartyEffects, unlockAudio } from './effects.js';
import { gameClient, useGame } from './store.js';

function pointsWord(value: number) {
  const n = Math.abs(value) % 100;
  return n > 10 && n < 20 ? 'очков' : n % 10 === 1 ? 'очко' : n % 10 >= 2 && n % 10 <= 4 ? 'очка' : 'очков';
}

function usePreference(name: string, initial: boolean) {
  const [value, setValue] = useState(() => { try { const saved = localStorage.getItem(name); return saved === null ? initial : saved === 'true'; } catch { return initial; } });
  return [value, (next: boolean) => { setValue(next); try { localStorage.setItem(name, String(next)); } catch { /* Preferences are optional. */ } }] as const;
}

function useTask() {
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<void>) => {
    if (pending) return;
    setPending(true); setError(null);
    try { await task(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не получилось. Попробуйте ещё раз.'); }
    finally { setPending(false); }
  };
  return { pending, error, run };
}

function Rays({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'rays rays-small' : 'rays'} viewBox="0 0 42 48" fill="none" aria-hidden="true"><path d="M12 4L8 14M35 18L23 24M34 42L22 36" stroke="currentColor" strokeWidth="6" strokeLinecap="round" /></svg>;
}

function Wordmark() { return <span className="wordmark">Beango<Rays /></span>; }

function Avatar({ id, className = '', name = '' }: { id: string; className?: string; name?: string }) {
  return <img className={`avatar ${className}`} src={avatarUrl(id)} alt={name} width="96" height="96" draggable={false} />;
}

function AvatarPicker({ selected, onChange, compact = false }: { selected: string; onChange: (id: string) => void; compact?: boolean }) {
  return <div className={`avatar-picker ${compact ? 'avatar-picker-compact' : ''}`} role="group" aria-label="Выберите аватарку">
    {AVATARS.map((avatar) => <button type="button" key={avatar.id} className={`avatar-choice ${selected === avatar.id ? 'selected' : ''}`}
      aria-label={avatar.name} aria-pressed={selected === avatar.id} onClick={() => onChange(avatar.id)} title={avatar.name}>
      <Avatar id={avatar.id} />
      {selected === avatar.id && <span className="choice-check"><Check size={20} strokeWidth={4} /></span>}
    </button>)}
  </div>;
}

function Dialog({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  return <dialog className={`dialog ${wide ? 'dialog-wide' : ''}`} ref={dialog} aria-labelledby={titleId} onCancel={close}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="dialog-content"><header className="dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={close} aria-label="Закрыть окно"><X /></button></header>{children}</div>
  </dialog>;
}

function ErrorText({ children }: { children: ReactNode }) { return children ? <p className="form-error" role="alert">{children}</p> : null; }

async function copyText(value: string) {
  if (navigator.clipboard) { try { await navigator.clipboard.writeText(value); return; } catch { /* HTTP IP addresses need the fallback. */ } }
  const focused = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea'); field.value = value; field.readOnly = true;
  field.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(field); field.select();
  const copied = document.execCommand('copy'); field.remove(); focused?.focus();
  if (!copied) throw new Error('Скопируйте адрес из строки браузера.');
}

async function copyInvite(url: string) {
  try { await copyText(url); gameClient.notify('Адрес скопирован. Отправьте его друзьям!'); }
  catch (error) { gameClient.notify((error as Error).message, true); }
}

function InviteButton() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void gameClient.invite().then((info) => { if (active) setUrl(info.publicUrl); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <button type="button" className="button header-invite" disabled={!url} onClick={() => { if (url) void copyInvite(url); }}
    aria-label="Скопировать адрес для друзей из интернета" title={url ? 'Скопировать адрес для друзей из интернета' : 'Внешний адрес ещё не настроен'}>
    <Copy size={19} /><span>Позвать друзей</span>
  </button>;
}

function Welcome({ session, notice }: { session: SessionState; notice?: string }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem('bingo-name') || ''; } catch { return ''; } });
  const [avatarId, setAvatarId] = useState(() => { try { const id = localStorage.getItem('bingo-avatar'); return AVATARS.some((item) => item.id === id) ? id! : AVATARS[0].id; } catch { return AVATARS[0].id; } });
  const task = useTask();
  const full = session.room.players.length >= MAX_PLAYERS;
  const running = session.room.phase !== 'lobby';
  const submit = (event: FormEvent) => { event.preventDefault(); void task.run(async () => {
    await gameClient.join(name, avatarId);
    try { localStorage.setItem('bingo-name', name); localStorage.setItem('bingo-avatar', avatarId); } catch { /* Joining does not depend on local storage. */ }
  }); };
  return <div className="welcome-page"><header className="site-header welcome-header"><Wordmark /><span className="header-note"><Users size={18} /> Для своей компании</span></header>
    <main className="welcome-main"><section className="join-card" aria-labelledby="join-title">
      <div className="join-title-row"><Rays small /><h1 id="join-title">Давайте сыграем<br className="desktop-break" /> в бинго</h1><Rays small /></div>
      {notice && <p className="join-wait" role="status">{notice}</p>}
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="player-name">Ваше имя</label>
        <input id="player-name" className="name-input" name="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} required autoComplete="nickname" placeholder="Как вас называть?" autoFocus />
        <p className="field-label avatar-label">Выберите аватарку</p><AvatarPicker selected={avatarId} onChange={setAvatarId} />
        <ErrorText>{task.error}</ErrorText>
        {(running || full) && <p className="join-wait" role="status">{running ? 'Игра уже началась. Новые игроки смогут войти перед следующим раундом.' : 'Все четыре места заняты. Попросите ведущего освободить место.'}</p>}
        <button className="button button-primary join-button" type="submit" disabled={task.pending || full || running}>{task.pending ? 'Присоединяемся…' : 'Присоединиться'}<ArrowRight size={22} /></button>
      </form>
      {session.canRecoverHost && <button className="text-button recover-button" disabled={task.pending} onClick={() => void task.run(() => gameClient.recoverHost())}>Восстановить роль ведущего</button>}
    </section><p className="welcome-caption"><span className="mini-dot" /> 1–4 игрока<span aria-hidden="true">·</span> два поля<span aria-hidden="true">·</span> играйте соло или с друзьями</p></main>
    <footer className="welcome-footer">Стикер пати <Sparkles size={15} /></footer>
  </div>;
}

function ProfileDialog({ player, close }: { player: PlayerView; close: () => void }) {
  const [name, setName] = useState(player.name); const [avatarId, setAvatarId] = useState<string>(player.avatarId); const task = useTask();
  return <Dialog title="Ваш персонаж" close={close}><form onSubmit={(event) => { event.preventDefault(); void task.run(async () => {
    await gameClient.action({ type: 'profile', name, avatarId });
    try { localStorage.setItem('bingo-name', name); localStorage.setItem('bingo-avatar', avatarId); } catch { /* Optional browser preference. */ }
    close();
  }); }}>
    <label className="field-label" htmlFor="profile-name">Ваше имя</label><input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} required />
    <p className="field-label avatar-label">Аватарка</p><AvatarPicker selected={avatarId} onChange={setAvatarId} compact />
    <ErrorText>{task.error}</ErrorText><div className="dialog-actions"><button type="button" className="button button-secondary" onClick={close}>Отмена</button><button type="submit" className="button button-primary" disabled={task.pending}>Сохранить</button></div>
  </form></Dialog>;
}

function Dictionary({ player, room, online }: { player: PlayerView; room: RoomView; online: boolean }) {
  const [entries, setEntries] = useState(() => player.entries.filter((entry) => !entry.super).map((entry) => entry.text));
  const [special, setSpecial] = useState(() => player.entries.find((entry) => entry.super)?.text ?? '');
  const [saved, setSaved] = useState(false); const task = useTask();
  useEffect(() => {
    setEntries(player.entries.filter((entry) => !entry.super).map((entry) => entry.text));
    setSpecial(player.entries.find((entry) => entry.super)?.text ?? ''); setSaved(false);
  }, [room.roundId, room.settings.competitiveCount, player.id]);
  const save = (ready: boolean) => void task.run(async () => { await gameClient.action({ type: 'dictionary', entries, superEntry: special, ready }); setSaved(true); });
  return <section className={`panel dictionary-panel ${player.ready ? 'dictionary-ready' : ''}`} aria-labelledby="dictionary-title">
    <div className="panel-heading"><div><h2 id="dictionary-title">Ваш словарь</h2><p>Придумайте {room.settings.competitiveCount} варианта и одно супер бинго.</p></div><span className="points-label"><Star size={16} fill="currentColor" /> +1 / +2</span></div>
    {player.ready && <div className="ready-banner" role="status"><span className="ready-check"><Check size={24} strokeWidth={3} /></span><div><strong>Вы готовы!</strong><p>Игру можно запустить, когда все участники готовы.</p></div></div>}
    <form onSubmit={(event) => { event.preventDefault(); save(true); }}>
      <div className="dictionary-fields">{entries.map((value, index) => <div className="dictionary-field" key={index}>
        <label htmlFor={`entry-${index}`}>Вариант {index + 1}<span>+1</span></label>
        <input id={`entry-${index}`} value={value} maxLength={MAX_PHRASE_LENGTH} disabled={player.ready || task.pending} required placeholder={index === 0 ? 'Например, «Кот в кадре»' : 'Что может случиться?'}
          onChange={(event) => { setSaved(false); setEntries((previous) => previous.map((item, position) => position === index ? event.target.value : item)); }} />
      </div>)}</div>
      <div className="super-field"><label htmlFor="super-entry"><span><Star size={17} fill="currentColor" /> Супер бинго</span><span className="point-sticker">+2</span></label>
        <input id="super-entry" value={special} maxLength={MAX_PHRASE_LENGTH} disabled={player.ready || task.pending} required placeholder="Самое невероятное совпадение" onChange={(event) => { setSpecial(event.target.value); setSaved(false); }} />
      </div><ErrorText>{task.error}</ErrorText>
      <div className="dictionary-actions">{player.ready ? <button type="button" className="button button-secondary" disabled={!online || task.pending} onClick={() => void task.run(() => gameClient.action({ type: 'unready' }))}><Pencil size={17} /> Изменить варианты</button> : <>
        <button type="button" className="button button-secondary" disabled={!online || task.pending} onClick={() => save(false)}>{saved ? <><Check size={17} /> Сохранено</> : 'Сохранить'}</button>
        <button type="submit" className="button button-primary" disabled={!online || task.pending}>{task.pending ? 'Сохраняем…' : 'Я готов'}<Check size={20} /></button></>}
      </div>
    </form>
    <p className="dictionary-footnote">До старта ваши варианты видны только вам. Обычное бинго — 1 очко, супер бинго — 2.</p>
  </section>;
}

function Lobby({ session, online, openSettings }: { session: SessionState; online: boolean; openSettings: () => void }) {
  const { room, self } = session; const player = room.players.find((item) => item.id === self!.id)!; const task = useTask();
  const [remove, setRemove] = useState<PlayerView | null>(null);
  const readyCount = room.players.filter((item) => item.ready).length;
  const host = room.players.find((item) => item.isHost);
  return <main className="main-container lobby"><div className="page-heading"><div><h1>Собираем компанию</h1><p>Заполните словари — и можно начинать.</p></div><span className="room-count"><Users size={20} /><strong>{room.players.length}</strong> / 4</span></div>
    <div className="lobby-layout"><Dictionary player={player} room={room} online={online} />
      <aside className="lobby-sidebar"><section className="panel players-panel"><div className="panel-heading"><h2>Кто играет</h2><span className="ready-counter">{readyCount} / {room.players.length} готовы</span></div>
        <ul className="lobby-players">{room.players.map((item) => <li key={item.id} className={!item.connected ? 'player-offline' : ''}>
          <Avatar id={item.avatarId} /><div className="lobby-player-info"><strong>{item.name}{item.id === self!.id && <small>это вы</small>}{item.isHost && <Crown size={15} className="host-crown" aria-label="Ведущий" />}</strong>
            <span className={item.ready && item.connected ? 'ready-text' : ''}>{!item.connected ? 'Не в сети' : item.ready ? 'Готов к игре' : 'Заполняет словарь'}</span></div>
          {item.ready && item.connected && <Check className="player-ready-icon" size={23} strokeWidth={3} />}
          {self!.isHost && item.id !== self!.id && <button className="small-icon-button" aria-label={`Убрать игрока ${item.name}`} onClick={() => setRemove(item)}><X size={16} /></button>}
        </li>)}{Array.from({ length: MAX_PLAYERS - room.players.length }, (_, index) => <li className="empty-seat" key={`empty-${index}`}><span className="empty-avatar"><Plus size={22} /></span><span>Место для друга</span></li>)}</ul>
        <div className="start-area">{self!.isHost ? <><button className="button button-primary start-button" disabled={!online || !room.canStart || task.pending} onClick={() => void task.run(() => gameClient.action({ type: 'start' }))}>Начать игру <ArrowRight size={20} /></button>
          <p>{!room.canStart ? 'Все игроки должны быть готовы и находиться в сети.' : room.players.length === 1 ? 'Вы готовы. Можно играть соло!' : 'Все готовы. Самое время начать!'}</p></> : <p className="host-wait"><Flag size={18} /> Игру начнёт {host?.name ?? 'ведущий из локальной сети'}.</p>}
          <ErrorText>{task.error}</ErrorText></div>
      </section><section className="invite-panel"><div className="invite-heading"><Sparkles size={23} /><h3>Два поля, один азарт</h3></div><p>Слева — ваши совпадения и очки. Справа — общее бинго для всей компании.</p>
        {self!.isHost && <button className="text-button" onClick={openSettings}>Словарь общего поля и приглашение <ArrowRight size={16} /></button>}</section>
    </aside></div>
    {remove && <Dialog title="Освободить место?" close={() => setRemove(null)}><p>Игрок {remove.name} выйдет из комнаты. Он сможет присоединиться снова, пока есть свободные места.</p><div className="dialog-actions"><button className="button button-secondary" onClick={() => setRemove(null)}>Отмена</button><button className="button button-danger" onClick={() => void task.run(async () => { await gameClient.action({ type: 'remove', playerId: remove.id }); setRemove(null); })}><Trash2 size={17} /> Убрать игрока</button></div></Dialog>}
  </main>;
}

function BingoCard({ text, marked, superBingo = false, common = false, points, event, bingoKey, disabled, onClick, index = 0 }: {
  text: string; marked: boolean; superBingo?: boolean; common?: boolean; points?: number; event: BingoEvent | null;
  bingoKey: string; disabled: boolean; onClick: () => void; index?: number;
}) {
  const celebrating = marked && event?.key === bingoKey;
  return <button type="button" className={`bingo-card ${marked ? 'marked' : ''} ${superBingo ? 'super-card' : ''} ${common ? 'common-card' : ''} ${celebrating ? 'celebrating' : ''}`}
    style={{ '--entry-index': index } as CSSProperties} disabled={disabled} onClick={onClick} aria-pressed={marked}
    aria-label={`${text}${superBingo ? ', супер бинго, 2 очка' : ''}${marked ? ', уже отмечено' : ''}${marked && !disabled ? ', снять отметку' : ''}`}
    title={`${text}${marked && !disabled ? ' — нажмите ещё раз, чтобы снять отметку' : ''}`} data-bingo-key={bingoKey}>
    {superBingo && <span className="super-card-heading"><Star size={12} fill="currentColor" /> Супер бинго<span>+2</span></span>}
    <span className="bingo-card-text">{text}</span>{!common && !superBingo && <span className="card-point">+{points}</span>}
    {celebrating && <span className="bingo-tick" key={event.id}><Check size={38} strokeWidth={4} /></span>}
  </button>;
}

function ScoreStrip({ room, selfId, selectedId, select }: { room: RoomView; selfId: string; selectedId: string; select: (id: string) => void }) {
  return <div className="score-strip" aria-label="Счёт игроков">{room.players.map((player) => <button type="button" key={player.id} className={`score-chip ${selectedId === player.id ? 'active' : ''}`} onClick={() => select(player.id)} aria-pressed={selectedId === player.id}>
    <Avatar id={player.avatarId} /><span className="score-chip-name">{player.name}{selfId === player.id && <span className="sr-only">, это вы</span>}</span><strong>{player.score}</strong>
  </button>)}</div>;
}

function GameBoard({ session, online, event, perform, busy }: { session: SessionState; online: boolean; event: BingoEvent | null; perform: (action: GameAction) => void; busy: boolean }) {
  const { room, self } = session; const [tab, setTab] = useState<'competition' | 'common'>('competition');
  const [selected, setSelected] = useState(self!.id);
  const selectedId = room.players.some((player) => player.id === selected) ? selected : room.players[0]?.id;
  const commonAllowed = Boolean(self!.isHost || room.settings.commonPermission === 'everyone');
  const playing = room.phase === 'playing';
  return <>
    <div className="mobile-game-controls"><ScoreStrip room={room} selfId={self!.id} selectedId={selectedId} select={(id) => { setSelected(id); setTab('competition'); }} />
      <div className="board-tabs" role="tablist" aria-label="Поля бинго"><button id="competition-tab" type="button" role="tab" aria-selected={tab === 'competition'} aria-controls="competition-panel" onClick={() => setTab('competition')}>Соревнование</button><button id="common-tab" type="button" role="tab" aria-selected={tab === 'common'} aria-controls="common-panel" onClick={() => setTab('common')}>Общее</button></div>
    </div>
    <div className={`game-layout mobile-tab-${tab}`}>
      <section className="game-panel competition-panel" id="competition-panel" aria-labelledby="competition-title">
        <div className="game-panel-heading"><h2 id="competition-title">Соревновательное бинго</h2><Trophy size={25} strokeWidth={2.5} /></div>
        <div className="player-columns" style={{ '--player-count': room.players.length } as CSSProperties}>
          {room.players.map((player) => <div key={player.id} className={`player-column ${selectedId === player.id ? 'mobile-selected' : ''}`}>
            <div className="player-column-heading"><Avatar id={player.avatarId} /><div className="player-column-identity"><div className="player-name-row"><h3 title={player.name}>{player.name}</h3>{player.isHost && <Crown size={14} aria-label="Ведущий" />}</div>
              <div className="player-score"><strong>{player.score}</strong><span>{pointsWord(player.score)}</span>{event?.playerId === player.id && <span key={event.id} className="score-plus">+{event.points}</span>}</div></div>
              {!player.connected && <span className="offline-dot" title="Игрок не в сети" />}
            </div><div className="player-entries">{player.entries.map((entry, index) => <BingoCard key={`${room.roundId}:${entry.id}`} text={entry.text} marked={entry.marked} superBingo={entry.super} points={entry.super ? 2 : 1}
              event={event} bingoKey={`competitive:${player.id}:${entry.id}`} index={index} disabled={!self!.isHost || !online || !playing || busy}
              onClick={() => perform({ type: 'mark', playerId: player.id, entryId: entry.id, marked: !entry.marked })} />)}</div>
          </div>)}
        </div><div className="board-legend"><span><strong>+1</strong> обычное</span><span><Star size={14} fill="currentColor" /> <strong>+2</strong> супер бинго</span>{!self!.isHost && playing && <span className="readonly-hint">Отмечает ведущий</span>}</div>
      </section>
      <section className="game-panel common-panel" id="common-panel" aria-labelledby="common-title"><div className="game-panel-heading"><h2 id="common-title">Общее бинго</h2><Sparkles size={25} strokeWidth={2.5} /></div>
        <div className="common-permission"><span className="mini-dot" />{room.settings.commonPermission === 'everyone' ? 'Отмечают все игроки' : 'Отмечает ведущий'}<span>{room.commonCells.filter((cell) => cell.marked).length} / {room.commonCells.length}</span></div>
        <div className={`common-grid common-grid-${room.settings.commonSize}`} style={{ '--common-size': room.settings.commonSize } as CSSProperties}>{room.commonCells.map((cell) => <BingoCard key={cell.id} text={cell.text} marked={cell.marked} common event={event}
          bingoKey={`common:${cell.id}`} disabled={!commonAllowed || !online || !playing || busy} onClick={() => perform({ type: 'common', cellId: cell.id, marked: !cell.marked })} />)}</div>
        <p className="common-footnote">Общие совпадения — для всей компании. Личный счёт они не меняют.{commonAllowed && playing && ' Нажмите отмеченную клетку ещё раз, чтобы снять отметку.'}</p>
      </section>
    </div>
  </>;
}

function Results({ session, online, perform, busy }: { session: SessionState; online: boolean; perform: (action: GameAction) => void; busy: boolean }) {
  const sorted = [...session.room.players].sort((a, b) => b.score - a.score);
  const max = sorted[0]?.score ?? 0; const winners = sorted.filter((player) => player.score === max);
  let rank = 0;
  return <section className="results-panel" aria-labelledby="results-title"><div className="result-banner"><span className="trophy-sticker"><Trophy size={42} strokeWidth={2.5} /></span><div><h1 id="results-title">Бинго, {winners.map((player) => player.name).join(' и ')}!</h1><p>{winners.length > 1 ? 'Разделили первое место' : 'Победитель раунда'} — {max} {pointsWord(max)}.</p></div><Rays /></div>
    <div className="results-table-wrap"><table className="results-table"><caption className="sr-only">Итоги игры</caption><thead><tr><th>Место</th><th>Игрок</th><th>Бинго</th><th>Супер</th><th>Очки</th></tr></thead><tbody>{sorted.map((player, index) => {
      if (index === 0 || player.score !== sorted[index - 1].score) rank = index + 1;
      return <tr key={player.id} className={rank === 1 ? 'winner-row' : ''}><td>{rank === 1 ? <Crown size={22} aria-label="Первое место" /> : rank}</td><th scope="row"><Avatar id={player.avatarId} /><span>{player.name}</span></th><td>{player.normalHits}</td><td>{player.superHits}</td><td className="result-score">{player.score}</td></tr>;
    })}</tbody></table></div>
    <div className="results-actions">{session.self!.isHost ? <><button className="button button-primary" disabled={!online || busy} onClick={() => perform({ type: 'newGame' })}>Ещё один раунд <ArrowRight size={20} /></button><button className="text-button" disabled={!online || busy} onClick={() => perform({ type: 'newGame', clearDictionaries: true })}>Начать с пустыми словарями</button></> : <p>Следующую игру запустит ведущий. Ваш словарь сохранён.</p>}</div>
  </section>;
}

function PreferencesDialog({ close, sound, setSound, reduced, setReduced }: { close: () => void; sound: boolean; setSound: (value: boolean) => void; reduced: boolean; setReduced: (value: boolean) => void }) {
  return <Dialog title="Эффекты бинго" close={close}><p className="field-help">Эти настройки действуют только на вашем устройстве.</p>
    <label className="checkbox-field"><input type="checkbox" checked={sound} onChange={(event) => { setSound(event.target.checked); if (event.target.checked) unlockAudio(); }} /><span>Звук бинго</span></label>
    <label className="checkbox-field"><input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} /><span>Без тряски и конфетти</span></label>
    <div className="dialog-actions"><button className="button button-primary" onClick={close}>Готово</button></div>
  </Dialog>;
}

function SettingsDialog({ session, close, sound, setSound, reduced, setReduced }: { session: SessionState; close: () => void; sound: boolean; setSound: (value: boolean) => void; reduced: boolean; setReduced: (value: boolean) => void }) {
  const [settings, setSettings] = useState<Settings>({ ...session.room.settings });
  const [words, setWords] = useState(session.room.commonCells.map((cell) => cell.text));
  const [network, setNetwork] = useState<NetworkInfo | null>(null); const task = useTask();
  const lobby = session.room.phase === 'lobby';
  useEffect(() => { let active = true; void gameClient.network().then((info) => { if (active) setNetwork(info); }).catch(() => {}); return () => { active = false; }; }, []);
  return <Dialog title="Настройки игры" close={close} wide><form onSubmit={(event) => { event.preventDefault(); void task.run(async () => { await gameClient.action({ type: 'settings', settings, commonWords: words }); close(); }); }}>
    <div className="settings-top-grid"><label className="select-field"><span>Кто отмечает общее бинго</span><span className="select-wrapper"><select value={settings.commonPermission} onChange={(event) => setSettings({ ...settings, commonPermission: event.target.value as Settings['commonPermission'] })}><option value="everyone">Все игроки</option><option value="host">Только ведущий</option></select><ChevronDown size={17} /></span></label>
      <label className="select-field"><span>Обычных вариантов у игрока</span><span className="select-wrapper"><select disabled={!lobby} value={settings.competitiveCount} onChange={(event) => setSettings({ ...settings, competitiveCount: Number(event.target.value) })}>{[4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} + одно супер бинго</option>)}</select><ChevronDown size={17} /></span></label></div>
    <div className="settings-section-heading"><h3>Словарь общего поля</h3><span className="select-wrapper grid-size-select"><select disabled={!lobby} aria-label="Размер общего поля" value={settings.commonSize} onChange={(event) => {
      const size = Number(event.target.value) as 3 | 4; setSettings({ ...settings, commonSize: size }); setWords((previous) => Array.from({ length: size ** 2 }, (_, index) => previous[index] ?? ''));
    }}><option value={3}>3 × 3</option><option value={4}>4 × 4</option></select><ChevronDown size={16} /></span></div>
    {!lobby && <p className="field-help">Словари и размер поля можно изменить перед следующей игрой.</p>}
    <div className="common-word-fields">{words.map((word, index) => <label key={index}><span className="sr-only">Клетка {index + 1}</span><span className="word-index" aria-hidden="true">{index + 1}</span><input disabled={!lobby} value={word} required maxLength={MAX_PHRASE_LENGTH} placeholder="Текст клетки" onChange={(event) => setWords((previous) => previous.map((item, position) => index === position ? event.target.value : item))} /></label>)}</div>
    <div className="effects-settings"><h3>На этом устройстве</h3><label className="checkbox-field"><input type="checkbox" checked={sound} onChange={(event) => { setSound(event.target.checked); if (event.target.checked) unlockAudio(); }} /><span>Звук бинго</span></label><label className="checkbox-field"><input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} /><span>Спокойные эффекты без тряски и конфетти</span></label></div>
    <section className="network-section"><h3>Пригласить игроков</h3><p>В одной сети с вами друзья могут открыть эту ссылку:</p>{network ? network.localUrls.length ? network.localUrls.map((url) => <div className="copy-link" key={url}><span>{url}</span><button type="button" className="icon-button" aria-label={`Скопировать ${url}`} onClick={() => void copyInvite(url)}><Copy size={18} /></button></div>) : <p>Локальный адрес не найден. Проверьте подключение компьютера к сети.</p> : <p>Определяем адрес комнаты…</p>}
      {network?.publicUrl && <><p>Для друзей из интернета:</p><div className="copy-link"><span>{network.publicUrl}</span><button type="button" className="icon-button" aria-label="Скопировать внешнюю ссылку" onClick={() => void copyInvite(network.publicUrl!)}><Copy size={18} /></button></div></>}
    </section><ErrorText>{task.error}</ErrorText><div className="dialog-actions settings-actions"><button type="button" className="button button-secondary" onClick={close}>Отмена</button><button type="submit" className="button button-primary" disabled={task.pending}>{task.pending ? 'Сохраняем…' : 'Сохранить настройки'}</button></div>
  </form></Dialog>;
}

export function App() {
  const state = useGame(); const { session, bingo } = state;
  const phase = session?.room.phase;
  const [modal, setModal] = useState<'settings' | 'profile' | 'finish' | 'leave' | null>(null);
  const [sound, setSound] = usePreference('bingo-sound', false);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [quiet, setQuiet] = usePreference('bingo-quiet', false); const reduced = quiet || systemReduced;
  const task = useTask();
  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setSystemReduced(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => { document.documentElement.dataset.quiet = String(reduced); }, [reduced]);
  useEffect(() => { if (phase) window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [phase]);
  const perform = (action: GameAction) => void task.run(() => gameClient.action(action));
  useEffect(() => { if (task.error) gameClient.notify(task.error, true); }, [task.error]);
  if (state.loading) return <div className="loading-screen"><Wordmark /><p>Собираем бинго…</p></div>;
  if (!session) return <div className="loading-screen"><Wordmark /><WifiOff size={38} /><h1>Не удалось подключиться</h1><p>{state.error}</p><button className="button button-primary" onClick={() => void gameClient.refresh()}>Попробовать ещё раз</button></div>;
  if (!session.self) return <Welcome session={session} notice={state.notice?.text} />;
  const player = session.room.players.find((item) => item.id === session.self!.id);
  if (!player) return <div className="loading-screen"><p>Обновляем комнату…</p></div>;
  const online = state.connection === 'connected'; const host = session.room.players.find((item) => item.isHost);
  return <div className="app" key={session.room.id}>
    <header className="site-header app-header"><a href="#main" className="brand-link" aria-label="К игре"><Wordmark /></a><div className="header-game-state"><span className={`connection-dot ${online ? '' : 'connecting'}`} /><span>{online ? session.room.phase === 'lobby' ? 'Собираемся' : session.room.phase === 'playing' ? 'Игра идёт' : 'Игра завершена' : 'Переподключение…'}</span></div>
      <div className="header-actions"><InviteButton /><button className="profile-button" onClick={() => setModal('profile')} aria-label="Изменить имя и аватарку"><Avatar id={player.avatarId} /><span>{player.name}</span>{session.self.isHost && <Crown size={17} />}</button>
        <button className="icon-button sound-button" aria-label={sound ? 'Выключить звук' : 'Включить звук'} aria-pressed={sound} onClick={() => { setSound(!sound); if (!sound) unlockAudio(); }}>{sound ? <Volume2 size={21} /> : <VolumeX size={21} />}</button>
        <button className="button header-settings" aria-label={session.self.isHost ? 'Настройки игры' : 'Эффекты бинго'} onClick={() => setModal('settings')}><SettingsIcon size={19} /><span>{session.self.isHost ? 'Настройки' : 'Эффекты'}</span></button>
        {session.room.phase === 'playing' && session.self.isHost && <button className="button button-danger finish-button" disabled={!online || task.pending} onClick={() => setModal('finish')}><Flag size={18} /><span>Закончить</span></button>}
        {session.room.phase === 'lobby' && <button className="icon-button exit-button" onClick={() => setModal('leave')} aria-label="Выйти из комнаты"><LogOut size={19} /></button>}
      </div>
    </header>
    {!online && <div className="connection-banner" role="status"><WifiOff size={18} /> Восстанавливаем соединение. Ваш словарь и очки сохранены.</div>}
    {session.canClaimHost && <div className="host-recovery-banner"><span>Ведущий не подключён.</span><button className="text-button" disabled={!online || task.pending} onClick={() => perform({ type: 'claimHost' })}>Взять роль ведущего <Crown size={16} /></button></div>}
    <div id="main">{session.room.phase === 'lobby' ? <Lobby session={session} online={online} openSettings={() => setModal('settings')} /> : <main className="main-container game-main">
      {session.room.phase === 'finished' ? <Results session={session} online={online} perform={perform} busy={task.pending} /> : <div className="game-heading"><div><span className="live-game-tag"><span className="mini-dot" /> Ловим совпадения</span><h1 className="sr-only">Игра Бинго</h1></div><span className="host-label"><Crown size={15} /> Ведущий: {host?.name ?? 'не выбран'}</span></div>}
      <GameBoard key={session.room.roundId} session={session} online={online} event={bingo} perform={perform} busy={task.pending} />
      {session.self.isHost && session.room.phase === 'playing' && <div className="game-bottom-bar"><span>Повторное нажатие на клетку снимает отметку и возвращает очки.</span><button className="text-button undo-button" disabled={!session.room.canUndo || !online || task.pending} title={session.room.lastAction ?? ''} onClick={() => perform({ type: 'undo' })}><Undo2 size={17} /> Отменить последнюю отметку</button></div>}
    </main>}</div>
    <footer className="app-footer"><span>Стикер пати</span><span><Users size={14} /> {session.room.players.length} / 4</span></footer>
    <PartyEffects event={bingo} reduced={reduced} sound={sound} />
    <div className="event-announcement sr-only" aria-live="polite" aria-atomic="true">{bingo ? `${bingo.playerName}: ${bingo.text}. Бинго!${bingo.points ? ` Плюс ${bingo.points} ${pointsWord(bingo.points)}.` : ''}` : ''}</div>
    {bingo && <div className="bingo-toast" key={bingo.id}><Sparkles size={21} /><strong>{bingo.points === 2 ? 'СУПЕР БИНГО!' : 'БИНГО!'}</strong><span>{bingo.playerName}{bingo.points ? ` +${bingo.points}` : ''}</span></div>}
    {state.notice && <div className={`notice-toast ${state.notice.error ? 'notice-error' : ''}`} role={state.notice.error ? 'alert' : 'status'} key={state.notice.id}>{state.notice.text}</div>}
    {modal === 'profile' && <ProfileDialog player={player} close={() => setModal(null)} />}
    {modal === 'settings' && (session.self.isHost ? <SettingsDialog session={session} close={() => setModal(null)} sound={sound} setSound={setSound} reduced={quiet} setReduced={setQuiet} /> : <PreferencesDialog close={() => setModal(null)} sound={sound} setSound={setSound} reduced={quiet} setReduced={setQuiet} />)}
    {modal === 'finish' && <Dialog title="Подвести итоги?" close={() => setModal(null)}><p>Отметки закроются, и все игроки увидят итоговый счёт.</p><div className="dialog-actions"><button className="button button-secondary" onClick={() => setModal(null)}>Ещё играем</button><button className="button button-primary" disabled={task.pending} onClick={() => void task.run(async () => { await gameClient.action({ type: 'finish' }); setModal(null); })}><Trophy size={19} /> Закончить игру</button></div></Dialog>}
    {modal === 'leave' && <Dialog title="Выйти из комнаты?" close={() => setModal(null)}><p>Ваше место освободится. Чтобы играть, нужно будет присоединиться снова.</p><div className="dialog-actions"><button className="button button-secondary" onClick={() => setModal(null)}>Остаться</button><button className="button button-danger" disabled={task.pending} onClick={() => void task.run(async () => { await gameClient.leave(); setModal(null); })}><ArrowLeft size={17} /> Выйти</button></div></Dialog>}
  </div>;
}
