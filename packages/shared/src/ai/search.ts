import type { BaseState, GameEngine, PlayerIndex, Rng, StatusResult } from "../types.js";
import type { AiLevel, AiOptions, AiProvider, AiTestProfile } from "./types.js";
import { pickRandom, shuffle } from "./random.js";

/**
 * Generic alpha-beta search over any GameEngine.
 *
 * A game plugs in a static evaluation (and optionally a candidate-move
 * generator for pruning/ordering) and gets three playable levels back. The
 * search is written from the ROOT player's perspective: at each node it
 * maximises when the side to move is the root player and minimises otherwise.
 * That, rather than negamax, is deliberate — several engines here let the same
 * player move again (checkers multi-jumps, territory path extension), so the
 * side to move does not simply alternate with depth.
 *
 * Scores: terminal wins are ±WIN_SCORE adjusted by ply so a faster win (or a
 * slower loss) is preferred. Evaluations must stay well inside that range.
 */

export const WIN_SCORE = 1_000_000;

export interface SearchSpec<TState extends BaseState, TMove> {
  engine: GameEngine<TState, TMove>;
  /**
   * Static evaluation of a NON-terminal `state` from `player`'s point of view;
   * bigger is better for `player`. Keep |value| far below WIN_SCORE.
   */
  evaluate(state: TState, player: PlayerIndex): number;
  /**
   * Moves for `mover` to consider, best-first. Defaults to engine.legalMoves.
   * Use it to prune (gomoku: cells near existing stones) and to order (captures
   * first) — ordering is what makes alpha-beta cut. Must be a subset of legal moves.
   */
  candidates?(state: TState, mover: PlayerIndex, depthLeft: number): TMove[];
  /** Score of a drawn terminal from `player`'s view. Defaults to 0. */
  drawScore?(state: TState, player: PlayerIndex): number;
}

export interface SearchLevelConfig {
  /** Maximum depth in plies. */
  depth: number;
  /** Default time budget; iterative deepening stops when it runs out. */
  budgetMs: number;
  /** 0..1 — probability of playing a random legal move instead of searching. Makes low levels beatable. */
  randomness?: number;
}

export interface SearchAiConfig<TState extends BaseState, TMove> extends SearchSpec<TState, TMove> {
  levels: Record<AiLevel, SearchLevelConfig>;
  testProfile?: AiTestProfile;
}

interface Ctx {
  rng: Rng;
  now: () => number;
  deadline: number;
  nodes: number;
  timedOut: boolean;
}

function terminalScore<TState extends BaseState>(
  spec: SearchSpec<TState, unknown>,
  state: TState,
  status: StatusResult,
  root: PlayerIndex,
  ply: number,
): number {
  if (status.status === "win") return status.winner === root ? WIN_SCORE - ply : -WIN_SCORE + ply;
  return spec.drawScore ? spec.drawScore(state, root) : 0;
}

function candidatesFor<TState extends BaseState, TMove>(
  spec: SearchSpec<TState, TMove>,
  state: TState,
  mover: PlayerIndex,
  depthLeft: number,
): TMove[] {
  if (spec.candidates) {
    const c = spec.candidates(state, mover, depthLeft);
    if (c.length > 0) return c;
  }
  return spec.engine.legalMoves(state, mover);
}

function alphaBeta<TState extends BaseState, TMove>(
  spec: SearchSpec<TState, TMove>,
  state: TState,
  root: PlayerIndex,
  depth: number,
  alpha: number,
  beta: number,
  ctx: Ctx,
  ply: number,
): number {
  const status = spec.engine.status(state);
  if (status.status !== "ongoing") return terminalScore(spec, state, status, root, ply);
  if (depth <= 0) return spec.evaluate(state, root);
  if ((++ctx.nodes & 31) === 0 && ctx.now() >= ctx.deadline) ctx.timedOut = true;
  if (ctx.timedOut) return spec.evaluate(state, root);

  const mover = spec.engine.turn(state);
  const moves = candidatesFor(spec, state, mover, depth);
  if (moves.length === 0) return spec.evaluate(state, root);

  const maximizing = mover === root;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const r = spec.engine.applyMove(state, move, mover, ctx.rng);
    if (!r.ok) continue;
    const score = alphaBeta(spec, r.state, root, depth - 1, alpha, beta, ctx, ply + 1);
    if (maximizing) {
      if (score > best) best = score;
      if (best > alpha) alpha = best;
    } else {
      if (score < best) best = score;
      if (best < beta) beta = best;
    }
    if (alpha >= beta || ctx.timedOut) break;
  }
  if (best === Infinity || best === -Infinity) return spec.evaluate(state, root);
  return best;
}

export interface SearchResult<TMove> {
  move: TMove | null;
  score: number;
  /** Deepest iteration that finished inside the budget (0 = not even depth 1). */
  depth: number;
  nodes: number;
}

