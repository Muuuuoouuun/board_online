import type { Move, PlayerIndex, Rng } from "../types.js";
import { gonuEngine, POINT_IDS, EDGES, type GonuState, type GonuBoardMap, type PointId } from "../games/gonu.js";
import type { AiOptions, AiProvider } from "./types.js";
import { makeSearchAi, WIN_SCORE } from "./search.js";
import { pickRandom } from "./random.js";

/**
 * 우물고누 (Umul-gonu / "Well Gonu", internationally Pong Hau K'i) computer
 * opponent.
 *
 * The board has 5 points and 4 stones, so the whole game is tiny: only 56
 * (board, side-to-move) states are reachable from the opening, and with the
 * engine's 60-ply cap that is at most 30 x 60 = 1800 (board, turn, plies)
 * states. Solving it exhaustively shows exactly what kind of game it is:
 *
 *  - 8 of the 56 states hold an immediate trap (the mover can leave the
 *    opponent with no legal move and win on the spot);
 *  - NO state is a forced loss for the mover: every position has at least one
 *    move that does not hand over such a trap.
 *
 * So the only mistake that exists is a single careless move that gives the
 * opponent an immediate trap, and correct play (never doing that) draws for
 * ever — hence the engine's ply cap. That has a real consequence for how an
 * opponent must be built: a plain adversarial search rates every non-blunder
 * as an equal draw, has nothing left to prefer one drawing move over another,
 * and settles into a safe shuffle that never gives even a uniformly random
 * mover the chance to blunder. That is not strength, it is a bot that cannot
 * win. Being good here means never blundering AND steering the opponent
 * towards the positions where they can. Each level does that differently:
 *
 *  - `easy`: the generic alpha-beta from search.ts, reading one ply with a
 *    mobility/centre heuristic and playing at random 60% of the time. It still
 *    takes an immediate trap (makeSearchAi checks that first) but walks into
 *    them regularly, so it is genuinely beatable.
 *  - `normal`: 6-ply expectimax against an opponent modelled as uniformly
 *    random (its own moves maximise, the opponent's are averaged), with the
 *    same heuristic at the horizon. It sets traps well and beats random play
 *    far above the 90% bar, but it is honestly a mid level: when the safe
 *    line looks dull to the heuristic it will take a coin flip (offer the
 *    opponent a choice between trapping it and being trapped), which a
 *    careless opponent misses half the time and `hard` punishes every time.
 *  - `hard`: an exact solve of the remaining game by memoised backward
 *    induction over (board, turn, plies) — see `solveBestMoves`. Each move is
 *    valued lexicographically: first its minimax value (so `hard` never makes
 *    a move a perfect opponent could punish; from any position it can be
 *    handed it cannot lose), then, among equally safe moves, the exact
 *    probability of winning against a uniformly random opponent. From the
 *    opening that probability is 99.9% moving first and 88.8% moving second,
 *    which is the best any policy can do against random play under the ply
 *    cap; the rest of the games are draws, never losses.
 */

function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

/* ------------------------------------------------------------------------ */
/* Shared board helpers                                                     */
/* ------------------------------------------------------------------------ */

/** The one point with no stone on it. Always exists: 4 stones sit on 5 points. */
function emptyPointId(board: GonuBoardMap): PointId | null {
  for (const id of POINT_IDS) {
    if (board[id] === null) return id;
  }
  return null;
}

/**
 * How many of `player`'s stones sit next to the current empty point — the
 * number of legal moves `player` would have if it were their turn right now.
 * Unlike gonuEngine.legalMoves (which returns [] for whichever player isn't
 * state.turn), this is purely a function of the board, so it can be compared
 * for both players at any node regardless of whose turn `state` holds.
 */
function mobility(board: GonuBoardMap, player: PlayerIndex): number {
  const empty = emptyPointId(board);
  if (empty === null) return 0; // unreachable: exactly one point is always empty
  let n = 0;
  for (const neighbor of EDGES[empty]) {
    if (board[neighbor] === player) n++;
  }
  return n;
}

/* ------------------------------------------------------------------------ */
/* Heuristic + generic adversarial alpha-beta (search.ts)                   */
/* ------------------------------------------------------------------------ */

/** Weight per extra stone `root` has adjacent to the empty point versus the opponent. */
const MOBILITY_WEIGHT = 100;
/** Weight for holding the center, which stays reachable from any future empty point. */
const CENTRE_WEIGHT = 15;

/**
 * Static evaluation of a non-terminal state, from `root`'s point of view.
 * Mobility is always tied 2-2 whenever C is the empty point (the other four
 * points are then all occupied, split evenly between the two players, since
 * nobody ever gains or loses a stone in this game) — the centre term is what
 * breaks that tie, favouring the more flexible player. |value| <= 215.
 */
