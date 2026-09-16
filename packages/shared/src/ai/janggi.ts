import type { ApplyResult, GameEngine, Move, PlayerIndex, Rng } from "../types.js";
import { janggiEngine, type JanggiState, type PieceType } from "../games/janggi.js";
import type { AiProvider } from "./types.js";
import { findImmediateWin, searchBestMove, type SearchSpec } from "./search.js";
import { pickRandom } from "./random.js";

/**
 * Janggi (장기) computer opponent.
 *
 * The search is the generic iterative-deepening alpha-beta from search.ts.
 * This file supplies three things:
 *
 *  - A fast mirror of the rules for the search to run on. janggiEngine.applyMove
 *    regenerates the complete legal-move list twice per call (once to validate
 *    the move, once for the checkmate test), and each legal-move list clones
 *    the board and enumerates every enemy reply per candidate: about 0.3ms a
 *    node, which is fine for one move a turn but leaves a search with a few
 *    thousand nodes per second. The mirror keeps the board in a flat Int8Array,
 *    precomputes every step, jump and ray table, detects check by looking
 *    outward from the general, and stores each node's legal moves so the
 *    checkmate test and the next node's move list are one computation. Only the
 *    search runs on it: the root move list always comes from janggiEngine, so
 *    every move handed back is one the engine accepts.
 *  - evaluate(): material on the traditional scale (차 13, 포 7, 마 5, 상 3,
 *    사 3, 졸 2, times 100), piece-square bonuses (soldiers advancing, pieces on
 *    the enemy side and in its palace, the 면포 cannon), mobility, pressure on
 *    the enemy palace, general safety, a penalty for a cannon with nothing to
 *    jump over, and a tempo term worth most of the best capture open to the side
 *    to move, which keeps a fixed-depth search from stopping mid-exchange.
 *  - candidates(): every legal move, captures first ordered most-valuable-victim
 *    / least-valuable-attacker, quiet moves by piece-square gain, so alpha-beta
 *    cuts early.
 *
 * The engine has no pass move, no 빅장 and no draw rule: a side with no legal
 * move loses whether or not it is in check, so smothering the enemy general
 * wins just as mate does, and the evaluation rewards taking its squares away.
 */

const WIDTH = 9;
const HEIGHT = 10;
const CELLS = WIDTH * HEIGHT;

/** Piece types, stored in the low three bits of a cell; an empty cell is 0. */
const GENERAL = 1;
const GUARD = 2;
const CHARIOT = 3;
const CANNON = 4;
const HORSE = 5;
const ELEPHANT = 6;
const SOLDIER = 7;

const TYPE_CODE: Record<PieceType, number> = {
  general: GENERAL,
  guard: GUARD,
  chariot: CHARIOT,
  cannon: CANNON,
  horse: HORSE,
  elephant: ELEPHANT,
  soldier: SOLDIER,
};

/** A cell holds `owner * 8 + type`, so bit 3 is the owner and the low bits the type. */
const OWNER_BIT = 8;

function code(owner: PlayerIndex, type: number): number {
  return owner * OWNER_BIT + type;
}

function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

function cellIndex(x: number, y: number): number {
  return y * WIDTH + x;
}

function inBoard(x: number, y: number): boolean {
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
}

/** A move is `from << 7 | to` over flat cell indices; both fit in seven bits. */
function encodeMove(m: Move): number {
  return (cellIndex(m.from!.x, m.from!.y) << 7) | cellIndex(m.to.x, m.to.y);
}

function decodeMove(m: number): Move {
  const from = m >> 7;
  const to = m & 127;
  return { from: { x: from % WIDTH, y: Math.floor(from / WIDTH) }, to: { x: to % WIDTH, y: Math.floor(to / WIDTH) } };
}

/* ------------------------------------------------------------------------ */
/* Move tables                                                              */
/* ------------------------------------------------------------------------ */

