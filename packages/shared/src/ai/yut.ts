import type { PlayerIndex, Rng } from "../types.js";
import { yutEngine, type YutMove, type YutPos, type YutState } from "../games/yut.js";
import type { AiLevel, AiProvider } from "./types.js";
import { pickRandom, shuffle } from "./random.js";

/**
 * 윷놀이 (Yut Nori) computer opponent.
 *
 * Yut is a race decided by stick throws, so the generic alpha-beta in search.ts
 * does not apply (applying a throw consumes the rng). Instead:
 *
 *  - Throws are forced: when the only legal move is {kind:"throw"} it is returned.
 *  - Token moves are chosen by expectimax over a small tree. The AI's own move
 *    sequence for the pending throws is enumerated exactly; a capture grants an
 *    extra throw, which becomes a chance node over the five throw values. The
 *    hard level also expands the opponent's whole reply turn (their throw, their
 *    best sequence by the same evaluation) before the static evaluation, falling
 *    back to the own-turn result when the time budget runs out.
 *  - evaluate() scores a position in "steps": every token's progress along the
 *    shortest route home (a token on corner 5/10 is credited with the shortcut it
 *    will take), the expected loss from tokens the other side can capture on its
 *    next throw (exact probability from the throw distribution, 윷/모 double
 *    throws included), the tempo saved by 업기 stacks, the option value of sitting
 *    just before a corner, tokens already home, and unspent throws.
 */

/* ------------------------------------------------------------------------ */
/* Board topology                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Stations as small integers so reachability can be a table lookup:
 *   0..19  outer track (idx), corners at 5 and 10 divert onto the shortcuts
 *   20..24 "s5"  shortcut idx 0..4 (corner 5 → d1 d2 centre d3 d4 → corner 15)
 *   25..29 "s10" shortcut idx 0..4 (corner 10 → e1 e2 centre e3 e4 → home)
 *   30     start (off the board), 31 home
 * The two centre stations are distinct here, exactly as the engine keys them.
 */
const OUTER_LEN = 20;
const DIAG_LEN = 5;
const S5 = 20;
const S10 = 25;
const START = 30;
const HOME = 31;
const STATIONS = 32;
/** Steps from start to home when no shortcut is taken; a token's maximum progress. */
const FULL_ROUTE = 20;
/** Both shortcuts save exactly four steps over staying on the outer track. */
const SHORTCUT_SAVING = 4;
const MAX_THROW = 5;

function stationOf(pos: YutPos): number {
  if (pos === "start") return START;
  if (pos === "home") return HOME;
  if (pos.track === "out") return pos.idx;
  return (pos.track === "s5" ? S5 : S10) + pos.idx;
}

function stepOnce(s: number): number {
  if (s < S5) return s + 1 >= OUTER_LEN ? HOME : s + 1;
  if (s < S10) return s + 1 >= S5 + DIAG_LEN ? 15 : s + 1;
  return s + 1 >= S10 + DIAG_LEN ? HOME : s + 1;
}

/**
 * Mirrors the engine's advance(): the shortcut is taken only when the move
 * STARTS on corner 5 or 10, never when a corner is merely passed over.
 */
function advance(s: number, steps: number): number {
  let cur = s === START ? 0 : s;
  for (let i = 0; i < steps; i++) {
    if (i === 0 && cur === 5) {
      cur = S5;
      continue;
    }
    if (i === 0 && cur === 10) {
      cur = S10;
      continue;
    }
    cur = stepOnce(cur);
    if (cur === HOME) return HOME;
  }
  return cur;
}

/** ADV[s * 6 + v] = station reached from `s` by a single move of `v` steps. */
const ADV = new Uint8Array(STATIONS * (MAX_THROW + 1));
for (let s = 0; s < STATIONS; s++) {
  for (let v = 1; v <= MAX_THROW; v++) ADV[s * (MAX_THROW + 1) + v] = s === HOME ? HOME : advance(s, v);
}
function reach(s: number, v: number): number {
  return ADV[s * (MAX_THROW + 1) + v]!;
}

/**
 * Steps still needed to reach home along the route the token will actually
 * take. Corner 5 and 10 are scored as if the shortcut were already entered,
 * since the next move from them is diverted onto it.
 */