function evaluate(state: GonuState, root: PlayerIndex): number {
  const opp = other(root);
  const mobilityDiff = mobility(state.board, root) - mobility(state.board, opp);
  const centreDiff = (state.board.C === root ? 1 : 0) - (state.board.C === opp ? 1 : 0);
  return mobilityDiff * MOBILITY_WEIGHT + centreDiff * CENTRE_WEIGHT;
}

/**
 * Configs for the generic search. `easy` is the only level that normally runs
 * it: depth is plies, so it reads just its own move and otherwise moves at
 * random (it still takes an immediate trap, since makeSearchAi checks that
 * before rolling the dice). `hard` falls back to it only when the exact solve
 * runs out of time, and `normal`'s entry is what makeSearchAi uses for a
 * level id it does not recognise.
 */
const LEVELS = {
  easy: { depth: 1, budgetMs: 100, randomness: 0.6 },
  normal: { depth: 6, budgetMs: 500 },
  hard: { depth: 14, budgetMs: 1200 },
};

const searchAi = makeSearchAi<GonuState, Move>({
  engine: gonuEngine,
  evaluate,
  levels: LEVELS,
});

/* ------------------------------------------------------------------------ */
/* `normal`: bounded expectimax against a uniformly random opponent         */
/* ------------------------------------------------------------------------ */

/**
 * Plies of "my move maximises, the opponent's move averages" lookahead before
 * `normal` falls back to the heuristic. Deliberately bounded (unlike `hard`'s
 * exact solve): beyond the horizon it cannot tell which drawing line offers
 * the opponent more chances to go wrong, which is the room `hard` has to be
 * visibly stronger. With at most 2 legal moves per ply this is under 130 nodes.
 */
const NORMAL_DEPTH = 6;

/**
 * Expectimax value of `state` for `aiSeat`, looking `depthLeft` plies ahead:
 * `aiSeat`'s own turns maximise, the opponent's turns average over their
 * legal moves (modelling them as uniformly random). Terminals score ±WIN_SCORE
 * so they always dominate the heuristic used beyond the horizon.
 */
function expectimaxValue(state: GonuState, aiSeat: PlayerIndex, depthLeft: number): number {
  const status = gonuEngine.status(state);
  if (status.status === "win") return status.winner === aiSeat ? WIN_SCORE : -WIN_SCORE;
  if (status.status === "draw") return 0;
  if (depthLeft <= 0) return evaluate(state, aiSeat);

  const mover = state.turn;
  const moves = gonuEngine.legalMoves(state, mover);
  if (moves.length === 0) return 0; // unreachable: see games/gonu.ts's applyMove invariant, guarded defensively
  const children = moves.map((m) => expectimaxValue(gonuEngine.applyMove(state, m, mover).state, aiSeat, depthLeft - 1));
  if (mover === aiSeat) return Math.max(...children); // our move: take the best continuation
  return children.reduce((a, b) => a + b, 0) / children.length; // their move: average over a random reply
}

/** Tolerance for treating two floating-point move values as a tie. */
const EPS = 1e-9;

/** Among `legal`, the move(s) with the highest expectimax value for `player`. */
function bestMovesAgainstRandom(state: GonuState, player: PlayerIndex, legal: Move[]): Move[] {
  const scored = legal.map((move) => ({
    move,
    value: expectimaxValue(gonuEngine.applyMove(state, move, player).state, player, NORMAL_DEPTH - 1),
  }));
  const best = Math.max(...scored.map((s) => s.value));
  return scored.filter((s) => Math.abs(s.value - best) < EPS).map((s) => s.move);
}

/* ------------------------------------------------------------------------ */
/* `hard`: exact solve — minimax first, then win probability vs random      */
/* ------------------------------------------------------------------------ */

/**
 * Value of a state for the AI seat. `minimax` is the classic adversarial
 * value (+1 forced win, 0 draw, -1 forced loss, ply cap included). `random`
 * is P(win) - P(loss) against a uniformly random opponent when the AI follows
 * the policy below, i.e. always picks the child with the best `minimax` and,
 * among those, the best `random`. Both come out of the one recursion: the
 * opponent's nodes take the minimum for `minimax` and the average for `random`.
 */
interface SolvedValue {
  minimax: number;
  random: number;
}

interface SolveCtx {
  /** Values by (board, turn, plies). Plies always grow, so the recursion is acyclic. */
  memo: Map<string, SolvedValue>;
  now: () => number;
  deadline: number;
  nodes: number;
  timedOut: boolean;
}

/** Board occupancy plus side to move plus ply count — everything the value depends on. */
function stateKey(state: GonuState): string {
  let key = "";
  for (const id of POINT_IDS) {
    const owner = state.board[id];
    key += owner === null ? "." : owner;
  }
  return `${key}${state.turn}:${state.plies}`;
}

const DRAWN: SolvedValue = { minimax: 0, random: 0 };

