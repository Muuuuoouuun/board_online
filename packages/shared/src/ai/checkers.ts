import type { Move, PlayerIndex } from "../types.js";
import { checkersEngine, type CheckersState } from "../games/checkers.js";
import type { AiLevel, AiProvider } from "./types.js";
import { makeSearchAi, type SearchLevelConfig } from "./search.js";

/**
 * Checkers (체커) computer opponent.
 *
 * Built on the generic iterative-deepening alpha-beta from search.ts, which
 * already does the one thing this game needs that a plain minimax would get
 * wrong: it maximises/minimises by *side to move*, not by ply parity. That
 * matters here because a capture that lands with another jump available keeps
 * `state.turn` on the same player (`forcedFrom` in the engine) — the search
 * just sees "the mover is still root" and carries on correctly with no
 * special-casing on our side.
 *
 * This file supplies only the checkers-specific knowledge:
 *  - evaluate(): material, advancement, back-rank guard, centre control,
 *    mobility and a small tempo term (see the doc comment on evaluate()).
 *  - candidates(): re-orders the engine's legal moves so alpha-beta sees the
 *    most promising ones first — big captures before small ones, advancing
 *    pushes before shuffles — which is what actually makes the cuts happen.
 *    (The engine already enforces mandatory capture, so `legalMoves` never
 *    mixes captures with quiet moves; this only orders within one or the
 *    other.)
 *
 * makeSearchAi's own chooseMove already covers everything a checkers bot
 * needs beyond search: it returns null off-turn or once the game is over,
 * takes a one-move win at every level (an easy bot that lets a king-me-and-win
 * shot through would read as broken, not easy), and falls back to a random
 * legal move if anything unexpected happens — so there is no need for a
 * custom wrapper the way gomoku's five-in-a-row tactics required one.
 */

const SIZE = 8;

/**
 * Structural mirror of the engine's private per-square piece shape. Not
 * imported (checkers.ts doesn't export it) — TypeScript matches by shape, and
 * this file never constructs a piece, only reads the ones the engine hands
 * back via `state.board`, so the two stay in sync automatically.
 */
type Piece = { owner: PlayerIndex; king: boolean };
type Board = (Piece | null)[][];

