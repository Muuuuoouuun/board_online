import type {
  ApplyResult,
  BaseState,
  BoardPiece,
  GameEngine,
  GameStatus,
  PlayerIndex,
  Pos,
  StatusResult,
} from "../types.js";

/**
 * 땅따먹기 (territory capture, line-drawing variant).
 *
 * The board is a grid of cells, each owned by player 0, player 1, or nobody,
 * but play does not happen *in* the cells — it happens on the grid lines
 * between them. A move is one whole stroke: a polyline of lattice vertices
 * (cell corners) that runs along cell edges, drawn in a single gesture:
 *
 *   1. It starts on a corner of your own territory and ends on a corner of
 *      your own territory, having left your territory in between.
 *   2. Every segment runs along a cell edge with at least one neutral cell
 *      beside it, and never along an edge of the opponent's territory — you
 *      draw through open land, never into theirs.
 *   3. It may not cross or touch itself (each vertex is used once), though it
 *      may close back onto its own starting vertex.
 *   4. It may be at most MAX_LINE segments long — that cap, not luck, is what
 *      bounds how much one turn can take.
 *   5. Everything the finished stroke seals off from the outside — together
 *      with whatever territory already walls it in — becomes yours.
 *
 * Because the whole stroke arrives as one move, a half-drawn line is never
 * part of the shared state: the client draws freely and locally, and only a
 * finished stroke is sent. An illegal stroke is *rejected* rather than
 * costing the turn, which is what makes freehand drawing forgiving enough to
 * be fun; the limits on a turn are the length cap above and the clock below.
 *
 * TURN CLOCK — every turn is timed, and each one is shorter than the last (see
 * `turnBudget`), so the game opens as a thinking game and closes as a race. The
 * engine only keeps the deadline and decides what running out means: the turn
 * ends having taken nothing, exactly as if an empty stroke had been played. Who
 * watches the clock is the host's job, through the `clock` implementation at the
 * bottom of this file — the room server online, the page itself in pass-and-play.
 *
 * ---
 * CONTRACT NOTE — the one deliberate departure in this engine (flick.ts has
 * the same one, for the same reason): a move is a whole polyline, so the legal
 * move space is far too large to enumerate. `legalMoves` returns a small
 * sample of genuinely legal strokes — enough for the fuzz test and a simple
 * AI to have something to play — while `applyMove` accepts ANY stroke that
 * satisfies the rules above, never just the sampled ones. Do not assume
 * legalMoves() is exhaustive for territory. The client does not use it at
 * all: it validates the stroke it is drawing through the exported
 * `territoryCanStart` / `territoryCanExtend` / `territoryPreview` helpers, so
 * the rules still live in exactly one place.
 * ---
 */

const WIDTH = 14;
const HEIGHT = 14;
/** Each player's starting corner block is HOME x HOME cells. */
const HOME = 3;

/** Longest stroke (in segments) a single turn may draw. Caps how much one turn can take. */
export const MAX_LINE = 16;

/**
 * Bounds on the stroke search backing `legalMoves` and the "can this player
 * still capture anything?" test. Both go through `findLines`, with identical
 * budgets and a deterministic walk order, so whenever the end-of-game test
 * finds a stroke `legalMoves` finds it too — the fuzz test relies on an
 * ongoing game never having an empty move list.
 */
const SEARCH_NODE_BUDGET = 30000;
const SEARCH_START_BUDGET = 4000;
const SEARCH_CLOSE_BUDGET = 1500;
/** How many distinct strokes `legalMoves` samples, at most one per starting corner. */
const SAMPLE_LINES = 6;

/** The first turn's clock, in ms. */
export const TURN_START_MS = 24000;
/** How much shorter every turn is than the one before it. */
const TURN_STEP_MS = 600;
/** ...but never shorter than this, or the endgame would be unplayable rather than tense. */
export const TURN_FLOOR_MS = 6000;
/**
 * A timeout is allowed to arrive this much before the deadline. A host's timer
 * fires a hair late, never early, so this is only slack for clocks that disagree
 * by a few milliseconds — and a player who passes early only ever hurts themself.
 */