function solveValue(state: GonuState, aiSeat: PlayerIndex, ctx: SolveCtx): SolvedValue {
  const status = gonuEngine.status(state);
  if (status.status === "win") return status.winner === aiSeat ? { minimax: 1, random: 1 } : { minimax: -1, random: -1 };
  if (status.status !== "ongoing") return DRAWN; // the ply cap
  const key = stateKey(state);
  const hit = ctx.memo.get(key);
  if (hit) return hit;
  if ((++ctx.nodes & 31) === 0 && ctx.now() >= ctx.deadline) ctx.timedOut = true;
  if (ctx.timedOut) return DRAWN; // placeholder; the caller throws the whole answer away

  const mover = state.turn;
  const moves = gonuEngine.legalMoves(state, mover);
  const ours = mover === aiSeat;
  let minimax = ours ? -Infinity : Infinity;
  let random = ours ? -Infinity : 0;
  let count = 0;
  for (const move of moves) {
    const r = gonuEngine.applyMove(state, move, mover);
    if (!r.ok) continue;
    const child = solveValue(r.state, aiSeat, ctx);
    count++;
    if (ours) {
      // Lexicographic max: safety first, then chances against a careless opponent.
      if (child.minimax > minimax || (child.minimax === minimax && child.random > random)) {
        minimax = child.minimax;
        random = child.random;
      }
    } else {
      if (child.minimax < minimax) minimax = child.minimax;
      random += child.random;
    }
  }
  if (count === 0) return DRAWN; // unreachable: the engine only leaves "ongoing" states with a legal move
  const value: SolvedValue = ours ? { minimax, random } : { minimax, random: random / count };
  if (!ctx.timedOut) ctx.memo.set(key, value);
  return value;
}

/**
 * Exactly solves the rest of the game from `state` and returns the legal
 * moves that are lexicographically best for `player` (all of them, so the
 * caller can vary between equal choices), or null if the clock ran out first.
 * From the opening the solve touches 1190 states and takes a few
 * milliseconds; later positions are smaller still.
 */
function solveBestMoves(state: GonuState, player: PlayerIndex, legal: Move[], now: () => number, deadline: number): Move[] | null {
  const ctx: SolveCtx = { memo: new Map(), now, deadline, nodes: 0, timedOut: false };
  const scored: { move: Move; value: SolvedValue }[] = [];
  for (const move of legal) {
    const r = gonuEngine.applyMove(state, move, player);
    if (!r.ok) continue;
    const value = solveValue(r.state, player, ctx);
    if (ctx.timedOut) return null;
    scored.push({ move, value });
  }
  if (scored.length === 0) return null;
  let best = scored[0]!.value;
  for (const s of scored) {
    if (s.value.minimax > best.minimax || (s.value.minimax === best.minimax && s.value.random > best.random)) best = s.value;
  }
  return scored.filter((s) => s.value.minimax === best.minimax && Math.abs(s.value.random - best.random) < EPS).map((s) => s.move);
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                  */
/* ------------------------------------------------------------------------ */

/** Last resort when something unexpected happens: any legal move, or null if there is none. */
function fallback(state: GonuState, player: PlayerIndex, rng: Rng): Move | null {
  try {
    const legal = gonuEngine.legalMoves(state, player);
    return legal.length > 0 ? pickRandom(legal, rng) : null;
  } catch {
    return null;
  }
}

function chooseHard(state: GonuState, player: PlayerIndex, legal: Move[], options: AiOptions, rng: Rng): Move {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? LEVELS.hard.budgetMs);
  const best = solveBestMoves(state, player, legal, now, deadline);
  if (best && best.length > 0) return pickRandom(best, rng);
  // Out of time before the (tiny) solve finished — only plausible with a budget
  // of a millisecond or two on a stalled machine. The generic adversarial
  // search degrades gracefully with whatever is left and still takes an
  // immediate trap.
  const remaining = Math.max(0, deadline - now());
  return searchAi.chooseMove(state, player, "hard", { ...options, budgetMs: remaining }) ?? pickRandom(legal, rng);
}

export const gonuAi: AiProvider<GonuState, Move> = {
  // `normal` beats random play well above 90% in practice (the exact optimum
  // against a random mover is 99.9% moving first and 88.8% moving second under
  // the ply cap, and `normal`'s 6-ply expectimax is close to it).
  testProfile: { games: 20, minWinRate: 0.9, budgetMs: 40 },
  chooseMove(state, player, level, options = {}) {
    const rng = options.rng ?? Math.random;
    try {
      if (state.status !== "ongoing" || state.turn !== player) return null;
      const legal = gonuEngine.legalMoves(state, player);
      if (legal.length === 0) return null;
      if (legal.length === 1) return legal[0]!;

      if (level === "hard") return chooseHard(state, player, legal, options, rng);
      if (level === "normal") return pickRandom(bestMovesAgainstRandom(state, player, legal), rng);
      // `easy` (and any level id we do not know): the generic search above.
      return searchAi.chooseMove(state, player, level, options) ?? pickRandom(legal, rng);
    } catch {
      return fallback(state, player, rng);
    }
  },
};