function inRange(x: number, y: number): boolean {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

const KING_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** A man's two forward diagonals: player 0 advances toward y=7, player 1 toward y=0. */
function manDirs(owner: PlayerIndex): ReadonlyArray<readonly [number, number]> {
  const dy = owner === 0 ? 1 : -1;
  return [
    [1, dy],
    [-1, dy],
  ];
}

/* ------------------------------------------------------------------------ */
/* Static evaluation                                                        */
/* ------------------------------------------------------------------------ */

const MAN_VALUE = 100;
const KING_VALUE = 170;
/** Per-row credit for a man pushed toward its crowning row; kings are already maxed out. */
const ADVANCE_WEIGHT = 4;
/** Extra nudge for a man one row from crowning — makes the engine actually go for it. */
const NEAR_PROMOTION_BONUS = 12;
/** Per piece still sitting on the home back rank: those squares are where the *opponent*
 *  would crown a man, so keeping a defender on them for a while denies an easy king. */
const BACK_GUARD_BONUS = 6;
/** Per own piece in the central 4x4: more directions to develop into, harder to hem in. */
const CENTRE_BONUS = 3;
/** Per available destination (quiet move or jump) a piece has right now. */
const MOBILITY_WEIGHT = 2;
/** Small edge for the side to move — it gets to act on everything above one ply sooner. */
const TEMPO_BONUS = 5;

function inCentre(x: number, y: number): boolean {
  return x >= 2 && x <= 5 && y >= 2 && y <= 5;
}

/** How many quiet destinations + jumps `piece` at (x,y) has, ignoring whose turn it is. */
function destinationCount(board: Board, x: number, y: number, piece: Piece): number {
  const dirs = piece.king ? KING_DIRS : manDirs(piece.owner);
  let n = 0;
  for (const [dx, dy] of dirs) {
    const mx = x + dx;
    const my = y + dy;
    if (!inRange(mx, my)) continue;
    const mid = board[my]![mx];
    if (mid === null) {
      n++;
      continue;
    }
    if (mid.owner !== piece.owner) {
      const lx = x + dx * 2;
      const ly = y + dy * 2;
      if (inRange(lx, ly) && board[ly]![lx] === null) n++;
    }
  }
  return n;
}

/**
 * Static evaluation of a NON-terminal position from `root`'s point of view;
 * bigger is better for `root`. Every term below is small (a handful of points
 * per piece at most) next to MAN_VALUE, so material always dominates and the
 * rest only breaks ties between otherwise-similar positions — the sum across
 * a full board stays a few thousand at most, far inside WIN_SCORE.
 */
function evaluate(state: CheckersState, root: PlayerIndex): number {
  const board = state.board as unknown as Board;
  let score = 0;
  for (let y = 0; y < SIZE; y++) {
    const row = board[y]!;
    for (let x = 0; x < SIZE; x++) {
      const piece = row[x];
      if (!piece) continue;
      const sign = piece.owner === root ? 1 : -1;

      if (piece.king) {
        score += sign * KING_VALUE;
      } else {
        score += sign * MAN_VALUE;
        // Rows advanced toward the crowning edge (0 = still on the start row).
        const rowsAdvanced = piece.owner === 0 ? y : SIZE - 1 - y;
        score += sign * ADVANCE_WEIGHT * rowsAdvanced;
        if (rowsAdvanced === SIZE - 2) score += sign * NEAR_PROMOTION_BONUS;
        const homeRow = piece.owner === 0 ? 0 : SIZE - 1;
        if (y === homeRow) score += sign * BACK_GUARD_BONUS;
      }
      if (inCentre(x, y)) score += sign * CENTRE_BONUS;
      score += sign * MOBILITY_WEIGHT * destinationCount(board, x, y, piece);
    }
  }
  score += state.turn === root ? TEMPO_BONUS : -TEMPO_BONUS;
  return score;
}

/* ------------------------------------------------------------------------ */
/* Move ordering                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Rough "how promising does this look" score for ordering, not evaluation.
 * Captures always outrank quiet moves (mandatory capture means the engine
 * never actually mixes the two in one `legalMoves` call, but a chain of
 * jumps still needs internal ordering, and this keeps the function correct
 * even if that ever changes); within captures, prefer the more valuable
 * victim and a landing square that keeps options open; within quiet moves,
 * prefer pushing forward and toward the centre.
 */
function moveScore(board: Board, move: Move): number {
  const from = move.from;
  if (!from) return 0;
  const piece = board[from.y]![from.x];
  if (!piece) return 0;
  const { x: tx, y: ty } = move.to;
  const isCapture = Math.abs(tx - from.x) === 2;

  if (isCapture) {
    const mx = (from.x + tx) / 2;
    const my = (from.y + ty) / 2;
    const captured = board[my]![mx];
    const victim = captured?.king ? KING_VALUE : MAN_VALUE;
    return 1000 + victim + destinationCount(board, tx, ty, piece);
  }

  let s = 0;
  if (!piece.king) {
    const rowsBefore = piece.owner === 0 ? from.y : SIZE - 1 - from.y;
    const rowsAfter = piece.owner === 0 ? ty : SIZE - 1 - ty;
    s += (rowsAfter - rowsBefore) * ADVANCE_WEIGHT;
  }
  if (inCentre(tx, ty)) s += CENTRE_BONUS;
  return s;
}

function candidates(state: CheckersState, mover: PlayerIndex): Move[] {
  const moves = checkersEngine.legalMoves(state, mover);
  if (moves.length <= 1) return moves;
  const board = state.board as unknown as Board;
  return moves
    .map((m) => ({ m, s: moveScore(board, m) }))
    .sort((a, b) => b.s - a.s)
    .map((c) => c.m);
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                 */
/* ------------------------------------------------------------------------ */

const LEVELS: Record<AiLevel, SearchLevelConfig> = {
  // Shallow and noisy on purpose: still takes a one-move win or a forced
  // capture (those aren't optional), but otherwise plays like a beginner.
  easy: { depth: 1, budgetMs: 100, randomness: 0.5 },
  normal: { depth: 4, budgetMs: 500 },
  hard: { depth: 8, budgetMs: 1200 },
};

export const checkersAi: AiProvider<CheckersState, Move> = makeSearchAi<CheckersState, Move>({
  engine: checkersEngine,
  evaluate,
  candidates,
  levels: LEVELS,
  testProfile: { games: 20, minWinRate: 0.9, budgetMs: 40 },
});
