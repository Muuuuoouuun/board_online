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
 * Every cell on the grid is owned by player 0, player 1, or nobody (neutral).
 * On your turn you extend a "path" of neutral cells one cell at a time, out
 * from your own territory:
 *
 *   1. The first cell of a fresh path must be a neutral cell orthogonally
 *      adjacent to your own territory.
 *   2. Every further cell must be orthogonally adjacent to the current end of
 *      the path (the "head") and still neutral.
 *   3. The moment a newly placed cell (other than the very first one) is
 *      orthogonally adjacent to your own territory again, the path has
 *      reconnected: you capture the whole path plus every neutral cell that
 *      is now enclosed, and your turn ends.
 *   4. If a newly placed cell is orthogonally adjacent to the opponent's
 *      territory, or to a non-consecutive cell of your own current path
 *      (the path touching itself), the attempt fails immediately: the turn
 *      passes, the path is abandoned, and nothing is captured.
 *
 * A "turn" is therefore a whole sequence of extension moves — it does not
 * pass after every single move, only when a path resolves (capture or
 * failure). That in-progress sequence is modelled explicitly as `state.path`.
 */

const WIDTH = 14;
const HEIGHT = 14;
/** Each player's starting corner block is HOME x HOME cells. */
const HOME = 2;

const ORTHO: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export type TerritoryCell = PlayerIndex | null;

export interface TerritoryMove {
  to: Pos;
}

export interface TerritoryState extends BaseState {
  width: number;
  height: number;
  /** board[y][x]: cell owner, or null for neutral. */
  board: TerritoryCell[][];
  /** In-progress path belonging to the player whose turn it is; empty when no path is active. */
  path: Pos[];
}

function inRange(x: number, y: number): boolean {
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
}

