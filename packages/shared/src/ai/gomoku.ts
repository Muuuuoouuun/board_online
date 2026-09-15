import type { Move, PlayerIndex, Rng } from "../types.js";
import { gomokuEngine, type GomokuState } from "../games/gomoku.js";
import type { AiProvider } from "./types.js";
import { makeSearchAi } from "./search.js";
import { pickRandom } from "./random.js";

/**
 * Gomoku (오목) computer opponent.
 *
 * The search is the generic iterative-deepening alpha-beta from search.ts; this
 * file supplies the gomoku knowledge that makes it useful on a 15×15 board:
 *
 *  - evaluate(): counts line shapes (open/closed twos, threes, fours, including
 *    broken ones like XX_X) for both sides and adds a tempo term for the side to
 *    move, so a leaf where the mover already has a four — or an open three the
 *    opponent cannot answer — is recognised as decided without searching on.
 *  - candidates(): only empty points within Chebyshev distance 2 of a stone,
 *    ordered by the shape a stone there would make for either side and cut to a
 *    small branching factor. When someone can complete five next move only the
 *    winning / blocking points are searched, so forcing sequences are followed
 *    far deeper than the nominal depth.
 *  - chooseMove(): before searching, takes a five when available and blocks the
 *    opponent's five-threat at every level — an easy bot that lets a straight
 *    four through reads as broken rather than easy.
 */

const SIZE = 15;
const CELLS = SIZE * SIZE;
const CENTRE = Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2);

/** Flattened-board cell values: 0 and 1 are the players, then: */
const EMPTY = 2;
const WALL = 3; // off the board; behaves like an enemy stone when classifying shapes

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/**
 * Shape classes of one side's stones along one line, best first. In the
 * diagrams `_` is an empty point, `X` a stone, `O` an enemy stone or the edge.
 */
const FIVE = 0; // XXXXX (or longer — the engine counts overlines as wins too)
const OPEN_FOUR = 1; // _XXXX_: two points complete five, cannot be stopped
const FOUR = 2; // OXXXX_, XXX_X, XX_XX: exactly one point completes five
const OPEN_THREE = 3; // __XXX_, _XX_X_: one more stone makes an open four
const CLOSED_THREE = 4; // OXXX__, O_XXX_O, OXX_X_: one more stone makes a (closed) four
const OPEN_TWO = 5; // _XX_, _X_X_
const CLOSED_TWO = 6; // OXX__
const ONE = 7; // _X_
const NONE = 8; // dead: can never become five

/** Static worth of each shape class. A whole board sums to well under WIN_SCORE. */
const WEIGHTS = [100_000, 12_000, 2_600, 2_400, 260, 220, 30, 6, 0] as const;
const CLASSES = WEIGHTS.length;

/**
 * Tempo terms added to the raw shape difference, from the mover's point of view.
 * They encode the forcing logic a leaf evaluation would otherwise miss.
 */
const TEMPO_WIN = 50_000; // mover has a four: five comes next move
const TEMPO_LOST = 40_000; // opponent has an open four or two fours: one block is not enough
const TEMPO_OPEN_THREE = 15_000; // mover has an open three and faces no four: open four next
const TEMPO_DOUBLE_THREE = 10_000; // opponent has two open threes: only one can be blocked
const TEMPO_FORCED = 1_000; // mover must spend this move blocking a four or open three
const EVAL_CLAMP = 90_000; // keeps every evaluation strictly inside ±WIN_SCORE

const EASY_RANDOMNESS = 0.5;

const LEVELS = {
  easy: { depth: 1, budgetMs: 100 },
  normal: { depth: 4, budgetMs: 500 },
  hard: { depth: 6, budgetMs: 1200 },
};

function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

function toMove(idx: number): Move {
  return { to: { x: idx % SIZE, y: Math.floor(idx / SIZE) } };
}

function flatten(board: (PlayerIndex | null)[][]): Int8Array {
  const cells = new Int8Array(CELLS);
  for (let y = 0; y < SIZE; y++) {
    const row = board[y];
    for (let x = 0; x < SIZE; x++) {
      const v = row[x];
      cells[y * SIZE + x] = v === null ? EMPTY : v;
    }
  }
  return cells;
}

/* ------------------------------------------------------------------------ */
/* Shape classification                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Class of a solid run of `len` stones. `lOpen`/`rOpen` say whether the point
 * right next to the run on each side is empty; `lOpen2`/`rOpen2` the point
 * after that. The second point matters for threes: `O_XXX_O` can only ever
 * become a closed four, so it is not an open three.
 */
