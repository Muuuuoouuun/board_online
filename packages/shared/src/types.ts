export type PlayerIndex = 0 | 1;
export type GameId = "gomoku" | "reversi" | "checkers" | "chess" | "janggi";
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
}

export interface BaseState {
  turn: PlayerIndex;
  status: GameStatus;
  winner: PlayerIndex | null;
  reason: string;
}

export interface GameEngine<TState extends BaseState = BaseState> {
  meta: GameMeta;
  createInitialState(): TState;
  turn(state: TState): PlayerIndex;
  status(state: TState): StatusResult;
  /** All legal moves for `player` in `state`. Empty when it is not their turn or game is over. */
  legalMoves(state: TState, player: PlayerIndex): Move[];
  applyMove(state: TState, move: Move, player: PlayerIndex): ApplyResult<TState>;
  pieces(state: TState): BoardPiece[];
}

export function posEq(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(p: Pos, width: number, height: number): boolean {
  return p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
}