const TIMEOUT_GRACE_MS = 250;
/**
 * Turns that may run out back to back before the game is simply scored where it
 * stands. Without it two idle players (or two abandoned tabs) would hand the turn
 * back and forth forever, and the room would tick on for as long as it existed.
 */
const IDLE_TIMEOUT_LIMIT = 6;

/** How long the turn after `turnsTaken` completed turns gets. */
function turnBudget(turnsTaken: number): number {
  return Math.max(TURN_FLOOR_MS, TURN_START_MS - turnsTaken * TURN_STEP_MS);
}

const ORTHO: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export type TerritoryCell = PlayerIndex | null;

export type TerritoryMove =
  /** The whole stroke: lattice vertices (0..WIDTH, 0..HEIGHT), each one step from the last. */
  | { kind: "line"; line: Pos[] }
  /** Played by the host when the clock runs out; never chosen by a player. */
  | { kind: "timeout" };

export interface TerritoryState extends BaseState {
  /** Board size in *cells*; the lattice the line is drawn on is one larger in each direction. */
  width: number;
  height: number;
  /** board[y][x]: cell owner, or null for neutral. */
  board: TerritoryCell[][];
  /** The stroke the last move drew, so both clients can show what just happened. */
  lastLine: Pos[];
  /** Cells `lastLine` captured — the renderer flashes them. */
  lastGain: Pos[];
  /** Who drew `lastLine`; null before the first move. */
  lastBy: PlayerIndex | null;
  /** Turns finished so far — every one of them makes the next clock shorter. */
  turnsTaken: number;
  /** How long the turn on the table gets, in ms. */
  turnMs: number;
  /** Epoch ms this turn's clock started, or null while it is paused (see the TURN CLOCK note). */
  turnStartedAt: number | null;
  /** Turns that have run out back to back; any stroke that takes land resets it. */
  idleTimeouts: number;
}

function cellInRange(x: number, y: number): boolean {
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
}

function vertexInRange(v: Pos): boolean {
  return v.x >= 0 && v.x <= WIDTH && v.y >= 0 && v.y <= HEIGHT;
}

