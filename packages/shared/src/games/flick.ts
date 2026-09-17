import type { ApplyResult, BoardPiece, GameEngine, PlayerIndex, StatusResult } from "../types.js";

/**
 * 땅따먹기 (territory capture) — stone-flicking variant.
 *
 * Each player owns one stone that rests inside their own territory. On your
 * turn you flick it up to three times — grab the stone, pull it back and let
 * go, and it flies the other way, as far as you pulled. If it is back inside
 * your own land after flick 1, 2 or 3, the path you traced (closed by the
 * implicit return into your land) becomes yours. If the stone leaves the
 * board, or is still outside your land after the third flick, you claim
 * nothing and the stone is put back where the turn started.
 *
 * Every flick is recorded in `lastShot`, because where the stone *tried* to go
 * is not always where it ends up: a shot off the board, or a third shot that
 * misses home, puts the stone back where the turn started. Without the record
 * a client would only ever see the stone reappear at its resting spot, so
 * neither player could watch the shot that just failed.
 *
 * ---
 * CONTRACT NOTE — the one deliberate departure in this engine:
 * Flicking is continuous aim (any direction, any power up to MAX_FLICK), so
 * `legalMoves` cannot enumerate the legal move space the way every other
 * engine in this codebase does. It returns a small fixed sample of full-power
 * directions purely so the generic "pick a random legal move" fuzz test and
 * simple AIs have something to work with. `applyMove` accepts ANY
 * `{ kind: "flick", dx, dy }` whose magnitude is within [0, MAX_FLICK] —
 * validated purely by range, never by membership in the sampled list. Do not
 * assume elsewhere in the codebase that legalMoves() is exhaustive for flick.
 * ---
 */

/** Grid resolution AND the continuous coordinate extent: the board is [0, SIZE] x [0, SIZE],
 *  and grid cell (x, y) covers the continuous square [x, x+1) x [y, y+1). Sharing one constant
 *  for both means stone/flick coordinates and grid cells line up with no scaling step. */
export const SIZE = 48;
/** Radius (in board units) of each player's starting quarter-circle of land. */
const CORNER_RADIUS = 7;
/** Max distance a single flick may travel, in board units. */
export const MAX_FLICK = 16;
/** Hard cap on total completed turns (both players combined) — guarantees the game always
 *  ends even if neither player ever successfully claims anything. 40 turns = 20 each. */
const ROUND_LIMIT = 40;
/** Early-exit condition: the game also ends once neutral land drops to this fraction (or less)
 *  of the board, i.e. the board is "effectively full." */
const NEUTRAL_END_FRACTION = 0.1;
const EPS = 1e-6;

export interface FlickPos {
  x: number;
  y: number;
}

/** grid[y][x]: the owner of that cell, or null while neutral/unclaimed. */
export type FlickGrid = (PlayerIndex | null)[][];

export type FlickMove = { kind: "flick"; dx: number; dy: number } | { kind: "giveup" };

/** What became of a flick, in the order the engine decides it. */
export type FlickOutcome =
  /** landed back in the shooter's own land: the traced path was claimed */
  | "claim"
  /** flew off the board: nothing claimed, stone returns to where the turn started */
  | "off"
  /** third flick, still outside their land: same ending as "off" */
  | "spent"
  /** landed on open (or the opponent's) land with flicks to spare: the turn goes on */
  | "open";

/** The flick just played, so every client can animate the same shot. */
export interface FlickShot {
  player: PlayerIndex;
  /** Where the stone was flicked from, and where the flick sent it. `to` may be off the board. */
  from: FlickPos;
  to: FlickPos;
  outcome: FlickOutcome;
  /** Cells newly claimed by this shot; 0 unless `outcome` is "claim". */
  claimed: number;
}

export interface FlickState {
  grid: FlickGrid;
  /** Each player's current stone position — their resting spot between turns, and its
   *  live position mid-flick during their own turn. */
  stones: [FlickPos, FlickPos];
  /** Flicks left in the turn in progress; reset to 3 whenever a turn starts. */
  flicksLeft: number;
  /** Positions visited so far this turn, starting with the resting spot the turn began at.
   *  Doubles as the polygon claimed on a successful return (closed implicitly, last point
   *  back to first) and as the path the renderer draws live. */
  path: FlickPos[];
  /** Number of turns completed so far (by either player) — drives the round-limit ending. */
  round: number;
  /** The flick just played, or null at the start of a game and after a passed turn. */
  lastShot: FlickShot | null;
  turn: PlayerIndex;
  status: "ongoing" | "win" | "draw";
  winner: PlayerIndex | null;
  reason: string;
}

const SQRT2 = Math.SQRT2;
/** Starting stone position for each player: a little way in from their home corner along the
 *  diagonal, comfortably inside the starting quarter-circle. */
