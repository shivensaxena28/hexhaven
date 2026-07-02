// Game sessions. Two implementations with one interface:
//
//   LocalSession  – hot-seat play on one device; actions go straight to the
//                   engine. Also used to try the game with only bots.
//   OnlineSession – multiplayer over Supabase Realtime, host-authoritative:
//                   every client sends action *intents* on the lobby channel;
//                   the host validates them with the engine, persists the new
//                   canonical state to the `games` row, and broadcasts it.
//                   Clients only ever render host-confirmed state.
//
// The UI consumes a session through subscribe()/getSnapshot() (compatible
// with React's useSyncExternalStore) plus dispatch()/lobbyDispatch().

import { supabase } from './supabaseClient.js';
import { tryReduce, createGame, currentActor, GameError, reduce } from '../engine/game.js';
import { botAction } from '../engine/bots.js';
import { DEFAULT_SETTINGS } from '../engine/constants.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const makeLobbyCode = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

export function getPlayerId() {
  let id = localStorage.getItem('hexhaven:playerId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('hexhaven:playerId', id);
  }
  return id;
}

// ---------------------------------------------------------------- lobby state

export function createLobbyState(code, host) {
  return {
    v: 1,
    phase: 'lobby',
    code,
    hostId: host.id,
    settings: { ...DEFAULT_SETTINGS, seats: 4 },
    players: [{ id: host.id, name: host.name, isBot: false, botLevel: null }],
  };
}

// Lobby mutations, applied only by the host. Throws GameError on bad input.
export function applyLobbyIntent(lobby, intent, fromId) {
  const next = structuredClone(lobby);
  const isHost = fromId === lobby.hostId;
  switch (intent.type) {
    case 'join': {
      if (next.players.some((p) => p.id === intent.player.id)) break; // rejoin
      const bot = next.players.find((p) => p.isBot);
      if (next.players.length >= next.settings.seats) {
        if (!bot) throw new GameError('Lobby is full');
        next.players.splice(next.players.indexOf(bot), 1); // humans displace bots
      }
      next.players.push({
        id: intent.player.id,
        name: String(intent.player.name || 'Player').slice(0, 20),
        isBot: false,
        botLevel: null,
      });
      break;
    }
    case 'leave': {
      next.players = next.players.filter((p) => p.id !== intent.playerId);
      break;
    }
    case 'set_settings': {
      if (!isHost) throw new GameError('Only the host can change settings');
      next.settings = { ...next.settings, ...intent.settings };
      next.settings.seats = Math.max(2, Math.min(6, next.settings.seats));
      next.settings.targetVP = Math.max(3, Math.min(15, next.settings.targetVP));
      while (next.players.length > next.settings.seats) {
        const botIdx = next.players.findLastIndex((p) => p.isBot);
        if (botIdx < 0) break;
        next.players.splice(botIdx, 1);
      }
      break;
    }
    case 'add_bot': {
      if (!isHost) throw new GameError('Only the host can add bots');
      if (next.players.length >= next.settings.seats) throw new GameError('No empty seats');
      const n = next.players.filter((p) => p.isBot).length + 1;
      next.players.push({
        id: `bot-${crypto.randomUUID().slice(0, 8)}`,
        name: `Bot ${n} (${intent.level})`,
        isBot: true,
        botLevel: intent.level || 'medium',
      });
      break;
    }
    case 'chat': {
      const text = String(intent.text || '').slice(0, 300).trim();
      if (!text) throw new GameError('Empty message');
      next.chat = next.chat || [];
      next.chat.push({ name: String(intent.name || 'Player').slice(0, 20), text, ts: Date.now() });
      if (next.chat.length > 200) next.chat.splice(0, next.chat.length - 200);
      break;
    }
    case 'remove_player': {
      if (!isHost) throw new GameError('Only the host can remove players');
      if (intent.playerId === next.hostId) throw new GameError('The host cannot be removed');
      next.players = next.players.filter((p) => p.id !== intent.playerId);
      break;
    }
    default:
      throw new GameError(`Unknown lobby action: ${intent.type}`);
  }
  next.v += 1;
  return next;
}

export function startGameFromLobby(lobby) {
  if (lobby.players.length < 2) throw new GameError('Need at least 2 players');
  const game = createGame({ players: lobby.players, settings: lobby.settings });
  game.code = lobby.code;
  game.hostId = lobby.hostId;
  game.v = lobby.v + 1;
  return game;
}

// ------------------------------------------------------------- base session

const BOT_DELAY_MS = 900;