function other(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

/** Owner of a cell, or `undefined` for anything off the board (the outside is not a wall). */
function cellOwner(board: TerritoryCell[][], x: number, y: number): TerritoryCell | undefined {
  return cellInRange(x, y) ? board[y][x] : undefined;
}

/** The (up to four) cells that meet at lattice vertex `v`. */
function vertexCells(v: Pos): [number, number][] {
  return [
    [v.x - 1, v.y - 1],
    [v.x, v.y - 1],
    [v.x - 1, v.y],
    [v.x, v.y],
  ];
}

/** True when `owner` holds at least one of the cells meeting at `v` — i.e. `v` is a corner of their land. */
function vertexTouches(board: TerritoryCell[][], v: Pos, owner: PlayerIndex): boolean {
  for (const [x, y] of vertexCells(v)) {
    if (cellOwner(board, x, y) === owner) return true;
  }
  return false;
}

/** The two cells flanking the edge between adjacent vertices `a` and `b`. Off-board entries mean "the outside". */
function segmentCells(a: Pos, b: Pos): [[number, number], [number, number]] {
  if (a.y === b.y) {
    const x = Math.min(a.x, b.x);
    return [
      [x, a.y - 1],
      [x, a.y],
    ];
  }
  const y = Math.min(a.y, b.y);
  return [
    [a.x - 1, y],
    [a.x, y],
  ];
}

/** Identifies a lattice edge, so a drawn stroke can be tested as a wall between cells. */
function edgeKey(a: Pos, b: Pos): string {
  if (a.y === b.y) return `H:${Math.min(a.x, b.x)}:${a.y}`;
  return `V:${a.x}:${Math.min(a.y, b.y)}`;
}

function adjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/**
 * Whether `player` may draw along the edge from `a` to `b`: it must run beside
 * open land (so the stroke goes somewhere) and never beside the opponent's
 * territory (rule 2). Note this is about the *edge*, not the vertices: slipping
 * diagonally past the corner of the opponent's land is allowed, and a cell
 * pinched between two opposite corners of their land is sealed off by it.
 */
function canDrawSegment(board: TerritoryCell[][], player: PlayerIndex, a: Pos, b: Pos): boolean {
  if (!vertexInRange(a) || !vertexInRange(b) || !adjacent(a, b)) return false;
  const opponent = other(player);
  const [c1, c2] = segmentCells(a, b);
  const o1 = cellOwner(board, c1[0], c1[1]);
  const o2 = cellOwner(board, c2[0], c2[1]);
  if (o1 === opponent || o2 === opponent) return false;
  return o1 === null || o2 === null;
}

/** Every lattice vertex that is a corner of `player`'s land and has somewhere to draw. */
function startVertices(board: TerritoryCell[][], player: PlayerIndex): Pos[] {
  const out: Pos[] = [];
  for (let y = 0; y <= HEIGHT; y++) {
    for (let x = 0; x <= WIDTH; x++) {
      const v = { x, y };
      if (!vertexTouches(board, v, player)) continue;
      const hasExit = ORTHO.some(([dx, dy]) => canDrawSegment(board, player, v, { x: x + dx, y: y + dy }));
      if (hasExit) out.push(v);
    }
  }
  return out;
}

/**
 * Cells the finished stroke seals off from the outside.
 *
 * Flood fill the neutral cells inward from beyond the board edge, with both
 * players' territory as walls and every drawn segment as a closed door. Any
 * neutral cell the fill never reaches is enclosed and is captured — even when
 * part of the wall around it is the opponent's territory, since it is still
 * genuinely unreachable from the outside. Cells already owned are left alone:
 * a stroke claims open land, never land that is already someone's.
 */
function capturedBy(board: TerritoryCell[][], line: Pos[]): Pos[] {
  const closed = new Set<string>();
  for (let i = 1; i < line.length; i++) closed.add(edgeKey(line[i - 1], line[i]));

  const reached: boolean[][] = Array.from({ length: HEIGHT }, () => Array<boolean>(WIDTH).fill(false));
  const stack: [number, number][] = [];

  function seed(x: number, y: number, boundary: string) {
    if (board[y][x] !== null || reached[y][x] || closed.has(boundary)) return;
    reached[y][x] = true;
    stack.push([x, y]);
  }

  for (let x = 0; x < WIDTH; x++) {
    seed(x, 0, `H:${x}:0`);
    seed(x, HEIGHT - 1, `H:${x}:${HEIGHT}`);
  }
  for (let y = 0; y < HEIGHT; y++) {
    seed(0, y, `V:0:${y}`);
    seed(WIDTH - 1, y, `V:${WIDTH}:${y}`);
  }

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of ORTHO) {
      const nx = x + dx;
      const ny = y + dy;
      if (!cellInRange(nx, ny) || reached[ny][nx] || board[ny][nx] !== null) continue;
      // The shared edge: horizontal neighbours are split by a vertical segment and vice versa.
      const key = dy === 0 ? `V:${Math.max(x, nx)}:${y}` : `H:${x}:${Math.max(y, ny)}`;
      if (closed.has(key)) continue;
      reached[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }

  const enclosed: Pos[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (board[y][x] === null && !reached[y][x]) enclosed.push({ x, y });
    }
  }
  return enclosed;
}

export type TerritoryLineError =
  | "shape" // not a well-formed chain of lattice vertices
  | "too-long"
  | "start" // does not begin on a corner of your own land
  | "segment" // runs through the opponent's land or through owned land
  | "self" // crosses or touches itself
  | "home" // never left your own land
  | "open" // does not come back to your own land
  | "empty"; // closes, but seals nothing off

