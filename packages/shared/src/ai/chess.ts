import { Chess } from "chess.js";
import type { Move, PlayerIndex, Pos } from "../types.js";
import { chessEngine, type ChessState } from "../games/chess.js";
import type { AiProvider } from "./types.js";
import { makeSearchAi } from "./search.js";

/**
 * Chess (체스) computer opponent.
 *
 * The search is the generic iterative-deepening alpha-beta from search.ts. The
 * engine keeps the whole position as a FEN string and rebuilds a chess.js
 * instance on every call, so one node costs tens of microseconds and the search
 * only reaches two to four plies inside its budget. This file makes those plies
 * count:
 *
 *  - evaluate(): material and piece-square tables (the classic "simplified
 *    evaluation function" tables), a small mobility term, a bonus for giving
 *    check, a threat term that credits the side to move with its best available
 *    capture (a one-capture stand-in for quiescence search, which curbs the
 *    horizon effect of grabbing a defended piece on the last ply) and a mop-up
 *    term that drives the enemy king to the edge once the position is won.
 *  - candidates(): the engine's legalMoves() asks chess.js for verbose moves,
 *    which re-runs full move generation per move; the SAN list is ten times
 *    cheaper, so the SAN strings are resolved to squares with the board
 *    geometry below and ordered mate, captures (most valuable victim first),
 *    queen promotions, checks, then quiet moves by piece-square gain. Rook and
 *    bishop underpromotions are left out of the search.
 *  - drawScore(): stalemate, the fifty-move rule and insufficient material are
 *    scored from the material balance, so a side that is ahead steers clear of
 *    them and a side that is behind heads for them.
 */

const LEVELS = {
  easy: { depth: 1, budgetMs: 100, randomness: 0.5 },
  normal: { depth: 3, budgetMs: 500 },
  hard: { depth: 5, budgetMs: 1200 },
};

/* ------------------------------------------------------------------------ */
/* Board representation                                                     */
/* ------------------------------------------------------------------------ */

/**
 * 64 cells indexed y * 8 + x with x the file (a = 0) and y the row from the
 * top (rank 8 = 0) — the engine's Pos coordinates. White pieces carry the
 * positive codes below, black pieces the negative ones. chess.js guarantees
 * exactly one king per side in every position it produces.
 */
const EMPTY = 0;
const PAWN = 1;
const KNIGHT = 2;
const BISHOP = 3;
const ROOK = 4;
const QUEEN = 5;
const KING = 6;

const PIECE_CODE: Record<string, number> = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

/** Centipawn values by piece kind. The king's only says "an attacker that can never be traded off". */
const VALUE = [0, 100, 320, 330, 500, 900, 20_000] as const;

function readBoard(chess: Chess): Int8Array {
  const rows = chess.board();
  const b = new Int8Array(64);
  for (let y = 0; y < 8; y++) {
    const row = rows[y]!;
    for (let x = 0; x < 8; x++) {
      const cell = row[x];
      if (!cell) continue;
      const code = PIECE_CODE[cell.type]!;
      b[y * 8 + x] = cell.color === "w" ? code : -code;
    }
  }
  return b;
}

/** "e4" → {x: 4, y: 4}. */
function sqToPos(sq: string): Pos {
  return { x: sq.charCodeAt(0) - 97, y: 56 - sq.charCodeAt(1) };
}

function isOwn(occupant: number, code: number): boolean {
  return occupant !== EMPTY && occupant > 0 === code > 0;
}

/* ------------------------------------------------------------------------ */
/* Piece-square tables (white's view, row 0 = rank 8; black reads them mirrored) */
/* ------------------------------------------------------------------------ */

// prettier-ignore
const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
// prettier-ignore
const PST_KNIGHT = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];
// prettier-ignore
const PST_BISHOP = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];
// prettier-ignore
const PST_ROOK = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
// prettier-ignore
const PST_QUEEN = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];
/** Middlegame king: stay castled behind the pawns. */
// prettier-ignore
const PST_KING_MID = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];
/** Endgame king: walk to the centre and take part. */
// prettier-ignore
const PST_KING_END = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

/** Indexed by piece kind; the king entry is the middlegame table (evaluate swaps it in the endgame). */
const PST: ReadonlyArray<readonly number[]> = [[], PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, PST_KING_MID];

