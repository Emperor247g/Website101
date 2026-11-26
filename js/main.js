import './script.js';
import {
  BLACK,
  CheckersGame,
  WHITE,
  squareName,
} from './engine.js';
import { cancelAiRequests, requestAiHint, requestAiMove } from './ai-client.js';
import { difficultyLabel } from './ai.js';
import { CheckersScene } from './render/CheckersScene.js';
import { SoundManager } from './audio.js';
import { NetClient } from './net.js';

const SETTINGS_KEY = 'crown-and-oak-settings-v1';
const ONLINE_PREFS_KEY = 'crown-and-oak-online-prefs-v1';
const HUMAN = WHITE;
const AI_COLOR = BLACK;

const DIFFICULTY_NOTES = {
  easy: 'Relaxed, unpredictable play. A good place to learn the board.',
  medium: 'Careful captures and a sound positional instinct.',
  hard: 'Deep search, forced captures and positional judgement.',
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const ONLINE_SERVER_HINT = $('#onlineServerHint')?.textContent || '';

function getSupabaseConfig() {
  const buildConfig = typeof __SUPABASE_CONFIG__ !== 'undefined' ? __SUPABASE_CONFIG__ : null;
  if (buildConfig && typeof buildConfig === 'object' && buildConfig.url && buildConfig.anonKey) {
    return buildConfig;
  }
  // The standalone build gets its public config from js/script.js at runtime.
  const runtimeConfig = globalThis.__CROWN_OAK_SUPABASE_CONFIG__;
  return runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {};
}

function supabaseConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.anonKey);
}

async function createNetClient(options) {
  if (supabaseConfigured()) {
    const { SupabaseNetClient } = await import('./supabase-net.js');
    return new SupabaseNetClient({ ...options, config: getSupabaseConfig() });
  }
  return new NetClient(options);
}

function configureOnlineUI() {
  const serverField = $('#onlineServer');
  const serverLabel = document.querySelector('label[for="onlineServer"]');
  const hint = $('#onlineServerHint');

  if (supabaseConfigured()) {
    if (serverField) serverField.hidden = true;
    if (serverLabel) serverLabel.hidden = true;
    if (els.onlineConnect) els.onlineConnect.hidden = true;
    if (hint) hint.textContent = 'Online rooms use Supabase Realtime — no server URL is needed.';
    if (els.onlineNote) {
      els.onlineNote.textContent = 'Moves are validated by the room host. Undo and pause are not available in online matches.';
    }
  } else {
    if (serverField) serverField.hidden = false;
    if (serverLabel) serverLabel.hidden = false;
    if (els.onlineConnect) els.onlineConnect.hidden = false;
    if (hint) hint.textContent = ONLINE_SERVER_HINT;
  }
}

function loadSettings() {
  const fallback = { mode: 'ai', difficulty: 'hard', sound: true };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return fallback;
    return {
      mode: ['ai', 'pvp', 'online'].includes(stored.mode) ? stored.mode : 'ai',
      difficulty: ['easy', 'medium', 'hard'].includes(stored.difficulty) ? stored.difficulty : 'hard',
      sound: stored.sound !== false,
    };
  } catch {
    return fallback;
  }
}

function loadOnlinePrefs() {
  const fallback = { server: '', nickname: '' };
  try {
    const stored = JSON.parse(localStorage.getItem(ONLINE_PREFS_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return fallback;
    return {
      server: typeof stored.server === 'string' ? stored.server : '',
      nickname: typeof stored.nickname === 'string' ? stored.nickname : '',
    };
  } catch {
    return fallback;
  }
}

function saveOnlinePrefs(patch = {}) {
  try {
    const next = { ...loadOnlinePrefs(), ...patch };
    localStorage.setItem(ONLINE_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private browsing or file mode.
  }
}

function defaultServerUrl() {
  if (typeof location === 'undefined') return '';
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.hostname || 'localhost';
  return `${scheme}://${host}:8787`;
}

function normalizeServerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    else if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function formatRoomCode(code) {
  return String(code || '').toUpperCase();
}

const settings = loadSettings();
const onlinePrefs = loadOnlinePrefs();

const ui = {
  mode: settings.mode,
  difficulty: settings.difficulty,
  selected: null,
  destinations: [],
  busy: false,
  thinking: false,
  hintThinking: false,
  paused: false,
  menuOpen: false,
  dialogOpen: false,
  gameOverShown: false,
  net: null,
  netStatus: 'offline',
  netVersion: 0,
  netConnecting: false,
  pendingMove: null,
  rematchRequested: false,
  aiToken: 0,
  actionToken: 0,
  gameOverTimer: null,
  pointerStart: null,
  hoverPointer: null,
  hoverFrame: 0,
  toastTimer: null,
};

let game;
let scene;
let sound;

const els = {
  loading: $('#loadingScreen'),
  loadingCopy: $('.loading-copy'),
  canvas: $('#scene'),
  statusDock: $('.status-dock'),
  difficultyLabel: $('#difficultyLabel'),
  whiteCount: $('#whiteCount'),
  blackCount: $('#blackCount'),
  turnDot: $('#turnDot'),
  statusText: $('#statusText'),
  statusInstruction: $('#statusInstruction'),
  btnMenu: $('#btnMenu'),
  btnRestart: $('#btnRestart'),
  btnPause: $('#btnPause'),
  btnUndo: $('#btnUndo'),
  btnInfo: $('#btnInfo'),
  btnHint: $('#btnHint'),
  menuOverlay: $('#menuOverlay'),
  menuClose: $('#menuClose'),
  menuNewGame: $('#menuNewGame'),
  menuReturn: $('#menuReturn'),
  menuInstructions: $('#menuInstructions'),
  menuDifficultyValue: $('#menuDifficultyValue'),
  difficultyNote: $('#difficultyNote'),
  difficultySection: $('#difficultySection'),
  soundToggle: $('#soundToggle'),
  infoOverlay: $('#infoOverlay'),
  instructionsOverlay: $('#instructionsOverlay'),
  pauseOverlay: $('#pauseOverlay'),
  gameOverOverlay: $('#gameOverOverlay'),
  resumeButton: $('#resumeButton'),
  pauseRestart: $('#pauseRestart'),
  playAgainButton: $('#playAgainButton'),
  reviewButton: $('#reviewButton'),
  gameOverTitle: $('#gameOverTitle'),
  gameOverEyebrow: $('#gameOverEyebrow'),
  gameOverMessage: $('#gameOverMessage'),
  gameOverCrown: $('#gameOverCrown'),
  gameOverWhite: $('#gameOverWhite'),
  gameOverBlack: $('#gameOverBlack'),
  gameOverTurns: $('#gameOverTurns'),
  infoMode: $('#infoMode'),
  infoDifficulty: $('#infoDifficulty'),
  infoTurn: $('#infoTurn'),
  infoPieces: $('#infoPieces'),
  toastRegion: $('#toastRegion'),
  modeCards: $$('.mode-card'),
  difficultyButtons: $$('[data-difficulty]'),
  onlineSection: $('#onlineSection'),
  onlineServer: $('#onlineServer'),
  onlineNickname: $('#onlineNickname'),
  onlineCreate: $('#onlineCreate'),
  onlineConnect: $('#onlineConnect'),
  onlineCode: $('#onlineCode'),
  onlineJoin: $('#onlineJoin'),
  onlineRoom: $('#onlineRoom'),
  onlineRoomCode: $('#onlineRoomCode'),
  onlineColor: $('#onlineColor'),
  onlineOpponent: $('#onlineOpponent'),
  onlineCopy: $('#onlineCopy'),
  onlineRematch: $('#onlineRematch'),
  onlineLeave: $('#onlineLeave'),
  onlineStatusValue: $('#onlineStatusValue'),
  onlineNote: $('#onlineNote'),
};

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      mode: ui.mode,
      difficulty: ui.difficulty,
      sound: sound ? sound.enabled : settings.sound,
    }));
  } catch {
    // Storage can be unavailable in private browsing or file mode.
  }
}

