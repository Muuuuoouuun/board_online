import type { PlayerIndex, Rng } from "../types.js";
import { territoryEngine, type TerritoryMove, type TerritoryState } from "../games/territory.js";
import type { AiLevel, AiProvider } from "./types.js";
import { pickRandom, shuffle } from "./random.js";
import { findImmediateWin } from "./search.js";

/**
 * 땅따먹기 (territory, line-drawing variant) computer opponent.
 *
 * A turn here is a whole path, not a single step: the mover keeps extending a
 * line of neutral cells out of their territory until it reconnects (capturing
 * the line plus everything it encloses) or fails (touches enemy land, touches
 * itself, or runs out of room — nothing gained). The opponent cannot interfere
 * while the line is drawn, so the position is fully known and the only question
 * each turn is *which closed route to draw*. Minimax over single steps would be
 * pointless; this is a route planner:
 *
 *  - planRoutes(): depth-limited DFS from the current path head. The in-progress
 *    path is kept as a fixed prefix, so every route found extends what is already
 *    drawn and replanning after each step stays consistent. The DFS only steps
 *    onto cells the engine would accept without ending the turn: neutral, not
 *    next to enemy territory, and not next to any path cell but the head. A step
 *    onto a cell next to our own territory closes the route; its gain (path cells
 *    + enclosed cells) is measured with the same edge flood fill the engine uses.
 *    Iterative deepening on route length guarantees a complete shallow scan
 *    inside any budget, and the deepest finished pass is what gets used.
 *  - positional(): the best routes by raw gain are re-ranked by the territory
 *    they leave behind — neutral cells strictly closer to us than to the opponent
 *    (distances through cells each side may actually enter) minus the reverse.
 *    That prefers routes that wall off space and grab contested cells over
 *    routes that tidy up a corner nobody else can reach.
 *  - Levels differ in how many cells they will add to a route (6 / 10 / 14) and
 *    in time; easy also follows a random route instead of the best one 40% of the
 *    time, so it mostly takes small bites and is easy to out-draw.
 */

const W = territoryEngine.meta.width;
const H = territoryEngine.meta.height;
const N = W * H;

/** Flattened board values: 0 and 1 are the players, NEUTRAL is unowned. */
const NEUTRAL = 2;
/** Distance of a cell a side cannot reach at all. */
const UNREACHABLE = 30_000;
/** Routes kept for positional re-ranking, best raw gain first. */
const TOP_ROUTES = 24;
/** Weight of one "closer to us" neutral cell relative to one captured cell. */
const POSITIONAL_WEIGHT = 0.5;

interface LevelConfig {
  /** Most cells a route may add beyond the path already drawn. */
  maxExtra: number;
  budgetMs: number;
  /** 0..1 — probability of following a random completing route instead of the best. */
  randomness: number;
}

const LEVELS: Record<AiLevel, LevelConfig> = {
  easy: { maxExtra: 6, budgetMs: 100, randomness: 0.4 },
  normal: { maxExtra: 10, budgetMs: 500, randomness: 0 },
  hard: { maxExtra: 14, budgetMs: 1200, randomness: 0 },
};

/** NB[c * 4 + k] is the k-th orthogonal neighbour of cell c, or -1 off the board. */
const NB = new Int16Array(N * 4).fill(-1);
/** Cells on the outer rim: where the enclosure flood fill starts. */
const EDGE: number[] = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const c = y * W + x;
    if (x > 0) NB[c * 4] = c - 1;
    if (x < W - 1) NB[c * 4 + 1] = c + 1;
    if (y > 0) NB[c * 4 + 2] = c - W;
    if (y < H - 1) NB[c * 4 + 3] = c + W;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) EDGE.push(c);
  }
}

function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

function toMove(c: number): TerritoryMove {
  return { to: { x: c % W, y: Math.floor(c / W) } };
}

/* ------------------------------------------------------------------------ */
/* Planner state                                                            */
/* ------------------------------------------------------------------------ */