const LINE_ERROR_TEXT: Record<TerritoryLineError, string> = {
  shape: "선의 모양이 올바르지 않습니다.",
  "too-long": `한 번에 그릴 수 있는 선은 ${MAX_LINE}칸까지입니다.`,
  start: "자기 땅의 모서리에서 시작해야 합니다.",
  segment: "상대 땅에 붙은 선이나 이미 차지한 땅 안으로는 지나갈 수 없습니다.",
  self: "선이 스스로와 겹쳤습니다.",
  home: "자기 땅 밖으로 나갔다 돌아와야 합니다.",
  open: "선을 자기 땅까지 되돌려야 합니다.",
  empty: "둘러싸서 차지한 칸이 없습니다.",
};

export function territoryLineErrorText(error: TerritoryLineError): string {
  return LINE_ERROR_TEXT[error];
}

/**
 * The rule check for a whole stroke, shared by `applyMove` and — through
 * `territoryPreview` — by the client while it draws.
 */
function checkLine(
  board: TerritoryCell[][],
  player: PlayerIndex,
  line: Pos[],
): { error: TerritoryLineError | null; gain: Pos[] } {
  if (!Array.isArray(line) || line.length < 1) return { error: "shape", gain: [] };
  for (const v of line) {
    if (!v || typeof v !== "object") return { error: "shape", gain: [] };
    if (!Number.isInteger(v.x) || !Number.isInteger(v.y) || !vertexInRange(v)) return { error: "shape", gain: [] };
  }
  if (line.length - 1 > MAX_LINE) return { error: "too-long", gain: [] };
  if (!vertexTouches(board, line[0], player)) return { error: "start", gain: [] };

  const seen = new Set<string>([`${line[0].x},${line[0].y}`]);
  let left = false;
  for (let i = 1; i < line.length; i++) {
    const prev = line[i - 1];
    const v = line[i];
    if (!adjacent(prev, v)) return { error: "shape", gain: [] };
    if (!canDrawSegment(board, player, prev, v)) return { error: "segment", gain: [] };
    const k = `${v.x},${v.y}`;
    // The final vertex may land back on the first one — that closes the loop.
    const closesLoop = i === line.length - 1 && v.x === line[0].x && v.y === line[0].y;
    if (seen.has(k) && !closesLoop) return { error: "self", gain: [] };
    seen.add(k);
    if (!vertexTouches(board, v, player)) left = true;
  }

  if (line.length < 2) return { error: "open", gain: [] };
  if (!left) return { error: "home", gain: [] };
  if (!vertexTouches(board, line[line.length - 1], player)) return { error: "open", gain: [] };
  const gain = capturedBy(board, line);
  if (gain.length === 0) return { error: "empty", gain: [] };
  return { error: null, gain };
}

/**
 * Samples up to `want` legal strokes, at most one per starting corner so the
 * sample is spread around the frontier rather than clustered on one spot.
 * Deterministic: see the contract note at the top of this file for why that
 * matters. Depth-first from each corner, stopping at a stroke as soon as one
 * closes with something enclosed.
 */
