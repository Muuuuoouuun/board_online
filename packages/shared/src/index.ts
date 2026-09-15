import type { GameEngine, GameId } from "./types.js";
import { gomokuEngine } from "./games/gomoku.js";
import { reversiEngine } from "./games/reversi.js";
import { checkersEngine } from "./games/checkers.js";
import { chessEngine } from "./games/chess.js";
import { janggiEngine } from "./games/janggi.js";

export * from "./types.js";
export type { GomokuState } from "./games/gomoku.js";
export type { ReversiState } from "./games/reversi.js";
export type { CheckersState } from "./games/checkers.js";
export type { ChessState } from "./games/chess.js";
export type { JanggiState } from "./games/janggi.js";

export const ENGINES: Record<GameId, GameEngine<any>> = {
  gomoku: gomokuEngine,
  reversi: reversiEngine,
  checkers: checkersEngine,
  chess: chessEngine,
  janggi: janggiEngine,
};

export const GAME_LIST: GameId[] = ["gomoku", "chess", "janggi", "checkers", "reversi"];

export function getEngine(id: GameId): GameEngine<any> {
  const engine = ENGINES[id];
  if (!engine) throw new Error(`Unknown game id: ${id}`);
  return engine;
}

export function isGameId(id: string): id is GameId {
  return (GAME_LIST as string[]).includes(id);
}
