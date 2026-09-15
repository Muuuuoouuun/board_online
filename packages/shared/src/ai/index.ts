import type { GameId } from "../types.js";
import type { AiProvider } from "./types.js";
import { gomokuAi } from "./gomoku.js";
import { reversiAi } from "./reversi.js";
import { checkersAi } from "./checkers.js";
import { chessAi } from "./chess.js";
import { janggiAi } from "./janggi.js";
import { gonuAi } from "./gonu.js";
import { yutAi } from "./yut.js";
import { territoryAi } from "./territory.js";
import { flickAi } from "./flick.js";

export * from "./types.js";
export { makeRandomAi, pickRandom, shuffle } from "./random.js";
export { makeSearchAi, searchBestMove, findImmediateWin, WIN_SCORE } from "./search.js";
export type { SearchSpec, SearchAiConfig, SearchLevelConfig, SearchResult } from "./search.js";

/** Computer opponents, one per registered game. */
export const AI_PROVIDERS: Record<GameId, AiProvider<any, any>> = {
  gomoku: gomokuAi,
  reversi: reversiAi,
  checkers: checkersAi,
  chess: chessAi,
  janggi: janggiAi,
  gonu: gonuAi,
  yut: yutAi,
  territory: territoryAi,
  flick: flickAi,
};

export function getAi(id: GameId): AiProvider<any, any> {
  const ai = AI_PROVIDERS[id];
  if (!ai) throw new Error(`No AI registered for game: ${id}`);
  return ai;
}