/** Table lookup for a piece of `colour` on `sq`; black sees the board upside down. */
function pstAt(table: readonly number[], colour: PlayerIndex, sq: number): number {
  return table[colour === 0 ? sq : sq ^ 56]!;
}

/* ------------------------------------------------------------------------ */
/* Attack maps                                                              */
/* ------------------------------------------------------------------------ */

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const BISHOP_STEPS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const ROOK_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Mobility credit per square a piece can move to or capture on, by piece
 * kind. Minor pieces get the most: a knight on the rim really is dim, while a
 * queen's raw square count says little and, weighted heavily, sends it out on
 * early sorties. Pawns and kings earn nothing.
 */
const MOBILITY_WEIGHT = [0, 0, 4, 3, 2, 1, 0] as const;

/** Value of the cheapest piece of each colour attacking each square, indexed colour * 64 + sq; 0 = unattacked. Reused across calls. */
const attackMin = new Int32Array(128);
/** Weighted mobility total per colour. */
const mobility = new Int32Array(2);

function mark(i: number, value: number): void {
  const cur = attackMin[i];
  if (cur === 0 || value < cur) attackMin[i] = value;
}

function slide(b: Int8Array, code: number, colour: PlayerIndex, x: number, y: number, steps: typeof BISHOP_STEPS | typeof ROOK_STEPS): void {
  const kind = Math.abs(code);
  const base = colour * 64;
  for (const [dx, dy] of steps) {
    let nx = x + dx;
    let ny = y + dy;
    while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
      const t = ny * 8 + nx;
      mark(base + t, VALUE[kind]);
      const occupant = b[t];
      if (occupant !== EMPTY) {
        if (!isOwn(occupant, code)) mobility[colour] += MOBILITY_WEIGHT[kind];
        break;
      }
      mobility[colour] += MOBILITY_WEIGHT[kind];
      nx += dx;
      ny += dy;
    }
  }
}