function classifySolid(len: number, lOpen: boolean, rOpen: boolean, lOpen2: boolean, rOpen2: boolean): number {
  if (len >= 5) return FIVE;
  if (len === 4) return lOpen && rOpen ? OPEN_FOUR : lOpen || rOpen ? FOUR : NONE;
  const roomL = lOpen && lOpen2;
  const roomR = rOpen && rOpen2;
  if (len === 3) {
    if (lOpen && rOpen) return lOpen2 || rOpen2 ? OPEN_THREE : CLOSED_THREE;
    return roomL || roomR ? CLOSED_THREE : NONE;
  }
  if (len === 2) {
    if (lOpen && rOpen) return OPEN_TWO;
    return roomL || roomR ? CLOSED_TWO : NONE;
  }
  return lOpen && rOpen ? ONE : NONE;
}

/**
 * Class of two runs separated by a single empty point (`XX_X`), `total` stones
 * in all. Filling the gap turns it into a solid run, which is why a broken
 * four is a plain four (one completing point) and a broken three with both
 * ends open is an open three.
 */
function classifyBroken(total: number, lOpen: boolean, rOpen: boolean): number {
  if (total >= 4) return FOUR;
  if (total === 3) return lOpen && rOpen ? OPEN_THREE : lOpen || rOpen ? CLOSED_THREE : NONE;
  if (total === 2) return lOpen && rOpen ? OPEN_TWO : lOpen || rOpen ? CLOSED_TWO : NONE;
  return NONE;
}

/* ------------------------------------------------------------------------ */
/* Static evaluation                                                        */
/* ------------------------------------------------------------------------ */

/** Every row, column and diagonal long enough to hold five, as flat cell indices. */
const LINES: Int16Array[] = (() => {
  const lines: Int16Array[] = [];
  const add = (x: number, y: number, dx: number, dy: number) => {
    const idx: number[] = [];
    for (; x >= 0 && x < SIZE && y >= 0 && y < SIZE; x += dx, y += dy) idx.push(y * SIZE + x);
    if (idx.length >= 5) lines.push(Int16Array.from(idx));
  };
  for (let i = 0; i < SIZE; i++) {
    add(0, i, 1, 0); // row
    add(i, 0, 0, 1); // column
    add(i, 0, 1, 1); // ↘ diagonal from the top edge
    add(0, i, 1, -1); // ↗ diagonal from the left edge
    if (i > 0) {
      add(0, i, 1, 1); // ↘ diagonal from the left edge ((0,0) is already a top-edge start)
      add(i, SIZE - 1, 1, -1); // ↗ diagonal from the bottom edge ((0,14) is already a left-edge start)
    }
  }
  return lines;
})();

/** Per-player shape counts, indexed `player * CLASSES + class`. Reused across calls. */
const counts = new Int32Array(2 * CLASSES);
/** One line's cells with two WALL sentinels on each side, so the scanner never bounds-checks. */
const lineBuf = new Int8Array(SIZE + 4);

/**
 * Walks one padded line left to right and tallies every shape on it. Each
 * stone belongs to exactly one shape: a run, or a run + gap + run pair when a
 * single empty point separates two runs of the same colour (runs of four or
 * more are always classified on their own, since `_XXXX_X` is an open four
 * rather than a broken six).
 */
function scanLine(c: Int8Array, n: number): void {
  const end = n + 2;
  let i = 2;
  while (i < end) {
    const p = c[i];
    if (p > 1) {
      i++;
      continue;
    }
    let j = i + 1;
    while (c[j] === p) j++;
    const len1 = j - i;
    const lOpen = c[i - 1] === EMPTY;
    if (len1 < 4 && c[j] === EMPTY && c[j + 1] === p) {
      let k = j + 2;
      while (c[k] === p) k++;
      const len2 = k - j - 1;
      if (len2 < 4) {
        counts[p * CLASSES + classifyBroken(len1 + len2, lOpen, c[k] === EMPTY)]++;
        i = k;
        continue;
      }
    }
    counts[p * CLASSES + classifySolid(len1, lOpen, c[j] === EMPTY, c[i - 2] === EMPTY, c[j + 1] === EMPTY)]++;
    i = j;
  }
}

function countShapes(cells: Int8Array): void {
  counts.fill(0);
  for (const line of LINES) {
    const n = line.length;
    lineBuf[0] = WALL;
    lineBuf[1] = WALL;
    for (let t = 0; t < n; t++) lineBuf[t + 2] = cells[line[t]];
    lineBuf[n + 2] = WALL;
    lineBuf[n + 3] = WALL;
    scanLine(lineBuf, n);
  }
}

