import type { PlayerIndex, Rng } from "../types.js";
import { flickEngine, MAX_FLICK, SIZE, type FlickGrid, type FlickMove, type FlickPos, type FlickState } from "../games/flick.js";
import type { AiLevel, AiProvider } from "./types.js";
import { pickRandom } from "./random.js";

/**
 * 땅따먹기 (stone flicking) computer opponent.
 *
 * Flick's move space is continuous (any direction, any power up to MAX_FLICK)
 * and a turn is a sequence of up to three flicks, so the generic alpha-beta in
 * search.ts does not fit. This file is a one-turn beam planner instead:
 *
 *  - Intermediate flicks (those that leave the stone outside home) are sampled
 *    as evenly spread directions × a few powers, with a per-call random phase so
 *    equal positions vary between games.
 *  - Return flicks (those that land in own land, end the turn and claim the
 *    traced polygon) are not sampled: they aim at the centres of own boundary
 *    cells within reach, ranked by the shoelace area of the polygon they would
 *    close. Aiming at a cell centre can never miss home by a hair.
 *  - Every candidate turn is simulated with the real engine and the resulting
 *    position scored by evaluate(). The best intermediate positions are kept
 *    and extended by one more flick (up to the three the rules allow). The
 *    search is anytime: whatever plan is best when the budget runs out is played.
 *  - Hard then re-scores its best lines three plies deep: the opponent's greedy
 *    reply (this same planner, run for them) followed by our own next turn.
 *    That is what sees that a smaller claim which parks the stone next to open
 *    land, or one that takes the cells the opponent was about to take, beats
 *    the biggest polygon available right now — and that a claim which drops
 *    neutral land under the 10% cut-off decides the game.
 *  - Mid-turn calls (flicks already made this turn) plan from the live stone
 *    position and the path traced so far, so a plan started earlier is simply
 *    re-derived and continued.
 *  - Giving up is the baseline every plan must beat. It is what gets played when
 *    the stone is stranded (no own cell within reach on the last flick): the
 *    engine treats an off-board or failed third flick exactly like a give-up, so
 *    the explicit move is the honest one.
 */

const CELLS = SIZE * SIZE;
const TWO_PI = 2 * Math.PI;
/** Reach used when aiming at a target: a hair under MAX_FLICK so float error never trips the engine's power check. */
const REACH = MAX_FLICK - 1e-3;
const REACH_SQ = REACH * REACH;

/**
 * Evaluation terms (see evaluate()).
 *  - Cells within CONTEST_RADIUS of the opponent's resting stone weigh up to
 *    1 + CONTEST_BONUS instead of 1: the game is a race for neutral cells, and a
 *    cell the opponent can reach next turn is worth more than one nobody else
 *    will claim for a while, because taking it also denies it.
 *  - POTENTIAL_WEIGHT per neutral cell within POTENTIAL_RADIUS (Chebyshev, in
 *    cells) of where our stone comes to rest: a stone on a frontier with open
 *    land around it sets up the next claim; one buried deep in own land wastes
 *    a turn getting back out. At most ~19 points, so it only breaks near-ties.
 *  - GAME_OVER is added (subtracted) when the turn ends the game won (lost), so
 *    a plan that ends the game ahead is taken and one that ends it behind is
 *    avoided even if it claims more. Everything stays far below search.ts's
 *    WIN_SCORE for consistency with the other AIs.
 */
const CONTEST_RADIUS = 28;
const CONTEST_BONUS = 0.7;
const POTENTIAL_RADIUS = 12;
const POTENTIAL_WEIGHT = 0.03;
const GAME_OVER = 50_000;

const GIVE_UP: FlickMove = { kind: "giveup" };