/** A completing route: the cells it adds after the current path, and what it captures. */
interface Route {
  cells: number[];
  gain: number;
}

interface Planner {
  us: PlayerIndex;
  cells: Int8Array;
  /** Neutral cell next to our territory: legal first cell, and closes any later path. */
  home: Uint8Array;
  /** Neutral cell next to enemy territory: stepping on it forfeits the turn. */
  forbidden: Uint8Array;
  onPath: Uint8Array;
  /** How many path cells each cell touches; an extension must touch only the head. */
  pathAdj: Uint8Array;
  path: number[];
  /** Length of the path that was already drawn when the call started. */
  fixedLen: number;
  /** Legal, non-doomed first cells in the (shuffled) order the DFS tries them. */
  starts: number[];
  neutralCount: number;
  rng: Rng;
  now: () => number;
  deadline: number;
  nodes: number;
  timedOut: boolean;
  /** Set when a pass skipped an extension for depth: a deeper pass could find more. */
  cutByDepth: boolean;
  /** Output of the pass in progress. */
  best: Route[];
  found: number;
  /** Uniform sample of every route the pass found (easy's random choice), when wanted. */
  sample: Route | null;
  wantSample: boolean;
}

function makePlanner(state: TerritoryState, us: PlayerIndex, rng: Rng, now: () => number, deadline: number, wantSample: boolean): Planner {
  const cells = new Int8Array(N);
  let neutralCount = 0;
  for (let y = 0; y < H; y++) {
    const row = state.board[y];
    for (let x = 0; x < W; x++) {
      const v = row[x];
      if (v === null) {
        cells[y * W + x] = NEUTRAL;
        neutralCount++;
      } else {
        cells[y * W + x] = v;
      }
    }
  }
  const home = new Uint8Array(N);
  const forbidden = new Uint8Array(N);
  const them = other(us);
  for (let c = 0; c < N; c++) {
    if (cells[c] !== NEUTRAL) continue;
    for (let k = 0; k < 4; k++) {
      const n = NB[c * 4 + k];
      if (n < 0) continue;
      if (cells[n] === us) home[c] = 1;
      else if (cells[n] === them) forbidden[c] = 1;
    }
  }
  const p: Planner = {
    us,
    cells,
    home,
    forbidden,
    onPath: new Uint8Array(N),
    pathAdj: new Uint8Array(N),
    path: [],
    fixedLen: 0,
    starts: [],
    neutralCount,
    rng,
    now,
    deadline,
    nodes: 0,
    timedOut: false,
    cutByDepth: false,
    best: [],
    found: 0,
    sample: null,
    wantSample,
  };
  for (const pos of state.path) push(p, pos.y * W + pos.x);
  p.fixedLen = p.path.length;
  if (p.fixedLen === 0) {
    for (let c = 0; c < N; c++) if (home[c] && !forbidden[c]) p.starts.push(c);
    shuffle(p.starts, rng);
  }
  return p;
}

function push(p: Planner, c: number): void {
  p.onPath[c] = 1;
  p.path.push(c);
  for (let k = 0; k < 4; k++) {
    const n = NB[c * 4 + k];
    if (n >= 0) p.pathAdj[n]++;
  }
}

function pop(p: Planner, c: number): void {
  p.onPath[c] = 0;
  p.path.pop();
  for (let k = 0; k < 4; k++) {
    const n = NB[c * 4 + k];
    if (n >= 0) p.pathAdj[n]--;
  }
}

/** Whether the path may step from its head onto `n` without ending the turn. */
function canExtend(p: Planner, n: number): boolean {
  return n >= 0 && p.cells[n] === NEUTRAL && p.onPath[n] === 0 && p.forbidden[n] === 0 && p.pathAdj[n] === 1;
}

/* ------------------------------------------------------------------------ */
/* Enclosure                                                                */
/* ------------------------------------------------------------------------ */