class BaseSession {
  constructor() {
    this.listeners = new Set();
    this.state = null;
    this.error = null;
    this.errorSeq = 0;
  }

  subscribe(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getSnapshot() {
    return this.state;
  }

  emit() {
    for (const cb of this.listeners) cb();
  }

  setState(state) {
    this.state = state;
    this.emit();
  }

  reportError(message) {
    this.error = message;
    this.errorSeq += 1;
    this.emit();
  }

  get myIndex() {
    if (!this.state?.players) return -1;
    return this.state.players.findIndex((p) => p.id === this.playerId);
  }
}

// -------------------------------------------------------------- host duties
// Shared by LocalSession and by OnlineSession when this client is the host:
// run bot turns (visibly paced) and the optional per-turn timer.

function hostDrive(session) {
  clearTimeout(session._botTimer);
  clearTimeout(session._turnTimer);
  const state = session.state;
  if (!state || state.phase === 'lobby' || state.phase === 'ended') return;

  // 1. Bots: the actor whose move it is, or any bot owing a trade response.
  const scheduleBot = (idx) => {
    const v = state.v;
    session._botTimer = setTimeout(() => {
      if (session.state?.v !== v) return; // state moved on
      const action = botAction(session.state, idx);
      if (action) session.applyEngineAction({ ...action, player: idx });
    }, BOT_DELAY_MS);
  };
  const actor = currentActor(state);
  if (actor != null && state.players[actor].isBot) {
    scheduleBot(actor);
  } else if (state.trade) {
    const owing = state.players.findIndex(
      (p, i) => p.isBot && i !== state.trade.from && state.trade.responses[i] === undefined,
    );
    if (owing >= 0) scheduleBot(owing);
    else if (state.players[state.trade.from].isBot) scheduleBot(state.trade.from);
  }

  // 2. Turn timer for human players.
  const limit = state.settings.turnTimerSeconds;
  if (limit > 0 && actor != null && !state.players[actor].isBot && state.phase === 'main') {
    if (!state.turn.deadline) {
      // Stamp the deadline outside the reducer (wall-clock is host authority).
      const stamped = structuredClone(state);
      stamped.turn.deadline = Date.now() + limit * 1000;
      stamped.v += 1;
      session.setState(stamped);
      session.persist?.(stamped);
      return; // setState re-enters hostDrive
    }
    const remaining = state.turn.deadline - Date.now();
    session._turnTimer = setTimeout(() => {
      const s = session.state;
      if (!s || s.v !== state.v) return;
      // Sensible auto-action: end the turn, or make the forced move for the
      // player (roll / discard / robber) using the bot logic.
      const auto = s.turn.phase === 'main'
        ? { type: 'end_turn' }
        : s.turn.phase === 'special'
          ? { type: 'end_special' }
          : botAction(s, actor);
      if (auto) session.applyEngineAction({ ...auto, player: actor });
    }, Math.max(0, remaining));
  }
}

// Clear the stamped deadline whenever the actor or sub-phase changes.
function nextDeadline(prev, next) {
  if (!next.turn) return next;
  if (!prev?.turn) return next;
  const moved = currentActor(prev) !== currentActor(next) || prev.turn.phase !== next.turn.phase;
  if (moved) next.turn.deadline = null;
  return next;
}

// -------------------------------------------------------------- local play

export class LocalSession extends BaseSession {
  constructor({ resume } = {}) {
    super();
    this.mode = 'local';
    this.playerId = 'local';
    this.code = null;
    this.isHost = true;
    if (resume) {
      this.state = resume;
    }
  }

  static resumeFromStorage() {
    try {
      const raw = localStorage.getItem('hexhaven:localGame');
      if (!raw) return null;
      const state = JSON.parse(raw);
      // Saves from before the resource rename (lumber/wool/grain) are not
      // compatible; ignore them rather than resuming a broken game.
      if (!state.bank || state.bank.wheat === undefined) return null;
      return state.phase && state.phase !== 'ended' ? new LocalSession({ resume: state }) : null;
    } catch {
      return null;
    }
  }

  startLocalGame(players, settings) {
    const game = createGame({ players, settings });
    game.hostId = 'local';
    this.setState(game);
    this.persist(game);
    hostDrive(this);
  }

  // In hot-seat mode the device acts for whichever player must move.
  dispatch(action) {
    const idx = action.player ?? currentActor(this.state);
    this.applyEngineAction({ ...action, player: idx });
  }