const STONE_START: [FlickPos, FlickPos] = [
  { x: (CORNER_RADIUS * 0.6) / SQRT2, y: (CORNER_RADIUS * 0.6) / SQRT2 },
  { x: SIZE - (CORNER_RADIUS * 0.6) / SQRT2, y: SIZE - (CORNER_RADIUS * 0.6) / SQRT2 },
];

function buildInitialGrid(): FlickGrid {
  const grid: FlickGrid = Array.from({ length: SIZE }, () => Array<PlayerIndex | null>(SIZE).fill(null));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (Math.hypot(cx, cy) <= CORNER_RADIUS) grid[y][x] = 0;
      else if (Math.hypot(SIZE - cx, SIZE - cy) <= CORNER_RADIUS) grid[y][x] = 1;
    }
  }
  return grid;
}

function clampCell(v: number): number {
  return Math.min(SIZE - 1, Math.max(0, Math.floor(v)));
}

function ownerAt(grid: FlickGrid, pos: FlickPos): PlayerIndex | null {
  return grid[clampCell(pos.y)][clampCell(pos.x)];
}

/** Standard ray-casting point-in-polygon test; treats `poly` as implicitly closed
 *  (last vertex connects back to the first), which is exactly the "return into your
 *  land" edge of a flick path. Polygons with fewer than 3 vertices enclose no area. */
function pointInPolygon(px: number, py: number, poly: FlickPos[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Rasterises the closed flick-path polygon onto the grid for `player`, skipping any cell
 *  already owned by the opponent (you claim through neutral land, never through theirs).
 *  Returns the new grid plus how many previously-neutral cells were newly claimed. */
function claimPolygon(grid: FlickGrid, path: FlickPos[], player: PlayerIndex): { grid: FlickGrid; claimed: number } {
  if (path.length < 3) return { grid, claimed: 0 };
  const opponent: PlayerIndex = player === 0 ? 1 : 0;
  const next = grid.map((row) => row.slice());

  let minX = SIZE;
  let maxX = 0;
  let minY = SIZE;
  let maxY = 0;
  for (const p of path) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const xStart = clampCell(minX);
  const xEnd = clampCell(Math.ceil(maxX));
  const yStart = clampCell(minY);
  const yEnd = clampCell(Math.ceil(maxY));

  let claimed = 0;
  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      if (next[y][x] === opponent) continue;
      if (pointInPolygon(x + 0.5, y + 0.5, path)) {
        if (next[y][x] === null) claimed++;
        next[y][x] = player;
      }
    }
  }
  return { grid: next, claimed };
}

function areaCounts(grid: FlickGrid): { p0: number; p1: number; neutral: number } {
  let p0 = 0;
  let p1 = 0;
  let neutral = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell === 0) p0++;
      else if (cell === 1) p1++;
      else neutral++;
    }
  }
  return { p0, p1, neutral };
}

function pct(n: number, total: number): string {
  return (Math.round((n / total) * 1000) / 10).toFixed(1);
}

function computeEndStatus(grid: FlickGrid, round: number): StatusResult {
  const { p0, p1, neutral } = areaCounts(grid);
  const total = SIZE * SIZE;
  const roundsDone = round >= ROUND_LIMIT;
  const boardFull = neutral <= total * NEUTRAL_END_FRACTION;
  if (!roundsDone && !boardFull) {
    return { status: "ongoing", winner: null, reason: "" };
  }
  if (p0 === p1) {
    return { status: "draw", winner: null, reason: `땅 넓이가 같아 무승부입니다 (${pct(p0, total)}% : ${pct(p1, total)}%)` };
  }
  const winner: PlayerIndex = p0 > p1 ? 0 : 1;
  return { status: "win", winner, reason: `${pct(p0, total)}% : ${pct(p1, total)}%로 승리했습니다` };
}

/** Ends the current player's turn: hands the stone to rest at `restingPos`, resets flicks/path
 *  for whoever moves next, advances round/turn, and folds in the end-of-game check. `outcomeReason`
 *  describes what just happened and is kept only while the game is still ongoing — once the game
 *  ends, the final win/draw reason takes over. */
function endTurn(
  state: FlickState,
  grid: FlickGrid,
  player: PlayerIndex,
  restingPos: FlickPos,
  outcomeReason: string,
  shot: FlickShot | null,
): FlickState {
  const nextPlayer: PlayerIndex = player === 0 ? 1 : 0;
  const stones: [FlickPos, FlickPos] = [state.stones[0], state.stones[1]];
  stones[player] = restingPos;
  const round = state.round + 1;
  const end = computeEndStatus(grid, round);
  return {
    grid,
    stones,
    flicksLeft: 3,
    path: [stones[nextPlayer]],
    round,
    lastShot: shot,
    turn: nextPlayer,
    status: end.status,
    winner: end.winner,
    reason: end.status === "ongoing" ? outcomeReason : end.reason,
  };
}