/** Owner of the palace a cell belongs to, or -1 outside both palaces. */
const PALACE_OF = new Int8Array(CELLS).fill(-1);
/** Straight rays to the board edge in the four orthogonal directions, per cell. */
const ORTHO_RAYS: Int8Array[][] = [];
/** Palace diagonals: from a corner [centre, opposite corner]; from the centre one ray per corner. */
const DIAG_RAYS: Int8Array[][] = [];
/** Squares a general or guard of `owner` may step to from a cell of its own palace. */
const PALACE_STEPS: [Int8Array[], Int8Array[]] = [[], []];
/** Squares a soldier of `owner` may step to: forward, sideways, and forward along a palace diagonal. */
const SOLDIER_STEPS: [Int8Array[], Int8Array[]] = [[], []];
/** Horse jumps as (leg, destination) pairs; the leg must be empty. */
const HORSE_JUMPS: Int8Array[] = [];
/** Elephant jumps as (leg, eye, destination) triples; leg and eye must be empty. */
const ELEPHANT_JUMPS: Int8Array[] = [];
/** Inverses of the jump/step tables, keyed by the attacked square, for outward attack detection. */
const HORSE_ATTACKS: Int8Array[] = [];
const ELEPHANT_ATTACKS: Int8Array[] = [];
const SOLDIER_ATTACKS: [Int8Array[], Int8Array[]] = [[], []];
const PALACE_ATTACKS: [Int8Array[], Int8Array[]] = [[], []];

/** One orthogonal leg followed by one (horse) or two (elephant) diagonal steps outward. */
const LEG_DIAG: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 1, 1], [1, 0, 1, -1], [-1, 0, -1, 1], [-1, 0, -1, -1],
  [0, 1, 1, 1], [0, 1, -1, 1], [0, -1, 1, -1], [0, -1, -1, -1],
];

const EMPTY_TABLE = new Int8Array(0);

(function buildTables() {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 3; x <= 5; x++) {
      if (y >= 7) PALACE_OF[cellIndex(x, y)] = 0;
      else if (y <= 2) PALACE_OF[cellIndex(x, y)] = 1;
    }
  }
  const horseAttacks: number[][] = Array.from({ length: CELLS }, () => []);
  const elephantAttacks: number[][] = Array.from({ length: CELLS }, () => []);
  const soldierAttacks: [number[][], number[][]] = [
    Array.from({ length: CELLS }, () => []),
    Array.from({ length: CELLS }, () => []),
  ];
  const palaceAttacks: [number[][], number[][]] = [
    Array.from({ length: CELLS }, () => []),
    Array.from({ length: CELLS }, () => []),
  ];

  for (let i = 0; i < CELLS; i++) {
    const x = i % WIDTH;
    const y = (i - x) / WIDTH;

    const ortho: Int8Array[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ray: number[] = [];
      for (let cx = x + dx, cy = y + dy; inBoard(cx, cy); cx += dx, cy += dy) ray.push(cellIndex(cx, cy));
      if (ray.length > 0) ortho.push(Int8Array.from(ray));
    }
    ORTHO_RAYS.push(ortho);

    const diag: Int8Array[] = [];
    const palace = PALACE_OF[i];
    if (palace >= 0) {
      const cy = palace === 0 ? 8 : 1;
      if (x === 4 && y === cy) {
        for (const [cx2, cy2] of [[3, cy - 1], [5, cy - 1], [3, cy + 1], [5, cy + 1]]) diag.push(Int8Array.of(cellIndex(cx2, cy2)));
      } else if (x !== 4 && y !== cy) {
        diag.push(Int8Array.of(cellIndex(4, cy), cellIndex(8 - x, 2 * cy - y)));
      }
    }
    DIAG_RAYS.push(diag);

    const horse: number[] = [];
    const elephant: number[] = [];
    for (const [ox, oy, dx, dy] of LEG_DIAG) {
      const lx = x + ox;
      const ly = y + oy;
      if (!inBoard(lx, ly)) continue;
      const leg = cellIndex(lx, ly);
      const hx = lx + dx;
      const hy = ly + dy;
      if (inBoard(hx, hy)) {
        const dest = cellIndex(hx, hy);
        horse.push(leg, dest);
        horseAttacks[dest].push(i, leg);
        const ex = hx + dx;
        const ey = hy + dy;
        if (inBoard(ex, ey)) {
          const eye = cellIndex(hx, hy);
          const dest2 = cellIndex(ex, ey);
          elephant.push(leg, eye, dest2);
          elephantAttacks[dest2].push(i, leg, eye);
        }
      }
    }
    HORSE_JUMPS.push(Int8Array.from(horse));
    ELEPHANT_JUMPS.push(Int8Array.from(elephant));

    for (const owner of [0, 1] as const) {
      const fdy = owner === 0 ? -1 : 1;
      const soldier: number[] = [];
      for (const [sx, sy] of [[x, y + fdy], [x - 1, y], [x + 1, y]]) {
        if (inBoard(sx, sy)) soldier.push(cellIndex(sx, sy));
      }
      for (const ray of diag) {
        const first = ray[0];
        if (Math.floor(first / WIDTH) - y === fdy) soldier.push(first);
      }
      for (const dest of soldier) soldierAttacks[owner][dest].push(i);
      SOLDIER_STEPS[owner].push(Int8Array.from(soldier));

      const steps: number[] = [];
      if (palace === owner) {
        for (const [sx, sy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (inBoard(sx, sy) && PALACE_OF[cellIndex(sx, sy)] === owner) steps.push(cellIndex(sx, sy));
        }
        for (const ray of diag) steps.push(ray[0]);
        for (const dest of steps) palaceAttacks[owner][dest].push(i);
      }
      PALACE_STEPS[owner].push(steps.length > 0 ? Int8Array.from(steps) : EMPTY_TABLE);
    }
  }
  for (let i = 0; i < CELLS; i++) {
    HORSE_ATTACKS.push(Int8Array.from(horseAttacks[i]));
    ELEPHANT_ATTACKS.push(Int8Array.from(elephantAttacks[i]));
    for (const owner of [0, 1] as const) {
      SOLDIER_ATTACKS[owner].push(Int8Array.from(soldierAttacks[owner][i]));
      PALACE_ATTACKS[owner].push(palaceAttacks[owner][i].length > 0 ? Int8Array.from(palaceAttacks[owner][i]) : EMPTY_TABLE);
    }
  }
})();

