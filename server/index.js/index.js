/**
 * Crown & Oak authoritative WebSocket game server.
 *
 * Clients never send board state. Every move arrives as a single click-level
 * step ({ from, to }) and is validated through the shared checkers engine on
 * this server before being broadcast to both seats.
 *
 * Run:
 *   cd server
 *   npm install
 *   npm start
 *
 * Environment:
 *   PORT=8787                 Listening port (or use the host's PORT injection).
 *   HOST=0.0.0.0              Listen address.
 *   ALLOWED_ORIGIN=...        Optional exact browser origin allowed to connect.
 */

import crypto from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { BLACK, CheckersGame, WHITE } from '../js/engine.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS = 15 * 60 * 1000;
const MAX_PAYLOAD = 8 * 1024;
const MAX_NICKNAME = 24;

/** @type {Map<string, any>} */
const rooms = new Map();

function send(socket, payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function fail(socket, message, code = 'bad_request') {
  send(socket, { type: 'error', ok: false, code, message });
}

function acknowledge(socket, message, payload = {}) {
  send(socket, { ...payload, type: message.type, id: message.id, ok: true });
}

function cleanNickname(value) {
  if (typeof value !== 'string') return 'Player';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NICKNAME) || 'Player';
}

function makeRoomCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not allocate a room code');
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function publicState(room) {
  const state = room.game.getState();
  return {
    board: state.board,
    counts: state.counts,
    currentPlayer: state.currentPlayer,
    status: state.status,
    winner: state.winner,
    winReason: state.winReason,
    forcedFrom: state.forcedFrom,
    turnNumber: state.turnNumber,
    historyLength: state.historyLength,
    lastMove: state.lastMove,
    noProgressTurns: state.noProgressTurns,
    players: room.players.map((player) => ({
      color: player.color,
      nickname: player.nickname,
      connected: Boolean(player.connected && player.socket),
    })),
  };
}

function roomStateMessage(room, type = 'room_state') {
  return {
    type,
    code: room.code,
    version: room.version,
    state: publicState(room),
  };
}

function broadcast(room, payload) {
  room.lastActivity = Date.now();
  room.players.forEach((player) => send(player.socket, payload));
}

function createPlayer(socket, color, nickname) {
  return {
    socket,
    color,
    nickname: cleanNickname(nickname),
    token: makeToken(),
    connected: true,
    room: null,
  };
}

function registerPlayer(room, player, socket) {
  room.players.push(player);
  player.room = room;
  socket.player = player;
  socket.room = room;
}

function contextFor(socket) {
  const player = socket.player;
  const room = socket.room || player?.room;
  if (!player || !room || player.room !== room) return null;
  return { player, room };
}

function authenticate(message) {
  if (typeof message.code !== 'string' || typeof message.token !== 'string') return null;
  const room = rooms.get(message.code.trim().toUpperCase());
  if (!room) return null;
  const player = room.players.find((candidate) => candidate.token === message.token);
  if (!player) return null;
  return { room, player };
}

function handleCreate(socket, message) {
  if (socket.player) {
    fail(socket, 'Leave your current room first', 'already_in_room');
    return;
  }

  const code = makeRoomCode();
  const room = {
    code,
    game: new CheckersGame(),
    version: 0,
    players: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    rematchReady: new Set(),
  };

  const player = createPlayer(socket, WHITE, message.nickname);
  registerPlayer(room, player, socket);
  rooms.set(code, room);

  send(socket, {
    type: 'room_created',
    ok: true,
    id: message.id,
    code,
    token: player.token,
    color: player.color,
    version: room.version,
    state: publicState(room),
  });
}

function handleJoin(socket, message) {
  if (socket.player) {
    fail(socket, 'Leave your current room first', 'already_in_room');
    return;
  }

  const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : '';
  const room = rooms.get(code);
  if (!room) {
    fail(socket, 'That room code was not found', 'room_not_found');
    return;
  }
  if (room.players.length >= 2) {
    fail(socket, 'That room is already full', 'room_full');
    return;
  }

  const color = room.players[0].color === WHITE ? BLACK : WHITE;
  const player = createPlayer(socket, color, message.nickname);
  registerPlayer(room, player, socket);

  acknowledge(socket, message, {
    type: 'room_joined',
    code,
    token: player.token,
    color: player.color,
    version: room.version,
    state: publicState(room),
  });

  broadcast(room, {
    type: 'opponent_joined',
    nickname: player.nickname,
    state: publicState(room),
  });
}

function handleResume(socket, message) {
  if (socket.player) {
    fail(socket, 'Already attached to a room', 'already_in_room');
    return;
  }

  const found = authenticate(message);
  if (!found) {
    fail(socket, 'That room session has expired', 'session_expired');
    return;
  }

  const { room, player } = found;
  if (player.socket && player.socket !== socket) {
    try {
      player.socket.close(4001, 'Session resumed elsewhere');
    } catch {
      // Ignore sockets that are already closing.
    }
  }

  player.socket = socket;
  player.connected = true;
  registerPlayer(room, player, socket);
  room.lastActivity = Date.now();

  send(socket, {
    type: 'room_resumed',
    ok: true,
    id: message.id,
    code: room.code,
    token: player.token,
    color: player.color,
    version: room.version,
    state: publicState(room),
  });

  broadcast(room, roomStateMessage(room));
}

