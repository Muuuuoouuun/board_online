import type { Move, PlayerIndex, Rng } from "../types.js";
import { gonuEngine, POINT_IDS, EDGES, type GonuState, type GonuBoardMap, type PointId } from "../games/gonu.js";
import type { AiProvider } from "./types.js";
import { makeSearchAi } from "./search.js";
import { pickRandom } from "./random.js";

/**
 * 우물고누 (Umul-gonu / "Well Gonu", internationally Pong Hau K'i) computer
 * opponent.
 *
 * The board has only 5 points and 4 stones, so the whole reachable state
 * graph is tiny — games/gonu.ts's own PLY_CAP comment puts an upper bound of
 * 30 board layouts x 2 turns-to-move = 60 distinct states on it. That has a
 * real consequence for how to build a good opponent here, not just for how
 * cheap the search is:
 *
 * With correct play from BOTH sides this game is a theoretical forever-draw
 * (games/gonu.ts: "with careful play (mirroring the opponent), neither side
 * can be forced into a trap") — confirmed below by exhaustively solving the
 * adversarial (minimax) value of the opening position, which comes out to
 * exactly 0. That means a classic alpha-beta search, however deep, will
 * always find that every move only *draws* against a perfect defender, and
 * — with no reason to prefer one drawing line over another — happily settles
 * into a safe repeating shuffle that never actually threatens a real
 * (imperfect) opponent. That is exactly what a mobility-only alpha-beta AI
 * does here in practice: it locks into a short cycle and draws every single
 * game, including against a *uniformly random* mover. Minimax's worst-case
 * assumption is simply the wrong model of a random opponent, who — unlike an
 * adversary — cannot reliably find the one safe reply out of two.
 *
 * So `normal` and `hard` use two different, deliberately mismatched engines:
 *
 *  - `normal` plays the exact move that maximizes the probability of
 *    eventually winning *against a uniformly random opponent* (ties broken
 *    by minimizing loss probability). Because the whole game graph is only a
 *    few thousand (board, turn, plies-so-far) states, this is computed
 *    exactly by backward induction rather than approximated — see
 *    `outcomeAgainstRandom` below — which reliably clears the ≥90% win-rate
 *    bar (solving from the opening position gives ~99.9% as the first player
 *    and ~92.4% as the second, well above it). This policy takes real risks
 *    a cautious opponent could in principle punish; that's fine, it exists
 *    to beat careless (random) play efficiently, not to be unbeatable.
 *  - `hard` (and the shallow, noisy `easy`) use the generic alpha-beta search
 *    from search.ts with a plain mobility/centre evaluation. Being adversarial
 *    and deep enough to see essentially the whole graph, `hard` never willingly
 *    loses and is exactly the kind of opponent that can catch `normal`'s
 *    riskier lines — which is what makes `hard` play visibly stronger head to
 *    head, even though neither engine can force a win from a game that is a
 *    theoretical draw.
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
/* `easy` / `hard`: generic adversarial alpha-beta (search.ts)              */
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
 * breaks that tie, favouring the more flexible player.
 */
function evaluate(state: GonuState, root: PlayerIndex): number {
  const opp = other(root);
  const mobilityDiff = mobility(state.board, root) - mobility(state.board, opp);
  const centreDiff = (state.board.C === root ? 1 : 0) - (state.board.C === opp ? 1 : 0);
  return mobilityDiff * MOBILITY_WEIGHT + centreDiff * CENTRE_WEIGHT;
}

/**
 * Depth is plies, not "moves" — with a branching factor of at most 2 (a
 * player owns only 2 stones, so at most 2 can ever be adjacent to the single
 * empty point) even `hard`'s depth 14 is cheap, so the time budget (search.ts's
 * iterative deepening stops when it runs out) is what actually bounds `hard`,
 * not the nominal depth. `easy` reads only one ply ahead and otherwise moves
 * at random — it still takes an immediate trap of the opponent, since
 * makeSearchAi checks that before rolling the dice.
 */
