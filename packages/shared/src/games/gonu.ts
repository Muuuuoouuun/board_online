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
 * 우물고누: each side starts with two adjacent stones facing the other side.
 * The left side TL–BL is the impassable well; the centre is an ordinary point.
 * On the opening ply ONLY, the stone beside the well cannot move into the
 * centre: it would trap the opponent before they have had a turn.
 * Reference: 한국민족문화대백과사전, 고누 / 우물고누
 * https://encykorea.aks.ac.kr/Article/E0003367
 *
 * The 60-ply draw is this app's house rule, not a traditional winning rule.
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

/** Draw exactly the same seven connections that the move validator uses. */
export const GONU_LINES: Line[] = POINT_IDS.flatMap((from, index) =>
  EDGES[from]
    .filter((to) => POINT_IDS.indexOf(to) > index)
    .map((to) => ({ x1: POINTS[from].x, y1: POINTS[from].y, x2: POINTS[to].x, y2: POINTS[to].y })),
);

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

function legalMovesFor(board: GonuBoardMap, player: PlayerIndex, opening = false): Move[] {
  const empty = emptyPointId(board);
  if (empty === null) return [];
  const moves: Move[] = [];
  for (const neighbor of EDGES[empty]) {
    if (board[neighbor] === player && !(opening && (neighbor === "TL" || neighbor === "BL"))) {
      moves.push({ from: POINTS[neighbor], to: POINTS[empty] });
    }
  }
  return moves;
}

function initialBoard(): GonuBoardMap {
  return { TL: 1, TR: 1, BR: 0, BL: 0, C: null };
}

export const gonuEngine: GameEngine<GonuState, Move> = {
  meta: {
    id: "gonu",
    nameKo: "고누",
    width: 3,
    height: 3,
    gridStyle: "intersection",
    playerLabels: ["흑", "백"],
    decorations: GONU_LINES,
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
    return legalMovesFor(state.board, player, state.plies === 0);
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

    const fromPoint = pointIdAt(move.from);
    if (state.plies === 0 && (fromPoint === "TL" || fromPoint === "BL") && state.board[fromPoint] === player) {
      return { ok: false, state, error: "첫 수에는 우물 옆의 말을 움직일 수 없습니다.", status: current };
    }
    const legal = legalMovesFor(state.board, player, state.plies === 0);
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
