import type {
  ApplyResult,
  BaseState,
  BoardPiece,
  GameEngine,
  GameStatus,
  Line,
  Move,
  PlayerIndex,
  Pos,
  StatusResult,
} from "../types.js";
import { posEq } from "../types.js";

/**
 * 우물고누 (Umul-gonu / "Well Gonu") — internationally catalogued as Pong Hau
 * K'i. This is the smallest, most widely-known member of the 고누 family.
 *
 * Board (5 points, 7 edges): four outer points arranged as a square —
 * TL, TR, BR, BL — plus a center point C. Lines join TL-TR, TR-BR, BR-BL
 * (three of the square's four sides), and all four spokes TL-C, TR-C, BR-C,
 * BL-C. The fourth side, BL-TL, is deliberately left undrawn: that gap is
 * the "우물" (well) the board is named for, and stones may never cross it
 * directly — they can only reach the far side by going through the center.
 *
 * Each player has 2 stones and starts on a diagonal pair of outer points
 * (player 0 / 흑: TL + BR, player 1 / 백: TR + BL), leaving the center
 * empty. Since there are always exactly 4 stones on 5 points, exactly one
 * point is empty at any time. On your turn you must slide one of your own
 * stones, along a line, into that single empty point — so a stone can move
 * only if it currently sits next to the empty point. If none of your
 * stones do, you have no legal move and lose immediately.
 *
 * This is the classic "가두기 고누" (trapping gonu): with careful play
 * (mirroring the opponent) neither side can be forced into a trap and the
 * game can in principle continue forever, so we cap the game length — see
 * PLY_CAP below — and call it a draw past that point.
 */

export type PointId = "TL" | "TR" | "BR" | "BL" | "C";

/** Board-coordinate layout of the 5 points (also used by the client renderer). */
export const POINTS: Record<PointId, Pos> = {
  TL: { x: 0, y: 0 },
  TR: { x: 2, y: 0 },
  BR: { x: 2, y: 2 },
  BL: { x: 0, y: 2 },
  C: { x: 1, y: 1 },
};

export const POINT_IDS: PointId[] = ["TL", "TR", "BR", "BL", "C"];

/** Adjacency graph — 7 edges. BL-TL (the "well") is deliberately absent. */
export const EDGES: Record<PointId, PointId[]> = {
  TL: ["TR", "C"],
  TR: ["TL", "BR", "C"],
  BR: ["TR", "BL", "C"],
  BL: ["BR", "C"],
  C: ["TL", "TR", "BR", "BL"],
};

/** The 7 edges above, as board-coordinate line segments for the renderer. */
const EDGE_LINES: Line[] = [
  { x1: 0, y1: 0, x2: 2, y2: 0 }, // TL-TR
  { x1: 2, y1: 0, x2: 2, y2: 2 }, // TR-BR
  { x1: 2, y1: 2, x2: 0, y2: 2 }, // BR-BL
  { x1: 0, y1: 0, x2: 1, y2: 1 }, // TL-C
  { x1: 2, y1: 0, x2: 1, y2: 1 }, // TR-C
  { x1: 2, y1: 2, x2: 1, y2: 1 }, // BR-C
  { x1: 0, y1: 2, x2: 1, y2: 1 }, // BL-C
];

/**
 * With 5 points and exactly 4 stones (1 empty), there are at most
 * C(5,1) x C(4,2) = 30 distinct board layouts, times 2 turns = 60 distinct
 * (board, turn) states. So 60 plies is already enough to guarantee — on
 * pigeonhole grounds alone — that any still-undecided game has revisited a
 * prior state, independent of how either side actually plays.
 */
const PLY_CAP = 60;

export type GonuBoardMap = Record<PointId, PlayerIndex | null>;

export interface GonuState extends BaseState {
  board: GonuBoardMap;
  /** Half-moves played so far this game; drives the PLY_CAP draw. */
  plies: number;
}

function emptyPointId(board: GonuBoardMap): PointId | null {
  for (const id of POINT_IDS) {
    if (board[id] === null) return id;
  }
  return null;
}

function pointIdAt(pos: Pos): PointId | null {
  for (const id of POINT_IDS) {
    if (posEq(POINTS[id], pos)) return id;
  }
  return null;
}

function legalMovesFor(board: GonuBoardMap, player: PlayerIndex): Move[] {
  const empty = emptyPointId(board);
  if (empty === null) return [];
  const moves: Move[] = [];
  for (const neighbor of EDGES[empty]) {
    if (board[neighbor] === player) {
      moves.push({ from: POINTS[neighbor], to: POINTS[empty] });
    }
  }
  return moves;
}

function initialBoard(): GonuBoardMap {
  return { TL: 0, BR: 0, TR: 1, BL: 1, C: null };
}

export const gonuEngine: GameEngine<GonuState, Move> = {
  meta: {
    id: "gonu",
    nameKo: "고누",
    width: 2,
    height: 2,
    gridStyle: "intersection",
    playerLabels: ["흑", "백"],
    decorations: EDGE_LINES,
    renderer: "gonu",
  },

  createInitialState(): GonuState {
    return { board: initialBoard(), turn: 0, status: "ongoing", winner: null, reason: "", plies: 0 };
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

  applyMove(state, move, player): ApplyResult<GonuState> {
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

    const legal = legalMovesFor(state.board, player);
    const match = legal.find((m) => m.from && posEq(m.from, move.from!) && posEq(m.to, move.to));
    if (!match) {
      return { ok: false, state, error: "둘 수 없는 이동입니다.", status: current };
    }

    const fromId = pointIdAt(match.from!)!;
    const toId = pointIdAt(match.to)!;
    const board: GonuBoardMap = { ...state.board, [fromId]: null, [toId]: player };
    const plies = state.plies + 1;
    const opponent: PlayerIndex = player === 0 ? 1 : 0;

    let status: GameStatus = "ongoing";
    let winner: PlayerIndex | null = null;
    let reason = "";

    const opponentMoves = legalMovesFor(board, opponent);
    if (opponentMoves.length === 0) {
      status = "win";
      winner = player;
      reason = "상대방이 더 이상 말을 움직일 수 없습니다.";
    } else if (plies >= PLY_CAP) {
      status = "draw";
      winner = null;
      reason = `${PLY_CAP}수 동안 승부가 나지 않아 무승부가 되었습니다.`;
    }

    const nextState: GonuState = { board, turn: opponent, status, winner, reason, plies };
    return { ok: true, state: nextState, status: { status, winner, reason } };
  },

  pieces(state): BoardPiece[] {
    const out: BoardPiece[] = [];
    for (const id of POINT_IDS) {
      const owner = state.board[id];
      if (owner !== null) {
        out.push({ pos: POINTS[id], owner, glyph: owner === 0 ? "●" : "○" });
      }
    }
    return out;
  },
};
