import type { Move, PlayerIndex } from "../types.js";
import { reversiEngine, type ReversiState } from "../games/reversi.js";
import type { AiProvider } from "./types.js";
import { makeSearchAi } from "./search.js";

/**
 * Reversi (리버시/오델로) computer opponent.
 *
 * Built on the generic iterative-deepening alpha-beta from search.ts; this file
 * supplies the reversi-specific pieces:
 *
 *  - evaluate(): a classic Othello heuristic — a positional weight table (corners
 *    great, the squares next to an EMPTY corner dangerous, waived once that
 *    corner is settled), mobility, frontier discs, and explicit corner
 *    ownership — that switches to exact disc-count near the end of the game,
 *    once shape stops mattering and only the final tally does.
 *  - candidates(): reuses the engine's own legalMoves (so it is always a legal
 *    subset by construction) but reorders them best-first — corners first, then
 *    the same positional table used by evaluate — so alpha-beta cuts hard.
 *
 * reversi.ts (the rules engine) keeps flip detection and legal-move generation
 * private, and only ever reports legal moves for the side whose turn it
 * actually is. evaluate() needs "how mobile would each color be right now",
 * for both colors, regardless of whose turn it is — so this file carries its
 * own small reimplementation of the flip rule (SIZE/DIRS/flipsAt below),
 * mirroring games/reversi.ts exactly. Move *generation* for the search itself
 * still goes through the real engine (candidates(), and findImmediateWin /
 * legalMoves inside makeSearchAi), so every move ever returned or searched is
 * one the engine actually accepts.
 */

const SIZE = 8;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const CORNERS: ReadonlyArray<readonly [number, number]> = [[0, 0], [7, 0], [0, 7], [7, 7]];

type Board = (PlayerIndex | null)[][]; // board[y][x], same layout as ReversiState.board

function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

function isCorner(x: number, y: number): boolean {
  return (x === 0 || x === 7) && (y === 0 || y === 7);
}

/**
 * Discs that `player` placing at (x,y) would flip. Mirrors flipsFor() in
 * games/reversi.ts (not exported from there), so this file can ask "what
 * would happen" for either color without depending on whose turn it is.
 */
function flipsAt(board: Board, x: number, y: number, player: PlayerIndex): [number, number][] {
  if (board[y][x] !== null) return [];
  const opponent = other(player);
  const flips: [number, number][] = [];
  for (const [dx, dy] of DIRS) {
    const line: [number, number][] = [];
    let cx = x + dx;
    let cy = y + dy;
    while (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[cy][cx] === opponent) {
      line.push([cx, cy]);
      cx += dx;
      cy += dy;
    }
    if (line.length > 0 && cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[cy][cx] === player) {
      flips.push(...line);
    }
  }
  return flips;
}

/** How many cells `player` could legally play on, regardless of whose turn it actually is. */
function countLegalMoves(board: Board, player: PlayerIndex): number {
  let n = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === null && flipsAt(board, x, y, player).length > 0) n++;
    }
  }
  return n;
}

/** A disc is "frontier" when it touches at least one empty square — exposed to being outflanked. */
function isFrontier(board: Board, x: number, y: number): boolean {
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === null) return true;
  }
  return false;
}

function countDiscs(board: Board): [black: number, white: number] {
  let black = 0;
  let white = 0;
  for (const row of board) {
    for (const c of row) {
      if (c === 0) black++;
      else if (c === 1) white++;
    }
  }
  return [black, white];
}

/* ------------------------------------------------------------------------ */
/* Positional weight table                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Classic hand-tuned Othello square values, indexed [y][x]. Corners (120) are
 * the best square on the board — permanent and a launchpad for a stable edge.
 * The diagonal "X-squares" (-40) and orthogonal "C-squares" (-20) next to a
 * corner are dangerous *while that corner is still empty*: playing there
 * commonly hands the opponent the corner itself. cellWeight() below waives
 * that penalty once the corner is no longer up for grabs.
 */
const POSITION_WEIGHTS: readonly (readonly number[])[] = [
  [120, -20, 20, 5, 5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20, 5, 5, 20, -20, 120],
];

/** Each danger square (X/C-square) mapped to the corner whose emptiness makes it dangerous. */
const DANGER_SQUARE_CORNER = new Map<string, readonly [number, number]>([
  ["1,1", [0, 0]], ["1,0", [0, 0]], ["0,1", [0, 0]],
  ["6,1", [7, 0]], ["6,0", [7, 0]], ["7,1", [7, 0]],
  ["1,6", [0, 7]], ["1,7", [0, 7]], ["0,6", [0, 7]],
  ["6,6", [7, 7]], ["6,7", [7, 7]], ["7,6", [7, 7]],
]);
/** Once its corner is settled, a danger square is just an ordinary edge-adjacent cell. */
const NEUTRAL_DANGER_WEIGHT = 5;

