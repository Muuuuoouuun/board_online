import type { GameEngine, GameId } from "./types.js";
import { gomokuEngine } from "./games/gomoku.js";
import { reversiEngine } from "./games/reversi.js";
import { checkersEngine } from "./games/checkers.js";
import { chessEngine } from "./games/chess.js";
import { janggiEngine } from "./games/janggi.js";
import { flickEngine } from "./games/flick.js";
import { gonuEngine } from "./games/gonu.js";

export * from "./types.js";
export type { GomokuState } from "./games/gomoku.js";
export type { ReversiState } from "./games/reversi.js";
export type { CheckersState } from "./games/checkers.js";
export type { ChessState } from "./games/chess.js";
export type { JanggiState, Formation } from "./games/janggi.js";
export type { FlickState, FlickMove, FlickPos, FlickGrid } from "./games/flick.js";
export { SIZE as FLICK_SIZE, MAX_FLICK as FLICK_MAX } from "./games/flick.js";
export type { GonuState, PointId, GonuBoardMap } from "./games/gonu.js";
export { POINTS, POINT_IDS, EDGES } from "./games/gonu.js";

export const ENGINES: Partial<Record<GameId, GameEngine<any, any>>> = {
  gomoku: gomokuEngine,
  reversi: reversiEngine,
  checkers: checkersEngine,
  chess: chessEngine,
  janggi: janggiEngine,
  flick: flickEngine,
  gonu: gonuEngine,
};

/** Registered games, in the order the lobby lists them. */
export const GAME_LIST: GameId[] = ["gomoku", "chess", "janggi", "checkers", "reversi", "gonu", "flick"];

export function getEngine(id: GameId): GameEngine<any, any> {
  const engine = ENGINES[id];
  if (!engine) throw new Error(`Unknown game id: ${id}`);
  return engine;
}

export function isGameId(id: string): id is GameId {
  return (GAME_LIST as string[]).includes(id);
}
