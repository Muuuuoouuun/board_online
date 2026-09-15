/// <reference lib="webworker" />
import { getAi, isAiLevel, isGameId } from "@board-online/shared";

/**
 * Runs the computer opponent off the main thread so a deep search never
 * freezes the board. One request in, one reply out, matched by `id`.
 */
export interface AiRequest {
  id: number;
  gameId: string;
  state: unknown;
  player: 0 | 1;
  level: string;
  budgetMs?: number;
}

export interface AiResponse {
  id: number;
  move: unknown | null;
  error?: string;
}

self.onmessage = (event: MessageEvent<AiRequest>) => {
  const req = event.data;
  let response: AiResponse;
  try {
    if (!isGameId(req.gameId)) throw new Error(`unknown game ${req.gameId}`);
    const level = isAiLevel(req.level) ? req.level : "normal";
    const move = getAi(req.gameId).chooseMove(req.state, req.player, level, { budgetMs: req.budgetMs });
    response = { id: req.id, move };
  } catch (err) {
    response = { id: req.id, move: null, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(response);
};
