/**
 * Pure checkers rules engine.
 * No rendering code lives here, so the same rules drive the human player and the AI.
 *
 * Board layout (internal):
 *   row 0 is the far side of the board, row 7 is the near side.
 *   index = row * 8 + column
 *   dark playable squares satisfy (row + column) % 2 === 1
 *   A1 is row 7 / column 0.
 */

export const EMPTY = 0;
export const WHITE_MAN = 1;
export const WHITE_KING = 2;
export const BLACK_MAN = 3;
export const BLACK_KING = 4;

export const WHITE = 'white';
export const BLACK = 'black';

const MAN_DIRS = {
  [WHITE]: [[-1, -1], [-1, 1]],
  [BLACK]: [[1, -1], [1, 1]],
};

const KING_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

const DRAW_NO_PROGRESS_TURNS = 80; // 40 moves by each side
const MATE_SCORE = 1_000_000;

export const other = (color) => (color === WHITE ? BLACK : WHITE);
export const kingCode = (color) => (color === WHITE ? WHITE_KING : BLACK_KING);
export const manCode = (color) => (color === WHITE ? WHITE_MAN : BLACK_MAN);

export function pieceColor(piece) {
  if (piece === WHITE_MAN || piece === WHITE_KING) return WHITE;
  if (piece === BLACK_MAN || piece === BLACK_KING) return BLACK;
  return null;
}

export function isKing(piece) {
  return piece === WHITE_KING || piece === BLACK_KING;
}

export function isMan(piece) {
  return piece === WHITE_MAN || piece === BLACK_MAN;
}

export function isEnemy(piece, color) {
  const pc = pieceColor(piece);
  return pc !== null && pc !== color;
}

export function isPlayable(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8 && (row + col) % 2 === 1;
}

export function rowColToIndex(row, col) {
  return row * 8 + col;
}

export function indexToRowCol(index) {
  return [Math.floor(index / 8), index % 8];
}

export function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function squareName(index) {
  if (index == null || index < 0 || index > 63) return '';
  const [row, col] = indexToRowCol(index);
  return `${String.fromCharCode(65 + col)}${8 - row}`;
}

export function backRow(color) {
  return color === WHITE ? 0 : 7;
}

export function directionsFor(piece) {
  if (isKing(piece)) return KING_DIRS;
  if (piece === WHITE_MAN) return MAN_DIRS[WHITE];
  if (piece === BLACK_MAN) return MAN_DIRS[BLACK];
  return [];
}

export function createInitialBoard() {
  const board = new Array(64).fill(EMPTY);

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (isPlayable(row, col)) board[rowColToIndex(row, col)] = BLACK_MAN;
    }
  }

  for (let row = 5; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (isPlayable(row, col)) board[rowColToIndex(row, col)] = WHITE_MAN;
    }
  }

  return board;
}

export function cloneBoard(board) {
  return board.slice();
}

export function pieceCounts(board) {
  let white = 0;
  let black = 0;
  for (let i = 0; i < board.length; i += 1) {
    const color = pieceColor(board[i]);
    if (color === WHITE) white += 1;
    else if (color === BLACK) black += 1;
  }
  return { white, black };
}

/**
 * Find every terminal capture sequence for a piece, including multi-jumps.
 * Men are promoted immediately when they touch the far row, and a freshly
 * crowned king may continue a jump sequence (matching American checkers play).
 */