interface LevelConfig {
  /** Evenly spread directions sampled for an intermediate flick. */
  dirs: number;
  /** Powers tried in each direction. */
  powers: number[];
  /** Return targets (own boundary cells) simulated per intermediate position. */
  targets: number;
  /** Intermediate positions kept, by exact score, for one more flick. */
  beam: number;
  /** Extra positions kept by their three-flick shoelace estimate, so the beam is not all near-copies of one line. */
  beamExtra: number;
  /** Intermediate flicks planned ahead: 1 = triangles only, 2 = the full three-flick turn. */
  expansions: number;
  /** Best lines (by distinct first flick) re-scored three plies deep after the one-turn plan; 0 = none. */
  lookahead: number;
  budgetMs: number;
  /** Probability that a fresh turn opens with a careless full-power flick instead of the plan. */
  randomness: number;
}

/**
 * Easy samples coarsely, plans triangles only and opens 40% of its turns with
 * a careless flick (the mid-turn re-plan then salvages what it can). Normal
 * plans the full turn greedily. Hard samples about four times as densely,
 * keeps a wider beam, and reads its best lines three plies deep.
 */
const LEVELS: Record<AiLevel, LevelConfig> = {
  easy: { dirs: 12, powers: [MAX_FLICK, 11], targets: 4, beam: 1, beamExtra: 0, expansions: 1, lookahead: 0, budgetMs: 100, randomness: 0.4 },
  normal: { dirs: 24, powers: [MAX_FLICK, 12, 8], targets: 8, beam: 5, beamExtra: 3, expansions: 2, lookahead: 0, budgetMs: 500, randomness: 0 },
  hard: { dirs: 40, powers: [MAX_FLICK, 13, 10, 7], targets: 12, beam: 10, beamExtra: 5, expansions: 2, lookahead: 8, budgetMs: 1200, randomness: 0 },
};

/** Coarse planner used for the opponent's reply and our follow-up inside the lookahead: a whole turn in a few ms. */
const REPLY: LevelConfig = { dirs: 16, powers: [MAX_FLICK, 11], targets: 5, beam: 3, beamExtra: 2, expansions: 2, lookahead: 0, budgetMs: 0, randomness: 0 };
/** Share of the budget the one-turn plan may use when a lookahead follows; the rest is for the lookahead. */
const PLAN_SHARE = 0.4;

/** Directions probed (at full power) when estimating a position's three-flick potential. */
const ESTIMATE_DIRS = 16;

/* ------------------------------------------------------------------------ */
/* Geometry                                                                 */
/* ------------------------------------------------------------------------ */

function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

/** Grid cell containing a continuous coordinate, clamped the way the engine clamps it. */
function cellOf(v: number): number {
  return Math.min(SIZE - 1, Math.max(0, Math.floor(v)));
}

function offBoard(p: FlickPos): boolean {
  return p.x < 0 || p.x > SIZE || p.y < 0 || p.y > SIZE;
}

function dist2(a: FlickPos, b: FlickPos): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** One term of the shoelace formula. */
function cross(a: FlickPos, b: FlickPos): number {
  return a.x * b.y - b.x * a.y;
}

/** Shoelace sum over the open path p0→p1→…→pk (without the closing edge). */
function pathCross(path: FlickPos[]): number {
  let s = 0;
  for (let i = 0; i + 1 < path.length; i++) s += cross(path[i]!, path[i + 1]!);
  return s;
}

/** Neutral cells within Chebyshev distance POTENTIAL_RADIUS of cell (cx, cy). */
function openAround(grid: FlickGrid, cx: number, cy: number): number {
  const y0 = Math.max(0, cy - POTENTIAL_RADIUS);
  const y1 = Math.min(SIZE - 1, cy + POTENTIAL_RADIUS);
  const x0 = Math.max(0, cx - POTENTIAL_RADIUS);
  const x1 = Math.min(SIZE - 1, cx + POTENTIAL_RADIUS);
  let open = 0;
  for (let y = y0; y <= y1; y++) {
    const row = grid[y]!;
    for (let x = x0; x <= x1; x++) if (row[x] === null) open++;
  }
  return open;
}

