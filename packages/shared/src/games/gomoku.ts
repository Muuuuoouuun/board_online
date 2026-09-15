import type {
  ApplyResult,
  BoardPiece,
  GameEngine,
  Move,
  PlayerIndex,
  StatusResult,
} from "../types.js";

const SIZE = 15;
const WIN_LEN = 5;

export interface GomokuState {
  board: (PlayerIndex | null)[][]; // board[y][x]
  turn: PlayerIndex;
  status: "ongoing" | "win" | "draw";
  winner: PlayerIndex | null;
  reason: string;
}

function emptyBoard(): (PlayerIndex | null)[][] {
  return Array.from({ length: SIZE }, () => Array<PlayerIndex | null>(SIZE).fill(null));
}

function countDir(
  board: (PlayerIndex | null)[][],
  x: number,
  y: number,
  dx: number,
  dy: number,
  player: PlayerIndex,
): number {
  let count = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[cy][cx] === player) {
    count++;
    cx += dx;
    cy += dy;
  }
  return count;
}

function checkWin(board: (PlayerIndex | null)[][], x: number, y: number, player: PlayerIndex): boolean {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (const [dx, dy] of dirs) {
    const total = 1 + countDir(board, x, y, dx, dy, player) + countDir(board, x, y, -dx, -dy, player);
    if (total >= WIN_LEN) return true;
  }
  return false;
}

function isBoardFull(board: (PlayerIndex | null)[][]): boolean {
  return board.every((row) => row.every((c) => c !== null));
}

export const gomokuEngine: GameEngine<GomokuState> = {
  meta: {
    id: "gomoku",
    nameKo: "오목",
    width: SIZE,
    height: SIZE,
    gridStyle: "intersection",
    playerLabels: ["흑", "백"],
  },

  createInitialState(): GomokuState {
    return { board: emptyBoard(), turn: 0, status: "ongoing", winner: null, reason: "" };
  },

  turn(state) {
    return state.turn;
  },

  status(state): StatusResult {
    return { status: state.status, winner: state.winner, reason: state.reason };
  },

  legalMoves(state, player): Move[] {
    if (state.status !== "ongoing" || state.turn !== player) return [];
    const moves: Move[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (state.board[y][x] === null) moves.push({ to: { x, y } });
      }
    }
    return moves;
  },

  applyMove(state, move, player): ApplyResult<GomokuState> {
    const current: StatusResult = { status: state.status, winner: state.winner, reason: state.reason };
    if (state.status !== "ongoing") {
      return { ok: false, state, error: "게임이 이미 종료되었습니다.", status: current };
    }
    if (state.turn !== player) {
      return { ok: false, state, error: "상대방의 차례입니다.", status: current };
    }
    const { x, y } = move.to;
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE || state.board[y][x] !== null) {
      return { ok: false, state, error: "둘 수 없는 자리입니다.", status: current };
    }

    const board = state.board.map((row) => row.slice());
    board[y][x] = player;

    let status: "ongoing" | "win" | "draw" = "ongoing";
    let winner: PlayerIndex | null = null;
    let reason = "";
    if (checkWin(board, x, y, player)) {
      status = "win";
      winner = player;
      reason = "5목 완성";
    } else if (isBoardFull(board)) {
      status = "draw";
      reason = "보드가 가득 찼습니다";
    }

    const nextState: GomokuState = {
      board,
      turn: player === 0 ? 1 : 0,
      status,
      winner,
      reason,
    };
    return { ok: true, state: nextState, status: { status, winner, reason } };
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