/** Fills attackMin and mobility for both colours in one pass over the board. */
function computeAttacks(b: Int8Array): void {
  attackMin.fill(0);
  mobility[0] = 0;
  mobility[1] = 0;
  for (let sq = 0; sq < 64; sq++) {
    const code = b[sq];
    if (code === EMPTY) continue;
    const colour: PlayerIndex = code > 0 ? 0 : 1;
    const kind = Math.abs(code);
    const x = sq & 7;
    const y = sq >> 3;
    if (kind === PAWN) {
      const ny = y + (colour === 0 ? -1 : 1);
      if (x > 0) mark(colour * 64 + ny * 8 + x - 1, VALUE[PAWN]);
      if (x < 7) mark(colour * 64 + ny * 8 + x + 1, VALUE[PAWN]);
    } else if (kind === KNIGHT || kind === KING) {
      for (const [dx, dy] of kind === KNIGHT ? KNIGHT_STEPS : KING_STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx > 7 || ny < 0 || ny > 7) continue;
        const t = ny * 8 + nx;
        mark(colour * 64 + t, VALUE[kind]);
        if (kind === KNIGHT && !isOwn(b[t], code)) mobility[colour] += MOBILITY_WEIGHT[KNIGHT];
      }
    } else {
      if (kind !== ROOK) slide(b, code, colour, x, y, BISHOP_STEPS);
      if (kind !== BISHOP) slide(b, code, colour, x, y, ROOK_STEPS);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Static evaluation                                                        */
/* ------------------------------------------------------------------------ */

const CHECK_BONUS = 20; // for the side that has just given check
/**
 * Share of the best capture available to the side to move that is credited
 * to it. Below 1 because the capture may be met by a recapture the map cannot
 * see, or may not be the best move at all.
 */
const THREAT_WEIGHT = 0.8;
const MOPUP_LEAD = 400; // material lead before the mop-up term switches on
const MOPUP_MAX_DEFENDER = 330; // …and the trailing side has at most a minor piece besides pawns
/**
 * The mop-up steps are each worth more than the mobility swing of shuffling a
 * queen about; otherwise a 3-ply search shuffles instead of walking its king in.
 */
const MOPUP_EDGE = 10; // per step the losing king is from the centre
const MOPUP_CLOSE = 10; // per step the kings are closer together
const MOPUP_CONFINE = 10; // per neighbouring square the losing king cannot step to
const DRAW_AVERSION = 0.5; // how much of the material balance a draw forfeits
const EVAL_CLAMP = 90_000; // keeps every evaluation strictly inside ±WIN_SCORE

function lightQueen(queens: number, rooks: number, minors: number): boolean {
  return queens === 0 || (rooks === 0 && minors <= 1);
}

/**
 * Best material the side to move could win with a single capture, judged from
 * the attack maps: an undefended piece is worth its full value, a defended one
 * only the difference to the cheapest attacker (nothing when that is negative).
 */
function bestCaptureGain(b: Int8Array, mover: PlayerIndex): number {
  const moverBase = mover * 64;
  const enemyBase = (1 - mover) * 64;
  let best = 0;
  for (let sq = 0; sq < 64; sq++) {
    const code = b[sq];
    if (code === EMPTY || (code > 0) === (mover === 0)) continue;
    const kind = Math.abs(code);
    if (kind === KING) continue;
    const attacker = attackMin[moverBase + sq];
    if (attacker === 0) continue;
    const gain = attackMin[enemyBase + sq] === 0 ? VALUE[kind] : VALUE[kind] - attacker;
    if (gain > best) best = gain;
  }
  return best;
}

/**
 * Mating a lone (or nearly lone) king with a shallow search needs the static
 * score to spell out the plan: push it to the edge, bring our king up, and
 * take away its squares. Reads the attack maps, so computeAttacks() runs first.
 */
function mopUp(b: Int8Array, leader: PlayerIndex, leaderKing: number, trailerKing: number): number {
  const tx = trailerKing & 7;
  const ty = trailerKing >> 3;
  const centreDist = Math.max(3 - tx, tx - 4) + Math.max(3 - ty, ty - 4); // 0 at the centre, 6 in a corner
  const kingDist = Math.abs(tx - (leaderKing & 7)) + Math.abs(ty - (leaderKing >> 3)); // 2 … 14
  let free = 0;
  for (const [dx, dy] of KING_STEPS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (nx < 0 || nx > 7 || ny < 0 || ny > 7) continue;
    const t = ny * 8 + nx;
    if (attackMin[leader * 64 + t] === 0 && !isOwn(b[t], b[trailerKing])) free++;
  }
  return MOPUP_EDGE * centreDist + MOPUP_CLOSE * (14 - kingDist) + MOPUP_CONFINE * (8 - free);
}

/** Position score from white's point of view. `mover` is the side to move. */
function scoreForWhite(b: Int8Array, mover: PlayerIndex): number {
  const material = [0, 0];
  const pst = [0, 0];
  const pawns = [0, 0];
  const queens = [0, 0];
  const rooks = [0, 0];
  const minors = [0, 0];
  const kingSq = [0, 0];
  for (let sq = 0; sq < 64; sq++) {
    const code = b[sq];
    if (code === EMPTY) continue;
    const colour: PlayerIndex = code > 0 ? 0 : 1;
    const kind = Math.abs(code);
    if (kind === KING) {
      kingSq[colour] = sq;
      continue;
    }
    material[colour] += VALUE[kind];
    pst[colour] += pstAt(PST[kind], colour, sq);
    if (kind === PAWN) pawns[colour]++;
    else if (kind === QUEEN) queens[colour]++;
    else if (kind === ROOK) rooks[colour]++;
    else minors[colour]++;
  }
  // The simplified-evaluation endgame rule: no queens, or every queen has at most one minor piece for company.
  const endgame = lightQueen(queens[0], rooks[0], minors[0]) && lightQueen(queens[1], rooks[1], minors[1]);
  const kingTable = endgame ? PST_KING_END : PST_KING_MID;
  pst[0] += pstAt(kingTable, 0, kingSq[0]);
  pst[1] += pstAt(kingTable, 1, kingSq[1]);

  computeAttacks(b);
  let score = material[0] - material[1] + (pst[0] - pst[1]) + (mobility[0] - mobility[1]);

  // Side-to-move terms, converted into white's view.
  const sign = mover === 0 ? 1 : -1;
  const inCheck = attackMin[(1 - mover) * 64 + kingSq[mover]] !== 0;
  if (inCheck) score -= sign * CHECK_BONUS;
  else score += sign * THREAT_WEIGHT * bestCaptureGain(b, mover);

  const lead = material[0] - material[1];
  if (Math.abs(lead) >= MOPUP_LEAD) {
    const leader: PlayerIndex = lead > 0 ? 0 : 1;
    const trailer: PlayerIndex = lead > 0 ? 1 : 0;
    if (material[trailer] - VALUE[PAWN] * pawns[trailer] <= MOPUP_MAX_DEFENDER) {
      const mop = mopUp(b, leader, kingSq[leader], kingSq[trailer]);
      score += leader === 0 ? mop : -mop;
    }
  }
  return score;
}

function evaluate(state: ChessState, root: PlayerIndex): number {
  const white = scoreForWhite(readBoard(new Chess(state.fen)), state.turn);
  const clamped = Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, white));
  return root === 0 ? clamped : -clamped;
}