/* ------------------------------------------------------------------------ */
/* Rules mirror                                                             */
/* ------------------------------------------------------------------------ */

/** Chariot: slide along each ray until the first piece, capturing an enemy there. */
function slideDests(cells: Int8Array, rays: Int8Array[], ownBit: number, out: Int8Array, n: number): number {
  for (const ray of rays) {
    for (let k = 0; k < ray.length; k++) {
      const to = ray[k];
      const v = cells[to];
      if (v === 0) {
        out[n++] = to;
        continue;
      }
      if ((v & OWNER_BIT) !== ownBit) out[n++] = to;
      break;
    }
  }
  return n;
}

/**
 * Cannon: needs exactly one piece (of either side, but never a cannon) to jump
 * over; beyond it, empty squares are moves and the next piece is a capture if
 * it is an enemy that is not a cannon.
 */
function hopDests(cells: Int8Array, rays: Int8Array[], ownBit: number, out: Int8Array, n: number): number {
  for (const ray of rays) {
    let screened = false;
    for (let k = 0; k < ray.length; k++) {
      const to = ray[k];
      const v = cells[to];
      if (!screened) {
        if (v === 0) continue;
        if ((v & 7) === CANNON) break;
        screened = true;
        continue;
      }
      if (v === 0) {
        out[n++] = to;
        continue;
      }
      if ((v & 7) !== CANNON && (v & OWNER_BIT) !== ownBit) out[n++] = to;
      break;
    }
  }
  return n;
}

/** Steps to squares that are empty or hold an enemy piece. */
function stepDests(cells: Int8Array, steps: Int8Array, ownBit: number, out: Int8Array, n: number): number {
  for (let k = 0; k < steps.length; k++) {
    const to = steps[k];
    const v = cells[to];
    if (v === 0 || (v & OWNER_BIT) !== ownBit) out[n++] = to;
  }
  return n;
}

/**
 * Writes the pseudo-legal destinations of the piece on `from` into `out` and
 * returns how many there are. The buffer is shared, so callers must consume it
 * before generating for another piece; nothing here recurses.
 */
