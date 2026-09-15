import type {
  ApplyResult,
  BoardPiece,
  GameEngine,
  Move,
  PlayerIndex,
  Pos,
  StatusResult,
} from "../types.js";

const SIZE = 8;

interface Piece {
  owner: PlayerIndex;
  king: boolean;
}

export interface CheckersState {
  board: (Piece | null)[][]; // board[y][x]
  turn: PlayerIndex;
  status: "ongoing" | "win" | "draw";
  winner: PlayerIndex | null;
  reason: string;
  forcedFrom: Pos | null;
}

function initialBoard(): (Piece | null)[][] {
  const board: (Piece | null)[][] = Array.from({ length: SIZE }, () => Array<Piece | null>(SIZE).fill(null));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if ((x + y) % 2 !== 1) continue;
      if (y <= 2) board[y][x] = { owner: 0, king: false };
      else if (y >= 5) board[y][x] = { owner: 1, king: false };
    }
  }
  return board;
}

const KING_DIRS = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function forwardDirs(owner: PlayerIndex): number[][] {
  const dy = owner === 0 ? 1 : -1;
  return [[1, dy], [-1, dy]];
}

function inB(x: number, y: number): boolean {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

interface PieceMoves {
  simple: Move[];
  captures: Move[];
}

function movesForPiece(board: (Piece | null)[][], x: number, y: number): PieceMoves {
  const piece = board[y][x];
  const simple: Move[] = [];
  const captures: Move[] = [];
  if (!piece) return { simple, captures };
  const dirs = piece.king ? KING_DIRS : forwardDirs(piece.owner);
  for (const [dx, dy] of dirs) {
    const mx = x + dx;
    const my = y + dy;
    if (!inB(mx, my)) continue;
    const mid = board[my][mx];
    if (mid === null) {
      simple.push({ from: { x, y }, to: { x: mx, y: my } });
      continue;
    }
    if (mid.owner !== piece.owner) {
      const lx = x + dx * 2;
      const ly = y + dy * 2;
      if (inB(lx, ly) && board[ly][lx] === null) {
        captures.push({ from: { x, y }, to: { x: lx, y: ly } });
      }
    }
  }
  return { simple, captures };
}

function allMovesFor(board: (Piece | null)[][], player: PlayerIndex): PieceMoves {
  const simple: Move[] = [];
  const captures: Move[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const piece = board[y][x];
      if (!piece || piece.owner !== player) continue;
      const m = movesForPiece(board, x, y);
      simple.push(...m.simple);
      captures.push(...m.captures);
    }
  }
  return { simple, captures };
}

function legalMovesFor(board: (Piece | null)[][], player: PlayerIndex, forcedFrom: Pos | null): Move[] {
  if (forcedFrom) {
    return movesForPiece(board, forcedFrom.x, forcedFrom.y).captures;
  }
  const { simple, captures } = allMovesFor(board, player);
  return captures.length > 0 ? captures : simple;
}

export const checkersEngine: GameEngine<CheckersState> = {
  meta: {
    id: "checkers",
    nameKo: "체커",
    width: SIZE,
    height: SIZE,
    gridStyle: "cell",
    playerLabels: ["흑", "백"],
  },

  createInitialState(): CheckersState {
    return { board: initialBoard(), turn: 0, status: "ongoing", winner: null, reason: "", forcedFrom: null };
  },

  turn(state) {
    return state.turn;
  },

  status(state): StatusResult {
    return { status: state.status, winner: state.winner, reason: state.reason };
  },

  legalMoves(state, player): Move[] {
    if (state.status !== "ongoing" || state.turn !== player) return [];
    return legalMovesFor(state.board, player, state.forcedFrom);
  },

  applyMove(state, move, player): ApplyResult<CheckersState> {
    const current: StatusResult = { status: state.status, winner: state.winner, reason: state.reason };
    if (state.status !== "ongoing") {
      return { ok: false, state, error: "게임이 이미 종료되었습니다.", status: current };
    }
    if (state.turn !== player) {
      return { ok: false, state, error: "상대방의 차례입니다.", status: current };
    }
    if (!move.from) {
      return { ok: false, state, error: "이동할 말을 지정해야 합니다.", status: current };
    }
    const legal = legalMovesFor(state.board, player, state.forcedFrom);
    const match = legal.find(
      (m) => m.from && m.from.x === move.from!.x && m.from.y === move.from!.y && m.to.x === move.to.x && m.to.y === move.to.y,
    );
    if (!match) {
      return { ok: false, state, error: "둘 수 없는 이동입니다.", status: current };
    }

    const board = state.board.map((row) => row.slice());
    const { x: fx, y: fy } = move.from;
    const { x: tx, y: ty } = move.to;
    const piece = board[fy][fx]!;
    const isCapture = Math.abs(tx - fx) === 2;
    board[fy][fx] = null;
    if (isCapture) {
      const mx = (fx + tx) / 2;
      const my = (fy + ty) / 2;
      board[my][mx] = null;
    }
    let promoted = false;
    let king = piece.king;
    if (!king && ((piece.owner === 0 && ty === SIZE - 1) || (piece.owner === 1 && ty === 0))) {
      king = true;
      promoted = true;
    }
    board[ty][tx] = { owner: piece.owner, king };

    let forcedFrom: Pos | null = null;
    let turn = player;
    let status: "ongoing" | "win" | "draw" = "ongoing";
    let winner: PlayerIndex | null = null;
    let reason = "";

    const canContinue = isCapture && !promoted && movesForPiece(board, tx, ty).captures.length > 0;
    if (canContinue) {
      forcedFrom = { x: tx, y: ty };
      turn = player;
    } else {
      const opponent: PlayerIndex = player === 0 ? 1 : 0;
      turn = opponent;
      forcedFrom = null;
      const opponentMoves = legalMovesFor(board, opponent, null);
      if (opponentMoves.length === 0) {
        status = "win";
        winner = player;
        reason = "상대방이 더 이상 이동할 수 없습니다";
      }
    }

    const nextState: CheckersState = { board, turn, status, winner, reason, forcedFrom };
    return { ok: true, state: nextState, status: { status, winner, reason } };
  },

  pieces(state): BoardPiece[] {
    const out: BoardPiece[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = state.board[y][x];
        if (p) out.push({ pos: { x, y }, owner: p.owner, glyph: p.owner === 0 ? "●" : "○", highlight: p.king });
      }
    }
    return out;
  },
};