/** A draw costs the side that is ahead part of its lead, and earns the side that is behind the same. */
function drawScore(state: ChessState, root: PlayerIndex): number {
  const b = readBoard(new Chess(state.fen));
  let balance = 0;
  for (let sq = 0; sq < 64; sq++) {
    const code = b[sq];
    const kind = Math.abs(code);
    if (kind === EMPTY || kind === KING) continue;
    balance += code > 0 ? VALUE[kind] : -VALUE[kind];
  }
  return -DRAW_AVERSION * (root === 0 ? balance : -balance);
}

/* ------------------------------------------------------------------------ */
/* Candidate moves: SAN → engine move, ordered best-first                   */
/* ------------------------------------------------------------------------ */

const ORDER_MATE = 1_000_000;
const ORDER_CAPTURE = 10_000; // every capture and queen promotion ahead of every quiet move
const ORDER_CHECK = 500;
const ORDER_CASTLE = 60;

interface ScoredMove {
  move: Move;
  score: number;
}

/** True when every square strictly between (x, y) and (x + dx, y + dy) is empty. */
function clearPath(b: Int8Array, x: number, y: number, dx: number, dy: number): boolean {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i < steps; i++) if (b[(y + i * sy) * 8 + x + i * sx] !== EMPTY) return false;
  return true;
}

/** Whether a piece of `kind` on (x, y) could move to `to` on an otherwise unconstrained board. */
function reaches(b: Int8Array, kind: number, x: number, y: number, to: Pos): boolean {
  const dx = to.x - x;
  const dy = to.y - y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const diagonal = ax === ay && ax > 0;
  const straight = (ax === 0) !== (ay === 0);
  switch (kind) {
    case KNIGHT:
      return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
    case KING:
      return Math.max(ax, ay) === 1;
    case BISHOP:
      return diagonal && clearPath(b, x, y, dx, dy);
    case ROOK:
      return straight && clearPath(b, x, y, dx, dy);
    default:
      return (diagonal || straight) && clearPath(b, x, y, dx, dy);
  }
}

/** SAN disambiguator: a file letter, a rank digit, or both. */
function matchesDisambiguator(x: number, y: number, hint: string): boolean {
  for (let i = 0; i < hint.length; i++) {
    const c = hint.charCodeAt(i);
    if (c >= 97 ? c - 97 !== x : 56 - c !== y) return false;
  }
  return true;
}

/**
 * The square of the piece `code` that a SAN move to `to` refers to, or null
 * when the geometry leaves more than one candidate: chess.js disambiguates
 * only among legal moves, so a pinned twin goes unmentioned and the caller
 * has to ask chess.js which one it meant.
 */
function findOrigin(b: Int8Array, code: number, to: Pos, hint: string): Pos | null {
  const kind = Math.abs(code);
  let found: Pos | null = null;
  for (let sq = 0; sq < 64; sq++) {
    if (b[sq] !== code) continue;
    const x = sq & 7;
    const y = sq >> 3;
    if (!matchesDisambiguator(x, y, hint) || !reaches(b, kind, x, y, to)) continue;
    if (found) return null;
    found = { x, y };
  }
  return found;
}

