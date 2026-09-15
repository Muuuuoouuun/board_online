import type {
  ApplyResult,
  BoardPiece,
  GameEngine,
  Line,
  Move,
  PlayerIndex,
  Pos,
  StatusResult,
} from "../types.js";

const WIDTH = 9;
const HEIGHT = 10;

export type PieceType = "general" | "guard" | "chariot" | "cannon" | "horse" | "elephant" | "soldier";

interface Piece {
  owner: PlayerIndex;
  type: PieceType;
}

type Cell = Piece | null;
type Board = Cell[][]; // board[y][x]

export interface JanggiState {
  board: Board;
  turn: PlayerIndex;
  status: "ongoing" | "win" | "draw";
  winner: PlayerIndex | null;
  reason: string;
  formation: Formation;
}

/** Traditional hanja. The two sides use different characters for general and soldier. */
function glyphFor(type: PieceType, owner: PlayerIndex): string {
  switch (type) {
    case "general":
      return owner === 0 ? "楚" : "漢";
    case "soldier":
      return owner === 0 ? "卒" : "兵";
    case "guard":
      return "士";
    case "chariot":
      return "車";
    case "cannon":
      return "包";
    case "horse":
      return "馬";
    case "elephant":
      return "象";
  }
}

/**
 * The 마상 setup: each side may swap its horses and elephants. Named by the
 * back-rank sequence read from that player's own side, left to right.
 */
export type Formation = "마상상마" | "상마마상" | "마상마상" | "상마상마";

const FORMATIONS: Record<Formation, [PieceType, PieceType, PieceType, PieceType]> = {
  마상상마: ["horse", "elephant", "elephant", "horse"],
  상마마상: ["elephant", "horse", "horse", "elephant"],
  마상마상: ["horse", "elephant", "horse", "elephant"],
  상마상마: ["elephant", "horse", "elephant", "horse"],
};

const DEFAULT_FORMATION: Formation = "상마마상";

function isFormation(id: string): id is Formation {
  return id in FORMATIONS;
}

function inB(x: number, y: number): boolean {
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
}

function posKey(p: Pos): string {
  return `${p.x},${p.y}`;
}

function palaceRows(owner: PlayerIndex): number[] {
  return owner === 0 ? [7, 8, 9] : [0, 1, 2];
}

function forwardDy(owner: PlayerIndex): number {
  return owner === 0 ? -1 : 1;
}

type Ray = Pos[];

function buildPalaceDiagRays(py0: number): Map<string, Ray[]> {
  const map = new Map<string, Ray[]>();
  const center: Pos = { x: 4, y: py0 + 1 };
  const corners: Pos[] = [
    { x: 3, y: py0 },
    { x: 5, y: py0 },
    { x: 3, y: py0 + 2 },
    { x: 5, y: py0 + 2 },
  ];
  for (const corner of corners) {
    const opp: Pos = { x: center.x * 2 - corner.x, y: center.y * 2 - corner.y };
    map.set(posKey(corner), [[center, opp]]);
    const existing = map.get(posKey(center)) ?? [];
    existing.push([corner]);
    map.set(posKey(center), existing);
  }
  return map;
}

const DIAG_RAYS = new Map<string, Ray[]>([...buildPalaceDiagRays(0), ...buildPalaceDiagRays(7)]);

function diagonalRaysAt(pos: Pos): Ray[] {
  return DIAG_RAYS.get(posKey(pos)) ?? [];
}

function orthoRays(x: number, y: number): Ray[] {
  const rays: Ray[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ray: Pos[] = [];
    let cx = x + dx;
    let cy = y + dy;
    while (inB(cx, cy)) {
      ray.push({ x: cx, y: cy });
      cx += dx;
      cy += dy;
    }
    rays.push(ray);
  }
  return rays;
}

function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice());
}

function slideMoves(board: Board, x: number, y: number, owner: PlayerIndex, rays: Ray[]): Pos[] {
  const dests: Pos[] = [];
  for (const ray of rays) {
    for (const p of ray) {
      const cell = board[p.y][p.x];
      if (cell === null) {
        dests.push(p);
        continue;
      }
      if (cell.owner !== owner) dests.push(p);
      break;
    }
  }
  return dests;
}

function cannonRayDests(board: Board, ray: Ray, owner: PlayerIndex): Pos[] {
  const dests: Pos[] = [];
  let screenFound = false;
  for (const p of ray) {
    const cell = board[p.y][p.x];
    if (!screenFound) {
      if (cell === null) continue;
      if (cell.type === "cannon") break;
      screenFound = true;
      continue;
    }
    if (cell === null) {
      dests.push(p);
      continue;
    }
    if (cell.type !== "cannon" && cell.owner !== owner) dests.push(p);
    break;
  }
  return dests;
}

// One orthogonal "leg" step followed by one or two diagonal steps in the same outward
// direction. Horse uses (leg, dest); Elephant extends with an extra diagonal (leg, eye, dest).
const LEG_DIAG_DIRS: { o: [number, number]; d: [number, number] }[] = [
  { o: [1, 0], d: [1, 1] }, { o: [1, 0], d: [1, -1] },
  { o: [-1, 0], d: [-1, 1] }, { o: [-1, 0], d: [-1, -1] },
  { o: [0, 1], d: [1, 1] }, { o: [0, 1], d: [-1, 1] },
  { o: [0, -1], d: [1, -1] }, { o: [0, -1], d: [-1, -1] },
];

