import { Chess } from "chess.js";
import type { ApplyResult, BoardPiece, GameEngine, Pos, StatusResult } from "../types.js";
import type { PlayerIndex } from "../types.js";

export interface ChessState {
  fen: string;
  turn: PlayerIndex;
  status: "ongoing" | "win" | "draw";
  winner: PlayerIndex | null;
  reason: string;
}

const PIECE_GLYPH: Record<string, string> = {
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
};

function colorToPlayer(c: "w" | "b"): PlayerIndex {
  return c === "w" ? 0 : 1;
}

function sqToPos(sq: string): Pos {
  const x = sq.charCodeAt(0) - "a".charCodeAt(0);
  const y = 8 - parseInt(sq[1]!, 10);
  return { x, y };
}

function posToSq(p: Pos): string {
  const file = String.fromCharCode("a".charCodeAt(0) + p.x);
  const rank = 8 - p.y;
  return `${file}${rank}`;
}

function deriveStatus(chess: Chess, mover: PlayerIndex): StatusResult {
  if (!chess.isGameOver()) return { status: "ongoing", winner: null, reason: "" };
  if (chess.isCheckmate()) return { status: "win", winner: mover, reason: "체크메이트" };
  return { status: "draw", winner: null, reason: "무승부" };
}

export const chessEngine: GameEngine<ChessState> = {
  meta: {
    id: "chess",
    nameKo: "체스",
    width: 8,
    height: 8,
    gridStyle: "cell",
    playerLabels: ["백", "흑"],
    ownerIsDark: [false, true],
  },

  createInitialState(): ChessState {
    const chess = new Chess();
    return { fen: chess.fen(), turn: 0, status: "ongoing", winner: null, reason: "" };
  },

  turn(state) {
    return state.turn;
  },

  status(state): StatusResult {
    return { status: state.status, winner: state.winner, reason: state.reason };
  },

  legalMoves(state, player) {
    if (state.status !== "ongoing" || state.turn !== player) return [];
    const chess = new Chess(state.fen);
    return chess.moves({ verbose: true }).map((m) => ({
      from: sqToPos(m.from),
      to: sqToPos(m.to),
      promotion: (m.promotion as "q" | "r" | "b" | "n" | undefined) ?? undefined,
    }));
  },

  applyMove(state, move, player): ApplyResult<ChessState> {
    const current: StatusResult = { status: state.status, winner: state.winner, reason: state.reason };
    if (state.status !== "ongoing") {
      return { ok: false, state, error: "게임이 이미 종료되었습니다.", status: current };
    }
    if (state.turn !== player) {
      return { ok: false, state, error: "상대방의 차례입니다.", status: current };
    }
    if (!move.from) {
      return { ok: false, state, error: "이동할 기물을 지정해야 합니다.", status: current };
    }
    const chess = new Chess(state.fen);
    let result;
    try {
      result = chess.move({ from: posToSq(move.from), to: posToSq(move.to), promotion: move.promotion ?? "q" });
    } catch {
      result = null;
    }
    if (!result) {
      return { ok: false, state, error: "둘 수 없는 이동입니다.", status: current };
    }
    const nextTurn = colorToPlayer(chess.turn());
    const statusResult = deriveStatus(chess, player);
    const nextState: ChessState = {
      fen: chess.fen(),
      turn: nextTurn,
      status: statusResult.status,
      winner: statusResult.winner,
      reason: statusResult.reason,
    };
    return { ok: true, state: nextState, status: statusResult };
  },

  pieces(state): BoardPiece[] {
    const chess = new Chess(state.fen);
    const board = chess.board();
    const out: BoardPiece[] = [];
    board.forEach((row, ry) => {
      row.forEach((cell, rx) => {
        if (!cell) return;
        out.push({ pos: { x: rx, y: ry }, owner: colorToPlayer(cell.color), glyph: PIECE_GLYPH[cell.type] ?? "?" });
      });
    });
    return out;
  },
};