/** Evenly spread full-power directions — see the contract note at the top of this file. */
function sampledFlicks(count: number): FlickMove[] {
  const moves: FlickMove[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    moves.push({ kind: "flick", dx: MAX_FLICK * Math.cos(angle), dy: MAX_FLICK * Math.sin(angle) });
  }
  return moves;
}

export const flickEngine: GameEngine<FlickState, FlickMove> = {
  meta: {
    id: "flick",
    nameKo: "땅따먹기 (돌 튕기기)",
    width: SIZE,
    height: SIZE,
    gridStyle: "cell",
    playerLabels: ["파랑", "주황"],
    renderer: "flick",
  },

  createInitialState(): FlickState {
    return {
      grid: buildInitialGrid(),
      stones: [STONE_START[0], STONE_START[1]],
      flicksLeft: 3,
      path: [STONE_START[0]],
      round: 0,
      lastShot: null,
      turn: 0,
      status: "ongoing",
      winner: null,
      reason: "",
    };
  },

  turn(state) {
    return state.turn;
  },

  status(state): StatusResult {
    return { status: state.status, winner: state.winner, reason: state.reason };
  },

  legalMoves(state, player): FlickMove[] {
    if (state.status !== "ongoing" || state.turn !== player) return [];
    return [...sampledFlicks(20), { kind: "giveup" }];
  },

  applyMove(state, move, player): ApplyResult<FlickState> {
    const current: StatusResult = { status: state.status, winner: state.winner, reason: state.reason };
    if (state.status !== "ongoing") {
      return { ok: false, state, error: "게임이 이미 종료되었습니다.", status: current };
    }
    if (state.turn !== player) {
      return { ok: false, state, error: "상대방의 차례입니다.", status: current };
    }

    const start = state.path[0];

    if (move.kind === "giveup") {
      // No shot to replay, so clients have nothing to animate.
      const nextState = endTurn(state, state.grid, player, start, "차례를 포기했습니다.", null);
      return { ok: true, state: nextState, status: { status: nextState.status, winner: nextState.winner, reason: nextState.reason } };
    }

    if (move.kind !== "flick") {
      return { ok: false, state, error: "알 수 없는 동작입니다.", status: current };
    }

    const { dx, dy } = move;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return { ok: false, state, error: "잘못된 방향입니다.", status: current };
    }
    const power = Math.hypot(dx, dy);
    if (power > MAX_FLICK + EPS) {
      return { ok: false, state, error: "튕기는 힘이 너무 셉니다.", status: current };
    }

    const from = state.stones[player];
    const to: FlickPos = { x: from.x + dx, y: from.y + dy };
    const offBoard = to.x < 0 || to.x > SIZE || to.y < 0 || to.y > SIZE;

    const shot = (outcome: FlickOutcome, claimed = 0): FlickShot => ({ player, from, to, outcome, claimed });

    if (offBoard) {
      const nextState = endTurn(
        state,
        state.grid,
        player,
        start,
        "돌이 보드를 벗어나 차례가 넘어갔습니다.",
        shot("off"),
      );
      return { ok: true, state: nextState, status: { status: nextState.status, winner: nextState.winner, reason: nextState.reason } };
    }

    const newPath = [...state.path, to];
    const flicksLeft = state.flicksLeft - 1;
    const landedHome = ownerAt(state.grid, to) === player;

    if (landedHome) {
      const { grid, claimed } = claimPolygon(state.grid, newPath, player);
      const nextState = endTurn(state, grid, player, to, `땅을 ${claimed}칸 차지했습니다!`, shot("claim", claimed));
      return { ok: true, state: nextState, status: { status: nextState.status, winner: nextState.winner, reason: nextState.reason } };
    }

    if (flicksLeft <= 0) {
      const nextState = endTurn(
        state,
        state.grid,
        player,
        start,
        "세 번 튕겼지만 자기 땅으로 돌아오지 못했습니다.",
        shot("spent"),
      );
      return { ok: true, state: nextState, status: { status: nextState.status, winner: nextState.winner, reason: nextState.reason } };
    }

    const stones: [FlickPos, FlickPos] = [state.stones[0], state.stones[1]];
    stones[player] = to;
    const nextState: FlickState = { ...state, stones, path: newPath, flicksLeft, lastShot: shot("open") };
    return { ok: true, state: nextState, status: current };
  },

  pieces(state): BoardPiece[] {
    return [
      { pos: state.stones[0], owner: 0, glyph: "●" },
      { pos: state.stones[1], owner: 1, glyph: "●" },
    ];
  },
};