const visited = new Int32Array(N);
const stack = new Int32Array(N);
let stamp = 0;

/**
 * Cells captured if `last` closes the current path: the path itself plus every
 * neutral cell the board edge can no longer reach with the path as a wall —
 * the engine's enclosure rule exactly. Neutral cells reachable from the edge
 * are counted and subtracted from the total instead of collecting the rest.
 */
function closedGain(p: Planner, last: number): number {
  const s = ++stamp;
  const cells = p.cells;
  const onPath = p.onPath;
  onPath[last] = 1;
  let reached = 0;
  let top = 0;
  for (const e of EDGE) {
    if (cells[e] !== NEUTRAL || onPath[e] || visited[e] === s) continue;
    visited[e] = s;
    stack[top++] = e;
    reached++;
  }
  while (top > 0) {
    const base = stack[--top] * 4;
    for (let k = 0; k < 4; k++) {
      const n = NB[base + k];
      if (n < 0 || visited[n] === s || cells[n] !== NEUTRAL || onPath[n]) continue;
      visited[n] = s;
      stack[top++] = n;
      reached++;
    }
  }
  onPath[last] = 0;
  return p.neutralCount - reached;
}

/* ------------------------------------------------------------------------ */
/* Route search                                                             */
/* ------------------------------------------------------------------------ */

function record(p: Planner, last: number): void {
  const gain = closedGain(p, last);
  p.found++;
  const best = p.best;
  const keep = best.length < TOP_ROUTES || gain > best[best.length - 1].gain;
  // Reservoir sampling: each route found so far is the sample with equal probability.
  const sampled = p.wantSample && Math.floor(p.rng() * p.found) === 0;
  if (!keep && !sampled) return;
  const cells = p.path.slice(p.fixedLen);
  cells.push(last);
  const route: Route = { cells, gain };
  if (sampled) p.sample = route;
  if (keep) {
    // Stable insert: among equal gains the route found first (from a shuffled start) stays ahead.
    let i = best.length;
    while (i > 0 && best[i - 1].gain < gain) i--;
    best.splice(i, 0, route);
    if (best.length > TOP_ROUTES) best.pop();
  }
}

/** Tries every extension of the current head, `remaining` cells at most, recording closed routes. */
function extend(p: Planner, remaining: number): void {
  if ((++p.nodes & 63) === 0 && p.now() >= p.deadline) p.timedOut = true;
  if (p.timedOut) return;
  const base = p.path[p.path.length - 1] * 4;
  for (let k = 0; k < 4; k++) {
    const n = NB[base + k];
    if (!canExtend(p, n)) continue;
    if (p.home[n]) {
      record(p, n);
      continue;
    }
    if (remaining < 2) {
      // One more cell could not close anything, so it is not worth placing.
      p.cutByDepth = true;
      continue;
    }
    push(p, n);
    extend(p, remaining - 1);
    pop(p, n);
    if (p.timedOut) return;
  }
}

interface PlanResult {
  /** Best routes by raw gain from the deepest pass that finished (plus whatever an unfinished pass added). */
  best: Route[];
  sample: Route | null;
}

/**
 * Iterative deepening over the number of cells a route may add. Each pass
 * re-explores the shallower routes, so its result supersedes the previous one;
 * when a pass is cut off by the clock, what it found is merged with the last
 * complete pass so no start cell is favoured just for being searched first.
 */
function planRoutes(p: Planner, maxExtra: number): PlanResult {
  let best: Route[] = [];
  let sample: Route | null = null;
  for (let d = p.fixedLen === 0 ? 2 : 1; d <= maxExtra; d++) {
    p.best = [];
    p.found = 0;
    p.sample = null;
    p.cutByDepth = false;
    if (p.fixedLen === 0) {
      for (const s of p.starts) {
        push(p, s);
        extend(p, d - 1);
        pop(p, s);
        if (p.timedOut) break;
      }
    } else {
      extend(p, d);
    }
    if (p.timedOut) {
      best = best.concat(p.best);
      sample = sample ?? p.sample;
      break;
    }
    best = p.best;
    sample = p.sample;
    if (!p.cutByDepth) break; // every route was already fully explored
  }
  return { best, sample };
}