function handleMove(socket, message) {
  const context = contextFor(socket);
  if (!context) {
    fail(socket, 'Join a room before moving', 'not_in_room');
    return;
  }
  const { room, player } = context;

  if (typeof message.code === 'string' && message.code.trim().toUpperCase() !== room.code) {
    fail(socket, 'Room code mismatch', 'room_mismatch');
    return;
  }
  if (typeof message.token === 'string' && message.token !== player.token) {
    fail(socket, 'Session token mismatch', 'token_mismatch');
    return;
  }
  if (room.game.status !== 'playing') {
    fail(socket, 'The game is over', 'game_over');
    return;
  }
  if (room.game.currentPlayer !== player.color) {
    fail(socket, 'It is not your turn', 'not_your_turn');
    return;
  }
  if (!Number.isInteger(message.from) || !Number.isInteger(message.to)
    || message.from < 0 || message.from > 63 || message.to < 0 || message.to > 63) {
    fail(socket, 'Invalid move coordinates', 'invalid_move');
    return;
  }

  const result = room.game.step(message.from, message.to);
  if (!result.ok) {
    fail(socket, result.reason || 'Illegal move', 'illegal_move');
    return;
  }

  room.version += 1;
  room.rematchReady.clear();

  broadcast(room, {
    type: 'move_applied',
    version: room.version,
    by: player.color,
    from: message.from,
    to: message.to,
    capture: result.capture,
    promoted: result.promoted,
    pending: Boolean(result.pending),
    forcedFrom: room.game.forcedFrom,
    state: publicState(room),
  });
}

function resetRoom(room) {
  room.game.reset();
  room.version += 1;
  room.rematchReady.clear();
  room.lastActivity = Date.now();
  broadcast(room, roomStateMessage(room, 'game_reset'));
}

function handleRematch(socket, message) {
  const context = contextFor(socket);
  if (!context) {
    fail(socket, 'Join a room first', 'not_in_room');
    return;
  }
  const { room, player } = context;

  if (room.game.status === 'playing') {
    fail(socket, 'Finish the current game first', 'game_in_progress');
    return;
  }
  if (room.players.length !== 2 || room.players.some((candidate) => !candidate.connected)) {
    fail(socket, 'Both players must be present for a rematch', 'opponent_missing');
    return;
  }

  room.rematchReady.add(player.color);
  broadcast(room, {
    type: 'rematch_status',
    ready: [...room.rematchReady],
    state: publicState(room),
  });

  if (room.rematchReady.size >= 2) resetRoom(room);
}

function handleLeave(socket, message) {
  const context = contextFor(socket);
  if (!context) return;
  const { room, player } = context;

  rooms.delete(room.code);
  room.players.forEach((candidate) => {
    if (candidate !== player) {
      send(candidate.socket, {
        type: 'room_closed',
        reason: `${player.nickname} left the room`,
      });
      candidate.socket.player = null;
      candidate.socket.room = null;
      candidate.room = null;
    }
  });

  socket.player = null;
  socket.room = null;
  player.room = null;
  player.connected = false;
  player.socket = null;
}

function handleStateRequest(socket, message) {
  const context = contextFor(socket);
  if (!context) {
    fail(socket, 'Join a room first', 'not_in_room');
    return;
  }
  acknowledge(socket, message, {
    type: 'room_state',
    code: context.room.code,
    version: context.room.version,
    state: publicState(context.room),
  });
}

function handleMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    fail(socket, 'Malformed message', 'invalid_json');
    return;
  }
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
    fail(socket, 'Malformed message', 'invalid_message');
    return;
  }

  switch (message.type) {
    case 'create_room': handleCreate(socket, message); break;
    case 'join_room': handleJoin(socket, message); break;
    case 'resume': handleResume(socket, message); break;
    case 'move': handleMove(socket, message); break;
    case 'rematch': handleRematch(socket, message); break;
    case 'request_state': handleStateRequest(socket, message); break;
    case 'leave_room': handleLeave(socket, message); break;
    case 'ping': send(socket, { type: 'pong', id: message.id }); break;
    default: fail(socket, `Unknown message type: ${message.type}`, 'unknown_type');
  }
}

function handleDisconnect(socket) {
  const context = contextFor(socket);
  if (!context) return;
  const { room, player } = context;

  if (player.socket !== socket) return;
  player.connected = false;
  player.socket = null;
  room.lastActivity = Date.now();

  room.players.forEach((candidate) => {
    if (candidate !== player) {
      send(candidate.socket, {
        type: 'opponent_status',
        color: player.color,
        connected: false,
        state: publicState(room),
      });
    }
  });
}

const verifyClient = ALLOWED_ORIGIN
  ? ({ origin }, callback) => {
      if (!origin || origin === ALLOWED_ORIGIN) callback(true);
      else callback(false, 403, 'Forbidden origin');
    }
  : undefined;

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: MAX_PAYLOAD,
  ...(verifyClient ? { verifyClient } : {}),
});

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', (raw) => {
    if (raw.length > MAX_PAYLOAD) {
      fail(socket, 'Message too large', 'too_large');
      socket.close(1009, 'Message too large');
      return;
    }
    try {
      handleMessage(socket, raw.toString());
    } catch (error) {
      console.error('Message handler failed:', error);
      fail(socket, 'Internal server error', 'internal_error');
    }
  });
  socket.on('close', () => handleDisconnect(socket));
  socket.on('error', (error) => console.error('Socket error:', error.message));
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (!socket.isAlive) {
      socket.terminate();
      return;
    }
    socket.isAlive = false;
    socket.ping();
  });
}, 30_000);
heartbeat.unref?.();

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyoneConnected = room.players.some((player) => player.connected && player.socket);
    if (!anyoneConnected && now - room.lastActivity > ROOM_IDLE_MS) rooms.delete(code);
  }
}, 60_000);
cleanup.unref?.();

console.log(`Crown & Oak game server listening on ws://${HOST}:${PORT}`);

function shutdown() {
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