function pseudoDests(cells: Int8Array, from: number, out: Int8Array): number {
  const piece = cells[from];
  const owner = (piece >> 3) as PlayerIndex;
  const ownBit = piece & OWNER_BIT;
  let n = 0;
  switch (piece & 7) {
    case GENERAL:
    case GUARD:
      return stepDests(cells, PALACE_STEPS[owner][from], ownBit, out, 0);
    case SOLDIER:
      return stepDests(cells, SOLDIER_STEPS[owner][from], ownBit, out, 0);
    case CHARIOT:
      n = slideDests(cells, ORTHO_RAYS[from], ownBit, out, 0);
      return slideDests(cells, DIAG_RAYS[from], ownBit, out, n);
    case CANNON:
      n = hopDests(cells, ORTHO_RAYS[from], ownBit, out, 0);
      return hopDests(cells, DIAG_RAYS[from], ownBit, out, n);
    case HORSE: {
      const jumps = HORSE_JUMPS[from];
      for (let k = 0; k < jumps.length; k += 2) {
        if (cells[jumps[k]] !== 0) continue;
        const to = jumps[k + 1];
        const v = cells[to];
        if (v === 0 || (v & OWNER_BIT) !== ownBit) out[n++] = to;
      }
      return n;
    }
    case ELEPHANT: {
      const jumps = ELEPHANT_JUMPS[from];
      for (let k = 0; k < jumps.length; k += 3) {
        if (cells[jumps[k]] !== 0 || cells[jumps[k + 1]] !== 0) continue;
        const to = jumps[k + 2];
        const v = cells[to];
        if (v === 0 || (v & OWNER_BIT) !== ownBit) out[n++] = to;
      }
      return n;
    }
    default:
      return 0;
  }
}

/**
 * Does a chariot or cannon of the side with owner bit `byBit` reach `target`
 * along one of `rays`? Walking outward from the target, the first piece met is
 * either an attacking chariot, a cannon (which can neither attack from there
 * nor serve as a screen), or a screen; a cannon right behind a screen attacks,
 * unless the target is itself a cannon.
 */
function rayAttack(cells: Int8Array, rays: Int8Array[], byBit: number, targetIsCannon: boolean): boolean {
  for (const ray of rays) {
    let screened = false;
    for (let k = 0; k < ray.length; k++) {
      const v = cells[ray[k]];
      if (v === 0) continue;
      const type = v & 7;
      if (!screened) {
        if (type === CHARIOT && (v & OWNER_BIT) === byBit) return true;
        if (type === CANNON) break;
        screened = true;
        continue;
      }
      if (type === CANNON && (v & OWNER_BIT) === byBit && !targetIsCannon) return true;
      break;
    }
  }
  return false;
}

/** Whether any piece of `by` has `target` as a pseudo-legal destination. */
function attackedBy(cells: Int8Array, target: number, by: PlayerIndex, targetIsCannon: boolean): boolean {
  const byBit = by * OWNER_BIT;
  if (rayAttack(cells, ORTHO_RAYS[target], byBit, targetIsCannon)) return true;
  if (rayAttack(cells, DIAG_RAYS[target], byBit, targetIsCannon)) return true;
  const horse = code(by, HORSE);
  const horses = HORSE_ATTACKS[target];
  for (let k = 0; k < horses.length; k += 2) {
    if (cells[horses[k]] === horse && cells[horses[k + 1]] === 0) return true;
  }
  const elephant = code(by, ELEPHANT);
  const elephants = ELEPHANT_ATTACKS[target];
  for (let k = 0; k < elephants.length; k += 3) {
    if (cells[elephants[k]] === elephant && cells[elephants[k + 1]] === 0 && cells[elephants[k + 2]] === 0) return true;
  }
  const soldier = code(by, SOLDIER);
  const soldiers = SOLDIER_ATTACKS[by][target];
  for (let k = 0; k < soldiers.length; k++) {
    if (cells[soldiers[k]] === soldier) return true;
  }
  const general = code(by, GENERAL);
  const guard = code(by, GUARD);
  const palace = PALACE_ATTACKS[by][target];
  for (let k = 0; k < palace.length; k++) {
    const v = cells[palace[k]];
    if (v === general || v === guard) return true;
  }
  return false;
}

function findGeneral(cells: Int8Array, owner: PlayerIndex): number {
  const general = code(owner, GENERAL);
  for (let i = 0; i < CELLS; i++) if (cells[i] === general) return i;
  return -1;
}

/** Shared destination buffer; the widest fan-out is a chariot's, well under 32. */
const destBuf = new Int8Array(32);

/** Every move of `player` that does not leave its own general attacked. */
function legalMoves(cells: Int8Array, player: PlayerIndex): number[] {
  const moves: number[] = [];
  const ownBit = player * OWNER_BIT;
  const enemy = other(player);
  const general = findGeneral(cells, player);
  for (let from = 0; from < CELLS; from++) {
    const piece = cells[from];
    if (piece === 0 || (piece & OWNER_BIT) !== ownBit) continue;
    const n = pseudoDests(cells, from, destBuf);
    const movesGeneral = (piece & 7) === GENERAL;
    for (let k = 0; k < n; k++) {
      const to = destBuf[k];
      const captured = cells[to];
      cells[to] = piece;
      cells[from] = 0;
      const king = movesGeneral ? to : general;
      if (king < 0 || !attackedBy(cells, king, enemy, false)) moves.push((from << 7) | to);
      cells[from] = piece;
      cells[to] = captured;
    }
  }
  return moves;
}

