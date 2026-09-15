import type { PlayerIndex, Rng } from "../types.js";

export type AiLevel = "easy" | "normal" | "hard";

export interface AiLevelInfo {
  id: AiLevel;
  label: string;
  description: string;
}

export const AI_LEVELS: AiLevelInfo[] = [
  { id: "easy", label: "쉬움", description: "가볍게 둡니다. 바로 이기는 수만 놓치지 않아요." },
  { id: "normal", label: "보통", description: "몇 수 앞을 읽습니다." },
  { id: "hard", label: "어려움", description: "주어진 시간 안에서 최대한 깊이 읽습니다." },
];

export function isAiLevel(id: string): id is AiLevel {
  return AI_LEVELS.some((l) => l.id === id);
}

export interface AiOptions {
  /** Random source for tie-breaking and easy-level noise. Defaults to Math.random. */
  rng?: Rng;
  /** Wall-clock budget for levels that search until time runs out. Overrides the level's default. */
  budgetMs?: number;
  /** Clock measured against budgetMs; defaults to Date.now. Injected so tests can be deterministic. */
  now?: () => number;
}

/** Knobs the AI self-test harness reads to keep its checks fast and fair per game. */
export interface AiTestProfile {
  /** AI-vs-random games to play (default 6). */
  games?: number;
  /** Minimum share of those games the "normal" level must win (default 0.7). */
  minWinRate?: number;
  /** Per-move time budget the harness hands the AI (default 30ms). */
  budgetMs?: number;
  /** Plies after which a harness game is abandoned and counted as a draw (default 300). */
  maxPlies?: number;
}

export interface AiProvider<TState, TMove> {
  /**
   * Picks a move for `player`. Must return a move the engine's applyMove accepts,
   * or null when `player` has no legal move (not their turn, or the game is over).
   * Must never throw: the UI calls this from a worker and treats an exception as
   * "the computer is broken".
   */
  chooseMove(state: TState, player: PlayerIndex, level: AiLevel, options?: AiOptions): TMove | null;
  testProfile?: AiTestProfile;
}