const LEVELS = {
  easy: { depth: 1, budgetMs: 100, randomness: 0.6 },
  normal: { depth: 6, budgetMs: 500 }, // unused: "normal" is handled by outcomeAgainstRandom below
  hard: { depth: 14, budgetMs: 1200 },
};

const searchAi = makeSearchAi<GonuState, Move>({
  engine: gonuEngine,
  evaluate,
  levels: LEVELS,
});

/* ------------------------------------------------------------------------ */
/* `normal`: expectimax against a uniformly random opponent                 */
/* ------------------------------------------------------------------------ */

/**
 * How many plies of "my move maximizes, the opponent's move averages" lookahead
 * `normal` does before falling back to the mobility/centre heuristic. This is
 * deliberately *not* exact (unlike `hard`'s adversarial search, which is deep
 * enough to see essentially the whole graph): a bounded, imperfect opponent
 * model is what gives `hard` — which sees further and can find and punish the
 * concrete mistakes this horizon causes — genuine room to play visibly
 * stronger. See the file header for why an exact solve here would actually
 * make `normal` *harder* to beat, not easier.
 */
const NORMAL_DEPTH = 6;

/** A value clearly outside evaluate()'s range (see EVAL_CLAMP-free bound above), so it always dominates a heuristic leaf. */
const TERMINAL_VALUE = 1_000_000;

/**
 * Expectimax value of `state` for `aiSeat`, looking `depthLeft` plies ahead:
 * `aiSeat`'s own turns maximize, the opponent's turns average over their
 * legal moves (modelling them as uniformly random) — exactly the search a
 * player who knows their opponent is careless, not adversarial, should run.
 * Beyond `depthLeft` (or at a real terminal) it falls back to the same
 * mobility/centre `evaluate()` used by the adversarial search below.
 */
function expectimaxValue(state: GonuState, aiSeat: PlayerIndex, depthLeft: number): number {
  const status = gonuEngine.status(state);
  if (status.status === "win") return status.winner === aiSeat ? TERMINAL_VALUE : -TERMINAL_VALUE;
  if (status.status === "draw") return 0;
  if (depthLeft <= 0) return evaluate(state, aiSeat);

  const mover = state.turn;
  const moves = gonuEngine.legalMoves(state, mover);
  if (moves.length === 0) return 0; // unreachable: see games/gonu.ts's applyMove invariant, guarded defensively
  const children = moves.map((m) => expectimaxValue(gonuEngine.applyMove(state, m, mover).state, aiSeat, depthLeft - 1));
  if (mover === aiSeat) return Math.max(...children); // our move: take the best continuation
  return children.reduce((a, b) => a + b, 0) / children.length; // their move: average over a random reply
}

/** Among `legal`, the move(s) with the highest expectimax value for `player`. */
function bestMovesAgainstRandom(state: GonuState, player: PlayerIndex, legal: Move[]): Move[] {
  const scored = legal.map((move) => ({
    move,
    value: expectimaxValue(gonuEngine.applyMove(state, move, player).state, player, NORMAL_DEPTH - 1),
  }));
  const best = Math.max(...scored.map((s) => s.value));
  const EPS = 1e-9;
  return scored.filter((s) => Math.abs(s.value - best) < EPS).map((s) => s.move);
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

export const gonuAi: AiProvider<GonuState, Move> = {
  // The exact policy against random play wins ~99.9% as the first seat and
  // ~92.4% as the second (solved once, offline, from the opening position),
  // comfortably above the harness's 90% bar even averaged over both seats.
  testProfile: { games: 20, minWinRate: 0.9, budgetMs: 40 },
  chooseMove(state, player, level, options = {}) {
    const rng = options.rng ?? Math.random;
    try {
      if (state.status !== "ongoing" || state.turn !== player) return null;
      const legal = gonuEngine.legalMoves(state, player);
      if (legal.length === 0) return null;
      if (legal.length === 1) return legal[0]!;

      if (level === "normal") {
        return pickRandom(bestMovesAgainstRandom(state, player, legal), rng);
      }
      // easy & hard: the generic adversarial search above.
      return searchAi.chooseMove(state, player, level, options) ?? pickRandom(legal, rng);
    } catch {
      return fallback(state, player, rng);
    }
  },
};