function findLines(board: TerritoryCell[][], player: PlayerIndex, want: number): TerritoryMove[] {
  const found: TerritoryMove[] = [];
  let nodeBudget = SEARCH_NODE_BUDGET;
  let closeBudget = SEARCH_CLOSE_BUDGET;

  for (const start of startVertices(board, player)) {
    if (found.length >= want || nodeBudget <= 0 || closeBudget <= 0) break;
    let startBudget = SEARCH_START_BUDGET;
    const line: Pos[] = [start];
    const seen = new Set<string>([`${start.x},${start.y}`]);

    /** Depth-first to at most `limit` segments; returns the stroke that closed, or null. */
    const walk = (left: boolean, limit: number): Pos[] | null => {
      if (nodeBudget <= 0 || startBudget <= 0 || closeBudget <= 0) return null;
      const head = line[line.length - 1];
      const drawn = line.length - 1;
      if (left && drawn >= 1 && vertexTouches(board, head, player)) {
        closeBudget--;
        if (capturedBy(board, line).length > 0) return line.slice();
      }
      if (drawn >= limit) return null;
      // A stroke may also close back onto the corner it started from, which the
      // visited-vertex set below would otherwise rule out.
      if (left && drawn >= 2 && canDrawSegment(board, player, head, start)) {
        closeBudget--;
        const loop = [...line, start];
        if (capturedBy(board, loop).length > 0) return loop;
      }
      for (const [dx, dy] of ORTHO) {
        const next = { x: head.x + dx, y: head.y + dy };
        const k = `${next.x},${next.y}`;
        if (seen.has(k)) continue;
        if (!canDrawSegment(board, player, head, next)) continue;
        nodeBudget--;
        startBudget--;
        if (nodeBudget <= 0 || startBudget <= 0) return null;
        line.push(next);
        seen.add(k);
        const hit = walk(left || !vertexTouches(board, next, player), limit);
        if (hit) return hit;
        line.pop();
        seen.delete(k);
      }
      return null;
    };

    // Deepen one segment at a time so the *shortest* stroke from this corner is
    // the one found. Without it a plain depth-first walk wanders out to the
    // length cap before it ever tries turning back, which costs far more than
    // re-walking the shallow levels.
    let hit: Pos[] | null = null;
    for (let limit = 2; limit <= MAX_LINE && !hit; limit++) {
      hit = walk(false, limit);
    }
    if (hit) found.push({ kind: "line", line: hit });
  }
  return found;
}

/** Whether `player` can still draw a stroke that captures something — the end-of-game test. */
function canCapture(board: TerritoryCell[][], player: PlayerIndex): boolean {
  return findLines(board, player, 1).length > 0;
}

function countCells(board: TerritoryCell[][]): [number, number] {
  let c0 = 0;
  let c1 = 0;
  for (const row of board) {
    for (const c of row) {
      if (c === 0) c0++;
      else if (c === 1) c1++;
    }
  }
  return [c0, c1];
}

interface TurnResolution {
  turn: PlayerIndex;
  status: GameStatus;
  winner: PlayerIndex | null;
  reason: string;
}

function finalScore(board: TerritoryCell[][]): { status: GameStatus; winner: PlayerIndex | null; reason: string } {
  const [c0, c1] = countCells(board);
  if (c0 === c1) return { status: "draw", winner: null, reason: `무승부 (${c0}:${c1})로 게임이 끝났습니다.` };
  const winner: PlayerIndex = c0 > c1 ? 0 : 1;
  return { status: "win", winner, reason: `${c0}:${c1}로 승리했습니다.` };
}

/**
 * Called after `justMoved` finishes a stroke. Hands the turn over, unless the
 * opponent has no capturing stroke left anywhere — then it comes straight back,
 * and when *neither* side can capture anything the game ends on cell count.
 */
function resolveTurn(board: TerritoryCell[][], justMoved: PlayerIndex, eventReason: string): TurnResolution {
  const opponent = other(justMoved);
  if (canCapture(board, opponent)) {
    return { turn: opponent, status: "ongoing", winner: null, reason: eventReason };
  }
  if (canCapture(board, justMoved)) {
    return {
      turn: justMoved,
      status: "ongoing",
      winner: null,
      reason: `${eventReason} 상대방이 더 그릴 곳이 없어 차례가 이어집니다.`.trim(),
    };
  }
  return { turn: justMoved, ...finalScore(board) };
}

function resolveInitial(board: TerritoryCell[][]): TurnResolution {
  if (canCapture(board, 0)) return { turn: 0, status: "ongoing", winner: null, reason: "" };
  if (canCapture(board, 1)) return { turn: 1, status: "ongoing", winner: null, reason: "" };
  return { turn: 0, ...finalScore(board) };
}

/** The deadline of the turn on the table, or null while the clock is paused or the game is over. */
function clockDeadline(state: TerritoryState): number | null {
  if (state.status !== "ongoing" || state.turnStartedAt === null) return null;
  return state.turnStartedAt + state.turnMs;
}