/* ------------------------------------------------------------------------ */
/* Per-call context and evaluation                                          */
/* ------------------------------------------------------------------------ */

interface Ctx {
  me: PlayerIndex;
  opp: PlayerIndex;
  /** Worth of each cell (flat index), fixed for the whole call: the opponent's stone does not move during our turn. */
  weights: Float64Array;
  /** Centres of our cells that touch a non-own cell: the only landing spots worth aiming at. */
  boundary: FlickPos[];
  now: () => number;
  deadline: number;
  timedOut: boolean;
  /** Turn-ending simulations so far; the clock is read every few of them. */
  sims: number;
}

function buildWeights(state: FlickState, me: PlayerIndex): Float64Array {
  const o = state.stones[other(me)];
  const w = new Float64Array(CELLS);
  for (let y = 0, i = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++, i++) {
      const d = Math.hypot(x + 0.5 - o.x, y + 0.5 - o.y);
      w[i] = 1 + CONTEST_BONUS * Math.max(0, 1 - d / CONTEST_RADIUS);
    }
  }
  return w;
}

/**
 * Own cells with a 4-neighbour that is not ours. Landing anywhere in own land
 * ends the turn, but the polygon only grows by landing at an extreme of the
 * land, and resting on the frontier is where the next turn wants to start.
 */