function cellWeight(board: Board, x: number, y: number): number {
  const corner = DANGER_SQUARE_CORNER.get(`${x},${y}`);
  if (corner && board[corner[1]][corner[0]] !== null) return NEUTRAL_DANGER_WEIGHT;
  return POSITION_WEIGHTS[y]![x]!;
}

/* ------------------------------------------------------------------------ */
/* Evaluation                                                                */
/* ------------------------------------------------------------------------ */

const MOBILITY_WEIGHT = 12; // having more legal moves than the opponent keeps options open and forces bad replies
const FRONTIER_WEIGHT = 4; // fewer frontier (edge-of-mass) discs means fewer discs exposed to being outflanked soon
const CORNER_WEIGHT = 30; // extra emphasis on top of the position table: corners anchor a whole stable edge
const DISC_DIFF_WEIGHT = 10; // endgame coin-parity scale, kept in the same rough order of magnitude as the midgame score
const ENDGAME_EMPTY_THRESHOLD = 10; // ≤ this many empty squares left: shape no longer matters, only the final tally
const EVAL_CLAMP = 20_000; // comfortably inside WIN_SCORE (1,000,000)

function clamp(v: number): number {
  return Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, v));
}

/** Static evaluation of a non-terminal `state`, from `root`'s point of view (bigger is better for root). */
function evaluate(state: ReversiState, root: PlayerIndex): number {
  const board = state.board;
  const opp = other(root);
  const [black, white] = countDiscs(board);
  const empties = SIZE * SIZE - black - white;
  const myDiscs = root === 0 ? black : white;
  const theirDiscs = root === 0 ? white : black;

  if (empties <= ENDGAME_EMPTY_THRESHOLD) {
    // Close to a full board there is little room left to maneuver for position;
    // what decides the game is who actually ends up with more discs, so switch
    // straight to exact coin-count difference instead of the shape heuristics below.
    return clamp((myDiscs - theirDiscs) * DISC_DIFF_WEIGHT);
  }

  let position = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = board[y][x];
      if (v === null) continue;
      const w = cellWeight(board, x, y);
      position += v === root ? w : -w;
    }
  }

  const mobility = MOBILITY_WEIGHT * (countLegalMoves(board, root) - countLegalMoves(board, opp));

  let myFrontier = 0;
  let theirFrontier = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = board[y][x];
      if (v === null || !isFrontier(board, x, y)) continue;
      if (v === root) myFrontier++;
      else theirFrontier++;
    }
  }
  const frontier = FRONTIER_WEIGHT * (theirFrontier - myFrontier); // fewer of mine, more of theirs, is good for me

  let myCorners = 0;
  let theirCorners = 0;
  for (const [cx, cy] of CORNERS) {
    const v = board[cy]![cx];
    if (v === root) myCorners++;
    else if (v === opp) theirCorners++;
  }
  const cornerTerm = CORNER_WEIGHT * (myCorners - theirCorners);

  return clamp(position + mobility + frontier + cornerTerm);
}

/* ------------------------------------------------------------------------ */
/* Candidate move ordering                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Best-first ordering for alpha-beta: corners are always searched first
 * (they're decisive and never wrong to consider early), then the same
 * positional table evaluate() uses, with the number of discs flipped as a
 * small tie-breaker. The moves themselves come straight from the engine, so
 * this is always exactly the legal set, just reordered.
 */
function candidates(state: ReversiState, mover: PlayerIndex, _depthLeft: number): Move[] {
  const board = state.board;
  const legal = reversiEngine.legalMoves(state, mover);
  return legal
    .map((move) => {
      const { x, y } = move.to;
      const score = isCorner(x, y) ? 1_000_000 : cellWeight(board, x, y) * 10 + flipsAt(board, x, y, mover).length;
      return { move, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.move);
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                  */
/* ------------------------------------------------------------------------ */

const LEVELS = {
  easy: { depth: 1, budgetMs: 100, randomness: 0.5 },
  normal: { depth: 4, budgetMs: 500 },
  hard: { depth: 8, budgetMs: 1200 },
};

export const reversiAi: AiProvider<ReversiState, Move> = makeSearchAi<ReversiState, Move>({
  engine: reversiEngine,
  evaluate,
  candidates,
  levels: LEVELS,
  // Reversi is deterministic and short (≤ 60 plies): a solid normal level should
  // beat a random mover almost every time, not just 70% of the time.
  testProfile: { games: 12, minWinRate: 0.9, budgetMs: 40, maxPlies: 150 },
});