/** The clock fields for the turn that starts once the current one is finished. */
function startNextTurn(state: TerritoryState, now: number): Pick<TerritoryState, "turnsTaken" | "turnMs" | "turnStartedAt"> {
  const turnsTaken = state.turnsTaken + 1;
  return {
    turnsTaken,
    turnMs: turnBudget(turnsTaken),
    // Running, unless the clock was paused — the host restarts it when play resumes.
    turnStartedAt: state.turnStartedAt === null ? null : now,
  };
}

function initialBoard(): TerritoryCell[][] {
  const board: TerritoryCell[][] = Array.from({ length: HEIGHT }, () => Array<TerritoryCell>(WIDTH).fill(null));
  for (let y = 0; y < HOME; y++) {
    for (let x = 0; x < HOME; x++) {
      board[y][x] = 0; // player 0's home: top-left corner
      board[HEIGHT - 1 - y][WIDTH - 1 - x] = 1; // player 1's home: bottom-right corner
    }
  }
  return board;
}

// --- Helpers the client draws with, so the drawing rules live only in here ---

/** Can `player` begin a stroke at lattice vertex `v`? */
export function territoryCanStart(state: TerritoryState, player: PlayerIndex, v: Pos): boolean {
  if (!vertexInRange(v) || !vertexTouches(state.board, v, player)) return false;
  return ORTHO.some(([dx, dy]) => canDrawSegment(state.board, player, v, { x: v.x + dx, y: v.y + dy }));
}

/** Can `player` extend the stroke `line` to `next`? Mirrors the rules `applyMove` enforces. */
export function territoryCanExtend(state: TerritoryState, player: PlayerIndex, line: Pos[], next: Pos): boolean {
  if (line.length === 0) return territoryCanStart(state, player, next);
  if (line.length - 1 >= MAX_LINE) return false;
  const head = line[line.length - 1];
  if (!canDrawSegment(state.board, player, head, next)) return false;
  const closesLoop = next.x === line[0].x && next.y === line[0].y;
  if (!closesLoop && line.some((v) => v.x === next.x && v.y === next.y)) return false;
  return true;
}

/**
 * What the stroke drawn so far would do if it were submitted now: `gain` is the
 * land it would capture and `error` says why it would be refused (null when it
 * is ready to send). Lets the client shade the catch live and only submit
 * strokes the engine will accept.
 */
export function territoryPreview(
  state: TerritoryState,
  player: PlayerIndex,
  line: Pos[],
): { error: TerritoryLineError | null; gain: Pos[] } {
  return checkLine(state.board, player, line);
}