function horseMoves(board: Board, x: number, y: number, owner: PlayerIndex): Pos[] {
  const dests: Pos[] = [];
  for (const { o, d } of LEG_DIAG_DIRS) {
    const leg = { x: x + o[0], y: y + o[1] };
    if (!inB(leg.x, leg.y) || board[leg.y][leg.x] !== null) continue;
    const dest = { x: leg.x + d[0], y: leg.y + d[1] };
    if (!inB(dest.x, dest.y)) continue;
    const cell = board[dest.y][dest.x];
    if (cell === null || cell.owner !== owner) dests.push(dest);
  }
  return dests;
}

function elephantMoves(board: Board, x: number, y: number, owner: PlayerIndex): Pos[] {
  const dests: Pos[] = [];
  for (const { o, d } of LEG_DIAG_DIRS) {
    const leg = { x: x + o[0], y: y + o[1] };
    if (!inB(leg.x, leg.y) || board[leg.y][leg.x] !== null) continue;
    const eye = { x: leg.x + d[0], y: leg.y + d[1] };
    if (!inB(eye.x, eye.y) || board[eye.y][eye.x] !== null) continue;
    const dest = { x: eye.x + d[0], y: eye.y + d[1] };
    if (!inB(dest.x, dest.y)) continue;
    const cell = board[dest.y][dest.x];
    if (cell === null || cell.owner !== owner) dests.push(dest);
  }
  return dests;
}

function soldierMoves(board: Board, x: number, y: number, owner: PlayerIndex): Pos[] {
  const dests: Pos[] = [];
  const fdy = forwardDy(owner);
  const candidates: Pos[] = [
    { x, y: y + fdy },
    { x: x - 1, y },
    { x: x + 1, y },
  ];
  for (const c of candidates) {
    if (!inB(c.x, c.y)) continue;
    const cell = board[c.y][c.x];
    if (cell === null || cell.owner !== owner) dests.push(c);
  }
  for (const ray of diagonalRaysAt({ x, y })) {
    const p = ray[0];
    if (p.y - y !== fdy) continue;
    const cell = board[p.y][p.x];
    if (cell === null || cell.owner !== owner) dests.push(p);
  }
  return dests;
}

function palaceStepMoves(board: Board, x: number, y: number, owner: PlayerIndex): Pos[] {
  const dests: Pos[] = [];
  const rows = palaceRows(owner);
  const inOwn = (p: Pos) => p.x >= 3 && p.x <= 5 && rows.includes(p.y);
  const orth: Pos[] = [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }];
  for (const p of orth) {
    if (!inOwn(p)) continue;
    const cell = board[p.y][p.x];
    if (cell === null || cell.owner !== owner) dests.push(p);
  }
  for (const ray of diagonalRaysAt({ x, y })) {
    const p = ray[0];
    if (!inOwn(p)) continue;
    const cell = board[p.y][p.x];
    if (cell === null || cell.owner !== owner) dests.push(p);
  }
  return dests;
}

function pseudoDestsForSquare(board: Board, x: number, y: number): Pos[] {
  const piece = board[y][x];
  if (!piece) return [];
  switch (piece.type) {
    case "general":
    case "guard":
      return palaceStepMoves(board, x, y, piece.owner);
    case "chariot":
      return slideMoves(board, x, y, piece.owner, [...orthoRays(x, y), ...diagonalRaysAt({ x, y })]);
    case "cannon": {
      const rays = [...orthoRays(x, y), ...diagonalRaysAt({ x, y })];
      let dests: Pos[] = [];
      for (const ray of rays) dests = dests.concat(cannonRayDests(board, ray, piece.owner));
      return dests;
    }
    case "horse":
      return horseMoves(board, x, y, piece.owner);
    case "elephant":
      return elephantMoves(board, x, y, piece.owner);
    case "soldier":
      return soldierMoves(board, x, y, piece.owner);
    default:
      return [];
  }
}

function allPseudoMoves(board: Board, player: PlayerIndex): Move[] {
  const moves: Move[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const piece = board[y][x];
      if (!piece || piece.owner !== player) continue;
      for (const to of pseudoDestsForSquare(board, x, y)) {
        moves.push({ from: { x, y }, to });
      }
    }
  }
  return moves;
}

function findGeneral(board: Board, player: PlayerIndex): Pos | null {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const piece = board[y][x];
      if (piece && piece.owner === player && piece.type === "general") return { x, y };
    }
  }
  return null;
}

function isInCheck(board: Board, player: PlayerIndex): boolean {
  const gen = findGeneral(board, player);
  if (!gen) return false;
  const opponent: PlayerIndex = player === 0 ? 1 : 0;
  for (const move of allPseudoMoves(board, opponent)) {
    if (move.to.x === gen.x && move.to.y === gen.y) return true;
  }
  return false;
}