const REM = new Uint8Array(STATIONS);
for (let i = 0; i < OUTER_LEN; i++) REM[i] = OUTER_LEN - i;
REM[5] = 1 + (DIAG_LEN + (OUTER_LEN - 15)); // onto s5, along it, then corner 15 → home
REM[10] = 1 + DIAG_LEN; // onto s10, along it to home
for (let i = 0; i < DIAG_LEN; i++) {
  REM[S5 + i] = DIAG_LEN - i + (OUTER_LEN - 15);
  REM[S10 + i] = DIAG_LEN - i;
}
REM[START] = FULL_ROUTE;
REM[HOME] = 0;

/* ------------------------------------------------------------------------ */
/* Throws                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Probability of each throw value (index = value). Four sticks, each flat with
 * probability 1/2; the engine maps 1..4 flats to 도 개 걸 윷 and 0 flats to 모.
 */
const THROW_P = [0, 4 / 16, 6 / 16, 4 / 16, 1 / 16, 1 / 16] as const;
/** Flat-side-up stick count the engine turns into each value. */
const FLATS_FOR_VALUE = [0, 1, 2, 3, 4, 0] as const;
/** Expected steps from one throw, and from a whole turn (윷/모 throw again). */
const E_THROW = THROW_P.reduce((sum, p, v) => sum + p * v, 0);
const E_TURN = E_THROW / (1 - THROW_P[4] - THROW_P[5]);

/**
 * Applies a throw of a chosen value through the engine, feeding it a stick
 * sequence that produces that value: the engine samples one number per stick
 * and calls the stick flat when the sample is below 0.5.
 */
function throwWith(state: YutState, value: number): YutState | null {
  let flats = FLATS_FOR_VALUE[value]!;
  const sticks: Rng = () => (flats-- > 0 ? 0 : 1);
  const r = yutEngine.applyMove(state, { kind: "throw" }, state.turn, sticks);
  return r.ok ? r.state : null;
}

/** Whether any attacker station reaches `target` with a single move of `v`. */
function hits(target: number, attackers: number[], v: number): boolean {
  for (const a of attackers) if (reach(a, v) === target) return true;
  return false;
}

/** Whether any attacker reaches `target` by moving `v` and then `w` with the same token. */
function hitsTwice(target: number, attackers: number[], v: number, w: number): boolean {
  for (const a of attackers) {
    const mid = reach(a, v);
    if (mid !== HOME && reach(mid, w) === target) return true;
  }
  return false;
}

/**
 * Probability that the side owning `attackers` (distinct stations of its tokens
 * that can still move; start tokens enter at 1..5) lands on `target` during its
 * next turn. 도/개/걸 are single moves; 윷/모 are followed by another throw whose
 * value may be spent on the same token, in either order, or on a different one.
 * Longer 윷/모 chains are ignored (1/256 and rarer).
 */
function hitProbability(target: number, attackers: number[]): number {
  let p = 0;
  for (let v = 1; v <= MAX_THROW; v++) {
    if (hits(target, attackers, v)) {
      p += THROW_P[v]!;
      continue;
    }
    if (v < 4) continue;
    let q = 0;
    for (let w = 1; w <= MAX_THROW; w++) {
      if (hits(target, attackers, w) || hitsTwice(target, attackers, v, w) || hitsTwice(target, attackers, w, v)) {
        q += THROW_P[w]!;
      }
    }
    p += THROW_P[v]! * q;
  }
  return p;
}

/* ------------------------------------------------------------------------ */
/* Static evaluation                                                        */
/* ------------------------------------------------------------------------ */

/** Evaluation unit: one step of progress. Whole positions stay in the low thousands. */
const STEP = 100;
/** A token home is worth its full route plus this: it is safe for good. */
const HOME_BONUS = 0.5 * STEP;
/** Share of the steps a stack saves (each extra token rides for free) credited up front. */
const STACK_W = 0.5;
/** Discount on the four steps a shortcut would save for a token that might land on the corner. */
const CORNER_OPTION_W = 0.5;
/** The side to move can still capture or flee, so its exposure counts at this weight. */
const DEFERRED_RISK_W = 0.4;
/** Unspent throws (pending values, throws still owed) are worth about their steps. */
const TEMPO_W = 1;
const WIN = 60_000;
const EVAL_CLAMP = 50_000;