function other(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

function samePos(a: Pos, x: number, y: number): boolean {
  return a.x === x && a.y === y;
}

function pathHas(path: Pos[], x: number, y: number): boolean {
  return path.some((p) => samePos(p, x, y));
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

/** True if (x,y) has an orthogonal neighbor owned by `owner`. */
function touchesOwner(board: TerritoryCell[][], x: number, y: number, owner: PlayerIndex): boolean {
  for (const [dx, dy] of ORTHO) {
    const nx = x + dx;
    const ny = y + dy;
    if (inRange(nx, ny) && board[ny][nx] === owner) return true;
  }
  return false;
}

/** True if (x,y) has an orthogonal neighbor already in `path`, other than `exclude` (the cell we just came from). */
function touchesOwnPath(path: Pos[], x: number, y: number, exclude: Pos | null): boolean {
  for (const [dx, dy] of ORTHO) {
    const nx = x + dx;
    const ny = y + dy;
    for (const p of path) {
      if (p.x === nx && p.y === ny) {
        if (exclude && samePos(exclude, p.x, p.y)) continue;
        return true;
      }
    }
  }
  return false;
}

/** Neutral cells orthogonally adjacent to `player`'s territory — legal first moves of a fresh path. */
function startCells(board: TerritoryCell[][], player: PlayerIndex): Pos[] {
  const out: Pos[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (board[y][x] === null && touchesOwner(board, x, y, player)) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Whether `player` has a start worth ending the game over — used only to
 * decide whether to keep play going, never to decide what a move may target
 * (see `startCells`, which stays intentionally permissive: attempting a
 * doomed start is how rule 4's "turn passes if you touch the opponent" is
 * ever actually risked, and that risk is central to the game).
 *
 * A plain "is any neutral cell adjacent to my territory" check is not enough
 * here: two territories can pin a strip of neutral cells between them so
 * that *every* cell in it also touches the opponent, or so a pocket only
 * touches my territory at one single point with no second point to exit
 * through. Neither can ever actually be captured — attempting one always
 * fails immediately, and the other can be entered but never closed back into
 * a loop — so counting them would let both sides "legally" retry a doomed
 * cell forever and the game would never end. A cell/pocket only counts here
 * if it is reachable through neutral cells that never touch the opponent
 * (so a path through it cannot fail that way) and it borders my territory at
 * two or more distinct cells (so a path can enter through one and close the
 * loop through another instead of only ever retracing its own entrance).
 */
function hasSafeStart(board: TerritoryCell[][], player: PlayerIndex): boolean {
  const opponent = other(player);
  const visited: boolean[][] = Array.from({ length: HEIGHT }, () => Array<boolean>(WIDTH).fill(false));
  const isSafeNeutral = (x: number, y: number) => board[y][x] === null && !touchesOwner(board, x, y, opponent);

  for (let sy = 0; sy < HEIGHT; sy++) {
    for (let sx = 0; sx < WIDTH; sx++) {
      if (visited[sy][sx] || !isSafeNeutral(sx, sy) || !touchesOwner(board, sx, sy, player)) continue;

      // Flood-fill this whole pocket of opponent-safe neutral cells and count
      // how many of its cells border my territory.
      const stack: [number, number][] = [[sx, sy]];
      visited[sy][sx] = true;
      let borderCells = 0;
      while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        if (touchesOwner(board, x, y, player)) borderCells++;
        for (const [dx, dy] of ORTHO) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inRange(nx, ny) || visited[ny][nx] || !isSafeNeutral(nx, ny)) continue;
          visited[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      if (borderCells >= 2) return true;
    }
  }
  return false;
}

/** Legal next cells to extend `path` — neutral, unvisited, orthogonally adjacent to its head. */
function continuationCells(board: TerritoryCell[][], path: Pos[]): Pos[] {
  const head = path[path.length - 1];
  const out: Pos[] = [];
  for (const [dx, dy] of ORTHO) {
    const nx = head.x + dx;
    const ny = head.y + dy;
    if (!inRange(nx, ny)) continue;
    if (board[ny][nx] !== null) continue;
    if (pathHas(path, nx, ny)) continue;
    out.push({ x: nx, y: ny });
  }
  return out;
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

/**
 * Enclosure: flood fill from the board edge over neutral cells, treating both
 * players' territory *and* the newly closed path as walls. Any neutral cell
 * the fill never reaches is enclosed and is captured — even if part of the
 * wall around it belongs to the opponent, since it is still genuinely
 * unreachable from the outside.
 */
function findEnclosed(board: TerritoryCell[][], closedPath: Pos[]): Pos[] {
  const isWall = (x: number, y: number) => board[y][x] !== null || pathHas(closedPath, x, y);

  const reached: boolean[][] = Array.from({ length: HEIGHT }, () => Array<boolean>(WIDTH).fill(false));
  const stack: [number, number][] = [];

  function seed(x: number, y: number) {
    if (isWall(x, y) || reached[y][x]) return;
    reached[y][x] = true;
    stack.push([x, y]);
  }

  for (let x = 0; x < WIDTH; x++) {
    seed(x, 0);
    seed(x, HEIGHT - 1);
  }
  for (let y = 0; y < HEIGHT; y++) {
    seed(0, y);
    seed(WIDTH - 1, y);
  }

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of ORTHO) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inRange(nx, ny) || reached[ny][nx] || isWall(nx, ny)) continue;
      reached[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }

  const enclosed: Pos[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (!isWall(x, y) && !reached[y][x]) enclosed.push({ x, y });
    }
  }
  return enclosed;
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
 * Called whenever `justMoved`'s turn concludes (capture or failure). Hands the
 * turn to the opponent, unless the opponent has no legal starting cell at all
 * — then it skips back to `justMoved`, and if *neither* player can start a
 * path anywhere, the game ends and is scored by cell count.
 */
function resolveTurn(board: TerritoryCell[][], justMoved: PlayerIndex, eventReason: string): TurnResolution {
  const opponent = other(justMoved);
  if (hasSafeStart(board, opponent)) {
    return { turn: opponent, status: "ongoing", winner: null, reason: eventReason };
  }
  if (hasSafeStart(board, justMoved)) {
    return {
      turn: justMoved,
      status: "ongoing",
      winner: null,
      reason: eventReason
        ? `${eventReason} 상대방이 시작할 곳이 없어 차례가 이어집니다.`
        : "상대방이 시작할 곳이 없어 차례가 이어집니다.",
    };
  }
  return { turn: justMoved, ...finalScore(board) };
}

function resolveInitial(board: TerritoryCell[][]): TurnResolution {
  if (hasSafeStart(board, 0)) return { turn: 0, status: "ongoing", winner: null, reason: "" };
  if (hasSafeStart(board, 1)) return { turn: 1, status: "ongoing", winner: null, reason: "" };
  return { turn: 0, ...finalScore(board) };
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
    return { width: WIDTH, height: HEIGHT, board, path: [], ...resolved };
  },

  turn(state) {
    return state.turn;
  },

  status(state): StatusResult {
    return { status: state.status, winner: state.winner, reason: state.reason };
  },

  legalMoves(state, player): TerritoryMove[] {
    if (state.status !== "ongoing" || state.turn !== player) return [];
    const cells = state.path.length === 0 ? startCells(state.board, player) : continuationCells(state.board, state.path);
    return cells.map((to) => ({ to }));
  },

  applyMove(state, move, player): ApplyResult<TerritoryState> {
    const current: StatusResult = { status: state.status, winner: state.winner, reason: state.reason };
    if (state.status !== "ongoing") {
      return { ok: false, state, error: "게임이 이미 종료되었습니다.", status: current };
    }
    if (state.turn !== player) {
      return { ok: false, state, error: "상대방의 차례입니다.", status: current };
    }

    // Moves arrive from the network, so the shape is not trustworthy.
    if (!move || typeof move !== "object" || !move.to || typeof move.to !== "object") {
      return { ok: false, state, error: "잘못된 요청입니다.", status: current };
    }
    const { x, y } = move.to;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, state, error: "잘못된 좌표입니다.", status: current };
    }
    if (!inRange(x, y)) {
      return { ok: false, state, error: "보드 밖입니다.", status: current };
    }
    if (state.board[y][x] !== null) {
      return { ok: false, state, error: "빈 칸이 아닙니다.", status: current };
    }
    if (pathHas(state.path, x, y)) {
      return { ok: false, state, error: "이미 지나온 칸입니다.", status: current };
    }

    const priorPath = state.path;
    if (priorPath.length === 0) {
      if (!touchesOwner(state.board, x, y, player)) {
        return { ok: false, state, error: "자신의 땅과 붙어 있는 칸에서만 시작할 수 있습니다.", status: current };
      }
    } else {
      const head = priorPath[priorPath.length - 1];
      if (Math.abs(head.x - x) + Math.abs(head.y - y) !== 1) {
        return { ok: false, state, error: "이어지는 칸이 아닙니다.", status: current };
      }
    }

    const opponent = other(player);
    const prevHead = priorPath.length > 0 ? priorPath[priorPath.length - 1] : null;
    const touchedOpponent = touchesOwner(state.board, x, y, opponent);
    const touchedSelf = touchesOwnPath(priorPath, x, y, prevHead);

    if (touchedOpponent || touchedSelf) {
      const eventReason = touchedOpponent
        ? "상대 진영에 닿아 이번 턴에 그리던 선이 사라졌습니다."
        : "그리던 선이 스스로와 겹쳐 이번 턴에 그리던 선이 사라졌습니다.";
      const resolved = resolveTurn(state.board, player, eventReason);
      const nextState: TerritoryState = { ...state, path: [], ...resolved };
      return {
        ok: true,
        state: nextState,
        status: { status: resolved.status, winner: resolved.winner, reason: resolved.reason },
      };
    }

    const reconnects = priorPath.length >= 1 && touchesOwner(state.board, x, y, player);
    if (reconnects) {
      const closedPath = [...priorPath, { x, y }];
      const enclosed = findEnclosed(state.board, closedPath);
      const board = state.board.map((row) => row.slice());
      for (const p of closedPath) board[p.y][p.x] = player;
      for (const p of enclosed) board[p.y][p.x] = player;
      const eventReason = `${closedPath.length + enclosed.length}칸을 차지했습니다!`;
      const resolved = resolveTurn(board, player, eventReason);
      const nextState: TerritoryState = { ...state, board, path: [], ...resolved };
      return {
        ok: true,
        state: nextState,
        status: { status: resolved.status, winner: resolved.winner, reason: resolved.reason },
      };
    }

    // Ordinary extension: the path grows and the same player keeps their turn,
    // unless this leaves the path with nowhere left to go — then it fails too,
    // so a legal-move set is never empty for the player who is meant to move.
    const newPath = [...priorPath, { x, y }];
    if (continuationCells(state.board, newPath).length === 0) {
      const eventReason = "더 이상 이어갈 칸이 없어 이번 턴에 그리던 선이 사라졌습니다.";
      const resolved = resolveTurn(state.board, player, eventReason);
      const nextState: TerritoryState = { ...state, path: [], ...resolved };
      return {
        ok: true,
        state: nextState,
        status: { status: resolved.status, winner: resolved.winner, reason: resolved.reason },
      };
    }

    const nextState: TerritoryState = { ...state, path: newPath, status: "ongoing", winner: null, reason: "" };
    return { ok: true, state: nextState, status: { status: "ongoing", winner: null, reason: "" } };
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
};