function isAiTurn() {
  return ui.mode === 'ai' && game.currentPlayer === AI_COLOR;
}

function isHumanTurn() {
  if (ui.mode === 'online') {
    return Boolean(
      ui.net?.color
      && ui.net.code
      && game.currentPlayer === ui.net.color
      && ui.net.opponentConnected !== false,
    );
  }
  return ui.mode === 'pvp' || game.currentPlayer === HUMAN;
}

function isBlocked() {
  return ui.busy || ui.thinking || ui.hintThinking || ui.paused || ui.menuOpen || ui.dialogOpen || ui.netConnecting;
}

function canInteract() {
  return game && game.status === 'playing' && isHumanTurn() && !isBlocked();
}

function getOptionsFor(index) {
  if (index === null || index === undefined) return [];
  const seen = new Map();
  for (const move of game.getLegalMoves()) {
    if (move.from !== index) continue;
    const segment = move.segments[0];
    if (!seen.has(segment.to)) {
      seen.set(segment.to, {
        index: segment.to,
        capture: segment.capture !== null,
      });
    }
  }
  return [...seen.values()];
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

function updateNetPlayers(players) {
  if (!ui.net || !Array.isArray(players)) return;
  const me = players.find((player) => player.color === ui.net.color);
  const opponent = players.find((player) => player.color !== ui.net.color);
  if (me) ui.net.myConnected = Boolean(me.connected);
  if (opponent) {
    ui.net.opponentConnected = Boolean(opponent.connected);
    ui.net.opponentNickname = opponent.nickname || '';
  } else {
    ui.net.opponentConnected = false;
    ui.net.opponentNickname = '';
  }
}

function updateOnlineUI() {
  if (!els.onlineServer) return;
  if (document.activeElement !== els.onlineServer) {
    const current = normalizeServerUrl(els.onlineServer.value);
    if (!current && ui.net?.url) els.onlineServer.value = ui.net.url;
  }
  if (!els.onlineNickname.value && onlinePrefs.nickname) els.onlineNickname.value = onlinePrefs.nickname;

  const statusLabels = {
    offline: 'Offline',
    connecting: 'Connecting…',
    connected: ui.net?.code ? 'Room active' : 'Connected',
    reconnecting: 'Reconnecting…',
    error: 'Connection failed',
  };
  els.onlineStatusValue.textContent = statusLabels[ui.netStatus] || ui.netStatus;
  els.onlineSection.classList.toggle('is-online', ui.mode === 'online');

  const inRoom = Boolean(ui.net?.code);
  els.onlineRoom.hidden = !inRoom;
  if (inRoom) {
    els.onlineRoomCode.textContent = formatRoomCode(ui.net.code);
    els.onlineColor.textContent = ui.net.color === BLACK ? 'Black' : 'White';
    if (ui.net.opponentConnected === false) {
      els.onlineOpponent.textContent = ui.net.myConnected ? 'Opponent disconnected' : 'Waiting to reconnect…';
    } else if (ui.net.opponentNickname) {
      els.onlineOpponent.textContent = `Playing ${ui.net.opponentNickname}`;
    } else {
      els.onlineOpponent.textContent = 'Waiting for opponent…';
    }
  }

  const canUseRoom = inRoom && ui.net.connected;
  els.onlineCopy.disabled = !canUseRoom;
  els.onlineRematch.disabled = !canUseRoom || game?.status === 'playing';
  els.onlineLeave.disabled = !inRoom;
  els.onlineCreate.disabled = ui.netConnecting;
  els.onlineJoin.disabled = ui.netConnecting || !els.onlineCode.value.trim();

  if (ui.mode !== 'online') {
    els.onlineNote.textContent = 'Choose Play Online to create or join a validated two-player match.';
  } else if (supabaseConfigured()) {
    els.onlineNote.textContent = inRoom
      ? 'Moves are validated by the room host. Undo and pause are not available online.'
      : 'Create a room and invite a friend, or enter their room code.';
  } else if (!ui.net?.url) {
    els.onlineNote.textContent = 'Enter the WebSocket server URL, then create or join a room.';
  } else if (!inRoom) {
    els.onlineNote.textContent = 'Create a room and invite a friend, or enter their room code.';
  } else {
    els.onlineNote.textContent = 'Moves are validated by the server. Undo and pause are not available online.';
  }
}

function updateUI() {
  if (!game) return;
  const counts = game.counts;
  els.whiteCount.textContent = String(counts.white);
  els.blackCount.textContent = String(counts.black);

  if (ui.mode === 'ai') {
    els.difficultyLabel.textContent = `${ui.difficulty.toUpperCase()} LEVEL`;
  } else if (ui.mode === 'online') {
    els.difficultyLabel.textContent = ui.net?.code
      ? `ONLINE · ${formatRoomCode(ui.net.code)}`
      : 'ONLINE';
  } else {
    els.difficultyLabel.textContent = 'TWO PLAYER';
  }

  let statusText = '';
  let instruction = '';
  const playerName = game.currentPlayer === WHITE ? 'White' : 'Black';

  if (ui.mode === 'online') {
    if (ui.netStatus === 'connecting' || ui.netStatus === 'reconnecting' || ui.netConnecting) {
      statusText = ui.netStatus === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
      instruction = 'Reaching the game server';
    } else if (!ui.net?.code) {
      statusText = 'Online match';
      instruction = 'Open the menu to create or join a room';
    } else if (game.status === 'won') {
      statusText = game.winner === ui.net.color ? 'You win' : 'Opponent wins';
      instruction = game.winReason;
    } else if (game.status === 'draw') {
      statusText = 'Draw';
      instruction = game.winReason;
    } else if (ui.net.opponentConnected === false) {
      statusText = 'Opponent disconnected';
      instruction = 'Waiting for them to return';
    } else if (ui.busy) {
      statusText = game.currentPlayer === ui.net.color ? 'Sending your move' : 'Opponent is moving';
      instruction = 'A moment';
    } else if (game.forcedFrom !== null) {
      statusText = 'Continue capture';
      instruction = 'Same piece, another jump';
    } else if (game.currentPlayer === ui.net.color) {
      statusText = 'Your turn';
      const captureAvailable = game.getLegalMoves().some((move) => move.captureCount > 0);
      if (ui.selected !== null) {
        instruction = ui.destinations.some((destination) => destination.capture)
          ? 'Captures are compulsory — choose a jump'
          : 'Choose a destination';
      } else {
        instruction = captureAvailable ? 'Captures are compulsory' : 'Select a piece to begin';
      }
    } else {
      statusText = "Opponent's turn";
      instruction = 'Waiting for their move';
    }
  } else if (ui.paused) {
    statusText = 'Game paused';
    instruction = 'Resume when ready';
  } else if (game.status === 'won') {
    if (ui.mode === 'ai') {
      statusText = game.winner === AI_COLOR ? 'Computer wins' : 'You win';
    } else {
      statusText = `${capitalize(game.winner)} wins`;
    }
    instruction = game.winReason;
  } else if (game.status === 'draw') {
    statusText = 'Draw';
    instruction = game.winReason;
  } else if (ui.thinking) {
    statusText = 'Computer thinking';
    instruction = 'The house is considering its move';
  } else if (ui.hintThinking) {
    statusText = 'Reading the board';
    instruction = 'Preparing a suggestion';
  } else if (ui.busy) {
    statusText = `${playerName} is moving`;
    instruction = 'A moment';
  } else if (game.forcedFrom !== null) {
    statusText = 'Continue capture';
    instruction = 'Same piece, another jump';
  } else if (isAiTurn()) {
    statusText = 'Computer turn';
    instruction = 'Preparing to move';
  } else if (ui.mode === 'ai') {
    statusText = 'Your turn';
    const captureAvailable = game.getLegalMoves().some((move) => move.captureCount > 0);
    if (ui.selected !== null) {
      instruction = ui.destinations.some((destination) => destination.capture)
        ? 'Captures are compulsory — choose a jump'
        : 'Choose a destination';
    } else {
      instruction = captureAvailable ? 'Captures are compulsory' : 'Select a piece to begin';
    }
  } else {
    statusText = `${playerName}'s turn`;
    if (ui.selected !== null) {
      instruction = ui.destinations.some((destination) => destination.capture)
        ? 'Choose a jump'
        : 'Choose a destination';
    } else {
      instruction = 'Select a piece to begin';
    }
  }

  els.statusText.textContent = statusText;
  els.statusInstruction.textContent = instruction;
  els.statusDock.classList.toggle('is-thinking', ui.thinking || ui.busy);

  els.turnDot.className = 'turn-dot';
  const dotColor = game.status === 'won' && game.winner ? game.winner : game.currentPlayer;
  if (game.status === 'draw' || (ui.mode === 'ai' && game.status === 'won' && game.winner === AI_COLOR)) {
    els.turnDot.classList.add('turn-dot--gold');
  } else if (dotColor === BLACK) {
    els.turnDot.classList.add('turn-dot--black');
  }

  const online = ui.mode === 'online';
  els.btnUndo.disabled = online || game.history.length === 0 || ui.busy || game.forcedFrom !== null;
  els.btnHint.disabled = online || game.status !== 'playing' || !isHumanTurn() || isBlocked();
  els.btnPause.disabled = online || game.status !== 'playing' || ui.busy || ui.thinking || ui.hintThinking;
  els.btnPause.classList.toggle('is-active', ui.paused);
  els.btnMenu.classList.toggle('is-active', ui.menuOpen);
  els.playAgainButton.textContent = online && ui.rematchRequested ? 'Rematch requested' : 'Play Again';

  els.modeCards.forEach((card) => {
    const active = card.dataset.mode === ui.mode;
    card.classList.toggle('is-active', active);
    card.setAttribute('aria-pressed', String(active));
  });
  els.difficultyButtons.forEach((button) => {
    const active = button.dataset.difficulty === ui.difficulty;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  els.menuDifficultyValue.textContent = difficultyLabel(ui.difficulty);
  els.difficultyNote.textContent = DIFFICULTY_NOTES[ui.difficulty];
  els.difficultySection.classList.toggle('is-muted', ui.mode !== 'ai');
  els.soundToggle.classList.toggle('is-on', Boolean(sound?.enabled));
  els.soundToggle.setAttribute('aria-checked', String(Boolean(sound?.enabled)));
  document.body.classList.toggle('sound-off', !sound?.enabled);

  els.infoMode.textContent = ui.mode === 'ai' ? 'Play Against Computer'
    : ui.mode === 'online' ? 'Play Online' : 'Two Player Mode';
  els.infoDifficulty.textContent = ui.mode === 'ai' ? difficultyLabel(ui.difficulty)
    : ui.mode === 'online' ? (ui.net?.code ? `Room ${formatRoomCode(ui.net.code)}` : 'No room') : 'Shared table';
  els.infoTurn.textContent = game.status === 'won'
    ? `${capitalize(game.winner)} won`
    : game.status === 'draw'
      ? 'Draw'
      : playerName;
  els.infoPieces.textContent = `${counts.white} — ${counts.black}`;

  if (scene) {
    scene.setSelectable(game.status === 'playing' && isHumanTurn() ? game.getSelectablePieces() : []);
  }
  updateOnlineUI();
}

function clearHint() {
  if (scene) scene.setHint(null);
}

function clearSelection({ keepLift = false } = {}) {
  ui.selected = null;
  ui.destinations = [];
  if (scene) {
    if (!keepLift) scene.clearSelection();
    scene.setDestinations([]);
    scene.setHover(null);
  }
}

function selectPiece(index) {
  if (!canInteract()) return;
  if (game.forcedFrom !== null && index !== game.forcedFrom) {
    sound.invalid();
    toast('Complete the capture with the same piece');
    return;
  }
  if (!game.canSelect(index)) {
    const hasCaptures = game.getLegalMoves().some((move) => move.captureCount > 0);
    sound.invalid();
    toast(hasCaptures ? 'Captures are compulsory — choose a highlighted piece' : 'That piece cannot move');
    return;
  }

  clearHint();
  ui.selected = index;
  ui.destinations = getOptionsFor(index);
  scene.setSelection(index);
  scene.setDestinations(ui.destinations);
  sound.select();
  updateUI();
}

function deselectPiece() {
  if (game.forcedFrom !== null) return;
  clearSelection();
  updateUI();
}

function handlePieceClick(index) {
  if (ui.selected === index && game.forcedFrom === null) {
    deselectPiece();
    return;
  }
  selectPiece(index);
}

function handleSquareClick(index) {
  if (game.forcedFrom !== null && ui.selected === null) {
    ui.selected = game.forcedFrom;
    ui.destinations = getOptionsFor(game.forcedFrom);
    scene.setSelection(game.forcedFrom);
    scene.setDestinations(ui.destinations);
    updateUI();
    return;
  }

  if (ui.selected === null) return;

  const destination = ui.destinations.find((entry) => entry.index === index);
  if (destination) {
    performStep(ui.selected, index);
    return;
  }

  if (game.forcedFrom !== null) {
    sound.invalid();
    toast('This piece must finish its capture sequence');
    return;
  }

  const piece = game.board[index];
  if (piece && game.canSelect(index)) {
    selectPiece(index);
    return;
  }

  clearSelection();
  updateUI();
}

function handleBoardTap(clientX, clientY) {
  if (!canInteract()) return;
  const hit = scene.pick(clientX, clientY);
  if (!hit) return;
  if (hit.type === 'piece') handlePieceClick(hit.index);
  else handleSquareClick(hit.index);
}

function applyHover(pointer) {
  if (!canInteract() || pointer.pointerType === 'touch') {
    clearHover();
    return;
  }
  const hit = scene.pick(pointer.clientX, pointer.clientY);
  if (!hit) {
    clearHover();
    return;
  }
  if (hit.type === 'piece') {
    const selectable = game.canSelect(hit.index) && (game.forcedFrom === null || game.forcedFrom === hit.index);
    els.canvas.style.cursor = selectable ? 'pointer' : 'default';
    scene.setHover(selectable ? hit.index : null);
  } else {
    const destination = ui.destinations.some((entry) => entry.index === hit.index);
    els.canvas.style.cursor = destination ? 'pointer' : 'default';
    scene.setHover(destination ? hit.index : null);
  }
}

function clearHover() {
  els.canvas.style.cursor = 'default';
  scene.setHover(null);
}

function queueHover(pointer) {
  ui.hoverPointer = pointer;
  if (ui.hoverFrame) return;
  ui.hoverFrame = window.requestAnimationFrame(() => {
    ui.hoverFrame = 0;
    const latest = ui.hoverPointer;
    ui.hoverPointer = null;
    if (latest) applyHover(latest);
  });
}

function cancelHover() {
  ui.hoverPointer = null;
  if (ui.hoverFrame) window.cancelAnimationFrame(ui.hoverFrame);
  ui.hoverFrame = 0;
}

/* ----------------------------- Online play ----------------------------- */

function applyAuthoritativeState(state, version) {
  if (!state || !Array.isArray(state.board) || state.board.length !== 64) return;

  ui.actionToken += 1;
  clearTimeout(ui.gameOverTimer);
  game.reset();
  game.board = state.board.slice();
  game.currentPlayer = state.currentPlayer;
  game.status = state.status || 'playing';
  game.winner = state.winner ?? null;
  game.winReason = state.winReason || '';
  game.forcedFrom = state.forcedFrom ?? null;
  game.turnNumber = state.turnNumber || 1;
  game.noProgressTurns = state.noProgressTurns || 0;
  game.lastMove = cloneLastMove(state.lastMove);
  game.history = new Array(Math.max(0, state.historyLength || 0)).fill(null);
  game.repetitions = {};

  ui.netVersion = Number.isFinite(Number(version)) ? Number(version) : 0;
  ui.busy = false;
  ui.pendingMove = null;
  ui.thinking = false;
  ui.hintThinking = false;
  ui.gameOverShown = false;
  ui.rematchRequested = false;

  clearHint();
  clearSelection();
  hideGameOver();
  scene.cancelAnimations();
  scene.syncBoard(game.board);
  scene.setLastMove(game.lastMove);
  scene.setHint(null);
  updateNetPlayers(state.players);
  updateUI();

  if (game.status !== 'playing') handleGameOver();
}

function applyOnlineStep(message) {
  const version = Number(message.version);
  if (!Number.isFinite(version)) return;
  if (version <= ui.netVersion) return;
  if (version !== ui.netVersion + 1) {
    ui.net?.requestState();
    return;
  }
  if (!Number.isInteger(message.from) || !Number.isInteger(message.to)) {
    ui.net?.requestState();
    return;
  }

  // The server has already validated this step. Apply it and restore input
  // immediately; the animation is purely visual and must never block play
  // (browsers throttle animation frames in background tabs).
  const token = ++ui.actionToken;
  clearHint();
  clearSelection();

  const result = game.step(message.from, message.to);
  if (!result.ok) {
    ui.busy = false;
    ui.net?.requestState();
    updateUI();
    return;
  }

  ui.netVersion = version;
  ui.busy = false;
  if (message.by === ui.net?.color) ui.pendingMove = null;
  if (message.state) updateNetPlayers(message.state.players);
  scene.setLastMove(game.lastMove);

  if (result.capture !== null) sound.capture();
  else sound.move();
  if (result.promoted) {
    window.setTimeout(() => {
      if (ui.actionToken === token) sound.promote();
    }, 340);
  }

  if (result.pending) {
    ui.selected = message.to;
    ui.destinations = getOptionsFor(message.to);
    scene.setSelection(message.to);
    scene.setDestinations(ui.destinations);
    toast('Capture continues — jump again', { gold: true });
  } else {
    clearSelection();
  }

  updateUI();
  if (game.status !== 'playing') handleGameOver();

  scene.animateStep({
    from: message.from,
    to: message.to,
    capture: result.capture,
    promoted: result.promoted,
  }).then(() => {
    if (token === ui.actionToken) scene.setLastMove(game.lastMove);
  }).catch(() => {});
}

function handleRoomClosed(reason) {
  ui.net?.clearRoom();
  ui.netVersion = 0;
  ui.rematchRequested = false;
  ui.netStatus = ui.net?.connected ? 'connected' : 'offline';
  resetGame({ announce: false, closeOverlays: false });
  toast(reason || 'The room was closed');
  updateUI();
}

function handleOnlineEvent(message) {
  switch (message.type) {
    case 'room_created':
    case 'room_joined':
    case 'room_resumed': {
      ui.net?.adoptRoom(message);
      ui.netConnecting = false;
      ui.netStatus = 'connected';
      ui.rematchRequested = false;
      applyAuthoritativeState(message.state, message.version);
      if (message.type === 'room_created') {
        toast(`Room ${formatRoomCode(message.code)} created — invite a friend`, { gold: true });
      } else if (message.type === 'room_joined') {
        toast(`Joined room ${formatRoomCode(message.code)}`, { gold: true });
      } else {
        toast('Reconnected to your match', { gold: true });
      }
      break;
    }
    case 'room_state': {
      if (message.code && ui.net?.code && message.code !== ui.net.code) break;
      updateNetPlayers(message.state?.players);
      if (Number(message.version) !== ui.netVersion) {
        applyAuthoritativeState(message.state, message.version);
      } else {
        updateUI();
      }
      break;
    }
    case 'move_applied':
      applyOnlineStep(message);
      break;
    case 'game_reset':
      applyAuthoritativeState(message.state, message.version);
      hideGameOver();
      updateUI();
      toast('A new game has begun', { gold: true });
      break;
    case 'opponent_status':
      if (message.state?.players) updateNetPlayers(message.state.players);
      else if (ui.net && message.color !== ui.net.color) ui.net.opponentConnected = Boolean(message.connected);
      updateUI();
      break;
    case 'opponent_joined':
      updateNetPlayers(message.state?.players);
      updateUI();
      toast(`${message.nickname || 'Opponent'} joined the room`, { gold: true });
      break;
    case 'rematch_status': {
      const ready = Array.isArray(message.ready) ? message.ready : [];
      ui.rematchRequested = Boolean(ui.net?.color && ready.includes(ui.net.color));
      const opponentReady = Boolean(ui.net?.color && ready.some((color) => color !== ui.net.color));
      updateUI();
      if (ui.rematchRequested) toast('Rematch requested — waiting for your opponent');
      else if (opponentReady) toast('Your opponent requested a rematch', { gold: true });
      break;
    }
    case 'room_closed':
      handleRoomClosed(message.reason);
      break;
    case 'error':
      ui.netConnecting = false;
      if (ui.pendingMove) {
        ui.pendingMove = null;
        ui.busy = false;
        ui.net?.requestState();
      }
      updateUI();
      toast(message.message || 'The game server rejected that request');
      break;
    default:
      break;
  }
}

async function connectOnline(action = 'connect', code = '') {
  if (!ui.net) return;
  const nickname = els.onlineNickname.value.trim() || 'Player';
  ui.netConnecting = true;
  ui.netStatus = 'connecting';
  updateUI();

  try {
    if (supabaseConfigured()) {
      saveOnlinePrefs({ nickname: els.onlineNickname.value.trim() });
      await ui.net.connect();
    } else {
      const raw = els.onlineServer.value.trim() || defaultServerUrl();
      const url = normalizeServerUrl(raw);
      if (!url) {
        ui.netConnecting = false;
        ui.netStatus = 'error';
        updateUI();
        toast('Enter a valid ws:// or wss:// server URL');
        els.onlineServer.focus();
        return;
      }
      els.onlineServer.value = url;
      saveOnlinePrefs({ server: url, nickname: els.onlineNickname.value.trim() });
      await ui.net.connect(url);
    }
  } catch (error) {
    ui.netConnecting = false;
    ui.netStatus = 'error';
    updateUI();
    toast(error.message || 'Could not reach the game server');
    return;
  }

  ui.netConnecting = false;
  ui.netStatus = 'connected';
  updateUI();

  try {
    if (action === 'create') await ui.net.createRoom(nickname);
    else if (action === 'join') await ui.net.joinRoom(code, nickname);
  } catch (error) {
    ui.netConnecting = false;
    updateUI();
    toast(error.message || 'Could not join the room');
  }
}

function createOnlineRoom() {
  connectOnline('create');
}

function joinOnlineRoom() {
  const code = formatRoomCode(els.onlineCode.value);
  if (code.length !== 6) {
    toast('Room codes are six characters');
    els.onlineCode.focus();
    return;
  }
  connectOnline('join', code);
}

function leaveOnlineRoom({ silent = false } = {}) {
  if (!ui.net) return;
  ui.net.leaveRoom();
  ui.netVersion = 0;
  ui.rematchRequested = false;
  ui.netStatus = ui.net.connected ? 'connected' : 'offline';
  resetGame({ announce: false, closeOverlays: false });
  updateUI();
  if (!silent) toast('You left the room');
}

async function copyInviteLink() {
  if (!ui.net?.code) return;
  try {
    const url = new URL(location.href);
    url.searchParams.set('room', formatRoomCode(ui.net.code));
    if (!supabaseConfigured() && ui.net.url) url.searchParams.set('server', ui.net.url);
    await navigator.clipboard.writeText(url.toString());
    toast('Invite link copied', { gold: true });
  } catch {
    els.onlineCode.value = formatRoomCode(ui.net.code);
    els.onlineCode.focus();
    els.onlineCode.select();
    toast('Room code selected — copy it to invite a friend');
  }
}

async function performStep(from, to) {
  if (!canInteract()) return;
  const option = ui.destinations.find((entry) => entry.index === to);
  if (!option) {
    sound.invalid();
    return;
  }

  if (ui.mode === 'online') {
    if (!ui.net?.inRoom) {
      toast('Create or join an online room first');
      updateUI();
      return;
    }
    if (!ui.net.connected) {
      toast('Reconnecting to the game server — try again in a moment');
      updateUI();
      return;
    }

    ui.actionToken += 1;
    clearHint();
    ui.busy = true;
    ui.pendingMove = { from, to };
    clearSelection();
    updateUI();
    ui.net.sendMove(from, to);
    return;
  }

  const token = ++ui.actionToken;
  const result = game.step(from, to);
  if (!result.ok) {
    sound.invalid();
    toast(result.reason || 'Illegal move');
    updateUI();
    return;
  }

  clearHint();
  ui.busy = true;
  ui.selected = null;
  ui.destinations = [];
  scene.setSelection(null);
  scene.setDestinations([]);
  scene.setHover(null);
  scene.setLastMove(game.lastMove);
  if (result.capture !== null) sound.capture();
  else sound.move();
  if (result.promoted) {
    window.setTimeout(() => {
      if (ui.actionToken === token) sound.promote();
    }, 340);
  }
  updateUI();

  await scene.animateStep({
    from,
    to,
    capture: result.capture,
    promoted: result.promoted,
  });

  if (token !== ui.actionToken) return;

  scene.setLastMove(game.lastMove);
  ui.busy = false;

  if (result.pending) {
    ui.selected = to;
    ui.destinations = getOptionsFor(to);
    scene.setSelection(to);
    scene.setDestinations(ui.destinations);
    sound.select();
    updateUI();
    toast('Capture continues — jump again', { gold: true });
    return;
  }

  clearSelection();
  updateUI();

  if (game.status !== 'playing') {
    handleGameOver();
    return;
  }

  if (isAiTurn()) {
    scheduleAI(120);
  }
}

function cancelAi() {
  ui.aiToken += 1;
  ui.thinking = false;
  cancelAiRequests();
}

function scheduleAI(delay = 200) {
  if (ui.mode !== 'ai' || game.currentPlayer !== AI_COLOR || game.status !== 'playing') return;
  if (ui.paused || ui.menuOpen || ui.dialogOpen || ui.busy || ui.hintThinking) return;
  cancelAi();
  const token = ui.aiToken;
  ui.thinking = true;
  updateUI();
  window.setTimeout(() => runAI(token), delay);
}

async function runAI(token) {
  if (token !== ui.aiToken || ui.paused || ui.menuOpen || ui.dialogOpen) return;
  if (ui.mode !== 'ai' || game.currentPlayer !== AI_COLOR || game.status !== 'playing') {
    ui.thinking = false;
    updateUI();
    return;
  }

  let move = null;
  try {
    move = await requestAiMove(game.board, game.currentPlayer, ui.difficulty);
  } catch (error) {
    console.error('AI search failed', error);
  }

  if (token !== ui.aiToken) return;
  if (!move) {
    const legal = game.getLegalMoves();
    move = legal[0] || null;
  }
  if (!move) {
    ui.thinking = false;
    handleGameOver();
    return;
  }

  const result = game.playFullMove(move);
  if (!result.ok) {
    const fallback = game.getLegalMoves()[0];
    if (!fallback) {
      ui.thinking = false;
      handleGameOver();
      return;
    }
    const fallbackResult = game.playFullMove(fallback);
    if (!fallbackResult.ok) {
      ui.thinking = false;
      handleGameOver();
      return;
    }
    move = fallbackResult.move;
  } else {
    move = result.move;
  }

  ui.thinking = false;
  ui.busy = true;
  ui.selected = null;
  clearHint();
  scene.clearSelection();
  scene.setDestinations([]);
  scene.setLastMove(game.lastMove);
  updateUI();

  await scene.animateMove(move, {
    onSegmentStart: (segment) => {
      if (segment.capture !== null) sound.capture();
      else sound.move();
      if (segment.promoted) {
        window.setTimeout(() => {
          if (token === ui.aiToken) sound.promote();
        }, 340);
      }
    },
  });

  if (token !== ui.aiToken) return;

  scene.setLastMove(game.lastMove);
  ui.busy = false;
  clearSelection();
  updateUI();

  if (game.status !== 'playing') {
    handleGameOver();
    return;
  }
  if (isAiTurn()) scheduleAI(140);
  else toast('Your turn', { gold: true });
}

function undoMove() {
  if (ui.mode === 'online') {
    toast('Undo is not available in online matches');
    return;
  }
  if (!game.history.length || ui.busy || game.forcedFrom !== null) return;
  if (ui.paused) return;
  cancelAi();
  ui.aiToken += 1;
  ui.actionToken += 1;
  clearTimeout(ui.gameOverTimer);

  const beforePlayer = game.currentPlayer;
  const snapshot = game.undo();
  if (!snapshot) return;

  if (ui.mode === 'ai' && game.currentPlayer !== HUMAN && game.history.length) {
    game.undo();
  } else if (ui.mode === 'ai' && beforePlayer === HUMAN && game.currentPlayer === AI_COLOR && game.history.length) {
    game.undo();
  }

  ui.selected = null;
  ui.destinations = [];
  ui.busy = false;
  ui.thinking = false;
  ui.hintThinking = false;
  ui.gameOverShown = false;
  hideGameOver();
  scene.syncBoard(game.board);
  scene.setLastMove(game.lastMove);
  scene.setHover(null);
  updateUI();
  sound.undo();
  toast('Move undone');

  if (isAiTurn() && game.status === 'playing') scheduleAI(260);
}

async function requestHint() {
  if (ui.mode === 'online') {
    toast('Hints are not available in online matches');
    return;
  }
  if (!canInteract() || game.forcedFrom !== null) return;
  clearHint();
  ui.hintThinking = true;
  const token = ui.actionToken;
  updateUI();

  let hint = null;
  try {
    hint = await requestAiHint(game.board, game.currentPlayer);
  } catch (error) {
    console.error('Hint search failed', error);
  }

  ui.hintThinking = false;
  if (token !== ui.actionToken || !hint) {
    updateUI();
    return;
  }

  const first = hint.segments[0];
  scene.setHint({ from: first.from, to: first.to });
  updateUI();
  sound.ui();
  const suffix = hint.captureCount > 1
    ? ` (${hint.captureCount} jumps)`
    : hint.captureCount === 1
      ? ' (capture)'
      : '';
  toast(`Hint: ${squareName(first.from)} to ${squareName(first.to)}${suffix}`, { gold: true });
}

function toast(message, { gold = false } = {}) {
  if (!els.toastRegion) return;
  els.toastRegion.replaceChildren();
  const node = document.createElement('div');
  node.className = `toast${gold ? ' toast--gold' : ''}`;
  node.textContent = message;
  els.toastRegion.appendChild(node);
  clearTimeout(ui.toastTimer);
  ui.toastTimer = window.setTimeout(() => {
    node.remove();
  }, 3200);
}

function openMenu() {
  if (ui.menuOpen) return;
  ui.menuOpen = true;
  cancelAi();
  els.menuOverlay.hidden = false;
  els.btnMenu.classList.add('is-active');
  updateUI();
  els.menuClose.focus({ preventScroll: true });
}

function closeMenu({ resume = true } = {}) {
  if (!ui.menuOpen) return;
  ui.menuOpen = false;
  els.menuOverlay.hidden = true;
  updateUI();
  if (resume && !ui.dialogOpen && !ui.paused) scheduleAI(180);
}

function openDialog(element) {
  if (!element) return;
  ui.dialogOpen = true;
  cancelAi();
  element.hidden = false;
  updateUI();
  const closeButton = element.querySelector('.dialog-close, .icon-btn');
  closeButton?.focus({ preventScroll: true });
}

function closeDialog(element) {
  if (!element) return;
  element.hidden = true;
  ui.dialogOpen = [...$$('#infoOverlay, #instructionsOverlay, #gameOverOverlay')].some((overlay) => !overlay.hidden);
  updateUI();
  if (!ui.dialogOpen && !ui.paused && !ui.menuOpen) scheduleAI(200);
}

function openInfo() {
  closeMenu({ resume: false });
  openDialog(els.infoOverlay);
}

function openInstructions(fromMenu = false) {
  if (fromMenu) closeMenu({ resume: false });
  openDialog(els.instructionsOverlay);
}

function pauseGame() {
  if (ui.mode === 'online') {
    toast('Online matches cannot be paused');
    return;
  }
  if (game.status !== 'playing' || ui.paused) return;
  ui.paused = true;
  cancelAi();
  els.pauseOverlay.hidden = false;
  updateUI();
  els.resumeButton.focus({ preventScroll: true });
}

function resumeGame() {
  if (!ui.paused) return;
  ui.paused = false;
  els.pauseOverlay.hidden = true;
  updateUI();
  scheduleAI(180);
}

function hideGameOver() {
  els.gameOverOverlay.hidden = true;
}

function handleGameOver() {
  if (game.status === 'playing') return;
  clearSelection();
  cancelAi();
  ui.thinking = false;
  ui.busy = false;
  ui.dialogOpen = true;
  updateUI();

  if (ui.gameOverShown) return;
  ui.gameOverShown = true;
  const token = ui.actionToken;

  if (game.status === 'draw') sound.draw();
  else if (ui.mode === 'ai') {
    if (game.winner === HUMAN) sound.win();
    else sound.lose();
  } else if (ui.mode === 'online') {
    if (game.winner === ui.net?.color) sound.win();
    else sound.lose();
  } else {
    sound.win();
  }

  clearTimeout(ui.gameOverTimer);
  ui.gameOverTimer = window.setTimeout(() => {
    if (token !== ui.actionToken && game.status === 'playing') return;
    if (game.status === 'playing') return;
    const counts = game.counts;
    const winner = game.winner;
    els.gameOverWhite.textContent = String(counts.white);
    els.gameOverBlack.textContent = String(counts.black);
    els.gameOverTurns.textContent = String(Math.max(1, Math.ceil((game.turnNumber - 1) / 2)));
    els.gameOverCrown.classList.toggle('is-black', winner === BLACK);

    if (game.status === 'draw') {
      els.gameOverEyebrow.textContent = 'A balanced contest';
      els.gameOverTitle.textContent = 'The game is drawn';
      els.gameOverMessage.textContent = `${game.winReason}. The board is level.`;
    } else if (ui.mode === 'ai') {
      if (winner === HUMAN) {
        els.gameOverEyebrow.textContent = 'A fine victory';
        els.gameOverTitle.textContent = 'You win';
        els.gameOverMessage.textContent = `${game.winReason}. The table is yours.`;
      } else {
        els.gameOverEyebrow.textContent = 'The house prevails';
        els.gameOverTitle.textContent = 'The computer wins';
        els.gameOverMessage.textContent = `${game.winReason}. A rematch awaits.`;
      }
    } else if (ui.mode === 'online') {
      if (winner === ui.net?.color) {
        els.gameOverEyebrow.textContent = 'A fine victory';
        els.gameOverTitle.textContent = 'You win';
        els.gameOverMessage.textContent = `${game.winReason}. The table is yours.`;
      } else {
        els.gameOverEyebrow.textContent = 'The match is complete';
        els.gameOverTitle.textContent = `${capitalize(winner)} wins`;
        els.gameOverMessage.textContent = `${game.winReason}. Request a rematch when ready.`;
      }
    } else {
      els.gameOverEyebrow.textContent = 'The match is complete';
      els.gameOverTitle.textContent = `${capitalize(winner)} wins`;
      els.gameOverMessage.textContent = `${game.winReason}. Well played.`;
    }

    els.gameOverOverlay.hidden = false;
    ui.dialogOpen = true;
    els.playAgainButton.focus({ preventScroll: true });
    updateUI();
  }, 620);
}

function resetGame({ announce = true, closeOverlays = true } = {}) {
  ui.actionToken += 1;
  cancelAi();
  ui.aiToken += 1;
  clearTimeout(ui.gameOverTimer);

  game.reset();
  ui.selected = null;
  ui.destinations = [];
  ui.busy = false;
  ui.pendingMove = null;
  ui.thinking = false;
  ui.hintThinking = false;
  ui.paused = false;
  ui.gameOverShown = false;
  ui.rematchRequested = false;

  if (closeOverlays) {
    els.menuOverlay.hidden = true;
    els.infoOverlay.hidden = true;
    els.instructionsOverlay.hidden = true;
    els.pauseOverlay.hidden = true;
    els.gameOverOverlay.hidden = true;
    ui.menuOpen = false;
    ui.dialogOpen = false;
  }

  scene.cancelAnimations();
  scene.syncBoard(game.board);
  scene.setLastMove(null);
  scene.clearSelection();
  scene.setDestinations([]);
  scene.setHint(null);
  updateUI();

  if (announce) {
    const text = ui.mode === 'ai'
      ? `New game — ${difficultyLabel(ui.difficulty)} level`
      : ui.mode === 'online'
        ? 'New local board — server match unchanged'
        : 'New two player game';
    toast(text, { gold: true });
  }
}

function setMode(mode) {
  if (mode !== 'ai' && mode !== 'pvp' && mode !== 'online') return;
  if (mode === ui.mode) {
    closeMenu();
    return;
  }

  if (ui.mode === 'online' && ui.net?.inRoom) leaveOnlineRoom({ silent: true });
  ui.mode = mode;
  settings.mode = mode;
  saveSettings();
  resetGame({ announce: false });
  closeMenu({ resume: false });
  updateUI();

  if (mode === 'ai') toast('Playing against the computer', { gold: true });
  else if (mode === 'pvp') toast('Two player mode', { gold: true });
  else {
    toast('Play Online — create or join a room', { gold: true });
    els.onlineServer.focus({ preventScroll: true });
  }
}

function setDifficulty(difficulty) {
  if (!['easy', 'medium', 'hard'].includes(difficulty) || difficulty === ui.difficulty) return;
  ui.difficulty = difficulty;
  settings.difficulty = difficulty;
  saveSettings();
  updateUI();
  sound.ui();
  if (ui.mode === 'ai' && game.currentPlayer === AI_COLOR && game.status === 'playing') {
    cancelAi();
    scheduleAI(160);
  }
}

function setSound(enabled) {
  sound.setEnabled(enabled);
  settings.sound = enabled;
  saveSettings();
  if (enabled) sound.ui();
  updateUI();
}

function bindEvents() {
  els.btnMenu.addEventListener('click', () => {
    sound.ui();
    if (ui.menuOpen) closeMenu();
    else openMenu();
  });
  els.menuClose.addEventListener('click', () => {
    sound.ui();
    closeMenu();
  });
  els.menuOverlay.addEventListener('click', (event) => {
    if (event.target === els.menuOverlay) closeMenu();
  });
  els.menuNewGame.addEventListener('click', () => {
    sound.ui();
    if (ui.mode === 'online') {
      toast(ui.net?.inRoom ? 'Use Rematch to restart an online match' : 'Create or join a room to play online');
      return;
    }
    resetGame();
  });
  els.menuReturn.addEventListener('click', () => {
    sound.ui();
    closeMenu();
  });
  els.menuInstructions.addEventListener('click', () => {
    sound.ui();
    openInstructions(true);
  });
  els.modeCards.forEach((card) => {
    card.addEventListener('click', () => {
      sound.ui();
      setMode(card.dataset.mode);
    });
  });
  els.difficultyButtons.forEach((button) => {
    button.addEventListener('click', () => setDifficulty(button.dataset.difficulty));
  });
  els.soundToggle.addEventListener('click', () => setSound(!sound.enabled));

  els.onlineCreate.addEventListener('click', () => {
    sound.ui();
    createOnlineRoom();
  });
  els.onlineConnect.addEventListener('click', () => {
    sound.ui();
    connectOnline('connect');
  });
  els.onlineJoin.addEventListener('click', () => {
    sound.ui();
    joinOnlineRoom();
  });
  els.onlineCopy.addEventListener('click', () => {
    sound.ui();
    copyInviteLink();
  });
  els.onlineRematch.addEventListener('click', () => {
    sound.ui();
    if (!ui.net?.inRoom) return;
    ui.rematchRequested = true;
    ui.net.requestRematch();
    updateUI();
    toast('Rematch requested — waiting for your opponent');
  });
  els.onlineLeave.addEventListener('click', () => {
    sound.ui();
    leaveOnlineRoom();
  });
  els.onlineServer.addEventListener('input', () => updateUI());
  els.onlineServer.addEventListener('change', () => {
    const url = normalizeServerUrl(els.onlineServer.value);
    if (url) {
      els.onlineServer.value = url;
      saveOnlinePrefs({ server: url });
    }
    updateUI();
  });
  els.onlineNickname.addEventListener('change', () => saveOnlinePrefs({ nickname: els.onlineNickname.value.trim() }));
  els.onlineCode.addEventListener('input', () => {
    els.onlineCode.value = els.onlineCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    updateUI();
  });
  els.onlineCode.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      joinOnlineRoom();
    }
  });
  els.onlineServer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      createOnlineRoom();
    }
  });

  els.btnRestart.addEventListener('click', () => {
    sound.ui();
    if (ui.mode === 'online') {
      openMenu();
      toast(ui.net?.inRoom ? 'Use Rematch to restart an online match' : 'Create or join a room to play online');
      return;
    }
    resetGame();
  });
  els.btnPause.addEventListener('click', () => {
    sound.ui();
    if (ui.paused) resumeGame();
    else pauseGame();
  });
  els.btnUndo.addEventListener('click', () => {
    sound.ui();
    undoMove();
  });
  els.btnInfo.addEventListener('click', () => {
    sound.ui();
    openInfo();
  });
  els.btnHint.addEventListener('click', () => {
    sound.ui();
    requestHint();
  });

  $$('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      sound.ui();
      closeDialog(document.getElementById(button.dataset.closeDialog));
    });
  });

  [els.infoOverlay, els.instructionsOverlay].forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeDialog(overlay);
    });
  });

  els.resumeButton.addEventListener('click', () => {
    sound.ui();
    resumeGame();
  });
  els.pauseRestart.addEventListener('click', () => {
    sound.ui();
    resetGame();
  });
  els.playAgainButton.addEventListener('click', () => {
    sound.ui();
    if (ui.mode === 'online') {
      if (!ui.net?.inRoom || !ui.net.connected) {
        toast('Reconnect to a room before requesting a rematch');
        return;
      }
      ui.rematchRequested = true;
      ui.net.requestRematch();
      updateUI();
      toast('Rematch requested — waiting for your opponent');
      return;
    }
    resetGame();
  });
  els.reviewButton.addEventListener('click', () => {
    sound.ui();
    closeDialog(els.gameOverOverlay);
  });
  els.gameOverOverlay.addEventListener('click', (event) => {
    if (event.target === els.gameOverOverlay) {
      closeDialog(els.gameOverOverlay);
    }
  });

  els.canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    ui.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      pointerId: event.pointerId,
    };
  });
  els.canvas.addEventListener('pointerup', (event) => {
    if (!ui.pointerStart || ui.pointerStart.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - ui.pointerStart.x, event.clientY - ui.pointerStart.y);
    const elapsed = performance.now() - ui.pointerStart.time;
    ui.pointerStart = null;
    if (distance < 12 && elapsed < 700) handleBoardTap(event.clientX, event.clientY);
  });
  els.canvas.addEventListener('pointercancel', () => {
    ui.pointerStart = null;
    cancelHover();
  });
  els.canvas.addEventListener('pointermove', (event) => {
    queueHover({
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
    });
  });
  els.canvas.addEventListener('pointerleave', cancelHover);
  els.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();

    if (key === 'escape') {
      if (!els.gameOverOverlay.hidden) closeDialog(els.gameOverOverlay);
      else if (!els.infoOverlay.hidden) closeDialog(els.infoOverlay);
      else if (!els.instructionsOverlay.hidden) closeDialog(els.instructionsOverlay);
      else if (ui.menuOpen) closeMenu();
      else if (ui.paused) resumeGame();
      return;
    }

    if (ui.menuOpen || ui.dialogOpen) return;
    if (key === 'u') {
      event.preventDefault();
      undoMove();
    } else if (key === 'h') {
      event.preventDefault();
      requestHint();
    } else if (key === 'p') {
      event.preventDefault();
      if (ui.paused) resumeGame();
      else pauseGame();
    }
  });

  window.addEventListener('blur', () => {
    ui.pointerStart = null;
    cancelHover();
  });
}