function captureMovesFrom(board, start) {
  const startPiece = board[start];
  const color = pieceColor(startPiece);
  if (!color) return [];

  const results = [];

  function recurse(currentBoard, pos, piece, path, captures, segments) {
    const row = Math.floor(pos / 8);
    const col = pos % 8;
    const dirs = directionsFor(piece);
    let extended = false;

    for (const [dr, dc] of dirs) {
      const midRow = row + dr;
      const midCol = col + dc;
      const destRow = row + dr * 2;
      const destCol = col + dc * 2;
      if (!inBounds(destRow, destCol)) continue;

      const mid = rowColToIndex(midRow, midCol);
      const dest = rowColToIndex(destRow, destCol);

      if (!isEnemy(currentBoard[mid], color) || currentBoard[dest] !== EMPTY) continue;

      extended = true;
      const nextBoard = currentBoard.slice();
      nextBoard[pos] = EMPTY;
      nextBoard[mid] = EMPTY;

      let nextPiece = piece;
      let promoted = false;
      if (isMan(piece) && destRow === backRow(color)) {
        nextPiece = kingCode(color);
        promoted = true;
      }
      nextBoard[dest] = nextPiece;

      const segment = {
        from: pos,
        to: dest,
        capture: mid,
        promoted,
      };

      recurse(
        nextBoard,
        dest,
        nextPiece,
        path.concat(dest),
        captures.concat(mid),
        segments.concat(segment),
      );
    }

    if (!extended && path.length > 0) {
      results.push({
        from: start,
        to: pos,
        path: path.slice(),
        captures: captures.slice(),
        segments: segments.slice(),
        captureCount: captures.length,
        becomesKing: segments.some((segment) => segment.promoted),
      });
    }
  }

  recurse(board, start, startPiece, [], [], []);
  return results;
}

function simpleMovesFrom(board, start) {
  const piece = board[start];
  const color = pieceColor(piece);
  if (!color) return [];

  const row = Math.floor(start / 8);
  const col = start % 8;
  const moves = [];

  for (const [dr, dc] of directionsFor(piece)) {
    const destRow = row + dr;
    const destCol = col + dc;
    if (!inBounds(destRow, destCol)) continue;
    const dest = rowColToIndex(destRow, destCol);
    if (board[dest] !== EMPTY) continue;

    const promoted = isMan(piece) && destRow === backRow(color);
    moves.push({
      from: start,
      to: dest,
      path: [dest],
      captures: [],
      segments: [{ from: start, to: dest, capture: null, promoted }],
      captureCount: 0,
      becomesKing: promoted,
    });
  }

  return moves;
}

/**
 * Mandatory-capture aware legal move generation.
 * Returns complete terminal sequences, never intermediate jumps.
 */
export function generateLegalMoves(board, color) {
  if (color !== WHITE && color !== BLACK) return [];

  const captures = [];
  const simple = [];

  for (let index = 0; index < board.length; index += 1) {
    if (pieceColor(board[index]) !== color) continue;
    const jumps = captureMovesFrom(board, index);
    if (jumps.length) captures.push(...jumps);
    else simple.push(...simpleMovesFrom(board, index));
  }

  return captures.length ? captures : simple;
}

export function generateCaptureMovesFrom(board, from) {
  if (from < 0 || from > 63) return [];
  return captureMovesFrom(board, from);
}

export function hasAnyCapture(board, color) {
  for (let index = 0; index < board.length; index += 1) {
    if (pieceColor(board[index]) !== color) continue;
    if (captureMovesFrom(board, index).length) return true;
  }
  return false;
}

export function applySingleStep(board, from, to, capture = null) {
  const next = board.slice();
  const piece = next[from];
  const color = pieceColor(piece);
  next[from] = EMPTY;
  if (capture !== null && capture >= 0) next[capture] = EMPTY;

  let promoted = false;
  let placed = piece;
  if (isMan(piece) && Math.floor(to / 8) === backRow(color)) {
    placed = kingCode(color);
    promoted = true;
  }
  next[to] = placed;

  return { board: next, promoted, piece, placed };
}

export function applyFullMove(board, move) {
  const next = board.slice();
  const piece = next[move.from];
  const color = pieceColor(piece);
  next[move.from] = EMPTY;

  for (const captured of move.captures || []) next[captured] = EMPTY;

  let placed = piece;
  if (move.becomesKing || (isMan(piece) && Math.floor(move.to / 8) === backRow(color))) {
    placed = kingCode(color);
  }
  next[move.to] = placed;
  return next;
}

export function moveKey(move) {
  return `${move.from}:${move.to}:${(move.path || []).join('.')}:${(move.captures || []).join('.')}`;
}