  applyEngineAction(action) {
    const result = tryReduce(this.state, { ...action, ts: Date.now() });
    if (!result.ok) {
      this.reportError(result.error);
      hostDrive(this);
      return;
    }
    const next = nextDeadline(this.state, result.state);
    next.hostId = this.state.hostId;
    this.setState(next);
    this.persist(next);
    hostDrive(this);
  }

  persist(state) {
    try {
      if (state.phase === 'ended') localStorage.removeItem('hexhaven:localGame');
      else localStorage.setItem('hexhaven:localGame', JSON.stringify(state));
    } catch { /* storage full or unavailable — resume is best-effort */ }
  }

  rematch() {
    const { players, settings } = this.state;
    this.startLocalGame(
      players.map(({ id, name, isBot, botLevel }) => ({ id, name, isBot, botLevel })),
      settings,
    );
  }

  leave() {
    clearTimeout(this._botTimer);
    clearTimeout(this._turnTimer);
    this.listeners.clear();
  }
}

// ------------------------------------------------------------- online play

const HOST_GRACE_MS = 5000;

export class OnlineSession extends BaseSession {
  constructor({ code, playerId, name }) {
    super();
    this.mode = 'online';
    this.code = code;
    this.playerId = playerId;
    this.name = name;
    this.presence = {}; // playerId -> true
    this.connected = false;
    this.channel = null;
    this._writeChain = Promise.resolve();
  }

  get isHost() {
    return this.state?.hostId === this.playerId;
  }

  // ---- lifecycle

  async create(settings) {
    const lobby = createLobbyState(this.code, { id: this.playerId, name: this.name });
    if (settings) lobby.settings = { ...lobby.settings, ...settings };
    const { error } = await supabase.from('games').insert({
      code: this.code,
      state: lobby,
      version: lobby.v,
    });
    if (error) throw new Error(`Could not create the lobby: ${error.message}`);
    this.setState(lobby);
    await this._subscribe();
  }

  async join() {
    const { data, error } = await supabase
      .from('games').select('state').eq('code', this.code).maybeSingle();
    if (error) throw new Error(`Could not reach the server: ${error.message}`);
    if (!data) throw new Error('No game found with that code');
    this.setState(data.state);
    await this._subscribe();
    const seated = this.state.players.some((p) => p.id === this.playerId);
    if (!seated) {
      if (this.state.phase !== 'lobby') throw new Error('That game has already started');
      this.sendIntent({ kind: 'lobby', type: 'join', player: { id: this.playerId, name: this.name } });
    }
  }