/** A search position: the flat board plus the legal moves of the side to move. */
interface Node {
  cells: Int8Array;
  turn: PlayerIndex;
  status: "ongoing" | "win" | "draw";
  winner: PlayerIndex | null;
  reason: string;
  moves: number[];
}

function makeNode(cells: Int8Array, turn: PlayerIndex, moves: number[], winner: PlayerIndex | null): Node {
  return { cells, turn, status: winner === null ? "ongoing" : "win", winner, reason: "", moves };
}

function cellsOf(board: JanggiState["board"]): Int8Array {
  const cells = new Int8Array(CELLS);
  for (let y = 0; y < HEIGHT; y++) {
    const row = board[y];
    for (let x = 0; x < WIDTH; x++) {
      const piece = row[x];
      if (piece) cells[cellIndex(x, y)] = code(piece.owner, TYPE_CODE[piece.type]);
    }
  }
  return cells;
}

/**
 * The mirror as a GameEngine, so the generic search can drive it. Its
 * applyMove trusts that `move` is in the node's legal list, which is all the
 * search ever passes; the checkmate rule is the engine's: the side to move
 * with no legal move has lost.
 */
const mirrorEngine: GameEngine<Node, number> = {
  meta: janggiEngine.meta,
  createInitialState(setupId) {
    const cells = cellsOf(janggiEngine.createInitialState(setupId).board);
    return makeNode(cells, 0, legalMoves(cells, 0), null);
  },
  turn: (node) => node.turn,
  status: (node) => ({ status: node.status, winner: node.winner, reason: node.reason }),
  legalMoves: (node, player) => (node.status === "ongoing" && node.turn === player ? node.moves.slice() : []),
  applyMove(node, move, player): ApplyResult<Node> {
    const current = { status: node.status, winner: node.winner, reason: node.reason };
    if (node.status !== "ongoing" || node.turn !== player || !node.moves.includes(move)) {
      return { ok: false, state: node, error: "둘 수 없는 이동입니다.", status: current };
    }
    const cells = node.cells.slice();
    cells[move & 127] = cells[move >> 7];
    cells[move >> 7] = 0;
    const opponent = other(player);
    const replies = legalMoves(cells, opponent);
    const next = makeNode(cells, opponent, replies, replies.length === 0 ? player : null);
    return { ok: true, state: next, status: { status: next.status, winner: next.winner, reason: next.reason } };
  },
  // Search positions are never drawn; the shared <Board> only ever sees JanggiState.
  pieces: () => [],
};

/* ------------------------------------------------------------------------ */
/* Static evaluation                                                        */
/* ------------------------------------------------------------------------ */

/** Traditional piece values times 100, indexed by type. The general is not material: it cannot be taken. */
const VALUE = [0, 0, 300, 1300, 700, 500, 300, 200] as const;
/** Points per pseudo-legal move, indexed by type. Cannons and horses are worth little when boxed in. */
const MOBILITY = [0, 0, 0, 2, 4, 4, 2, 1] as const;

const IMMOBILE_CANNON = 30; // a cannon with nothing to jump over is a bystander
const PALACE_PRESSURE = 8; // per move landing inside the enemy palace
const GENERAL_FREE_SQUARE = 5; // per unattacked square the general could step to
const GUARD_BESIDE_GENERAL = 10; // per guard adjacent to its general
const TEMPO_FACTOR = 0.8; // share of the best available capture credited to the side to move
const EVAL_CLAMP = 90_000; // keeps every evaluation strictly inside ±WIN_SCORE

/**
 * Piece-square bonus for `type` on (x, y) from `owner`'s side. `rank` counts
 * from the owner's back rank (0) toward the enemy's (9); soldiers start on 3.
 */