/**
 * Iterative-deepening alpha-beta from `player`'s root position. Root moves are
 * shuffled with `rng` (so equal moves vary between games) and re-ordered by the
 * previous iteration's scores, which is what lets deeper iterations cut early.
 */
export function searchBestMove<TState extends BaseState, TMove>(
  spec: SearchSpec<TState, TMove>,
  state: TState,
  player: PlayerIndex,
  cfg: { depth: number; budgetMs: number; rng?: Rng; now?: () => number },
): SearchResult<TMove> {
  const engine = spec.engine;
  const empty: SearchResult<TMove> = { move: null, score: 0, depth: 0, nodes: 0 };
  if (engine.status(state).status !== "ongoing" || engine.turn(state) !== player) return empty;

  const rng = cfg.rng ?? Math.random;
  const now = cfg.now ?? Date.now;
  let moves = candidatesFor(spec, state, player, cfg.depth);
  if (moves.length === 0) moves = engine.legalMoves(state, player);
  if (moves.length === 0) return empty;
  shuffle(moves, rng);

  const ctx: Ctx = { rng, now, deadline: now() + cfg.budgetMs, nodes: 0, timedOut: false };

  let children = moves
    .map((move) => ({ move, result: engine.applyMove(state, move, player, rng) }))
    .filter((c) => c.result.ok)
    .map((c) => ({ move: c.move, state: c.result.state }));
  if (children.length === 0) return empty;
  if (children.length === 1) return { move: children[0]!.move, score: 0, depth: 0, nodes: 0 };

  let bestMove: TMove = children[0]!.move;
  let bestScore = -Infinity;
  let completedDepth = 0;

  for (let depth = 1; depth <= cfg.depth; depth++) {
    let iterBest: TMove | null = null;
    let iterScore = -Infinity;
    let alpha = -Infinity;
    const scored: { move: TMove; state: TState; score: number }[] = [];
    for (const child of children) {
      const score = alphaBeta(spec, child.state, player, depth - 1, alpha, Infinity, ctx, 1);
      if (ctx.timedOut) break;
      scored.push({ ...child, score });
      if (score > iterScore) {
        iterScore = score;
        iterBest = child.move;
      }
      if (score > alpha) alpha = score;
    }
    if (ctx.timedOut) {
      // Nothing finished yet: the partial pass is still better than the shuffled first child.
      if (completedDepth === 0 && iterBest !== null) {
        bestMove = iterBest;
        bestScore = iterScore;
      }
      break;
    }
    bestMove = iterBest ?? bestMove;
    bestScore = iterScore;
    completedDepth = depth;
    scored.sort((a, b) => b.score - a.score);
    children = scored.map(({ move, state: s }) => ({ move, state: s }));
    // A forced win/loss has been found; deeper search cannot change it.
    if (Math.abs(bestScore) >= WIN_SCORE - 10_000) break;
  }
  return { move: bestMove, score: bestScore, depth: completedDepth, nodes: ctx.nodes };
}

/** Any legal move that ends the game in `player`'s favour right now. */
export function findImmediateWin<TState extends BaseState, TMove>(
  engine: GameEngine<TState, TMove>,
  state: TState,
  player: PlayerIndex,
  moves: TMove[],
  rng: Rng,
): TMove | null {
  for (const move of moves) {
    const r = engine.applyMove(state, move, player, rng);
    if (r.ok && r.status.status === "win" && r.status.winner === player) return move;
  }
  return null;
}

/**
 * Builds a three-level AiProvider from a SearchSpec. Every level takes an
 * immediate win when one exists (an "easy" bot that misses mate-in-one reads as
 * broken, not easy); beyond that the levels differ in depth, time and noise.
 */
export function makeSearchAi<TState extends BaseState, TMove>(config: SearchAiConfig<TState, TMove>): AiProvider<TState, TMove> {
  const engine = config.engine;
  return {
    testProfile: config.testProfile,
    chooseMove(state, player, level, options = {}) {
      const rng = options.rng ?? Math.random;
      try {
        if (engine.status(state).status !== "ongoing" || engine.turn(state) !== player) return null;
        const legal = engine.legalMoves(state, player);
        if (legal.length === 0) return null;
        if (legal.length === 1) return legal[0]!;
        const lv = config.levels[level] ?? config.levels.normal;
        const winning = findImmediateWin(engine, state, player, legal, rng);
        if (winning) return winning;
        if (lv.randomness && rng() < lv.randomness) return pickRandom(legal, rng);
        const res = searchBestMove(config, state, player, {
          depth: lv.depth,
          budgetMs: options.budgetMs ?? lv.budgetMs,
          rng,
          now: options.now,
        });
        return res.move ?? pickRandom(legal, rng);
      } catch {
        try {
          const legal = engine.legalMoves(state, player);
          return legal.length ? pickRandom(legal, rng) : null;
        } catch {
          return null;
        }
      }
    },
  };
}

/** Re-exported so game AIs only need to import from "./search.js". */
export type { AiLevel, AiOptions, AiProvider } from "./types.js";