function applyToBoard(board: Board, move: Move): Board {
  const next = cloneBoard(board);
  const from = move.from!;
  next[move.to.y][move.to.x] = next[from.y][from.x];
  next[from.y][from.x] = null;
  return next;
}

function legalMovesFor(board: Board, player: PlayerIndex): Move[] {
  const pseudo = allPseudoMoves(board, player);
  const legal: Move[] = [];
  for (const m of pseudo) {
    const next = applyToBoard(board, m);
    if (!isInCheck(next, player)) legal.push(m);
  }
  return legal;
}

function initialBoard(formation: Formation): Board {
  const board: Board = Array.from({ length: HEIGHT }, () => Array<Cell>(WIDTH).fill(null));
  const [a, b, c, d] = FORMATIONS[formation];
  const backRank: (PieceType | null)[] = [
    "chariot", a, b, "guard", null, "guard", c, d, "chariot",
  ];
  // Player 1 sits across the board, so the same formation from their own point
  // of view is the mirror of it in absolute coordinates.
  const mirroredBackRank: (PieceType | null)[] = [
    "chariot", d, c, "guard", null, "guard", b, a, "chariot",
  ];
  const place = (x: number, y: number, owner: PlayerIndex, type: PieceType) => {
    board[y][x] = { owner, type };
  };

  // Player 0 (Cho) at the bottom, back rank y=9, advancing toward y=0.
  backRank.forEach((type, x) => {
    if (type) place(x, 9, 0, type);
  });
  place(4, 8, 0, "general");
  place(1, 7, 0, "cannon");
  place(7, 7, 0, "cannon");
  [0, 2, 4, 6, 8].forEach((x) => place(x, 6, 0, "soldier"));

  // Player 1 (Han) at the top, back rank y=0, advancing toward y=9.
  mirroredBackRank.forEach((type, x) => {
    if (type) place(x, 0, 1, type);
  });
  place(4, 1, 1, "general");
  place(1, 2, 1, "cannon");
  place(7, 2, 1, "cannon");
  [0, 2, 4, 6, 8].forEach((x) => place(x, 3, 1, "soldier"));

  return board;
}

function palaceDecorations(): Line[] {
  return [
    { x1: 3, y1: 0, x2: 5, y2: 2 },
    { x1: 5, y1: 0, x2: 3, y2: 2 },
    { x1: 3, y1: 7, x2: 5, y2: 9 },
    { x1: 5, y1: 7, x2: 3, y2: 9 },
  ];
}

export const janggiEngine: GameEngine<JanggiState> = {
  meta: {
    id: "janggi",
    nameKo: "장기",
    width: WIDTH,
    height: HEIGHT,
    gridStyle: "intersection",
    playerLabels: ["초", "한"],
    decorations: palaceDecorations(),
    // The first entry must stay in sync with DEFAULT_FORMATION: the pickers show
    // this option before the player touches them, and it has to match the board
    // the engine actually builds when no setup id is supplied.
    setupOptions: [
      { id: "상마마상", label: "상마마상", description: "안쪽에 마, 바깥쪽에 상 (기본)" },
      { id: "마상상마", label: "마상상마", description: "안쪽에 상, 바깥쪽에 마" },
      { id: "마상마상", label: "마상마상", description: "양쪽 모두 마-상 순서" },
      { id: "상마상마", label: "상마상마", description: "양쪽 모두 상-마 순서" },
    ],
  },

  createInitialState(setupId?: string): JanggiState {
    const formation = setupId && isFormation(setupId) ? setupId : DEFAULT_FORMATION;
    return {
      board: initialBoard(formation),
      turn: 0,
      status: "ongoing",
      winner: null,
      reason: "",
      formation,
    };
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

  applyMove(state, move, player): ApplyResult<JanggiState> {
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
    const match = legal.find(
      (m) => m.from && m.from.x === move.from!.x && m.from.y === move.from!.y && m.to.x === move.to.x && m.to.y === move.to.y,
    );
    if (!match) {
      return { ok: false, state, error: "둘 수 없는 이동입니다.", status: current };
    }

    const board = applyToBoard(state.board, match);
    const opponent: PlayerIndex = player === 0 ? 1 : 0;
    let status: "ongoing" | "win" | "draw" = "ongoing";
    let winner: PlayerIndex | null = null;
    let reason = "";

    const opponentLegal = legalMovesFor(board, opponent);
    if (opponentLegal.length === 0) {
      status = "win";
      winner = player;
      reason = isInCheck(board, opponent) ? "외통장군 (체크메이트)" : "상대방이 더 이상 둘 수 있는 수가 없습니다";
    }

    const nextState: JanggiState = { board, turn: opponent, status, winner, reason, formation: state.formation };
    return { ok: true, state: nextState, status: { status, winner, reason } };
  },

  pieces(state): BoardPiece[] {
    const out: BoardPiece[] = [];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const p = state.board[y][x];
        if (p) out.push({ pos: { x, y }, owner: p.owner, glyph: glyphFor(p.type, p.owner), highlight: p.type === "general" });
      }
    }
    return out;
  },
};