function pieceSquare(type: number, owner: PlayerIndex, x: number, y: number): number {
  const rank = owner === 0 ? HEIGHT - 1 - y : y;
  const central = x >= 2 && x <= 6;
  const palaceFile = x >= 3 && x <= 5;
  switch (type) {
    case SOLDIER: {
      // Advancing soldiers gain until the enemy back rank, where they can only slide sideways.
      const advance = [0, 0, 0, 0, 12, 25, 40, 55, 60, 35][rank];
      const file = x === 4 ? 8 : palaceFile ? 5 : x === 0 || x === WIDTH - 1 ? -4 : 0;
      const inEnemyPalace = rank >= 7 && palaceFile ? 45 : 0;
      return advance + file + inEnemyPalace;
    }
    case HORSE:
      return (rank > 0 ? 10 : 0) + (central ? 8 : 0) + (rank >= 5 ? 12 : 0) + (rank >= 6 && central ? 15 : 0);
    case ELEPHANT:
      return (rank > 0 ? 6 : 0) + (central ? 5 : 0) + (rank >= 5 ? 8 : 0);
    case CHARIOT:
      return (rank >= 5 ? 12 : 0) + (rank >= 7 ? 20 : 0) + (rank >= 7 && palaceFile ? 10 : 0);
    case CANNON:
      // 면포: the cannon parked in front of its own general guards the palace file.
      return (rank === 2 && x === 4 ? 30 : 0) + (rank >= 6 ? 10 : 0) + (palaceFile ? 5 : 0);
    case GENERAL:
      return x === 4 ? (rank === 1 ? 8 : 4) : 0;
    default:
      return 0;
  }
}

/** Piece-square table indexed by `cell * CELLS + index`. */
const PST = new Int16Array(16 * CELLS);
for (const owner of [0, 1] as const) {
  for (let type = GENERAL; type <= SOLDIER; type++) {
    for (let i = 0; i < CELLS; i++) {
      PST[code(owner, type) * CELLS + i] = pieceSquare(type, owner, i % WIDTH, Math.floor(i / WIDTH));
    }
  }
}

/** Captures open to the side to move, gathered while scanning the board. */
const capVictim = new Int16Array(64);
const capAttacker = new Int16Array(64);
const capTarget = new Int8Array(64);
const capByCannon = new Uint8Array(64);

/**
 * Bonus for the general of `owner` on `general`: squares it could step to that
 * the enemy does not attack (room to dodge a check) and guards standing next
 * to it. Negative room means the general is close to being smothered.
 */
function generalSafety(cells: Int8Array, owner: PlayerIndex, general: number): number {
  if (general < 0) return 0;
  const enemy = other(owner);
  const ownBit = owner * OWNER_BIT;
  const steps = PALACE_STEPS[owner][general];
  let free = 0;
  let guards = 0;
  for (let k = 0; k < steps.length; k++) {
    const v = cells[steps[k]];
    if (v !== 0 && (v & OWNER_BIT) === ownBit) {
      if ((v & 7) === GUARD) guards++;
      continue;
    }
    if (!attackedBy(cells, steps[k], enemy, false)) free++;
  }
  return free * GENERAL_FREE_SQUARE + guards * GUARD_BESIDE_GENERAL;
}

/**
 * Static evaluation from `root`'s point of view. Everything is summed for
 * player 0 minus player 1, then flipped for root 1.
 */
function evaluate(node: Node, root: PlayerIndex): number {
  const cells = node.cells;
  const mover = node.turn;
  let score = 0;
  let general0 = -1;
  let general1 = -1;
  let captures = 0;

  for (let i = 0; i < CELLS; i++) {
    const v = cells[i];
    if (v === 0) continue;
    const type = v & 7;
    const owner = (v >> 3) as PlayerIndex;
    if (type === GENERAL) {
      if (owner === 0) general0 = i;
      else general1 = i;
    }
    let s = VALUE[type] + PST[v * CELLS + i];
    const n = pseudoDests(cells, i, destBuf);
    if (type === CANNON && n === 0) s -= IMMOBILE_CANNON;
    s += n * MOBILITY[type];
    const enemyPalace = owner === 0 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const to = destBuf[k];
      if (PALACE_OF[to] === enemyPalace) s += PALACE_PRESSURE;
      if (owner !== mover) continue;
      const target = cells[to];
      if (target === 0) continue;
      const victim = VALUE[target & 7];
      if (victim === 0 || captures >= capVictim.length) continue;
      capVictim[captures] = victim;
      capAttacker[captures] = VALUE[type];
      capTarget[captures] = to;
      capByCannon[captures] = type === CANNON ? 1 : 0;
      captures++;
    }
    score += owner === 0 ? s : -s;
  }

  // Tempo: the mover can cash the best exchange on the board before anything
  // else happens. A defended victim is only worth the difference from the
  // attacker, which is the one-step static exchange the search cannot see at
  // its leaves. Any capture's gain is at most its victim, hence the skip.
  let bestGain = 0;
  const defender = other(mover);
  for (let c = 0; c < captures; c++) {
    if (capVictim[c] <= bestGain) continue;
    const defended = attackedBy(cells, capTarget[c], defender, capByCannon[c] === 1);
    const gain = defended ? capVictim[c] - capAttacker[c] : capVictim[c];
    if (gain > bestGain) bestGain = gain;
  }
  const tempo = bestGain * TEMPO_FACTOR;
  score += mover === 0 ? tempo : -tempo;

  score += generalSafety(cells, 0, general0) - generalSafety(cells, 1, general1);
  score = Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, score));
  return root === 0 ? score : -score;
}