/** Plays and takes back `san` on the scratch instance just to read its squares. */
function resolveWithChessJs(chess: Chess, san: string): { from: Pos; to: Pos } | null {
  try {
    const m = chess.move(san);
    chess.undo();
    return { from: sqToPos(m.from), to: sqToPos(m.to) };
  } catch {
    return null;
  }
}

/**
 * Turns one chess.js SAN string into an engine move plus an ordering score.
 * The SAN grammar chess.js emits: `O-O`/`O-O-O`, or piece letter + optional
 * disambiguator (pawns: nothing, or the from-file before `x`) + optional `x` +
 * target square + optional `=Q`, all followed by an optional `+` or `#`.
 */
function parseSan(san: string, b: Int8Array, mover: PlayerIndex, chess: Chess): ScoredMove | null {
  let s = san;
  let score = 0;
  if (s.endsWith("#")) {
    score += ORDER_MATE;
    s = s.slice(0, -1);
  } else if (s.endsWith("+")) {
    score += ORDER_CHECK;
    s = s.slice(0, -1);
  }
  const sign = mover === 0 ? 1 : -1; // white pieces are positive and move towards row 0
  let from: Pos | null;
  let to: Pos;
  let promotion: Move["promotion"];
  if (s === "O-O" || s === "O-O-O") {
    const home = mover === 0 ? 7 : 0;
    from = { x: 4, y: home };
    to = { x: s === "O-O" ? 6 : 2, y: home };
    score += ORDER_CASTLE;
  } else {
    const eq = s.indexOf("=");
    if (eq >= 0) {
      promotion = s.charAt(eq + 1).toLowerCase() as Move["promotion"];
      if (promotion !== "q" && promotion !== "n") return null;
      s = s.slice(0, eq);
    }
    to = sqToPos(s.slice(-2));
    s = s.slice(0, -2);
    const capture = s.endsWith("x");
    if (capture) s = s.slice(0, -1);
    const first = s.charCodeAt(0);
    let kind: number;
    if (s.length === 0 || first >= 97) {
      kind = PAWN;
      if (capture) {
        from = { x: first - 97, y: to.y + sign };
      } else {
        const oneBack = to.y + sign;
        from = b[oneBack * 8 + to.x] === sign * PAWN ? { x: to.x, y: oneBack } : { x: to.x, y: to.y + 2 * sign };
      }
    } else {
      kind = PIECE_CODE[s.charAt(0).toLowerCase()]!;
      from = findOrigin(b, sign * kind, to, s.slice(1));
    }
    if (capture) {
      // An empty target square means en passant: the victim is a pawn.
      const victim = b[to.y * 8 + to.x] === EMPTY ? PAWN : Math.abs(b[to.y * 8 + to.x]!);
      score += ORDER_CAPTURE + 10 * VALUE[victim] - VALUE[kind];
    }
    if (promotion === "q") score += ORDER_CAPTURE + 10 * VALUE[QUEEN];
    else if (!capture && from) score += pstAt(PST[kind]!, mover, to.y * 8 + to.x) - pstAt(PST[kind]!, mover, from.y * 8 + from.x);
  }
  if (!from) {
    const resolved = resolveWithChessJs(chess, san);
    if (!resolved) return null;
    from = resolved.from;
    to = resolved.to;
  }
  return { move: promotion ? { from, to, promotion } : { from, to }, score };
}

/** Every legal move (minus rook/bishop underpromotions), best-first. Empty on any surprise, which makes the search fall back to engine.legalMoves. */
function candidates(state: ChessState, mover: PlayerIndex): Move[] {
  try {
    const chess = new Chess(state.fen);
    const b = readBoard(chess);
    const scored: ScoredMove[] = [];
    for (const san of chess.moves()) {
      const m = parseSan(san, b, mover, chess);
      if (m) scored.push(m);
    }
    scored.sort((p, q) => q.score - p.score);
    return scored.map((m) => m.move);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                 */
/* ------------------------------------------------------------------------ */

export const chessAi: AiProvider<ChessState, Move> = makeSearchAi<ChessState, Move>({
  engine: chessEngine,
  evaluate,
  candidates,
  drawScore,
  levels: LEVELS,
  testProfile: { games: 10, minWinRate: 0.9, budgetMs: 40, maxPlies: 400 },
});