/* ------------------------------------------------------------------------ */
/* Positional evaluation                                                    */
/* ------------------------------------------------------------------------ */

const after = new Int8Array(N);
const adjacent = [new Uint8Array(N), new Uint8Array(N)];
const dist = [new Int16Array(N), new Int16Array(N)];
const queue = new Int32Array(N);

/**
 * Multi-source BFS from `player`'s territory over the neutral cells that
 * player may enter (not next to the other side's land). Distance 1 is a legal
 * first cell; unreachable cells keep UNREACHABLE.
 */
function reach(board: Int8Array, player: PlayerIndex): void {
  const d = dist[player];
  const own = adjacent[player];
  const blocked = adjacent[other(player)];
  d.fill(UNREACHABLE);
  let head = 0;
  let tail = 0;
  for (let c = 0; c < N; c++) {
    if (board[c] === NEUTRAL && own[c] && !blocked[c]) {
      d[c] = 1;
      queue[tail++] = c;
    }
  }
  while (head < tail) {
    const c = queue[head++];
    const next = d[c] + 1;
    for (let k = 0; k < 4; k++) {
      const n = NB[c * 4 + k];
      if (n < 0 || board[n] !== NEUTRAL || blocked[n] || d[n] !== UNREACHABLE) continue;
      d[n] = next;
      queue[tail++] = n;
    }
  }
}

/**
 * Neutral cells strictly closer to `us` than to the opponent, minus the
 * reverse. Cells only one side can reach count fully for that side, so walling
 * a region off is rewarded before it is captured; cells neither side can enter
 * are ignored.
 */
function positional(board: Int8Array, us: PlayerIndex): number {
  adjacent[0].fill(0);
  adjacent[1].fill(0);
  for (let c = 0; c < N; c++) {
    const owner = board[c];
    if (owner === NEUTRAL) continue;
    const marks = adjacent[owner];
    for (let k = 0; k < 4; k++) {
      const n = NB[c * 4 + k];
      if (n >= 0) marks[n] = 1;
    }
  }
  reach(board, 0);
  reach(board, 1);
  const mine = dist[us];
  const theirs = dist[other(us)];
  let score = 0;
  for (let c = 0; c < N; c++) {
    if (board[c] !== NEUTRAL) continue;
    if (mine[c] < theirs[c]) score++;
    else if (theirs[c] < mine[c]) score--;
  }
  return score;
}

/** Raw gain plus the positional term of the board after `route` is drawn and captured. */
function routeScore(p: Planner, route: Route): number {
  after.set(p.cells);
  for (const c of p.path) after[c] = p.us;
  for (const c of route.cells) after[c] = p.us;
  const s = ++stamp;
  let top = 0;
  for (const e of EDGE) {
    if (after[e] !== NEUTRAL || visited[e] === s) continue;
    visited[e] = s;
    stack[top++] = e;
  }
  while (top > 0) {
    const base = stack[--top] * 4;
    for (let k = 0; k < 4; k++) {
      const n = NB[base + k];
      if (n < 0 || visited[n] === s || after[n] !== NEUTRAL) continue;
      visited[n] = s;
      stack[top++] = n;
    }
  }
  for (let c = 0; c < N; c++) if (after[c] === NEUTRAL && visited[c] !== s) after[c] = p.us;
  return route.gain + POSITIONAL_WEIGHT * positional(after, p.us);
}

/* ------------------------------------------------------------------------ */
/* Fallbacks                                                                */
/* ------------------------------------------------------------------------ */