  async _subscribe() {
    this.channel = supabase.channel(`game:${this.code}`, {
      config: { broadcast: { self: false }, presence: { key: this.playerId } },
    });
    this.channel
      .on('broadcast', { event: 'intent' }, ({ payload }) => this._onIntent(payload))
      .on('broadcast', { event: 'state' }, ({ payload }) => this._onState(payload.state))
      .on('broadcast', { event: 'reject' }, ({ payload }) => {
        if (payload.playerId === this.playerId) this.reportError(payload.error);
      })
      .on('presence', { event: 'sync' }, () => this._onPresence());
    await new Promise((resolve, reject) => {
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.connected = true;
          await this.channel.track({ name: this.name });
          // Re-read canonical state in case we missed broadcasts while connecting.
          const { data } = await supabase.from('games').select('state').eq('code', this.code).maybeSingle();
          if (data && (!this.state || data.state.v > this.state.v)) this.setState(data.state);
          this._afterStateChange();
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.connected = false;
          this.emit();
          reject(new Error('Realtime connection failed'));
        } else if (status === 'CLOSED') {
          this.connected = false;
          this.emit();
        }
      });
    });
  }

  leave() {
    clearTimeout(this._botTimer);
    clearTimeout(this._turnTimer);
    clearTimeout(this._hostWatch);
    if (this.channel) supabase.removeChannel(this.channel);
    this.listeners.clear();
  }

  // ---- outgoing

  dispatch(action) {
    if (this.isHost) {
      const idx = action.player ?? this.myIndex;
      this.applyEngineAction({ ...action, player: idx });
    } else {
      this.sendIntent({ kind: 'game', playerId: this.playerId, action });
    }
  }

  lobbyDispatch(intent) {
    if (this.isHost) {
      this._applyLobby(intent, this.playerId);
    } else {
      this.sendIntent({ kind: 'lobby', ...intent, fromId: this.playerId });
    }
  }

  startGame() {
    if (!this.isHost) return;
    try {
      const game = startGameFromLobby(this.state);
      this.setState(game);
      this._broadcastState();
      this.persist(game);
      this._afterStateChange();
    } catch (e) {
      if (e instanceof GameError) this.reportError(e.message);
      else throw e;
    }
  }

  sendIntent(payload) {
    this.channel?.send({ type: 'broadcast', event: 'intent', payload });
  }

  rematch() {
    if (!this.isHost || this.state.phase !== 'ended') return;
    const { players, settings } = this.state;
    const game = createGame({
      players: players.map(({ id, name, isBot, botLevel }) => ({ id, name, isBot, botLevel })),
      settings,
    });
    game.code = this.code;
    game.hostId = this.playerId;
    game.v = this.state.v + 1;
    this.setState(game);
    this._broadcastState();
    this.persist(game);
    this._afterStateChange();
  }

  // ---- host: handling intents

  _onIntent(payload) {
    if (!this.isHost || !this.state) return;
    if (payload.kind === 'lobby') {
      const { kind, fromId, ...intent } = payload;
      this._applyLobby(intent, fromId ?? payload.player?.id);
    } else if (payload.kind === 'game') {
      const idx = this.state.players?.findIndex((p) => p.id === payload.playerId);
      if (idx == null || idx < 0) return;
      this.applyEngineAction({ ...payload.action, player: idx }, payload.playerId);
    }
  }

  _applyLobby(intent, fromId) {
    try {
      const next = applyLobbyIntent(this.state, intent, fromId);
      this.setState(next);
      this._broadcastState();
      this.persist(next);
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      if (fromId === this.playerId) this.reportError(e.message);
      else this.channel?.send({ type: 'broadcast', event: 'reject', payload: { playerId: fromId, error: e.message } });
    }
  }

  applyEngineAction(action, fromPlayerId = this.playerId) {
    const result = tryReduce(this.state, { ...action, ts: Date.now() });
    if (!result.ok) {
      if (fromPlayerId === this.playerId) this.reportError(result.error);
      else this.channel?.send({ type: 'broadcast', event: 'reject', payload: { playerId: fromPlayerId, error: result.error } });
      hostDrive(this);
      return;
    }
    const next = nextDeadline(this.state, result.state);
    next.code = this.code;
    next.hostId = this.state.hostId;
    this.setState(next);
    this._broadcastState();
    this.persist(next);
    this._afterStateChange();
  }

  _broadcastState() {
    this.channel?.send({ type: 'broadcast', event: 'state', payload: { state: this.state } });
  }

  persist(state) {
    // Serialize writes so an older state can never overwrite a newer one.
    this._writeChain = this._writeChain.then(() =>
      supabase.from('games')
        .update({ state, version: state.v, updated_at: new Date().toISOString() })
        .eq('code', this.code)
        .then(({ error }) => {
          if (error) console.warn('persist failed:', error.message);
        }),
    );
  }

  // ---- everyone: receiving state

  _onState(state) {
    if (!state || (this.state && state.v <= this.state.v)) return;
    this.setState(state);
    this._afterStateChange();
  }

  _afterStateChange() {
    if (this.isHost) hostDrive(this);
    this._watchHost();
  }

  // ---- presence & host migration

  _onPresence() {
    if (!this.channel) return;
    const raw = this.channel.presenceState();
    this.presence = Object.fromEntries(Object.keys(raw).map((k) => [k, true]));
    this.emit();
    this._watchHost();
  }

  hostConnected() {
    return !!(this.state && this.presence[this.state.hostId]);
  }

  _watchHost() {
    clearTimeout(this._hostWatch);
    if (!this.state || this.isHost || this.hostConnected()) return;
    // The host looks gone. After a grace period the connected human with the
    // lowest seat index claims authority (deterministic, so no fighting).
    this._hostWatch = setTimeout(() => this._maybeClaimHost(), HOST_GRACE_MS);
  }

  async _maybeClaimHost() {
    if (!this.state || this.isHost || this.hostConnected()) return;
    const candidates = this.state.players.filter((p) => !p.isBot && this.presence[p.id]);
    if (candidates.length === 0 || candidates[0].id !== this.playerId) return;
    const claimed = structuredClone(this.state);
    claimed.hostId = this.playerId;
    claimed.v += 1;
    // Optimistic-concurrency claim: only succeeds against the version we saw.
    const { data, error } = await supabase.from('games')
      .update({ state: claimed, version: claimed.v })
      .eq('code', this.code)
      .eq('version', this.state.v)
      .select('version');
    if (!error && data && data.length > 0) {
      this.setState(claimed);
      this._broadcastState();
      this._afterStateChange();
    }
  }
}