export const territoryEngine: GameEngine<TerritoryState, TerritoryMove> = {
  meta: {
    id: "territory",
    nameKo: "땅따먹기 (선 그리기)",
    width: WIDTH,
    height: HEIGHT,
    gridStyle: "cell",
    playerLabels: ["파랑", "빨강"],
    renderer: "territory",
  },

  createInitialState(): TerritoryState {
    const board = initialBoard();
    const resolved = resolveInitial(board);
    return {
      width: WIDTH,
      height: HEIGHT,
      board,
      lastLine: [],
      lastGain: [],
      lastBy: null,
      turnsTaken: 0,
      turnMs: turnBudget(0),
      // Paused until the host starts it: a room sits waiting for a second player,
      // and nobody should lose their first turn to that wait.
      turnStartedAt: null,
      idleTimeouts: 0,
      ...resolved,
    };
  },

  turn(state) {
    return state.turn;
  },

  status(state): StatusResult {
    return { status: state.status, winner: state.winner, reason: state.reason };
  },

  legalMoves(state, player): TerritoryMove[] {
    if (state.status !== "ongoing" || state.turn !== player) return [];
    return findLines(state.board, player, SAMPLE_LINES);
  },

  applyMove(state, move, player, _rng, now = Date.now()): ApplyResult<TerritoryState> {
    const current: StatusResult = { status: state.status, winner: state.winner, reason: state.reason };
    if (state.status !== "ongoing") {
      return { ok: false, state, error: "게임이 이미 종료되었습니다.", status: current };
    }
    if (state.turn !== player) {
      return { ok: false, state, error: "상대방의 차례입니다.", status: current };
    }
    // Moves arrive from the network, so the shape is not trustworthy.
    if (!move || typeof move !== "object") {
      return { ok: false, state, error: "잘못된 요청입니다.", status: current };
    }

    if (move.kind === "timeout") {
      const deadline = clockDeadline(state);
      if (deadline === null) {
        return { ok: false, state, error: "시계가 아직 돌지 않았습니다.", status: current };
      }
      if (now + TIMEOUT_GRACE_MS < deadline) {
        return { ok: false, state, error: "아직 시간이 남았습니다.", status: current };
      }
      // Nothing happens to the board — the turn simply ends having taken nothing.
      const idleTimeouts = state.idleTimeouts + 1;
      if (idleTimeouts >= IDLE_TIMEOUT_LIMIT) {
        const scored = finalScore(state.board);
        const nextState: TerritoryState = {
          ...state,
          lastLine: [],
          lastGain: [],
          turnsTaken: state.turnsTaken + 1,
          idleTimeouts,
          turnStartedAt: null,
          ...scored,
          reason: `시간 초과가 이어져 ${scored.reason}`,
        };
        return {
          ok: true,
          state: nextState,
          status: { status: nextState.status, winner: nextState.winner, reason: nextState.reason },
        };
      }
      const resolved = resolveTurn(state.board, player, "시간이 다 되어 차례가 넘어갔습니다.");
      const nextState: TerritoryState = {
        ...state,
        lastLine: [],
        lastGain: [],
        idleTimeouts,
        ...startNextTurn(state, now),
        ...resolved,
      };
      return {
        ok: true,
        state: nextState,
        status: { status: resolved.status, winner: resolved.winner, reason: resolved.reason },
      };
    }

    if (move.kind !== "line" || !Array.isArray(move.line)) {
      return { ok: false, state, error: "잘못된 요청입니다.", status: current };
    }
    // The length is checked before anything walks the array, so a sender cannot
    // hand over a million vertices and make the room's thread copy them all.
    if (move.line.length > MAX_LINE + 1) {
      return { ok: false, state, error: territoryLineErrorText("too-long"), status: current };
    }

    const line: Pos[] = move.line.map((v: any) => (v && typeof v === "object" ? { x: v.x, y: v.y } : v));
    const { error, gain } = checkLine(state.board, player, line);
    if (error) {
      return { ok: false, state, error: territoryLineErrorText(error), status: current };
    }
    // A stroke that beats the host's timer by a hair stands. The clock is enforced
    // by the timeout move actually arriving, not by second-guessing a move that
    // was already on its way.

    const board = state.board.map((row) => row.slice());
    for (const p of gain) board[p.y][p.x] = player;

    const resolved = resolveTurn(board, player, `${gain.length}칸을 차지했습니다!`);
    const nextState: TerritoryState = {
      ...state,
      board,
      lastLine: line,
      lastGain: gain,
      lastBy: player,
      idleTimeouts: 0,
      ...startNextTurn(state, now),
      ...resolved,
    };
    return {
      ok: true,
      state: nextState,
      status: { status: resolved.status, winner: resolved.winner, reason: resolved.reason },
    };
  },

  pieces(state): BoardPiece[] {
    const out: BoardPiece[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const owner = state.board[y][x];
        if (owner !== null) out.push({ pos: { x, y }, owner, glyph: "" });
      }
    }
    return out;
  },

  clock: {
    deadline: clockDeadline,
    restart(state, now) {
      if (state.status !== "ongoing") return state;
      return { ...state, turnStartedAt: now };
    },
    pause(state) {
      if (state.turnStartedAt === null) return state;
      return { ...state, turnStartedAt: null };
    },
    timeoutMove() {
      return { kind: "timeout" };
    },
  },
};
