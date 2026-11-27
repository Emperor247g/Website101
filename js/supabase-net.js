/**
 * Supabase Realtime transport for Crown & Oak online matches.
 *
 * Vercel can only host static files, so this transport keeps the room on a
 * Supabase Realtime channel instead of a persistent WebSocket server. The
 * room creator is the host: every move is validated with the shared rules
 * engine before a single authoritative state update is broadcast to both
 * seats. Room credentials and the latest snapshot are cached locally so a
 * reload can reattach to the same seat.
 */

import { createClient } from '@supabase/supabase-js';
import { BLACK, CheckersGame, WHITE } from './engine.js';
import { ROOM_STORAGE_KEY } from './net.js';

const STATE_STORAGE_KEY = 'crown-and-oak-supabase-state-v1';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COMMAND_TYPES = new Set([
  'join_request',
  'resume_request',
  'move_request',
  'state_request',
  'rematch_request',
  'leave_request',
]);
const REQUEST_TIMEOUT = 8000;
const MOVE_TIMEOUT = 8000;
const RESUME_TIMEOUT = 2500;
const REALTIME_SETUP_MESSAGE =
  'Supabase Realtime blocked the room message. Enable public Realtime access or run SUPABASE_SETUP.sql, then reload.';

function makeToken() {
  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function makeRoomCode() {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

function normalizeRoomCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function cleanNickname(value) {
  return String(value || '').trim().slice(0, 24) || 'Player';
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cloneLastMove(lastMove) {
  if (!lastMove) return null;
  return {
    ...lastMove,
    path: Array.isArray(lastMove.path) ? lastMove.path.slice() : [],
    captures: Array.isArray(lastMove.captures) ? lastMove.captures.slice() : [],
    segments: Array.isArray(lastMove.segments)
      ? lastMove.segments.map((segment) => ({ ...segment }))
      : [],
  };
}

function serializeGame(game) {
  return {
    board: game.board.slice(),
    currentPlayer: game.currentPlayer,
    status: game.status,
    winner: game.winner,
    winReason: game.winReason,
    forcedFrom: game.forcedFrom,
    lastMove: cloneLastMove(game.lastMove),
    turnNumber: game.turnNumber,
    noProgressTurns: game.noProgressTurns,
    historyLength: game.history.length,
    repetitions: { ...game.repetitions },
    turnHadCapture: Boolean(game.turnHadCapture),
    turnHadManMove: Boolean(game.turnHadManMove),
    turnSegments: game.turnSegments.map((segment) => ({ ...segment })),
    snapshotPushed: Boolean(game._snapshotPushed),
  };
}

function restoreGame(game, state, snapshot = null) {
  if (!state || !Array.isArray(state.board) || state.board.length !== 64) return;
  game.reset();
  game.board = state.board.slice();
  game.currentPlayer = state.currentPlayer;
  game.status = state.status || 'playing';
  game.winner = state.winner ?? null;
  game.winReason = state.winReason || '';
  game.forcedFrom = state.forcedFrom ?? null;
  game.lastMove = cloneLastMove(state.lastMove);
  game.turnNumber = state.turnNumber || 1;
  game.noProgressTurns = state.noProgressTurns || 0;
  game.history = new Array(Math.max(0, state.historyLength || 0)).fill(null);
  game.repetitions = snapshot?.repetitions
    ? { ...snapshot.repetitions }
    : { [game.board.join('')]: 1 };

  if (snapshot?.turnSegments) {
    game.turnSegments = snapshot.turnSegments.map((segment) => ({ ...segment }));
    game.turnHadCapture = Boolean(snapshot.turnHadCapture);
    game.turnHadManMove = Boolean(snapshot.turnHadManMove);
    game._snapshotPushed = Boolean(snapshot.snapshotPushed);
  } else if (game.lastMove?.segments?.length) {
    game.turnSegments = game.lastMove.segments.map((segment) => ({ ...segment }));
    game.turnHadCapture = game.turnSegments.some((segment) => segment.capture !== null);
    game.turnHadManMove = false;
    game._snapshotPushed = game.forcedFrom !== null;
  }
}

function publicState(game, players) {
  const state = game.getState();
  return {
    board: state.board.slice(),
    counts: state.counts,
    currentPlayer: state.currentPlayer,
    status: state.status,
    winner: state.winner,
    winReason: state.winReason,
    forcedFrom: state.forcedFrom,
    turnNumber: state.turnNumber,
    historyLength: state.historyLength,
    lastMove: cloneLastMove(state.lastMove),
    noProgressTurns: state.noProgressTurns,
    players: players.map((player) => ({
      color: player.color,
      nickname: player.nickname,
      connected: Boolean(player.connected),
    })),
  };
}

function loadStoredRoom() {
  try {
    const stored = JSON.parse(localStorage.getItem(ROOM_STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return null;
    if (typeof stored.code !== 'string' || typeof stored.token !== 'string') return null;
    return {
      code: stored.code.toUpperCase(),
      token: stored.token,
      color: stored.color || null,
      host: Boolean(stored.host),
      hostToken: stored.hostToken || null,
    };
  } catch {
    return null;
  }
}

function loadStateSnapshot(code) {
  try {
    const stored = JSON.parse(localStorage.getItem(`${STATE_STORAGE_KEY}:${code}`) || 'null');
    if (!stored || typeof stored !== 'object' || !stored.state) return null;
    return stored;
  } catch {
    return null;
  }
}

function saveStateSnapshot(snapshot) {
  try {
    localStorage.setItem(`${STATE_STORAGE_KEY}:${snapshot.code}`, JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable in private mode.
  }
}

function removeStateSnapshot(code) {
  try {
    localStorage.removeItem(`${STATE_STORAGE_KEY}:${code}`);
  } catch {
    // Storage can be unavailable in private mode.
  }
}

/**
 * @typedef {Object} SupabaseNetOptions
 * @property {(message: object) => void} [onEvent] Called for every room message.
 * @property {(status: string) => void} [onStatus] Called on connection changes.
 * @property {{url: string, anonKey: string}} [config] Supabase browser credentials.
 */

export class SupabaseNetClient {
  /** @param {SupabaseNetOptions} options */
  constructor({ onEvent, onStatus, config = {} } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.config = config;

    this.client = createClient(
      String(config.url || '').replace(/\/$/, ''),
      String(config.anonKey || ''),
      {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 10 } },
      },
    );

    this.channel = null;
    this.subscribed = false;
    this.status = 'offline';
    this.shouldReconnect = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.subscribeWaiters = [];

    this.code = null;
    this.token = null;
    this.color = null;
    this.host = false;
    this.hostToken = null;
    this.opponentConnected = false;
    this.opponentNickname = '';

    this.room = null;
    this.game = new CheckersGame();
    this.latestState = null;
    this.latestVersion = 0;

    this.nextId = 1;
    this.pendingRequests = new Map();
    this.queuedSignals = [];
    this.moveTimer = null;
    this.moveId = null;
    this.seenTokens = new Set();
  }

  get connected() {
    return Boolean(this.client && this.subscribed);
  }

  get inRoom() {
    return Boolean(this.code && this.token);
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  /** Connect to Supabase and reattach to a cached room when one exists. */
  async connect() {
    if (!this.client) throw new Error('Supabase is not configured');
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;

    const stored = loadStoredRoom();
    if (!stored) {
      this._setStatus('connected');
      return;
    }

    this.code = stored.code;
    this.token = stored.token;
    this.color = stored.color;
    this.host = stored.host;
    this.hostToken = stored.hostToken || (stored.host ? stored.token : null);

    await this._subscribe();
    await this._resumeStoredRoom();
  }

  _subscribe() {
    if (this.subscribed) return Promise.resolve();
    if (this.subscribeWaiters.length) {
      return new Promise((resolve, reject) => this.subscribeWaiters.push({ resolve, reject }));
    }
    if (!this.code || !this.token) {
      return Promise.reject(new Error('No room selected'));
    }

    return new Promise((resolve, reject) => {
      this.subscribeWaiters.push({ resolve, reject });
      this._clearReconnect();
      this._setStatus(this.reconnectAttempt ? 'reconnecting' : 'connecting');

      let channel;
      try {
        channel = this.client.channel(`crown-oak-${this.code}`, {
          config: {
            broadcast: { self: true, ack: true },
            presence: { key: this.token },
          },
        });
        channel.on('broadcast', { event: 'signal' }, ({ payload }) => this._onSignal(payload));
        channel.on('presence', { event: 'sync' }, () => this._onPresenceSync());
      } catch (error) {
        this._rejectSubscribeWaiters(error);
        this._scheduleReconnect();
        return;
      }

      this.channel = channel;
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.subscribed = true;
          this.reconnectAttempt = 0;
          this._setStatus('connected');
          if (this.token) this.seenTokens.add(this.token);
          this._trackPresence();
          this._resolveSubscribeWaiters();
          this._flushQueue();
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.subscribed = false;
          this._rejectSubscribeWaiters(new Error('Could not join the room channel'));
          if (this.shouldReconnect) {
            this._setStatus('reconnecting');
            this._scheduleReconnect();
          } else {
            this._setStatus('offline');
          }
        }
      });
    });
  }

  _resolveSubscribeWaiters() {
    const waiters = this.subscribeWaiters.splice(0);
    waiters.forEach((waiter) => waiter.resolve());
  }

  _rejectSubscribeWaiters(error) {
    const waiters = this.subscribeWaiters.splice(0);
    waiters.forEach((waiter) => waiter.reject(error));
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer || !this.code) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(8000, 450 * 2 ** (this.reconnectAttempt - 1));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this._subscribe().catch(() => {});
    }, delay);
  }

  _clearChannel() {
    this.shouldReconnect = false;
    this._clearReconnect();
    this._rejectSubscribeWaiters(new Error('Room closed'));
    const channel = this.channel;
    this.channel = null;
    this.subscribed = false;
    if (channel && this.client) {
      Promise.resolve(this.client.removeChannel(channel)).catch(() => {});
    }
  }

  _trackPresence(color = this.color) {
    if (!this.channel || !this.subscribed) return;
    Promise.resolve(this.channel.track({ token: this.token, color: color || 'pending' }))
      .catch(() => {});
  }

  _send(signal) {
    const payload = { ...signal, code: signal.code || this.code };
    if (!this.subscribed || !this.channel) {
      this.queuedSignals.push(payload);
      return false;
    }
    try {
      Promise.resolve(
        this.channel.send(
          { type: 'broadcast', event: 'signal', payload },
          { timeout: REQUEST_TIMEOUT },
        ),
      )
        .then((result) => {
          if (result === 'error' || result === 'timed out') {
            this._emit({ type: 'error', ok: false, message: REALTIME_SETUP_MESSAGE });
          }
        })
        .catch(() => {
          this._emit({ type: 'error', ok: false, message: REALTIME_SETUP_MESSAGE });
        });
      return true;
    } catch {
      return false;
    }
  }

  _flushQueue() {
    const queued = this.queuedSignals.splice(0);
    queued.forEach((signal) => this._send(signal));
  }

  _request(type, payload = {}, timeoutMs = REQUEST_TIMEOUT) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        const waiter = this.pendingRequests.get(id);
        if (!waiter) return;
        window.clearTimeout(waiter.timer);
        this.pendingRequests.delete(id);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = window.setTimeout(() => {
        finish(new Error(`The room host did not respond. ${REALTIME_SETUP_MESSAGE}`));
      }, timeoutMs);
      this.pendingRequests.set(id, { finish, timer });

      if (!this._send({
        type,
        id,
        from: this.token,
        to: this.hostToken || undefined,
        payload,
      })) {
        finish(new Error('Not connected to the room'));
      }
    });
  }

  _settleRequest(signal) {
    if (!signal.replyTo || !this.pendingRequests.has(signal.replyTo)) return false;
    const waiter = this.pendingRequests.get(signal.replyTo);
    if (signal.type === 'error') {
      waiter.finish(new Error(signal.message || 'Room request failed'));
    } else {
      waiter.finish(null, signal);
    }
    return true;
  }

  _sendEvent(event) {
    return this._send({ code: this.code, from: this.token, ...event });
  }

  _sendError(message, errorCode, source = null) {
    const target = source?.from && source.from !== this.token
      ? source.from
      : (source?.to || this.token);
    this._send({
      code: this.code,
      from: this.token,
      to: target,
      replyTo: source?.id || null,
      type: 'error',
      ok: false,
      errorCode,
      message,
    });
  }

  _emit(message) {
    this.onEvent(message);
  }

  _onSignal(signal) {
    if (!signal || typeof signal.type !== 'string') return;
    if (this.code && signal.code && signal.code !== this.code) return;
    if (signal.to && signal.to !== this.token && signal.to !== this.color) return;
    if (COMMAND_TYPES.has(signal.type) && signal.from === this.token) return;

    this._settleRequest(signal);

    switch (signal.type) {
      case 'join_request':
        this._handleJoinRequest(signal);
        break;
      case 'resume_request':
        this._handleResumeRequest(signal);
        break;
      case 'move_request':
        if (this.host) this._applyMove(signal.from, signal.payload?.from, signal.payload?.to, signal.id, signal);
        break;
      case 'state_request':
        this._handleStateRequest(signal);
        break;
      case 'rematch_request':
        this._handleRematchRequest(signal);
        break;
      case 'leave_request':
        this._handleLeaveRequest(signal);
        break;
      case 'room_created':
      case 'room_joined':
      case 'room_resumed':
        this._handleRoomReady(signal);
        break;
      case 'opponent_joined':
        this._handleOpponentJoined(signal);
        break;
      case 'move_applied':
        this._handleMoveApplied(signal);
        break;
      case 'room_state':
      case 'game_reset':
        this._handleStateEvent(signal);
        break;
      case 'opponent_status':
        this._handleOpponentStatus(signal);
        break;
      case 'rematch_status':
        this._handleRematchStatus(signal);
        break;
      case 'room_closed':
        this._emit(signal);
        break;
      case 'error':
        this._clearMoveTimer();
        this._emit(signal);
        break;
      default:
        break;
    }
  }

  _publicState() {
    return publicState(this.game, this.room?.players || []);
  }

  _saveLocalSnapshot(message = {}) {
    if (!this.code || !this.latestState) return;
    const players = this.host && this.room
      ? this.room.players
      : (this.latestState.players || []);
    saveStateSnapshot({
      code: this.code,
      token: this.token,
      color: message.color || this.color,
      host: message.host !== undefined ? Boolean(message.host) : Boolean(this.host),
      hostToken: message.hostToken || this.hostToken || (this.host ? this.token : null),
      version: Number(message.version ?? this.latestVersion) || 0,
      state: cloneValue(this.latestState),
      game: serializeGame(this.game),
      players: cloneValue(players),
      rematchReady: this.room ? [...this.room.rematchReady] : [],
      updatedAt: Date.now(),
    });
  }

  _saveHostSnapshot() {
    if (!this.host || !this.room) return;
    this.latestState = this._publicState();
    this.latestVersion = this.room.version;
    this._saveLocalSnapshot({
      state: this.latestState,
      version: this.latestVersion,
      host: true,
      hostToken: this.token,
    });
  }

  _adoptRoomState(state, version) {
    if (!state || !Array.isArray(state.board)) return;
    this.latestState = cloneValue(state);
    this.latestVersion = Number(version) || 0;
    if (!this.host) restoreGame(this.game, state);
    this._saveLocalSnapshot({ state, version });
  }

  _handleRoomReady(signal) {
    if (!signal.code || !signal.token) return;
    this.code = String(signal.code).toUpperCase();
    this.token = String(signal.token);
    if (signal.color) this.color = signal.color;
    this.host = Boolean(signal.host);
    this.hostToken = signal.hostToken || (this.host ? this.token : this.hostToken);
    if (!this.host && signal.state?.players) {
      this.room = {
        code: this.code,
        version: Number(signal.version) || 0,
        players: cloneValue(signal.state.players),
        rematchReady: new Set(),
      };
    }
    this._adoptRoomState(signal.state, signal.version);
    this._storeRoom();
    this._trackPresence();
    this._emit(signal);
  }

  _handleJoinRequest(signal) {
    if (!this.host || !this.room) return;

    const existing = this.room.players.find((player) => player.token === signal.from);
    if (existing) {
      this._sendJoinedRoom(existing, signal);
      return;
    }
    if (this.room.players.length >= 2) {
      this._sendError('That room is already full', 'room_full', signal);
      return;
    }

    const color = this.room.players[0]?.color === WHITE ? BLACK : WHITE;
    const player = {
      token: signal.from,
      color,
      nickname: cleanNickname(signal.payload?.nickname),
      connected: true,
    };
    this.room.players.push(player);
    this.seenTokens.add(player.token);
    this._saveHostSnapshot();

    const opponent = this.room.players.find((candidate) => candidate.token !== player.token);
    if (opponent) {
      this._send({
        code: this.code,
        from: this.token,
        to: opponent.token,
        type: 'opponent_joined',
        nickname: player.nickname,
        state: this._publicState(),
      });
    }
    this._sendJoinedRoom(player, signal);
  }

  _sendJoinedRoom(player, signal) {
    this._send({
      code: this.code,
      from: this.token,
      to: player.token,
      replyTo: signal.id,
      type: 'room_joined',
      ok: true,
      token: player.token,
      color: player.color,
      version: this.room.version,
      state: this._publicState(),
      host: false,
      hostToken: this.token,
    });
  }

  _handleResumeRequest(signal) {
    if (!this.host || !this.room) return;

    let player = this.room.players.find((candidate) => candidate.token === signal.from);
    if (!player) {
      if (this.room.players.length >= 2) {
        this._sendError('That room session has expired', 'session_expired', signal);
        return;
      }
      player = {
        token: signal.from,
        color: this.room.players[0]?.color === WHITE ? BLACK : WHITE,
        nickname: cleanNickname(signal.payload?.nickname),
        connected: true,
      };
      this.room.players.push(player);
    }
    player.connected = true;
    this.seenTokens.add(player.token);
    this._saveHostSnapshot();

    this._send({
      code: this.code,
      from: this.token,
      to: signal.from,
      replyTo: signal.id,
      type: 'room_resumed',
      ok: true,
      token: player.token,
      color: player.color,
      version: this.room.version,
      state: this._publicState(),
      host: Boolean(signal.payload?.host),
      hostToken: this.token,
    });
    this._sendEvent({
      type: 'room_state',
      version: this.room.version,
      state: this._publicState(),
    });
  }

  _handleStateRequest(signal) {
    if (!this.host || !this.room) return;
    this._send({
      code: this.code,
      from: this.token,
      to: signal.from,
      replyTo: signal.id,
      type: 'room_state',
      ok: true,
      version: this.room.version,
      state: this._publicState(),
    });
  }

  _handleLeaveRequest(signal) {
    if (!this.host || !this.room) return;
    const player = this.room.players.find((candidate) => candidate.token === signal.from);
    if (!player) return;
    const opponent = this.room.players.find((candidate) => candidate.token !== player.token);
    this._send({
      code: this.code,
      from: this.token,
      to: opponent?.token || undefined,
      type: 'room_closed',
      reason: `${player.nickname} left the room`,
    });
  }

  _applyMove(token, from, to, id = null, source = null) {
    if (!this.room || !this.host) return null;
    const player = this.room.players.find((candidate) => candidate.token === token);
    if (!player) {
      this._sendError('Join a room before moving', 'not_in_room', source);
      return null;
    }
    if (this.room.game.status !== 'playing') {
      this._sendError('The game is over', 'game_over', source);
      return null;
    }
    if (this.room.game.currentPlayer !== player.color) {
      this._sendError('It is not your turn', 'not_your_turn', source);
      return null;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from > 63 || to > 63) {
      this._sendError('Invalid move coordinates', 'invalid_move', source);
      return null;
    }

    const result = this.room.game.step(from, to);
    if (!result.ok) {
      this._sendError(result.reason || 'Illegal move', 'illegal_move', source);
      return null;
    }

    this.room.version += 1;
    this.room.rematchReady.clear();
    this._saveHostSnapshot();

    this._sendEvent({
      type: 'move_applied',
      ok: true,
      replyTo: id,
      version: this.room.version,
      by: player.color,
      from,
      to,
      capture: result.capture,
      promoted: result.promoted,
      pending: Boolean(result.pending),
      forcedFrom: this.room.game.forcedFrom,
      state: this._publicState(),
    });
    return result;
  }

  _handleOpponentJoined(signal) {
    if (signal.state) {
      this.latestState = cloneValue(signal.state);
      this.latestVersion = Number(signal.version) || this.latestVersion;
      if (this.room) {
        this.room.players = this.room.players.map((player) => {
          const update = signal.state.players?.find((candidate) => candidate.color === player.color);
          return update ? { ...player, ...update } : player;
        });
      }
      this._saveLocalSnapshot(signal);
    }
    this._emit(signal);
  }

  _handleMoveApplied(signal) {
    this._clearMoveTimer();
    if (!signal.state) return;
    this.latestVersion = Number(signal.version) || this.latestVersion;
    if (!this.host) restoreGame(this.game, signal.state);
    if (this.room && signal.state.players) {
      this.room.players = this.room.players.map((player) => {
        const update = signal.state.players.find((candidate) => candidate.color === player.color);
        return update ? { ...player, ...update } : player;
      });
    }
    this._adoptRoomState(signal.state, signal.version);
    this._emit(signal);
  }

  _handleStateEvent(signal) {
    if (signal.type === 'game_reset') this.room?.rematchReady?.clear();
    if (signal.state && this.room && signal.state.players) {
      this.room.players = this.room.players.map((player) => {
        const update = signal.state.players.find((candidate) => candidate.color === player.color);
        return update ? { ...player, ...update } : player;
      });
    }
    this._adoptRoomState(signal.state, signal.version);
    this._emit(signal);
  }

  _handleOpponentStatus(signal) {
    if (signal.state) {
      this.latestState = cloneValue(signal.state);
      if (this.room && signal.state.players) {
        this.room.players = this.room.players.map((player) => {
          const update = signal.state.players.find((candidate) => candidate.color === player.color);
          return update ? { ...player, ...update } : player;
        });
      }
      this._saveLocalSnapshot();
    }
    this._emit(signal);
  }

  _handleRematchStatus(signal) {
    if (Array.isArray(signal.ready) && this.room) {
      this.room.rematchReady = new Set(signal.ready);
    }
    this._emit(signal);
  }

  _handleRematchRequest(signal) {
    if (!this.host || !this.room) return;
    if (this.room.game.status === 'playing') {
      this._sendError('Finish the current game first', 'game_in_progress', signal);
      return;
    }
    if (this.room.players.length !== 2 || this.room.players.some((player) => !player.connected)) {
      this._sendError('Both players must be present for a rematch', 'opponent_missing', signal);
      return;
    }
    const player = this.room.players.find((candidate) => candidate.token === signal.from);
    if (!player) {
      this._sendError('Join a room first', 'not_in_room', signal);
      return;
    }

    this.room.rematchReady.add(player.color);
    const state = this._publicState();
    this._sendEvent({
      type: 'rematch_status',
      ready: [...this.room.rematchReady],
      state,
    });

    if (this.room.rematchReady.size >= 2) {
      this.room.game.reset();
      this.room.version += 1;
      this.room.rematchReady.clear();
      this._saveHostSnapshot();
      this._sendEvent({
        type: 'game_reset',
        version: this.room.version,
        state: this._publicState(),
      });
    }
  }

  _onPresenceSync() {
    if (!this.channel || !this.room) return;
    let activeTokens;
    try {
      activeTokens = new Set(Object.keys(this.channel.presenceState()));
    } catch {
      return;
    }

    let changed = false;
    this.room.players.forEach((player) => {
      const token = player.token
        || (player.color === this.color ? this.token : this.hostToken);
      if (!token) return;
      const connected = activeTokens.has(token) || (token === this.token && this.subscribed);
      if (activeTokens.has(token)) this.seenTokens.add(token);
      if (!this.seenTokens.has(token) && !connected) return;
      if (player.connected !== connected) {
        player.connected = connected;
        changed = true;
      }
    });

    if (!changed) return;
    const state = this.host ? this._publicState() : { ...(this.latestState || {}), players: cloneValue(this.room.players) };
    this.latestState = cloneValue(state);
    this._saveLocalSnapshot(state);
    if (this.host) this._sendEvent({ type: 'opponent_status', state });
  }

  _restoreRoomFromSnapshot(snapshot, takeOver = false) {
    this.host = true;
    this.hostToken = this.token;
    if (snapshot.color) this.color = snapshot.color;
    restoreGame(this.game, snapshot.state, snapshot.game);
    let sourcePlayers = (Array.isArray(snapshot.players) && snapshot.players.length
      ? snapshot.players
      : snapshot.state.players || []);
    if (takeOver) {
      sourcePlayers = sourcePlayers.filter((player) => player.color === this.color);
      if (!sourcePlayers.length) {
        sourcePlayers = [{ color: this.color, nickname: 'Player', connected: true }];
      }
    }
    this.room = {
      code: this.code,
      version: Number(snapshot.version) || 0,
      players: sourcePlayers.map((player) => ({
        ...player,
        token: player.token || (player.color === this.color ? this.token : this.hostToken),
        connected: player.color === this.color ? true : Boolean(player.connected),
      })),
      rematchReady: new Set(Array.isArray(snapshot.rematchReady) ? snapshot.rematchReady : []),
    };
    this.latestState = cloneValue(snapshot.state);
    this.latestVersion = Number(snapshot.version) || 0;
    this._saveHostSnapshot();
    this._storeRoom();
  }

  async _resumeStoredRoom() {
    const wasHost = this.host;
    const snapshot = loadStateSnapshot(this.code);
    if (this.host && snapshot) {
      this._restoreRoomFromSnapshot(snapshot);
      this._emit({
        type: 'room_resumed',
        ok: true,
        code: this.code,
        token: this.token,
        color: this.color,
        version: this.room.version,
        state: this._publicState(),
        host: true,
        hostToken: this.token,
      });
      return;
    }

    let response = null;
    try {
      response = await this._request('resume_request', {
        host: this.host,
        color: this.color,
        nickname: cleanNickname(this.latestState?.players?.find((player) => player.color === this.color)?.nickname),
      }, RESUME_TIMEOUT);
    } catch {
      // The host may be offline; fall back to the local snapshot below.
    }
    if (response) return;

    if (snapshot) {
      this._restoreRoomFromSnapshot(snapshot, !wasHost);
      this._emit({
        type: 'room_resumed',
        ok: true,
        code: this.code,
        token: this.token,
        color: this.color,
        version: this.room.version,
        state: this._publicState(),
        host: true,
        hostToken: this.token,
      });
      return;
    }

    throw new Error('That room session has expired');
  }

  _storeRoom() {
    if (!this.code || !this.token) return;
    try {
      localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify({
        code: this.code,
        token: this.token,
        color: this.color,
        host: Boolean(this.host),
        hostToken: this.hostToken,
      }));
    } catch {
      // Storage can be unavailable in private mode.
    }
  }

  createRoom(nickname = '', requestedCode = '') {
    if (this.inRoom) return Promise.reject(new Error('Leave your current room first'));

    this.code = normalizeRoomCode(requestedCode) || makeRoomCode();
    this.token = makeToken();
    this.color = WHITE;
    this.host = true;
    this.hostToken = this.token;
    this.shouldReconnect = true;
    this.room = {
      code: this.code,
      version: 0,
      players: [{
        token: this.token,
        color: WHITE,
        nickname: cleanNickname(nickname),
        connected: true,
      }],
      rematchReady: new Set(),
    };
    this.game = new CheckersGame();
    this.latestState = null;
    this.latestVersion = 0;
    this.seenTokens = new Set([this.token]);

    return this._subscribe().then(() => {
      const state = this._publicState();
      this.latestState = cloneValue(state);
      this._saveHostSnapshot();
      const message = {
        type: 'room_created',
        ok: true,
        code: this.code,
        token: this.token,
        color: this.color,
        version: 0,
        state,
        host: true,
        hostToken: this.token,
      };
      this._storeRoom();
      this._emit(message);
      return message;
    });
  }

  async joinRoom(code, nickname = '', rpcData = null) {
    if (this.inRoom) throw new Error('Leave your current room first');
    const clean = normalizeRoomCode(code);
    if (!clean) throw new Error('Enter a room code');

    this.code = clean;
    this.token = makeToken();
    this.color = null;
    this.host = false;
    this.hostToken = null;
    this.shouldReconnect = true;
    this.seenTokens = new Set([this.token]);

    await this._subscribe();
    return this._request('join_request', { nickname: cleanNickname(nickname) });
  }

  adoptRoom(message) {
    if (!message || !message.code || !message.token) return;
    this.code = String(message.code).toUpperCase();
    this.token = String(message.token);
    if (message.color) this.color = message.color;
    this.host = Boolean(message.host);
    this.hostToken = message.hostToken || (this.host ? this.token : this.hostToken);
    this.opponentConnected = false;
    this.opponentNickname = '';
    this._storeRoom();
  }

  clearRoom() {
    const code = this.code;
    this._clearChannel();
    this.code = null;
    this.token = null;
    this.color = null;
    this.host = false;
    this.hostToken = null;
    this.room = null;
    this.game = new CheckersGame();
    this.latestState = null;
    this.latestVersion = 0;
    this.opponentConnected = false;
    this.opponentNickname = '';
    this.queuedSignals = [];
    this.seenTokens = new Set();
    this._clearMoveTimer();
    if (code) removeStateSnapshot(code);
    try {
      localStorage.removeItem(ROOM_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private mode.
    }
  }

  _clearMoveTimer() {
    if (this.moveTimer) {
      window.clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }
    this.moveId = null;
  }

  sendMove(from, to) {
    if (!this.inRoom) return false;
    this._clearMoveTimer();
    const id = this.nextId;
    this.nextId += 1;
    this.moveId = id;
    this.moveTimer = window.setTimeout(() => {
      if (this.moveId !== id) return;
      this.moveId = null;
      this.moveTimer = null;
      this._emit({
        type: 'error',
        ok: false,
        code: 'move_timeout',
        message: 'Move was not confirmed — check your connection',
      });
    }, MOVE_TIMEOUT);

    if (this.host) {
      this._applyMove(this.token, from, to, id);
    } else {
      this._send({
        type: 'move_request',
        id,
        from: this.token,
        to: this.hostToken || undefined,
        payload: { from, to },
      });
    }
    return true;
  }

  requestState() {
    if (!this.inRoom) return false;
    if (this.host) {
      this._sendEvent({
        type: 'room_state',
        version: this.room?.version || 0,
        state: this._publicState(),
      });
      return true;
    }
    const id = this.nextId;
    this.nextId += 1;
    this._send({
      type: 'state_request',
      id,
      from: this.token,
      to: this.hostToken || undefined,
    });
    return true;
  }

  requestRematch() {
    if (!this.inRoom) return false;
    if (this.host) {
      this._handleRematchRequest({ from: this.token, id: this.nextId, payload: {} });
      this.nextId += 1;
      return true;
    }
    const id = this.nextId;
    this.nextId += 1;
    this._send({
      type: 'rematch_request',
      id,
      from: this.token,
      to: this.hostToken || undefined,
    });
    return true;
  }

  leaveRoom() {
    if (!this.inRoom) return;
    const wasHost = this.host;
    const opponent = wasHost
      ? this.room?.players.find((player) => player.token !== this.token)
      : null;
    if (wasHost) {
      this._send({
        type: 'room_closed',
        to: opponent?.token || undefined,
        reason: 'The room host left the room',
      });
    } else {
      this._send({
        type: 'leave_request',
        from: this.token,
        to: this.hostToken || undefined,
      });
    }
    this.clearRoom();
  }

  disconnect() {
    if (this.inRoom) this.leaveRoom();
    this._clearChannel();
    this._setStatus('offline');
  }
}