async function init() {
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {
    // A system fallback font is acceptable.
  }

  game = new CheckersGame();
  sound = new SoundManager();
  sound.setEnabled(settings.sound);

  const netOptions = {
    onEvent: handleOnlineEvent,
    onStatus: (status) => {
      ui.netStatus = status;
      updateUI();
    },
  };
  ui.net = await createNetClient(netOptions);

  configureOnlineUI();

  const params = new URLSearchParams(location.search);
  const inviteRoom = formatRoomCode(params.get('room') || '').slice(0, 6);
  const inviteServer = supabaseConfigured() ? '' : normalizeServerUrl(params.get('server') || '');
  if (inviteServer) saveOnlinePrefs({ server: inviteServer });
  if (inviteRoom.length === 6) {
    ui.mode = 'online';
    settings.mode = 'online';
    saveSettings();
    els.onlineCode.value = inviteRoom;
  }

  if (!supabaseConfigured()) {
    els.onlineServer.value = normalizeServerUrl(onlinePrefs.server) || defaultServerUrl();
  }
  els.onlineNickname.value = onlinePrefs.nickname || '';

  try {
    scene = new CheckersScene(els.canvas);
  } catch (error) {
    console.error('Unable to start WebGL renderer', error);
    els.loading.classList.add('is-error');
    if (els.loadingCopy) {
      els.loadingCopy.textContent = 'This table needs WebGL. Please enable hardware acceleration or try a modern browser.';
    }
    return;
  }

  scene.syncBoard(game.board);
  scene.setLastMove(null);
  bindEvents();
  updateUI();

  if (inviteRoom.length === 6) {
    updateUI();
    connectOnline('join', inviteRoom);
  } else if (ui.mode === 'online' && (supabaseConfigured() || onlinePrefs.server)) {
    connectOnline('resume');
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        els.loading.classList.add('is-hidden');
        window.setTimeout(() => {
          els.loading.hidden = true;
        }, 750);
        window.setTimeout(() => {
          if (game.status === 'playing') {
            if (ui.mode === 'online') {
              toast('Online mode — create or join a room from the menu', { gold: true });
            } else {
              toast(ui.mode === 'ai' ? 'Your move' : 'White to move', { gold: true });
            }
          }
        }, 950);
      }, 300);
    });
  });
}

init();
