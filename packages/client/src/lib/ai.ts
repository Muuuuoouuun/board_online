import { getAi, type AiLevel, type GameId, type PlayerIndex } from "@board-online/shared";
import type { AiRequest, AiResponse } from "../workers/ai.worker.js";

/** Time the computer is allowed to think per move, by level. */
export const AI_BUDGET_MS: Record<AiLevel, number> = { easy: 150, normal: 600, hard: 1400 };

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, (move: unknown | null) => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === "undefined") {
      worker = null;
      return null;
    }
    worker = new Worker(new URL("../workers/ai.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<AiResponse>) => {
      const resolve = pending.get(event.data.id);
      if (!resolve) return;
      pending.delete(event.data.id);
      if (event.data.error) console.warn("AI worker error:", event.data.error);
      resolve(event.data.move);
    };
    worker.onerror = (event) => {
      // The worker itself failed to load (old browser, blocked module workers):
      // fail every waiting request and fall back to the main thread from now on.
      console.warn("AI worker unavailable, falling back to main thread:", event.message);
      for (const [, resolve] of pending) resolve(undefined);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function chooseOnMainThread(gameId: GameId, state: unknown, player: PlayerIndex, level: AiLevel): unknown | null {
  try {
    return getAi(gameId).chooseMove(state, player, level, { budgetMs: AI_BUDGET_MS[level] });
  } catch {
    return null;
  }
}

/**
 * Asks the computer for a move. Runs in a Web Worker when possible; otherwise
 * on the main thread (after a tick, so the UI can paint "thinking" first).
 */
export function requestAiMove(gameId: GameId, state: unknown, player: PlayerIndex, level: AiLevel): Promise<unknown | null> {
  const w = getWorker();
  if (!w) {
    return new Promise((resolve) => setTimeout(() => resolve(chooseOnMainThread(gameId, state, player, level)), 16));
  }
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (move) => {
      // `undefined` means the worker died before answering — recompute locally.
      if (move === undefined) resolve(chooseOnMainThread(gameId, state, player, level));
      else resolve(move);
    });
    const req: AiRequest = { id, gameId, state, player, level, budgetMs: AI_BUDGET_MS[level] };
    w.postMessage(req);
  });
}