function rawScore(p: PlayerIndex): number {
  const base = p * CLASSES;
  let s = 0;
  for (let k = 0; k < CLASSES; k++) s += WEIGHTS[k] * counts[base + k];
  return s;
}

/**
 * Raw shape difference plus a tempo term for the side to move. The tempo
 * cases are checked in forcing order: a four of the mover's wins outright, an
 * unanswerable four of the opponent's loses, a single enemy four merely costs
 * the move, and only then do open threes decide anything.
 */
function evaluate(state: GomokuState, root: PlayerIndex): number {
  countShapes(flatten(state.board));
  const mover = state.turn;
  const opp = other(mover);
  const m = mover * CLASSES;
  const o = opp * CLASSES;
  let score = rawScore(mover) - rawScore(opp);
  if (counts[m + FOUR] + counts[m + OPEN_FOUR] > 0) score += TEMPO_WIN;
  else if (counts[o + OPEN_FOUR] > 0 || counts[o + FOUR] >= 2) score -= TEMPO_LOST;
  else if (counts[o + FOUR] === 1) score -= TEMPO_FORCED;
  else if (counts[m + OPEN_THREE] > 0) score += TEMPO_OPEN_THREE;
  else if (counts[o + OPEN_THREE] >= 2) score -= TEMPO_DOUBLE_THREE;
  else if (counts[o + OPEN_THREE] === 1) score -= TEMPO_FORCED;
  score = Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, score));
  return mover === root ? score : -score;
}

/* ------------------------------------------------------------------------ */
/* Candidate moves                                                          */
/* ------------------------------------------------------------------------ */

function at(cells: Int8Array, x: number, y: number): number {
  return x < 0 || x >= SIZE || y < 0 || y >= SIZE ? WALL : cells[y * SIZE + x];
}

/** Results of probe(), kept in module scope to avoid allocating per call. */
let pRun = 0; // consecutive stones of the probed colour right next to the origin
let pEnd = WALL; // what follows that run
let pEnd2 = WALL; // what follows pEnd (only read when pEnd is EMPTY)
let pGapRun = 0; // stones of the same colour right after a single empty point
let pGapEnd = WALL; // what follows that second run

/** Looks along (dx,dy) from (x,y) — the origin itself is not read — for stones of colour `p`. */
function probe(cells: Int8Array, x: number, y: number, dx: number, dy: number, p: number): void {
  x += dx;
  y += dy;
  let n = 0;
  let v = at(cells, x, y);
  while (v === p) {
    n++;
    x += dx;
    y += dy;
    v = at(cells, x, y);
  }
  pRun = n;
  pEnd = v;
  pEnd2 = WALL;
  pGapRun = 0;
  pGapEnd = WALL;
  if (v !== EMPTY) return;
  x += dx;
  y += dy;
  v = at(cells, x, y);
  pEnd2 = v;
  if (v !== p) return;
  let g = 0;
  while (v === p) {
    g++;
    x += dx;
    y += dy;
    v = at(cells, x, y);
  }
  pGapRun = g;
  pGapEnd = v;
}

/**
 * Worth of the shapes a stone of `p` placed on the empty cell `idx` would form,
 * summed over the four line directions. In each direction the best reading of
 * the solid run through the cell and of a run + gap + run on either side is
 * used, so `_XX_X_` scores as the four that filling its gap would make.
 */
function placementScore(cells: Int8Array, idx: number, p: PlayerIndex): number {
  const x = idx % SIZE;
  const y = (idx - x) / SIZE;
  let total = 0;
  for (const [dx, dy] of DIRS) {
    probe(cells, x, y, dx, dy, p);
    const n1 = pRun;
    const e1 = pEnd;
    const e1b = pEnd2;
    const g1 = pGapRun;
    const ge1 = pGapEnd;
    probe(cells, x, y, -dx, -dy, p);
    const len = 1 + n1 + pRun;
    let best: number = WEIGHTS[classifySolid(len, pEnd === EMPTY, e1 === EMPTY, pEnd2 === EMPTY, e1b === EMPTY)];
    if (g1 > 0) best = Math.max(best, WEIGHTS[classifyBroken(len + g1, pEnd === EMPTY, ge1 === EMPTY)]);
    if (pGapRun > 0) best = Math.max(best, WEIGHTS[classifyBroken(len + pGapRun, pGapEnd === EMPTY, e1 === EMPTY)]);
    total += best;
  }
  return total;
}