function ownBoundary(grid: FlickGrid, me: PlayerIndex): FlickPos[] {
  const out: FlickPos[] = [];
  for (let y = 0; y < SIZE; y++) {
    const row = grid[y]!;
    for (let x = 0; x < SIZE; x++) {
      if (row[x] !== me) continue;
      if (
        (x > 0 && row[x - 1] !== me) ||
        (x < SIZE - 1 && row[x + 1] !== me) ||
        (y > 0 && grid[y - 1]![x] !== me) ||
        (y < SIZE - 1 && grid[y + 1]![x] !== me)
      ) {
        out.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  return out;
}

function makeCtx(state: FlickState, me: PlayerIndex, now: () => number, deadline: number): Ctx {
  return {
    me,
    opp: other(me),
    weights: buildWeights(state, me),
    boundary: ownBoundary(state.grid, me),
    now,
    deadline,
    timedOut: false,
    sims: 0,
  };
}

/** Score of a position in which our turn has just resolved, from our point of view. See the constants above. */
function evaluate(state: FlickState, ctx: Ctx): number {
  const grid = state.grid;
  const w = ctx.weights;
  let margin = 0;
  for (let y = 0, i = 0; y < SIZE; y++) {
    const row = grid[y]!;
    for (let x = 0; x < SIZE; x++, i++) {
      const c = row[x];
      if (c === ctx.me) margin += w[i]!;
      else if (c === ctx.opp) margin -= w[i]!;
    }
  }
  if (state.status === "win") return margin + (state.winner === ctx.me ? GAME_OVER : -GAME_OVER);
  if (state.status === "draw") return margin;
  const rest = state.stones[ctx.me];
  return margin + POTENTIAL_WEIGHT * openAround(grid, cellOf(rest.x), cellOf(rest.y));
}

/* ------------------------------------------------------------------------ */
/* Planner                                                                  */
/* ------------------------------------------------------------------------ */

interface Node {
  state: FlickState;
  /** The flick that started this line: what chooseMove returns if the line is best. null at the root. */
  first: FlickMove | null;
  /** Shoelace sum of the path so far, so closing areas cost two cross products each. */
  pathCross: number;
  /** Largest polygon a direct return could close from here; orders exact evaluation. -1 if no target is in reach. */
  estimate: number;
  /** Best exact score of a return from here; -Infinity until one has been simulated. */
  exact: number;
}

/** A complete turn: the flick that starts it, the position it leaves, and that position's score. */
interface Line {
  first: FlickMove;
  state: FlickState;
  score: number;
}

interface Search {
  best: Line;
  /** Best line per distinct first flick, kept only when a lookahead will re-score them. */
  byFirst: Map<FlickMove, Line> | null;
}

function record(search: Search, first: FlickMove, state: FlickState, score: number): void {
  if (score > search.best.score) search.best = { first, state, score };
  if (search.byFirst) {
    const cur = search.byFirst.get(first);
    if (!cur || score > cur.score) search.byFirst.set(first, { first, state, score });
  }
}

/** Area the polygon path…→t would enclose, given the path's own shoelace sum and endpoints. */
function closingArea(pc: number, last: FlickPos, t: FlickPos, p0: FlickPos): number {
  return Math.abs(pc + cross(last, t) + cross(t, p0)) / 2;
}

function makeNode(state: FlickState, first: FlickMove | null, ctx: Ctx): Node {
  const path = state.path;
  const pc = pathCross(path);
  const last = path[path.length - 1]!;
  const p0 = path[0]!;
  let estimate = -1;
  for (const t of ctx.boundary) {
    if (dist2(last, t) > REACH_SQ) continue;
    const a = closingArea(pc, last, t, p0);
    if (a > estimate) estimate = a;
  }
  return { state, first, pathCross: pc, estimate, exact: -Infinity };
}

/**
 * Simulates the best few returns home from `node` (by closing area, or by open
 * land around the target when the path is still a single point and no area can
 * be closed) and records their exact scores.
 */
function evaluateReturns(node: Node, cfg: LevelConfig, ctx: Ctx, search: Search): void {
  const path = node.state.path;
  const last = path[path.length - 1]!;
  const p0 = path[0]!;
  const grid = node.state.grid;
  const ranked: { t: FlickPos; key: number }[] = [];
  for (const t of ctx.boundary) {
    if (dist2(last, t) > REACH_SQ) continue;
    const key = path.length > 1 ? closingArea(node.pathCross, last, t, p0) : openAround(grid, cellOf(t.x), cellOf(t.y));
    ranked.push({ t, key });
  }
  ranked.sort((a, b) => b.key - a.key);
  const n = Math.min(cfg.targets, ranked.length);
  for (let i = 0; i < n; i++) {
    const t = ranked[i]!.t;
    const move: FlickMove = { kind: "flick", dx: t.x - last.x, dy: t.y - last.y };
    const r = flickEngine.applyMove(node.state, move, ctx.me);
    if ((++ctx.sims & 7) === 0 && ctx.now() >= ctx.deadline) ctx.timedOut = true;
    // A return must end the turn; anything else means the aim was off and the line is not trusted.
    if (r.ok && r.state.turn !== ctx.me) {
      const score = evaluate(r.state, ctx);
      if (score > node.exact) node.exact = score;
      record(search, node.first ?? move, r.state, score);
    }
    if (ctx.timedOut) return;
  }
}

/**
 * Largest polygon reachable with one more intermediate flick and a return:
 * the diversity key for the beam, so a first flick whose triangle is thin but
 * whose three-flick shapes are big is still extended.
 */
function threeFlickEstimate(node: Node, ctx: Ctx): number {
  const path = node.state.path;
  const last = path[path.length - 1]!;
  const p0 = path[0]!;
  const grid = node.state.grid;
  let best = -1;
  for (let i = 0; i < ESTIMATE_DIRS; i++) {
    const angle = (TWO_PI * i) / ESTIMATE_DIRS;
    const q: FlickPos = { x: last.x + MAX_FLICK * Math.cos(angle), y: last.y + MAX_FLICK * Math.sin(angle) };
    if (offBoard(q) || grid[cellOf(q.y)]![cellOf(q.x)] === ctx.me) continue;
    const pc = node.pathCross + cross(last, q);
    for (const t of ctx.boundary) {
      if (dist2(q, t) > REACH_SQ) continue;
      const a = closingArea(pc, q, t, p0);
      if (a > best) best = a;
    }
  }
  return best;
}

/** Intermediate positions to extend by one more flick: the best by exact score, plus a few by three-flick potential. */
function selectBeam(children: Node[], cfg: LevelConfig, ctx: Ctx): Node[] {
  const beam = children
    .filter((c) => c.exact > -Infinity)
    .sort((a, b) => b.exact - a.exact)
    .slice(0, cfg.beam);
  if (cfg.beamExtra > 0) {
    const chosen = new Set(beam);
    const extra = children
      .filter((c) => !chosen.has(c))
      .map((c) => ({ c, key: threeFlickEstimate(c, ctx) }))
      .filter((e) => e.key > 0)
      .sort((a, b) => b.key - a.key)
      .slice(0, cfg.beamExtra);
    for (const e of extra) beam.push(e.c);
  }
  return beam;
}

/** Sampled flicks from `from` that stay on the board and do not land in own land (those are returns, aimed separately). */
function intermediateFlicks(from: FlickPos, grid: FlickGrid, cfg: LevelConfig, phase: number, me: PlayerIndex): FlickMove[] {
  const out: FlickMove[] = [];
  for (let i = 0; i < cfg.dirs; i++) {
    const angle = phase + (TWO_PI * i) / cfg.dirs;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    for (const power of cfg.powers) {
      const to: FlickPos = { x: from.x + ux * power, y: from.y + uy * power };
      if (offBoard(to) || grid[cellOf(to.y)]![cellOf(to.x)] === me) continue;
      out.push({ kind: "flick", dx: ux * power, dy: uy * power });
    }
  }
  return out;
}

/**
 * One-turn plan for the rest of the turn. `best` is the line to play (a give-up
 * when nothing beats it); with `collect` the best line per first flick is kept too.
 */
function plan(state: FlickState, cfg: LevelConfig, ctx: Ctx, phase: number, collect: boolean): Search {
  const me = ctx.me;
  const giveUp = flickEngine.applyMove(state, GIVE_UP, me);
  const search: Search = {
    best: { first: GIVE_UP, state: giveUp.state, score: giveUp.ok ? evaluate(giveUp.state, ctx) : -Infinity },
    byFirst: collect ? new Map() : null,
  };
  if (giveUp.ok) record(search, GIVE_UP, giveUp.state, search.best.score);

  const root = makeNode(state, null, ctx);
  evaluateReturns(root, cfg, ctx, search); // mid-turn: close the polygon now; fresh turn: a mere repositioning hop

  let beam: Node[] = [root];
  const expansions = Math.min(cfg.expansions, state.flicksLeft - 1);
  for (let stage = 0; stage < expansions && !ctx.timedOut; stage++) {
    const children: Node[] = [];
    for (const node of beam) {
      const from = node.state.stones[me];
      for (const move of intermediateFlicks(from, state.grid, cfg, phase, me)) {
        const r = flickEngine.applyMove(node.state, move, me);
        if (!r.ok || r.state.turn !== me) continue;
        children.push(makeNode(r.state, node.first ?? move, ctx));
      }
    }
    // Most promising first, so a timeout still leaves the likeliest lines evaluated.
    children.sort((a, b) => b.estimate - a.estimate);
    for (const child of children) {
      if (ctx.timedOut) break;
      evaluateReturns(child, cfg, ctx, search);
    }
    if (stage + 1 < expansions) beam = selectBeam(children, cfg, ctx);
  }
  return search;
}

/* ------------------------------------------------------------------------ */
/* Lookahead                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Three-ply value of a line: the position after the opponent's greedy reply
 * and our greedy follow-up. Each side picks its turn with its own context, but
 * the leaf is scored with the root `ctx` so every line is measured on the same
 * scale (the contest weights depend on where the opponent's stone rests, which
 * differs per line). null when the clock ran out midway, since a reply search
 * cut short would flatter the line.
 */
function lineValue(line: Line, ctx: Ctx, phase: number): number | null {
  if (line.state.status !== "ongoing") return line.score;
  const oppCtx = makeCtx(line.state, ctx.opp, ctx.now, ctx.deadline);
  const reply = plan(line.state, REPLY, oppCtx, phase, false).best;
  if (oppCtx.timedOut) return null;
  if (reply.state.status !== "ongoing") return evaluate(reply.state, ctx);
  const myCtx = makeCtx(reply.state, ctx.me, ctx.now, ctx.deadline);
  const mine = plan(reply.state, REPLY, myCtx, phase, false).best;
  return myCtx.timedOut ? null : evaluate(mine.state, ctx);
}

/** Re-scores the best `cfg.lookahead` lines three plies deep; the first flick of the best one, or null if none finished. */
function lookahead(search: Search, cfg: LevelConfig, ctx: Ctx, phase: number): FlickMove | null {
  const lines = [...search.byFirst!.values()].sort((a, b) => b.score - a.score).slice(0, cfg.lookahead);
  let bestFirst: FlickMove | null = null;
  let bestValue = -Infinity;
  for (const line of lines) {
    if (ctx.now() >= ctx.deadline) break;
    const value = lineValue(line, ctx, phase);
    if (value === null) break;
    if (value > bestValue) {
      bestValue = value;
      bestFirst = line.first;
    }
  }
  return bestFirst;
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                 */
/* ------------------------------------------------------------------------ */

/** Last resort when something unexpected happens: giving up is always accepted on our turn. */
function fallback(state: FlickState, player: PlayerIndex): FlickMove | null {
  try {
    return flickEngine.applyMove(state, GIVE_UP, player).ok ? GIVE_UP : null;
  } catch {
    return null;
  }
}

/** A full-power flick in a random on-board direction: easy's careless opener. */
function carelessFlick(state: FlickState, player: PlayerIndex, cfg: LevelConfig, phase: number, rng: Rng): FlickMove | null {
  const from = state.stones[player];
  const full = { ...cfg, powers: [MAX_FLICK] };
  const options = intermediateFlicks(from, state.grid, full, phase, player);
  return options.length > 0 ? pickRandom(options, rng) : null;
}

export const flickAi: AiProvider<FlickState, FlickMove> = {
  testProfile: { games: 6, minWinRate: 0.7, maxPlies: 300, budgetMs: 60 },
  chooseMove(state, player, level, options = {}) {
    const rng = options.rng ?? Math.random;
    const now = options.now ?? Date.now;
    try {
      if (state.status !== "ongoing" || state.turn !== player) return null;
      const cfg = LEVELS[level] ?? LEVELS.normal;
      const start = now();
      const budgetMs = options.budgetMs ?? cfg.budgetMs;
      const withLookahead = cfg.lookahead > 0;
      const ctx = makeCtx(state, player, now, start + (withLookahead ? budgetMs * PLAN_SHARE : budgetMs));
      // Rotating the direction fan by a random fraction of one step is the only use of rng in the plan.
      const phase = (rng() * TWO_PI) / cfg.dirs;
      const search = plan(state, cfg, ctx, phase, withLookahead);
      let move = search.best.first;
      // A plan that ends the game in our favour is taken at every level, before any carelessness or re-scoring.
      const wins = search.best.score >= GAME_OVER / 2;
      if (!wins && withLookahead) {
        ctx.deadline = start + budgetMs;
        ctx.timedOut = false;
        move = lookahead(search, cfg, ctx, phase) ?? move;
      }
      if (!wins && cfg.randomness > 0 && state.path.length === 1 && rng() < cfg.randomness) {
        const careless = carelessFlick(state, player, cfg, phase, rng);
        if (careless) return careless;
      }
      return flickEngine.applyMove(state, move, player).ok ? move : fallback(state, player);
    } catch {
      return fallback(state, player);
    }
  },
};