export function boardKey(board, color) {
  return `${color === WHITE ? 'w' : 'b'}:${board.join('')}`;
}

export class CheckersGame {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = createInitialBoard();
    this.currentPlayer = WHITE;
    this.status = 'playing'; // playing | won | draw
    this.winner = null;
    this.winReason = '';
    this.forcedFrom = null;
    this.lastMove = null;
    this.history = [];
    this.turnNumber = 1;
    this.noProgressTurns = 0;
    this.turnHadCapture = false;
    this.turnHadManMove = false;
    this.turnSegments = [];
    this._snapshotPushed = false;
    this.repetitions = { [boardKey(this.board, this.currentPlayer)]: 1 };
  }

  get counts() {
    return pieceCounts(this.board);
  }

  getLegalMoves() {
    if (this.status !== 'playing') return [];
    let moves = generateLegalMoves(this.board, this.currentPlayer);
    if (this.forcedFrom !== null) {
      moves = moves.filter((move) => move.from === this.forcedFrom);
    }
    return moves;
  }

  getMovesForPiece(index) {
    return this.getLegalMoves().filter((move) => move.from === index);
  }

  getSelectablePieces() {
    return [...new Set(this.getLegalMoves().map((move) => move.from))];
  }

  canSelect(index) {
    return this.getSelectablePieces().includes(index);
  }

  _snapshot() {
    return {
      board: this.board.slice(),
      currentPlayer: this.currentPlayer,
      status: this.status,
      winner: this.winner,
      winReason: this.winReason,
      forcedFrom: this.forcedFrom,
      lastMove: this.lastMove
        ? {
            ...this.lastMove,
            path: this.lastMove.path.slice(),
            captures: this.lastMove.captures.slice(),
            segments: this.lastMove.segments.map((segment) => ({ ...segment })),
          }
        : null,
      turnNumber: this.turnNumber,
      noProgressTurns: this.noProgressTurns,
      repetitions: { ...this.repetitions },
    };
  }

  _pushSnapshotOnce() {
    if (this._snapshotPushed) return;
    this.history.push(this._snapshot());
    this._snapshotPushed = true;
  }

  _pushSegment(segment) {
    this.turnSegments.push({ ...segment });
  }

  _buildLastMove() {
    if (!this.turnSegments.length) return null;
    const first = this.turnSegments[0];
    const last = this.turnSegments[this.turnSegments.length - 1];
    return {
      from: first.from,
      to: last.to,
      path: this.turnSegments.map((segment) => segment.to),
      captures: this.turnSegments
        .filter((segment) => segment.capture !== null)
        .map((segment) => segment.capture),
      segments: this.turnSegments.map((segment) => ({ ...segment })),
      becomesKing: this.turnSegments.some((segment) => segment.promoted),
      player: this.currentPlayer,
      captureCount: this.turnSegments.filter((segment) => segment.capture !== null).length,
    };
  }

  _finishTurn() {
    this.lastMove = this._buildLastMove();
    const mover = this.currentPlayer;

    this.currentPlayer = other(mover);
    this.forcedFrom = null;

    if (this.turnHadCapture || this.turnHadManMove) this.noProgressTurns = 0;
    else this.noProgressTurns += 1;

    this.turnNumber += 1;
    this.turnHadCapture = false;
    this.turnHadManMove = false;
    this.turnSegments = [];
    this._snapshotPushed = false;

    const key = boardKey(this.board, this.currentPlayer);
    this.repetitions[key] = (this.repetitions[key] || 0) + 1;

    const nextMoves = generateLegalMoves(this.board, this.currentPlayer);
    if (nextMoves.length === 0) {
      this.status = 'won';
      this.winner = mover;
      const counts = pieceCounts(this.board);
      this.winReason = counts[this.currentPlayer] === 0
        ? 'All pieces captured'
        : 'No legal moves remaining';
      return this.getState();
    }

    if (this.repetitions[key] >= 3) {
      this.status = 'draw';
      this.winner = null;
      this.winReason = 'Threefold repetition';
      return this.getState();
    }

    if (this.noProgressTurns >= DRAW_NO_PROGRESS_TURNS) {
      this.status = 'draw';
      this.winner = null;
      this.winReason = '40-move rule';
      return this.getState();
    }

    return this.getState();
  }

  /**
   * Apply one click-level step. This supports step-by-step multi-jumps.
   */
  step(from, to) {
    if (this.status !== 'playing') return { ok: false, reason: 'Game over' };
    if (this.forcedFrom !== null && from !== this.forcedFrom) {
      return { ok: false, reason: 'Continue with the same piece' };
    }

    const available = this.getLegalMoves();
    const match = available.find((move) => move.from === from && move.path[0] === to);
    if (!match) return { ok: false, reason: 'Illegal move' };

    const segment = match.segments[0];
    const pieceBefore = this.board[from];

    this._pushSnapshotOnce();
    const result = applySingleStep(this.board, from, to, segment.capture);
    this.board = result.board;

    this.turnHadCapture = this.turnHadCapture || segment.capture !== null;
    this.turnHadManMove = this.turnHadManMove || isMan(pieceBefore);
    this._pushSegment({
      from,
      to,
      capture: segment.capture,
      promoted: result.promoted,
    });

    const isCapture = segment.capture !== null;
    if (isCapture) {
      const continuations = generateCaptureMovesFrom(this.board, to);
      if (continuations.length > 0) {
        this.forcedFrom = to;
        this.lastMove = this._buildLastMove();
        return {
          ok: true,
          pending: true,
          capture: segment.capture,
          promoted: result.promoted,
          from,
          to,
          forcedFrom: to,
          state: this.getState(),
        };
      }
    }

    const state = this._finishTurn();
    return {
      ok: true,
      pending: false,
      capture: segment.capture,
      promoted: result.promoted,
      from,
      to,
      state,
    };
  }

  /**
   * Apply a complete move sequence, used by the AI and for instant restores.
   */
  playFullMove(move) {
    if (this.status !== 'playing') return { ok: false, reason: 'Game over' };
    if (this.forcedFrom !== null) return { ok: false, reason: 'Capture in progress' };

    const legal = this.getLegalMoves();
    const wanted = moveKey(move);
    const match = legal.find((candidate) => moveKey(candidate) === wanted);
    if (!match) return { ok: false, reason: 'Illegal AI move' };

    const pieceBefore = this.board[match.from];
    this._pushSnapshotOnce();
    this.board = applyFullMove(this.board, match);

    this.turnHadCapture = match.captureCount > 0;
    this.turnHadManMove = isMan(pieceBefore);
    this.turnSegments = match.segments.map((segment) => ({ ...segment }));
    const state = this._finishTurn();

    return {
      ok: true,
      move: match,
      pending: false,
      capture: match.captureCount ? match.captures[0] : null,
      promoted: match.becomesKing,
      state,
    };
  }

  undo() {
    if (!this.history.length) return null;
    const snapshot = this.history.pop();
    this.board = snapshot.board.slice();
    this.currentPlayer = snapshot.currentPlayer;
    this.status = snapshot.status;
    this.winner = snapshot.winner;
    this.winReason = snapshot.winReason;
    this.forcedFrom = snapshot.forcedFrom;
    this.lastMove = snapshot.lastMove;
    this.turnNumber = snapshot.turnNumber;
    this.noProgressTurns = snapshot.noProgressTurns;
    this.repetitions = { ...snapshot.repetitions };
    this.turnHadCapture = false;
    this.turnHadManMove = false;
    this.turnSegments = [];
    this._snapshotPushed = false;
    return snapshot;
  }

  getState() {
    return {
      board: this.board,
      counts: this.counts,
      currentPlayer: this.currentPlayer,
      status: this.status,
      winner: this.winner,
      winReason: this.winReason,
      forcedFrom: this.forcedFrom,
      turnNumber: this.turnNumber,
      historyLength: this.history.length,
      lastMove: this.lastMove,
      noProgressTurns: this.noProgressTurns,
    };
  }
}

export { MATE_SCORE, DRAW_NO_PROGRESS_TURNS };