interface Scored {
  idx: number;
  score: number;
}

interface CandidateScan {
  stones: number;
  /** A cell that completes five for the mover, or -1. When set, nothing else is filled in. */
  win: number;
  /** Cells where the opponent would complete five; the mover must take one of them. */
  blocks: number[];
  /** Every empty cell within distance 2 of a stone, best first (attack + defence worth). */
  scored: Scored[];
}

/**
 * Scores every playable point near the stones for `mover`. Attack and defence
 * are added with equal weight: a point that blocks the opponent's open three is
 * worth searching exactly as early as one that makes our own.
 */
function scanCandidates(cells: Int8Array, mover: PlayerIndex): CandidateScan {
  const near = new Uint8Array(CELLS);
  let stones = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (cells[y * SIZE + x] === EMPTY) continue;
      stones++;
      const y0 = Math.max(0, y - 2);
      const y1 = Math.min(SIZE - 1, y + 2);
      const x0 = Math.max(0, x - 2);
      const x1 = Math.min(SIZE - 1, x + 2);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) near[yy * SIZE + xx] = 1;
    }
  }
  const opp = other(mover);
  const scored: Scored[] = [];
  const blocks: number[] = [];
  for (let idx = 0; idx < CELLS; idx++) {
    if (near[idx] === 0 || cells[idx] !== EMPTY) continue;
    const attack = placementScore(cells, idx, mover);
    if (attack >= WEIGHTS[FIVE]) return { stones, win: idx, blocks, scored };
    const defence = placementScore(cells, idx, opp);
    if (defence >= WEIGHTS[FIVE]) blocks.push(idx);
    scored.push({ idx, score: attack + defence });
  }
  scored.sort((a, b) => b.score - a.score);
  return { stones, win: -1, blocks, scored };
}

/** Moves kept per node; fewer near the leaves, where the ordering is most reliable. */
function branchLimit(depthLeft: number): number {
  return depthLeft <= 1 ? 8 : depthLeft <= 3 ? 12 : 16;
}

function candidates(state: GomokuState, mover: PlayerIndex, depthLeft: number): Move[] {
  const scan = scanCandidates(flatten(state.board), mover);
  if (scan.stones === 0) return [toMove(CENTRE)];
  if (scan.win >= 0) return [toMove(scan.win)];
  if (scan.blocks.length > 0) return scan.blocks.map(toMove);
  return scan.scored.slice(0, branchLimit(depthLeft)).map((s) => toMove(s.idx));
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                 */
/* ------------------------------------------------------------------------ */

const searchAi = makeSearchAi<GomokuState, Move>({
  engine: gomokuEngine,
  evaluate,
  candidates,
  levels: LEVELS,
});

/** Last resort when something unexpected happens: any legal move, or null if there is none. */
function fallback(state: GomokuState, player: PlayerIndex, rng: Rng): Move | null {
  try {
    const legal = gomokuEngine.legalMoves(state, player);
    return legal.length > 0 ? pickRandom(legal, rng) : null;
  } catch {
    return null;
  }
}

export const gomokuAi: AiProvider<GomokuState, Move> = {
  testProfile: { games: 10, minWinRate: 0.9, budgetMs: 40, maxPlies: CELLS },
  chooseMove(state, player, level, options = {}) {
    const rng = options.rng ?? Math.random;
    try {
      if (state.status !== "ongoing" || state.turn !== player) return null;
      const scan = scanCandidates(flatten(state.board), player);
      if (scan.stones === 0) return toMove(CENTRE);
      if (scan.win >= 0) return toMove(scan.win);
      if (scan.blocks.length > 0) {
        // Several blocks means the opponent already has two ways to five; take
        // whichever block also does the most for us and hope they miss it.
        const best = scan.scored.find((s) => scan.blocks.includes(s.idx));
        return toMove(best ? best.idx : scan.blocks[0]);
      }
      if (level === "easy" && rng() < EASY_RANDOMNESS && scan.scored.length > 0) {
        // Easy plays a plausible-looking but unconsidered move half the time:
        // any nearby point that touches one of somebody's lines. It still never
        // misses a five or a block above, so it feels careless, not broken.
        const touching = scan.scored.filter((s) => s.score > 0);
        return toMove(pickRandom(touching.length > 0 ? touching : scan.scored, rng).idx);
      }
      return searchAi.chooseMove(state, player, level, options) ?? fallback(state, player, rng);
    } catch {
      return fallback(state, player, rng);
    }
  },
};
