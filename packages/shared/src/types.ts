export type PlayerIndex = 0 | 1;
export type GameId =
  | "gomoku"
  | "reversi"
  | "checkers"
  | "chess"
  | "janggi"
  | "gonu"
  | "yut"
  | "territory"
  | "flick";
export type GameStatus = "ongoing" | "win" | "draw";

export interface Pos {
  x: number;
  y: number;
}

export interface Move {
  from?: Pos;
  to: Pos;
  promotion?: "q" | "r" | "b" | "n";
}

/** Injected so games with chance (yut throws, flick scatter) stay testable and server-authoritative. */
export type Rng = () => number;

export interface StatusResult {
  status: GameStatus;
  winner: PlayerIndex | null;
  reason: string;
}

export interface ApplyResult<TState> {
  ok: boolean;
  state: TState;
  error?: string;
  status: StatusResult;
}

/** Normalized piece for generic board rendering. */
export interface BoardPiece {
  pos: Pos;
  owner: PlayerIndex;
  glyph: string;
  highlight?: boolean;
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Semantic board feedback; derived from the same rules used to validate moves. */
export interface BoardFeedback {
  kind: "check" | "win";
  label: string;
  positions: Pos[];
  lines?: Line[];
}

export interface GameMeta {
  id: GameId;
  nameKo: string;
  width: number;
  height: number;
  /** cell = play happens inside squares (checkers/reversi/chess); intersection = play happens on line crossings (gomoku/janggi) */
  gridStyle: "cell" | "intersection";
  playerLabels: [string, string];
  decorations?: Line[];
  /** Which owner renders as the "dark disc" piece. Defaults to [true, false] (owner 0 = dark). */
  ownerIsDark?: [boolean, boolean];
  /**
   * Which client renderer draws this game. "grid" (the default) is the shared
   * <Board>; anything else has its own component because its board is not a
   * plain grid of squares or intersections.
   */
  renderer?: "grid" | "gonu" | "yut" | "territory" | "flick";
  /** Pre-game setup choices, e.g. janggi's 마상 formation. */
  setupOptions?: SetupOption[];
}

export interface SetupOption {
  id: string;
  label: string;
  description?: string;
}

export interface BaseState {
  turn: PlayerIndex;
  status: GameStatus;
  winner: PlayerIndex | null;
  reason: string;
}

/**
 * TMove defaults to the grid Move that the shared <Board> understands. Games on a
 * non-grid board (yut's path, territory's edges) substitute their own move type;
 * the server never inspects moves, it only hands them back to applyMove.
 */
export interface GameEngine<TState extends BaseState = BaseState, TMove = Move> {
  meta: GameMeta;
  createInitialState(setupId?: string): TState;
  turn(state: TState): PlayerIndex;
  status(state: TState): StatusResult;
  /** All legal moves for `player` in `state`. Empty when it is not their turn or game is over. */
  legalMoves(state: TState, player: PlayerIndex): TMove[];
  /** `rng` is supplied by the server for games with chance; defaults to Math.random. */
  applyMove(state: TState, move: TMove, player: PlayerIndex, rng?: Rng): ApplyResult<TState>;
  pieces(state: TState): BoardPiece[];
  feedback?(state: TState): BoardFeedback | null;
}

export function posEq(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(p: Pos, width: number, height: number): boolean {
  return p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
}
