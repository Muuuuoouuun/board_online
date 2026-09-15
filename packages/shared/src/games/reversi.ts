import type {
  ApplyResult,
  BoardPiece,
  GameEngine,
  Move,
  PlayerIndex,
  StatusResult,
} from "../types.js";

const SIZE = 8;
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export interface ReversiState {
  board: (PlayerIndex | null)[][]; // board[y][x]
  turn: PlayerIndex;
  status: "ongoing" | "win" | "draw";
  winner: PlayerIndex | null;
  reason: string;
}

function initialBoard(): (PlayerIndex | null)[][] {
  const board = Array.from({ length: SIZE }, () => Array<PlayerIndex | null>(SIZE).fill(null));
  board[3][3] = 1;
  board[3][4] = 0;
  board[4][3] = 0;
  board[4][4] = 1;
  return board;
}

/** Returns the list of opponent discs that would be flipped by playing at (x,y) for `player`. */
function flipsFor(board: (PlayerIndex | null)[][], x: number, y: number, player: PlayerIndex): [number, number][] {
  if (board[y][x] !== null) return [];
  const opponent = player === 0 ? 1 : 0;
  const allFlips: [number, number][] = [];
  for (const [dx, dy] of DIRS) {
    const line: [number, number][] = [];
    let cx = x + dx;
    let cy = y + dy;
    while (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[cy][cx] === opponent) {
      line.push([cx, cy]);
      cx += dx;
      cy += dy;
    }
    if (line.length > 0 && cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[cy][cx] === player) {
      allFlips.push(...line);
    }
  }
  return allFlips;
}

function legalMovesFor(board: (PlayerIndex | null)[][], player: PlayerIndex): Move[] {
  const moves: Move[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === null && flipsFor(board, x, y, player).length > 0) {
        moves.push({ to: { x, y } });
      }
    }
  }
  return moves;
}

function countDiscs(board: (PlayerIndex | null)[][]): [number, number] {
  let black = 0;
  let white = 0;
  for (const row of board) {
    for (const c of row) {
      if (c === 0) black++;
      else if (c === 1) white++;
    }
  }
  return [black, white];
}

function resolveTurnAndStatus(
  board: (PlayerIndex | null)[][],
  justMoved: PlayerIndex,
): { turn: PlayerIndex; status: "ongoing" | "win" | "draw"; winner: PlayerIndex | null; reason: string } {
  const opponent: PlayerIndex = justMoved === 0 ? 1 : 0;
  if (legalMovesFor(board, opponent).length > 0) {
    return { turn: opponent, status: "ongoing", winner: null, reason: "" };
  }
  if (legalMovesFor(board, justMoved).length > 0) {
    return { turn: justMoved, status: "ongoing", winner: null, reason: "상대방이 둘 곳이 없어 차례를 넘겼습니다" };
  }
  const [black, white] = countDiscs(board);
  if (black === white) return { turn: justMoved, status: "draw", winner: null, reason: `무승부 (${black}:${white})` };
  const winner: PlayerIndex = black > white ? 0 : 1;
  return { turn: justMoved, status: "win", winner, reason: `${black}:${white}로 승리` };
}

export const reversiEngine: GameEngine<ReversiState> = {
  meta: {
    id: "reversi",
    nameKo: "리버시",
    width: SIZE,
    height: SIZE,
    gridStyle: "cell",
    playerLabels: ["흑", "백"],
  },

  createInitialState(): ReversiState {
    return { board: initialBoard(), turn: 0, status: "ongoing", winner: null, reason: "" };
  },

  turn(state) {
    return state.turn;
  },

  status(state): StatusResult {
    return { status: state.status, winner: state.winner, reason: state.reason };
  },

  legalMoves(state, player): Move[] {
    if (state.status !== "ongoing" || state.turn !== player) return [];
    return legalMovesFor(state.board, player);
  },

  applyMove(state, move, player): ApplyResult<ReversiState> {
    const current: StatusResult = { status: state.status, winner: state.winner, reason: state.reason };
    if (state.status !== "ongoing") {
      return { ok: false, state, error: "게임이 이미 종료되었습니다.", status: current };
    }
    if (state.turn !== player) {
      return { ok: false, state, error: "상대방의 차례입니다.", status: current };
    }
    const { x, y } = move.to;
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) {
      return { ok: false, state, error: "보드 밖입니다.", status: current };
    }
    const flips = flipsFor(state.board, x, y, player);
    if (flips.length === 0) {
      return { ok: false, state, error: "둘 수 없는 자리입니다.", status: current };
    }

    const board = state.board.map((row) => row.slice());
    board[y][x] = player;
    for (const [fx, fy] of flips) board[fy][fx] = player;

    const resolved = resolveTurnAndStatus(board, player);
    const nextState: ReversiState = { board, ...resolved };
    return {
      ok: true,
      state: nextState,
      status: { status: resolved.status, winner: resolved.winner, reason: resolved.reason },
    };
  },

  pieces(state): BoardPiece[] {
    const out: BoardPiece[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = state.board[y][x];
        if (v !== null) out.push({ pos: { x, y }, owner: v, glyph: v === 0 ? "●" : "○" });
      }
    }
    return out;
  },
};