/** Neighbours of `c` the path could still use — how much room a cell leaves. */
function room(p: Planner, c: number): number {
  let count = 0;
  for (let k = 0; k < 4; k++) {
    const n = NB[c * 4 + k];
    if (n >= 0 && p.cells[n] === NEUTRAL && !p.onPath[n] && !p.forbidden[n]) count++;
  }
  return count;
}

/**
 * No completing route was found within reach (a path that wandered off, or a
 * cramped board). A fresh path starts where there is the most room; a path in
 * progress heads for the nearest cell next to our territory — measured through
 * cells it may actually use — so the next call can usually close it.
 */
function fallbackStep(p: Planner, legal: TerritoryMove[]): TerritoryMove {
  if (p.fixedLen === 0) {
    let best = -1;
    let bestRoom = -1;
    for (const s of p.starts) {
      const r = room(p, s);
      if (r > bestRoom) {
        bestRoom = r;
        best = s;
      }
    }
    return best >= 0 ? toMove(best) : pickRandom(legal, p.rng);
  }
  const d = dist[0];
  d.fill(UNREACHABLE);
  let head = 0;
  let tail = 0;
  for (let c = 0; c < N; c++) {
    if (p.cells[c] === NEUTRAL && p.home[c] && !p.forbidden[c] && !p.onPath[c]) {
      d[c] = 0;
      queue[tail++] = c;
    }
  }
  while (head < tail) {
    const c = queue[head++];
    for (let k = 0; k < 4; k++) {
      const n = NB[c * 4 + k];
      if (n < 0 || p.cells[n] !== NEUTRAL || p.forbidden[n] || p.onPath[n] || d[n] !== UNREACHABLE) continue;
      d[n] = d[c] + 1;
      queue[tail++] = n;
    }
  }
  const base = p.path[p.path.length - 1] * 4;
  let best = -1;
  let bestKey = Infinity;
  for (let k = 0; k < 4; k++) {
    const n = NB[base + k];
    if (!canExtend(p, n)) continue;
    const key = d[n] * 8 - room(p, n);
    if (key < bestKey) {
      bestKey = key;
      best = n;
    }
  }
  return best >= 0 ? toMove(best) : pickRandom(legal, p.rng);
}

/** Last resort when something unexpected happens: any legal move, or null if there is none. */
function fallback(state: TerritoryState, player: PlayerIndex, rng: Rng): TerritoryMove | null {
  try {
    const legal = territoryEngine.legalMoves(state, player);
    return legal.length > 0 ? pickRandom(legal, rng) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                 */
/* ------------------------------------------------------------------------ */

export const territoryAi: AiProvider<TerritoryState, TerritoryMove> = {
  testProfile: { games: 6, minWinRate: 0.8, maxPlies: 800, budgetMs: 40 },
  chooseMove(state, player, level, options = {}) {
    const rng = options.rng ?? Math.random;
    const now = options.now ?? Date.now;
    try {
      if (state.status !== "ongoing" || state.turn !== player) return null;
      const started = now();
      const legal = territoryEngine.legalMoves(state, player);
      if (legal.length === 0) return null;
      if (legal.length === 1) return legal[0];
      const winning = findImmediateWin(territoryEngine, state, player, legal, rng);
      if (winning) return winning;

      const cfg = LEVELS[level] ?? LEVELS.normal;
      const deadline = started + (options.budgetMs ?? cfg.budgetMs);
      const p = makePlanner(state, player, rng, now, deadline, cfg.randomness > 0);
      const plan = planRoutes(p, cfg.maxExtra);
      if (plan.sample && rng() < cfg.randomness) return toMove(plan.sample.cells[0]);
      let chosen: Route | null = null;
      let chosenScore = -Infinity;
      for (const route of plan.best) {
        const score = routeScore(p, route);
        if (score > chosenScore) {
          chosenScore = score;
          chosen = route;
        }
      }
      return chosen ? toMove(chosen.cells[0]) : fallbackStep(p, legal);
    } catch {
      return fallback(state, player, rng);
    }
  },
};