/** Expected steps a token on an outer station gains from the corner ahead: P(exact distance) × saving. */
const CORNER_OPTION = new Float64Array(STATIONS);
for (let i = 1; i < 10; i++) {
  if (i === 5) continue;
  const d = i < 5 ? 5 - i : 10 - i;
  CORNER_OPTION[i] = THROW_P[d]! * SHORTCUT_SAVING * CORNER_OPTION_W * STEP;
}

function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

/** Scratch: tokens per station of the side being scored. */
const groupCount = new Uint8Array(STATIONS);

/** Value of `side`'s material and prospects, in evaluation units. */
function sideValue(state: YutState, side: PlayerIndex): number {
  const attackers: number[] = [];
  for (const pos of state.tokens[other(side)]) {
    const s = stationOf(pos);
    if (s !== HOME && !attackers.includes(s)) attackers.push(s);
  }
  // Tokens of the side NOT to move face the coming throw in full; the mover's own
  // tokens only after it has had its move, so their exposure is discounted.
  const riskW = state.turn === side ? DEFERRED_RISK_W : 1;

  groupCount.fill(0);
  for (const pos of state.tokens[side]) groupCount[stationOf(pos)]++;

  let value = 0;
  for (let s = 0; s < STATIONS; s++) {
    const n = groupCount[s]!;
    if (n === 0 || s === START) continue;
    if (s === HOME) {
      value += n * (FULL_ROUTE * STEP + HOME_BONUS);
      continue;
    }
    const progress = (FULL_ROUTE - REM[s]!) * STEP;
    // 업기: a stack of n moves n tokens per throw, saving (n-1) × remaining steps.
    const stack = n > 1 ? STACK_W * (n - 1) * REM[s]! * STEP : 0;
    value += n * progress + stack + n * CORNER_OPTION[s]!;
    // A capture sends the whole stack back to start and hands the capturer a throw.
    const loss = n * progress + stack + E_TURN * STEP;
    value -= riskW * hitProbability(s, attackers) * loss;
  }

  if (state.turn === side) {
    let pending = 0;
    for (const t of state.pendingThrows) pending += t;
    value += TEMPO_W * STEP * (pending + state.throwsOwed * E_TURN);
  }
  return value;
}

/** Static score of a non-terminal `state` from `root`'s point of view. */
function evaluate(state: YutState, root: PlayerIndex): number {
  const score = sideValue(state, root) - sideValue(state, other(root));
  return Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, score));
}

function leaf(state: YutState, root: PlayerIndex): number {
  if (state.status === "win") return state.winner === root ? WIN : -WIN;
  if (state.status === "draw") return 0;
  return evaluate(state, root);
}

/* ------------------------------------------------------------------------ */
/* Expectimax                                                               */
/* ------------------------------------------------------------------------ */

/** Throw chains rarer than this (윷 윷 윷 …) are cut off with the static evaluation. */
const MIN_BRANCH_PROB = 0.002;

interface Ctx {
  root: PlayerIndex;
  now: () => number;
  deadline: number;
  nodes: number;
  timedOut: boolean;
}

/**
 * Legal token moves with duplicates removed: two pending throws of the same
 * value give identical moves under different throwIndex values.
 */
