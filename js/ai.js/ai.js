/**
 * Checkers AI.
 * Easy: random legal move with a light capture bias.
 * Medium: shallow alpha-beta search with positional evaluation.
 * Hard: iterative-deepening alpha-beta search with a time budget.
 */

import {
  BLACK,
  MATE_SCORE,
  WHITE,
  applyFullMove,
  generateLegalMoves,
  isKing,
  other,
  pieceColor,
} from './engine.js';

const TIMEOUT = Symbol('search-timeout');

const PIECE_VALUE = {
  man: 100,
  king: 178,
};

function advancementScore(piece, row, color) {
  if (isKing(piece)) return 0;
  if (color === WHITE) return ((7 - row) / 7) * 16;
  return (row / 7) * 16;
}

function centerScore(row, col) {
  const dr = Math.abs(3.5 - row);
  const dc = Math.abs(3.5 - col);
  return Math.max(0, 3.5 - (dr + dc) * 0.65);
}

/**
 * Static evaluation from the perspective of rootColor.
 * Material is primary; advancement, king activity, back-row defense,
 * edge safety and central control break ties.
 */
export function evaluateBoard(board, rootColor) {
  let score = 0;

  for (let index = 0; index < board.length; index += 1) {
    const piece = board[index];
    const color = pieceColor(piece);
    if (!color) continue;

    const row = Math.floor(index / 8);
    const col = index % 8;
    let value = 0;

    if (isKing(piece)) {
      value += PIECE_VALUE.king;
      value += centerScore(row, col) * 3.4;
      value += 4;
    } else {
      value += PIECE_VALUE.man;
      value += advancementScore(piece, row, color);
      value += centerScore(row, col) * 0.8;

      const back = color === WHITE ? 7 : 0;
      if (row === back) value += 9;
      if (Math.abs((color === WHITE ? 0 : 7) - row) === 1) value += 5;
    }

    // Edges are safer in checkers; central pieces have more options.
    if (col === 0 || col === 7) value += 3;
    if (row === 0 || row === 7) value += 1.5;

    // A piece supported from behind is harder to dislodge.
    const friendlyBehind = color === WHITE ? row + 1 : row - 1;
    if (friendlyBehind >= 0 && friendlyBehind < 8) {
      if (col > 0 && pieceColor(board[friendlyBehind * 8 + col - 1]) === color) value += 3;
      if (col < 7 && pieceColor(board[friendlyBehind * 8 + col + 1]) === color) value += 3;
    }

    score += color === rootColor ? value : -value;
  }

  return score;
}

function moveOrderScore(move, turn) {
  let score = move.captureCount * 1200;
  if (move.becomesKing) score += 420;
  if (move.to !== null) {
    const row = Math.floor(move.to / 8);
    const col = move.to % 8;
    score += centerScore(row, col) * 2;
  }
  if (move.captures.length > 1) score += move.captures.length * 40;
  return score;
}

function orderMoves(moves, turn) {
  return moves
    .slice()
    .sort((a, b) => moveOrderScore(b, turn) - moveOrderScore(a, turn));
}

function minimax(board, turn, depth, alpha, beta, rootColor, ply, ctx) {
  ctx.nodes += 1;
  if ((ctx.nodes & 511) === 0 && performance.now() > ctx.deadline) throw TIMEOUT;

  const moves = generateLegalMoves(board, turn);
  if (moves.length === 0) {
    return turn === rootColor ? -MATE_SCORE + ply : MATE_SCORE - ply;
  }

  if (depth <= 0) return evaluateBoard(board, rootColor);

  const maximizing = turn === rootColor;
  const ordered = orderMoves(moves, turn);

  if (maximizing) {
    let best = -Infinity;
    for (const move of ordered) {
      const next = applyFullMove(board, move);
      const value = minimax(next, other(turn), depth - 1, alpha, beta, rootColor, ply + 1, ctx);
      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of ordered) {
    const next = applyFullMove(board, move);
    const value = minimax(next, other(turn), depth - 1, alpha, beta, rootColor, ply + 1, ctx);
    if (value < best) best = value;
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchRoot(board, color, maxDepth, timeLimit, noise = 0) {
  const moves = orderMoves(generateLegalMoves(board, color), color);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];

  const started = performance.now();
  let bestMove = moves[0];
  let bestScore = -Infinity;

  const ctx = {
    deadline: started + timeLimit,
    nodes: 0,
  };

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let alpha = -Infinity;
    let beta = Infinity;
    let depthBest = null;
    let depthScore = -Infinity;
    const results = [];

    try {
      for (const move of moves) {
        const next = applyFullMove(board, move);
        let value = minimax(next, other(color), depth - 1, alpha, beta, color, 1, ctx);
        if (noise > 0) value += (Math.random() * 2 - 1) * noise;
        results.push({ move, value });
        if (value > depthScore) {
          depthScore = value;
          depthBest = move;
        }
        if (value > alpha) alpha = value;
      }

      if (depthBest) {
        bestScore = depthScore;
        bestMove = depthBest;
        // Keep the best root move first for the next iteration.
        results.sort((a, b) => b.value - a.value);
        moves.length = 0;
        moves.push(...results.map((entry) => entry.move));
      }

      if (Math.abs(bestScore) > MATE_SCORE - 1000) break;
      if (performance.now() > ctx.deadline) break;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }

  return bestMove;
}

export function chooseMove(board, color, difficulty = 'hard', options = {}) {
  const moves = generateLegalMoves(board, color);
  if (!moves.length) return null;

  if (difficulty === 'easy') {
    // Mostly pure random legal play, with a small preference for bigger jumps.
    const captureMoves = moves.filter((move) => move.captureCount > 0);
    if (captureMoves.length && Math.random() < 0.72) {
      const biggest = Math.max(...captureMoves.map((move) => move.captureCount));
      const strongest = captureMoves.filter((move) => move.captureCount === biggest);
      return strongest[Math.floor(Math.random() * strongest.length)];
    }
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (difficulty === 'medium') {
    return searchRoot(board, color, 3, options.timeLimit ?? 220, 7);
  }

  return searchRoot(board, color, 10, options.timeLimit ?? 650, 0);
}

export function chooseHint(board, color, timeLimit = 380) {
  return searchRoot(board, color, 8, timeLimit, 0);
}

export function difficultyLabel(difficulty) {
  if (difficulty === 'easy') return 'Easy';
  if (difficulty === 'medium') return 'Medium';
  return 'Hard';
}

export { BLACK, WHITE };
