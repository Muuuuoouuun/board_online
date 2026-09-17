import type { ApplyResult, BaseState, GameEngine, GameId, PlayerIndex, Rng } from "./types.js";
import { gomokuEngine } from "./games/gomoku.js";
import { reversiEngine } from "./games/reversi.js";
import { checkersEngine } from "./games/checkers.js";
import { chessEngine } from "./games/chess.js";
import { janggiEngine } from "./games/janggi.js";
import { flickEngine } from "./games/flick.js";
import { gonuEngine } from "./games/gonu.js";
import { yutEngine } from "./games/yut.js";
import { territoryEngine } from "./games/territory.js";

export * from "./types.js";
export type { GomokuState } from "./games/gomoku.js";
export type { ReversiState } from "./games/reversi.js";
export type { CheckersState } from "./games/checkers.js";
export type { ChessState } from "./games/chess.js";
export type { JanggiState, Formation } from "./games/janggi.js";
export type { FlickState, FlickMove, FlickPos, FlickGrid, FlickShot, FlickOutcome } from "./games/flick.js";
export { SIZE as FLICK_SIZE, MAX_FLICK as FLICK_MAX } from "./games/flick.js";
export type { GonuState, PointId, GonuBoardMap } from "./games/gonu.js";
export { POINTS, POINT_IDS, EDGES } from "./games/gonu.js";
export type { YutState, YutMove, YutPos, YutThrowResult, TrackPos as YutTrackPos } from "./games/yut.js";
export type { TerritoryState, TerritoryMove, TerritoryCell, TerritoryLineError } from "./games/territory.js";
export {
  MAX_LINE as TERRITORY_MAX_LINE,
  TURN_START_MS as TERRITORY_TURN_START_MS,
  TURN_FLOOR_MS as TERRITORY_TURN_FLOOR_MS,
  territoryCanStart,
  territoryCanExtend,
  territoryPreview,
  territoryLineErrorText,
} from "./games/territory.js";

export const ENGINES: Partial<Record<GameId, GameEngine<any, any>>> = {
  gomoku: gomokuEngine,
  reversi: reversiEngine,
  checkers: checkersEngine,
  chess: chessEngine,
  janggi: janggiEngine,
  flick: flickEngine,
  gonu: gonuEngine,
  yut: yutEngine,
  territory: territoryEngine,
};

/** Registered games, in the order the lobby lists them. */
export const GAME_LIST: GameId[] = ["gomoku", "chess", "janggi", "checkers", "reversi", "gonu", "yut", "territory", "flick"];

export function getEngine(id: GameId): GameEngine<any, any> {
  const engine = ENGINES[id];
  if (!engine) throw new Error(`Unknown game id: ${id}`);
  return engine;
}

export function isGameId(id: string): id is GameId {
  return (GAME_LIST as string[]).includes(id);
}

/**
 * The only way untrusted moves should reach an engine.
 *
 * Moves arrive as JSON from a network client, so their shape is whatever the
 * sender chose. Engines are written against well-formed moves and most of them
 * will throw on junk (destructuring `move.to` when `move` is null, say). A throw
 * inside the socket handler would take down the process and every other room on
 * it, so the boundary swallows it and reports an illegal move instead. Applying
 * this once here means new engines are covered without each one re-deriving it.
 */
export function applyMoveSafely<TState extends BaseState, TMove>(
  engine: GameEngine<TState, TMove>,
  state: TState,
  move: TMove,
  player: PlayerIndex,
  rng?: Rng,
  now?: number,
): ApplyResult<TState> {
  try {
    return engine.applyMove(state, move, player, rng, now);
  } catch {
    return { ok: false, state, error: "둘 수 없는 이동입니다.", status: engine.status(state) };
  }
}
