/**
 * Async front-end for the checkers AI.
 *
 * Search runs in a Web Worker so deep searches never stall rendering or input.
 * The standalone build injects the worker source as a string; the modular dev
 * build loads the generated worker file. A synchronous fallback keeps the game
 * playable on browsers that refuse workers.
 */

import { chooseHint, chooseMove } from './ai.js';

const MOVE_BUDGET = {
  easy: 0,
  medium: 220,
  hard: 650,
};
const HINT_BUDGET = 380;

let worker = null;
let workerFailed = false;
let nextRequestId = 0;
const pending = new Map();

function injectedWorkerSource() {
  if (typeof __STANDALONE_AI_WORKER_SOURCE__ !== 'undefined' && __STANDALONE_AI_WORKER_SOURCE__) {
    return __STANDALONE_AI_WORKER_SOURCE__;
  }
  return null;
}

function ensureWorker() {
  if (worker || workerFailed) return worker;

  try {
    const inlineSource = injectedWorkerSource();
    if (inlineSource) {
      const url = URL.createObjectURL(new Blob([inlineSource], { type: 'text/javascript' }));
      worker = new Worker(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      worker = new Worker(new URL('js/ai-worker.generated.js', document.baseURI));
    }

    worker.onmessage = (event) => {
      const message = event.data || {};
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error));
      else entry.resolve({ move: message.move || null, cancelled: false });
    };

    worker.onerror = (event) => {
      event.preventDefault?.();
      workerFailed = true;
      try {
        worker?.terminate();
      } catch {
        // Nothing else to clean up if termination is unavailable.
      }
      worker = null;
      const error = new Error('AI worker failed');
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    };
  } catch {
    workerFailed = true;
    worker = null;
  }

  return worker;
}

function askWorker(payload) {
  return new Promise((resolve, reject) => {
    const active = ensureWorker();
    if (!active) {
      reject(new Error('AI worker unavailable'));
      return;
    }

    const id = ++nextRequestId;
    pending.set(id, { resolve, reject });
    try {
      active.postMessage({ id, ...payload });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

function runFallback(payload) {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      try {
        const move = payload.type === 'hint'
          ? chooseHint(payload.board, payload.color, payload.timeLimit)
          : chooseMove(payload.board, payload.color, payload.difficulty, {
            timeLimit: payload.timeLimit,
          });
        resolve({ move: move || null, cancelled: false });
      } catch (error) {
        console.error('AI fallback failed', error);
        resolve({ move: null, cancelled: false });
      }
    }, 0);
  });
}

async function requestAi(payload) {
  try {
    return await askWorker(payload);
  } catch {
    // Worker creation, transport or search can fail; the synchronous engine is
    // still a complete and legal move source.
    return runFallback(payload);
  }
}

export async function requestAiMove(board, color, difficulty) {
  const result = await requestAi({
    type: 'move',
    board,
    color,
    difficulty,
    timeLimit: MOVE_BUDGET[difficulty] ?? MOVE_BUDGET.hard,
  });
  return result.move;
}

export async function requestAiHint(board, color) {
  const result = await requestAi({
    type: 'hint',
    board,
    color,
    timeLimit: HINT_BUDGET,
  });
  return result.move;
}

export function cancelAiRequests() {
  for (const entry of pending.values()) {
    entry.resolve({ move: null, cancelled: true });
  }
  pending.clear();

  if (worker) {
    try {
      worker.terminate();
    } catch {
      // A terminated worker simply gets replaced on the next request.
    }
    worker = null;
  }
}