function distinctMoves(state: YutState, mover: PlayerIndex): YutMove[] {
  const seen = new Set<string>();
  const out: YutMove[] = [];
  for (const m of yutEngine.legalMoves(state, mover)) {
    if (m.kind !== "move") continue;
    const key = `${m.tokenId}:${state.pendingThrows[m.throwIndex]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * Expected value of `state` for ctx.root. `mover` is the player whose turn is
 * being expanded; when the turn changes hands, `turnsLeft` says whether the new
 * turn is expanded too or the position is evaluated statically. `prob` is the
 * probability of the throw chain that led here. Throws owed are chance nodes,
 * pending throws decision nodes (max for the root, min for the opponent).
 */
function value(state: YutState, ctx: Ctx, mover: PlayerIndex, turnsLeft: number, prob: number): number {
  if (state.status !== "ongoing") return leaf(state, ctx.root);
  if (state.turn !== mover) {
    if (turnsLeft === 0) return evaluate(state, ctx.root);
    return value(state, ctx, state.turn, turnsLeft - 1, prob);
  }
  if ((++ctx.nodes & 31) === 0 && ctx.now() >= ctx.deadline) ctx.timedOut = true;
  if (ctx.timedOut || prob < MIN_BRANCH_PROB) return evaluate(state, ctx.root);

  if (state.throwsOwed > 0) {
    let sum = 0;
    for (let v = 1; v <= MAX_THROW; v++) {
      const next = throwWith(state, v);
      if (!next) return evaluate(state, ctx.root);
      sum += THROW_P[v]! * value(next, ctx, mover, turnsLeft, prob * THROW_P[v]!);
    }
    return sum;
  }

  const moves = distinctMoves(state, mover);
  const maximizing = mover === ctx.root;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    // Token moves never read the rng; only throws do.
    const r = yutEngine.applyMove(state, move, mover);
    if (!r.ok) continue;
    const s = value(r.state, ctx, mover, turnsLeft, prob);
    if (maximizing ? s > best : s < best) best = s;
    if (ctx.timedOut) break;
  }
  return Number.isFinite(best) ? best : evaluate(state, ctx.root);
}

interface Scored {
  move: YutMove;
  score: number;
}

/**
 * Scores every root move. `plies` 0 evaluates right after the move, 1 finishes
 * the AI's own turn first, 2 also plays out the opponent's reply turn. Returns
 * null when the budget ran out before every move was scored.
 */
function scoreRootMoves(state: YutState, moves: YutMove[], ctx: Ctx, plies: number): Scored[] | null {
  const scored: Scored[] = [];
  for (const move of moves) {
    const r = yutEngine.applyMove(state, move, ctx.root);
    if (!r.ok) continue;
    const score = plies === 0 ? leaf(r.state, ctx.root) : value(r.state, ctx, ctx.root, plies - 1, 1);
    if (ctx.timedOut) return null;
    scored.push({ move, score });
  }
  return scored.length > 0 ? scored : null;
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                 */
/* ------------------------------------------------------------------------ */

const EASY_RANDOMNESS = 0.5;

const LEVELS: Record<AiLevel, { plies: number; budgetMs: number; randomness: number }> = {
  easy: { plies: 0, budgetMs: 100, randomness: EASY_RANDOMNESS }, // one move, then the static evaluation
  normal: { plies: 1, budgetMs: 500, randomness: 0 }, // the whole own turn
  hard: { plies: 2, budgetMs: 1200, randomness: 0 }, // plus the opponent's reply turn
};

/** Last resort when something unexpected happens: any legal move, or null if there is none. */
function fallback(state: YutState, player: PlayerIndex, rng: Rng): YutMove | null {
  try {
    const legal = yutEngine.legalMoves(state, player);
    return legal.length > 0 ? pickRandom(legal, rng) : null;
  } catch {
    return null;
  }
}

export const yutAi: AiProvider<YutState, YutMove> = {
  testProfile: { games: 8, minWinRate: 0.6, maxPlies: 600, budgetMs: 30 },
  chooseMove(state, player, level, options = {}) {
    const rng = options.rng ?? Math.random;
    try {
      if (state.status !== "ongoing" || state.turn !== player) return null;
      const legal = yutEngine.legalMoves(state, player);
      if (legal.length === 0) return null;
      if (legal.length === 1) return legal[0]!; // a throw that is owed, or the only token move
      const moves = shuffle(distinctMoves(state, player), rng); // shuffled so equal moves vary between games
      if (moves.length === 0) return fallback(state, player, rng);
      if (moves.length === 1) return moves[0]!;

      // Every level brings the last token home when it can.
      for (const move of moves) {
        const r = yutEngine.applyMove(state, move, player);
        if (r.ok && r.status.status === "win" && r.status.winner === player) return move;
      }

      const lv = LEVELS[level] ?? LEVELS.normal;
      if (lv.randomness > 0 && rng() < lv.randomness) return pickRandom(moves, rng);

      const now = options.now ?? Date.now;
      const ctx: Ctx = { root: player, now, deadline: now() + (options.budgetMs ?? lv.budgetMs), nodes: 0, timedOut: false };
      // Iterative deepening: each finished pass replaces the previous one, so a
      // pass that overruns the budget leaves the shallower answer in place.
      let best: Scored[] | null = null;
      for (let plies = 0; plies <= lv.plies; plies++) {
        const scored = scoreRootMoves(state, moves, ctx, plies);
        if (!scored) break;
        best = scored;
      }
      if (!best) return fallback(state, player, rng);
      let top = best[0]!;
      for (const s of best) if (s.score > top.score) top = s;
      return top.move;
    } catch {
      return fallback(state, player, rng);
    }
  },
};
