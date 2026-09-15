import type { BaseState, GameEngine, PlayerIndex, Rng } from "../types.js";
import type { AiProvider } from "./types.js";

export function pickRandom<T>(items: T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Fisher-Yates in place. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/**
 * Plays uniformly random legal moves. The baseline every real AI is measured
 * against, and the placeholder a game ships with until it has its own AI.
 */
export function makeRandomAi<TState extends BaseState, TMove>(engine: GameEngine<TState, TMove>): AiProvider<TState, TMove> {
  return {
    chooseMove(state, player, _level, options = {}) {
      try {
        if (engine.status(state).status !== "ongoing" || engine.turn(state) !== player) return null;
        const moves = engine.legalMoves(state, player);
        if (moves.length === 0) return null;
        return pickRandom(moves, options.rng ?? Math.random);
      } catch {
        return null;
      }
    },
  };
}