/* ------------------------------------------------------------------------ */
/* Candidate ordering                                                       */
/* ------------------------------------------------------------------------ */

const CAPTURE_KEY = 10_000; // every capture sorts ahead of every quiet move
const QUIET_KEY = 500; // offset keeping piece-square deltas non-negative
const KEY_SHIFT = 16_384; // a move is under 2^14, so `key * KEY_SHIFT + move` sorts by key then move

/**
 * All legal moves, best-first: captures by most valuable victim then least
 * valuable attacker, quiet moves by piece-square gain. The key is packed above
 * the move so one numeric sort orders them.
 */
function candidates(node: Node): number[] {
  const cells = node.cells;
  const moves = node.moves;
  const packed = new Array<number>(moves.length);
  for (let k = 0; k < moves.length; k++) {
    const move = moves[k];
    const from = move >> 7;
    const to = move & 127;
    const piece = cells[from];
    const target = cells[to];
    let key: number;
    if (target !== 0) {
      key = CAPTURE_KEY + VALUE[target & 7] * 4 + (VALUE[CHARIOT] - VALUE[piece & 7]) / 4;
    } else {
      key = QUIET_KEY + PST[piece * CELLS + to] - PST[piece * CELLS + from];
    }
    packed[k] = key * KEY_SHIFT + move;
  }
  packed.sort((a, b) => b - a);
  for (let k = 0; k < packed.length; k++) packed[k] = packed[k] % KEY_SHIFT;
  return packed;
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                 */
/* ------------------------------------------------------------------------ */

const LEVELS = {
  easy: { depth: 1, budgetMs: 100, randomness: 0.5 },
  normal: { depth: 4, budgetMs: 500, randomness: 0 },
  hard: { depth: 6, budgetMs: 1200, randomness: 0 },
};

const spec: SearchSpec<Node, number> = { engine: mirrorEngine, evaluate, candidates };

/** Last resort when something unexpected happens: any legal move, or null if there is none. */
function fallback(state: JanggiState, player: PlayerIndex, rng: Rng): Move | null {
  try {
    const legal = janggiEngine.legalMoves(state, player);
    return legal.length > 0 ? pickRandom(legal, rng) : null;
  } catch {
    return null;
  }
}

export const janggiAi: AiProvider<JanggiState, Move> = {
  testProfile: { games: 10, minWinRate: 0.9, budgetMs: 40, maxPlies: 400 },
  chooseMove(state, player, level, options = {}) {
    const rng = options.rng ?? Math.random;
    try {
      if (state.status !== "ongoing" || state.turn !== player) return null;
      const legal = janggiEngine.legalMoves(state, player);
      if (legal.length === 0) return null;
      if (legal.length === 1) return legal[0];
      // The root's move list is the engine's own, so whatever the search picks is engine-legal.
      const root = makeNode(cellsOf(state.board), player, legal.map(encodeMove), null);
      const lv = LEVELS[level] ?? LEVELS.normal;
      const winning = findImmediateWin(mirrorEngine, root, player, root.moves, rng);
      if (winning !== null) return decodeMove(winning);
      if (lv.randomness > 0 && rng() < lv.randomness) return pickRandom(legal, rng);
      const res = searchBestMove(spec, root, player, {
        depth: lv.depth,
        budgetMs: options.budgetMs ?? lv.budgetMs,
        rng,
        now: options.now,
      });
      return res.move === null ? pickRandom(legal, rng) : decodeMove(res.move);
    } catch {
      return fallback(state, player, rng);
    }
  },
};
