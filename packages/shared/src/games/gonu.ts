import type {
  ApplyResult,
  BaseState,
  BoardPiece,
  GameEngine,
  GameStatus,
  Move,
  PlayerIndex,
  Pos,
  StatusResult,
} from "../types.js";
import { posEq } from "../types.js";

/**
 * 고누 — the Korean family of folk "trap / capture" board games that were
 * scratched into the dirt with a stick and played with pebbles.
 *
 * There is no single 고누: every region had its own 말밭 (board), and the
 * board decides both how many stones you get and how you win. We implement the
 * three that are always shown together in 전통놀이 material, and let the player
 * pick one before the game starts (meta.setupOptions):
 *
 *   우물고누  — 동그라미 안에 X, 말 2개. Trap the opponent.
 *   호박고누  — 王 + 가운데 동그라미, 말 3개. Trap the opponent, no going home.
 *   넉줄고누  — 가로세로 4줄, 말 4개. Sandwich the opponent's stones and take them.
 *
 * Only the folk *rules* are implemented here; the board art is our own.
 */

export type GonuVariant = "umul" | "hobak" | "neokjul";

export const GONU_VARIANTS: GonuVariant[] = ["umul", "hobak", "neokjul"];

/** A circle segment of the board, in board coordinates. Angles are degrees in
 *  screen space (y grows downward) and sweep clockwise from `from` to `to`. */
export interface GonuArc {
  cx: number;
  cy: number;
  r: number;
  from: number;
  to: number;
}

export interface GonuLabel {
  text: string;
  pos: Pos;
}

/**
 * Everything both the rules and the renderer need to know about one board.
 * The client imports this rather than re-deriving geometry, so a board can
 * never be drawn differently from the way it is played.
 */
export interface GonuLayout {
  id: GonuVariant;
  nameKo: string;
  /** Board-coordinate position of every point, addressed by index. */
  points: Pos[];
  /** Undirected adjacency, by index. */
  adj: number[][];
  /** Straight strokes of the board, as index pairs into `points`. */
  strokes: [number, number][];
  /** Curved strokes (the 우물 ring, the 호박 belly). */
  arcs: GonuArc[];
  /** Occupancy at the start of the game, by index. */
  start: (PlayerIndex | null)[];
  /** Drawing extent in board coordinates (points live inside this box). */
  width: number;
  height: number;
  /** Extra room outside the box for arcs and captions, in board units. */
  margin: { top: number; right: number; bottom: number; left: number };
  /** Captions painted on the board (the 우물 gap, each player's 집). */
  labels: GonuLabel[];
  /** 호박고누: the 집(home) points of player 0 and player 1. */
  homes: [number[], number[]] | null;
  /** 우물고누: the opening that instantly traps 백, banned by tradition. */
  bannedOpening: { from: number; to: number } | null;
  /** 넉줄고누 slides along a line; the others step to an adjacent point. */
  slide: boolean;
  /** 넉줄고누 takes stones by sandwiching them. */
  capture: boolean;
  /** Plies without progress before the game is called a draw. */
  drawAfter: number;
}

function p(x: number, y: number): Pos {
  return { x, y };
}

/** Builds a symmetric adjacency list from an edge list. */
function adjacency(count: number, edges: [number, number][]): number[][] {
  const adj: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of edges) {
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  }
  return adj;
}

/* ------------------------------------------------------------------ */
/* 우물고누                                                            */
/* ------------------------------------------------------------------ */

/**
 * 우물고누 — "동그라미 안에 X 표시를 해 놓은 말판". Four points sit on the ring
 * where the X meets it, a fifth sits where the X crosses, and one quarter of
 * the ring is left undrawn. That gap is the 우물 (well): there is no line, so
 * no stone may pass it. Two stones each, and you win by leaving your opponent
 * with nowhere to slide.
 *
 * Indices: 0 NW, 1 NE, 2 SE, 3 SW, 4 가운데. 백 starts on the top pair, 흑 on
 * the bottom pair, and the well is the right-hand quarter (NE-SE).
 *
 * Tradition also bans 흑's opening 2→4. That single move walls 백 off from the
 * only empty point and wins on the spot, so everybody knew it and nobody was
 * allowed to play it — hence the proverb 「우물고누 첫수」, said of a trick so
 * obvious it fools no one. Banning it is what makes the game a game.
 */
const UMUL: GonuLayout = (() => {
  const points = [p(0, 0), p(2, 0), p(2, 2), p(0, 2), p(1, 1)];
  const ring: [number, number][] = [
    [0, 1], // 위 (NW-NE)
    [2, 3], // 아래 (SE-SW)
    [3, 0], // 왼쪽 (SW-NW)
    // [1, 2] 오른쪽 — 우물. 선이 없으므로 이어지지 않는다.
  ];
  const spokes: [number, number][] = [
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
  ];
  const r = Math.SQRT2;
  return {
    id: "umul",
    nameKo: "우물고누",
    points,
    adj: adjacency(points.length, [...ring, ...spokes]),
    strokes: spokes,
    // Three quarters of the ring; the fourth (-45°..45°) is the well.
    arcs: [
      { cx: 1, cy: 1, r, from: -135, to: -45 },
      { cx: 1, cy: 1, r, from: 45, to: 135 },
      { cx: 1, cy: 1, r, from: 135, to: 225 },
    ],
    start: [1, 1, 0, 0, null],
    width: 2,
    height: 2,
    margin: { top: 0.55, right: 1.15, bottom: 0.55, left: 1.15 },
    labels: [{ text: "우물", pos: p(1 + r + 0.3, 1) }],
    homes: null,
    bannedOpening: { from: 2, to: 4 },
    slide: false,
    capture: false,
    drawAfter: 60,
  };
})();

/* ------------------------------------------------------------------ */
/* 호박고누                                                            */
/* ------------------------------------------------------------------ */

/**
 * 호박고누 (사발고누·돼지고누) — drawn by writing 임금 왕(王) and putting a
 * circle over its middle stroke; the round belly is the 호박 the board is named
 * for. The top and bottom strokes of the 王 are the two 진영 (camps), three
 * stones lined up on each, and everything between them is the ring.
 *
 * 각각 말 3개씩 자기 진영에 올려놓고 한 칸씩 움직입니다. 진영을 나온 말은 다시
 * 자기 진영에도, 상대 진영에도 들어갈 수 없습니다. 상대 말을 원 안에서 더 이상
 * 움직일 수 없게 만들면 이깁니다.
 *
 * The gate matters: a camp touches the ring at exactly one point, so a camp
 * still holding all three of its stones is one stone away from being sealed in.
 * Coming out is not optional, and coming out in the wrong order loses.
 *
 * Indices 0-2 백 진영, 3 북 · 4 서 · 5 가운데 · 6 동 · 7 남, 8-10 흑 진영.
 */
const HOBAK: GonuLayout = (() => {
  const points = [
    p(0, 0), p(2, 0), p(4, 0), // 백 진영 (王의 윗 획)
    p(2, 1), // 북 — 백의 문
    p(1, 2), p(2, 2), p(3, 2), // 서 · 가운데 · 동 (王의 가운데 획 = 원의 지름)
    p(2, 3), // 남 — 흑의 문
    p(0, 4), p(2, 4), p(4, 4), // 흑 진영 (王의 아랫 획)
  ];
  const N = 3, W = 4, C = 5, E = 6, S = 7;
  // 王: the two long strokes, the short middle stroke, and the stem joining them.
  const strokes: [number, number][] = [
    [0, 1], [1, 2],
    [8, 9], [9, 10],
    [1, N], [N, C], [C, S], [S, 9],
    [W, C], [C, E],
  ];
  // The 호박 itself: the ring through 북·동·남·서.
  const ring: [number, number][] = [
    [N, E],
    [E, S],
    [S, W],
    [W, N],
  ];
  return {
    id: "hobak",
    nameKo: "호박고누",
    points,
    adj: adjacency(points.length, [...strokes, ...ring]),
    strokes,
    arcs: [{ cx: 2, cy: 2, r: 1, from: 0, to: 360 }],
    start: [1, 1, 1, null, null, null, null, null, 0, 0, 0],
    width: 4,
    height: 4,
    margin: { top: 0.8, right: 0.6, bottom: 0.8, left: 0.6 },
    labels: [
      { text: "백 진영", pos: p(2, -0.44) },
      { text: "흑 진영", pos: p(2, 4.54) },
    ],
    homes: [[8, 9, 10], [0, 1, 2]],
    bannedOpening: null,
    slide: false,
    capture: false,
    drawAfter: 80,
  };
})();

/* ------------------------------------------------------------------ */
/* 넉줄고누                                                            */
/* ------------------------------------------------------------------ */

/**
 * 넉줄고누 — 가로 넉 줄, 세로 넉 줄을 그은 말판이라 넉줄고누. Four stones each,
 * lined up on your own back row. Unlike the other two this is a 잡기 고누: you
 * slide a stone along a line (one point or many, but never through another
 * stone) and any enemy stone your move pins between two of yours is taken.
 * Stones pinned in a corner by both of its neighbours go too. Diagonals never
 * capture. Walking into a sandwich yourself is safe.
 *
 * Down to one stone you can no longer sandwich anything, so that is the loss.
 */
const NEOKJUL: GonuLayout = (() => {
  const n = 4;
  const points: Pos[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) points.push(p(x, y));
  const edges: [number, number][] = [];
  const strokes: [number, number][] = [];
  for (let y = 0; y < n; y++) {
    strokes.push([y * n, y * n + (n - 1)]);
    for (let x = 0; x + 1 < n; x++) edges.push([y * n + x, y * n + x + 1]);
  }
  for (let x = 0; x < n; x++) {
    strokes.push([x, (n - 1) * n + x]);
    for (let y = 0; y + 1 < n; y++) edges.push([y * n + x, (y + 1) * n + x]);
  }
  const start: (PlayerIndex | null)[] = points.map((pt) => (pt.y === 0 ? 1 : pt.y === n - 1 ? 0 : null));
  return {
    id: "neokjul",
    nameKo: "넉줄고누",
    points,
    adj: adjacency(points.length, edges),
    strokes,
    arcs: [],
    start,
    width: n - 1,
    height: n - 1,
    margin: { top: 0.55, right: 0.55, bottom: 0.55, left: 0.55 },
    labels: [],
    homes: null,
    bannedOpening: null,
    slide: true,
    capture: true,
    drawAfter: 40,
  };
})();

export const GONU_LAYOUTS: Record<GonuVariant, GonuLayout> = {
  umul: UMUL,
  hobak: HOBAK,
  neokjul: NEOKJUL,
};

export function isGonuVariant(id: string): id is GonuVariant {
  return (GONU_VARIANTS as string[]).includes(id);
}

export const DEFAULT_GONU_VARIANT: GonuVariant = "umul";

export function getGonuLayout(variant: GonuVariant): GonuLayout {
  return GONU_LAYOUTS[variant] ?? GONU_LAYOUTS[DEFAULT_GONU_VARIANT];
}

/* ------------------------------------------------------------------ */
/* State + rules                                                       */
/* ------------------------------------------------------------------ */

export interface GonuState extends BaseState {
  variant: GonuVariant;
  /** Occupancy by point index, parallel to layout.points. */
  cells: (PlayerIndex | null)[];
  plies: number;
  /** 넉줄고누: plies since the last capture, for the no-progress draw. */
  quiet: number;
  /** Stones taken so far, for the scoreboard. */
  taken: [number, number];
  /** Last move played, as point indices, for the board highlight. */
  last: { from: number; to: number } | null;
}

function other(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

function indexAt(layout: GonuLayout, pos: Pos): number {
  return layout.points.findIndex((pt) => posEq(pt, pos));
}

/** Which player's 집 a point belongs to, or null when it is open board. */
function homeOwner(layout: GonuLayout, index: number): PlayerIndex | null {
  if (!layout.homes) return null;
  if (layout.homes[0].includes(index)) return 0;
  if (layout.homes[1].includes(index)) return 1;
  return null;
}

/** Slide destinations along one line of a 잡기 board, stopping at the first stone. */
function slideTargets(layout: GonuLayout, cells: (PlayerIndex | null)[], from: number): number[] {
  const out: number[] = [];
  const origin = layout.points[from];
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  for (const d of dirs) {
    for (let step = 1; ; step++) {
      const next = indexAt(layout, { x: origin.x + d.dx * step, y: origin.y + d.dy * step });
      if (next < 0 || cells[next] !== null) break;
      out.push(next);
    }
  }
  return out;
}

function movesFor(state: GonuState, layout: GonuLayout, player: PlayerIndex): Move[] {
  const moves: Move[] = [];
  for (let from = 0; from < layout.points.length; from++) {
    if (state.cells[from] !== player) continue;
    const targets = layout.slide
      ? slideTargets(layout, state.cells, from)
      : layout.adj[from].filter((to) => state.cells[to] === null);
    for (const to of targets) {
      // 호박고누: a stone that is out in the open can never go back into a 집.
      if (layout.homes) {
        const destHome = homeOwner(layout, to);
        if (destHome !== null && (destHome !== player || homeOwner(layout, from) !== player)) continue;
      }
      // 우물고누: 첫수 금지 — the opening that traps 백 before they ever move.
      if (
        layout.bannedOpening &&
        state.plies === 0 &&
        from === layout.bannedOpening.from &&
        to === layout.bannedOpening.to
      ) {
        continue;
      }
      moves.push({ from: layout.points[from], to: layout.points[to] });
    }
  }
  return moves;
}

/** Neighbour of `index` one step in (dx, dy), or -1 off the board. */
function step(layout: GonuLayout, index: number, dx: number, dy: number): number {
  const at = layout.points[index];
  return indexAt(layout, { x: at.x + dx, y: at.y + dy });
}

function isCorner(layout: GonuLayout, index: number): boolean {
  const at = layout.points[index];
  return (at.x === 0 || at.x === layout.width) && (at.y === 0 || at.y === layout.height);
}

/**
 * 넉줄고누 takes: the stone that just landed pins an enemy against a friend,
 * straight along a line — or pins one into a corner, where both of the corner's
 * neighbours do the work. A stone that moves *into* a gap between two enemies
 * is safe; only the mover ever captures.
 */
function capturesFrom(layout: GonuLayout, cells: (PlayerIndex | null)[], to: number, player: PlayerIndex): number[] {
  const foe = other(player);
  const taken: number[] = [];
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  for (const d of dirs) {
    const victim = step(layout, to, d.dx, d.dy);
    if (victim < 0 || cells[victim] !== foe) continue;

    const behind = step(layout, victim, d.dx, d.dy);
    if (behind >= 0 && cells[behind] === player) {
      taken.push(victim);
      continue;
    }
    if (isCorner(layout, victim) && layout.adj[victim].every((n) => cells[n] === player)) {
      taken.push(victim);
    }
  }
  return taken;
}

function countOf(cells: (PlayerIndex | null)[], player: PlayerIndex): number {
  return cells.reduce<number>((n, c) => (c === player ? n + 1 : n), 0);
}

export const gonuEngine: GameEngine<GonuState, Move> = {
  meta: {
    id: "gonu",
    nameKo: "고누",
    // The three boards have different extents; the gonu renderer takes the real
    // one from the layout. These are the largest, so a generic caller that only
    // has the meta never under-sizes the board.
    width: 4,
    height: 4,
    gridStyle: "intersection",
    playerLabels: ["흑", "백"],
    renderer: "gonu",
    setupOptions: [
      { id: "umul", label: "우물고누 (말 2개)", description: "동그라미 안에 X. 가두면 이깁니다." },
      { id: "hobak", label: "호박고누 (말 3개)", description: "王 자 말판. 집에서 나온 말은 못 돌아갑니다." },
      { id: "neokjul", label: "넉줄고누 (말 4개)", description: "가로세로 넉 줄. 양쪽에서 끼워 잡습니다." },
    ],
  },

  createInitialState(setupId?: string): GonuState {
    const variant = setupId && isGonuVariant(setupId) ? setupId : DEFAULT_GONU_VARIANT;
    const layout = getGonuLayout(variant);
    return {
      variant,
      cells: [...layout.start],
      turn: 0,
      status: "ongoing",
      winner: null,
      reason: "",
      plies: 0,
      quiet: 0,
      taken: [0, 0],
      last: null,
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
    return movesFor(state, getGonuLayout(state.variant), player);
  },

  applyMove(state, move, player): ApplyResult<GonuState> {
    const current: StatusResult = { status: state.status, winner: state.winner, reason: state.reason };
    if (state.status !== "ongoing") {
      return { ok: false, state, error: "게임이 이미 종료되었습니다.", status: current };
    }
    if (state.turn !== player) {
      return { ok: false, state, error: "상대방의 차례입니다.", status: current };
    }
    if (!move || !move.from || !move.to) {
      return { ok: false, state, error: "이동할 말을 지정해야 합니다.", status: current };
    }

    const layout = getGonuLayout(state.variant);
    const legal = movesFor(state, layout, player);
    const match = legal.find((m) => posEq(m.from!, move.from!) && posEq(m.to, move.to));
    if (!match) {
      const banned =
        layout.bannedOpening &&
        state.plies === 0 &&
        posEq(layout.points[layout.bannedOpening.from], move.from) &&
        posEq(layout.points[layout.bannedOpening.to], move.to);
      return {
        ok: false,
        state,
        error: banned ? "우물고누 첫수는 두지 않는 것이 규칙입니다." : "둘 수 없는 이동입니다.",
        status: current,
      };
    }

    const from = indexAt(layout, match.from!);
    const to = indexAt(layout, match.to);
    const cells = [...state.cells];
    cells[from] = null;
    cells[to] = player;

    const taken: [number, number] = [...state.taken] as [number, number];
    let captured = 0;
    if (layout.capture) {
      for (const victim of capturesFrom(layout, cells, to, player)) {
        cells[victim] = null;
        captured++;
      }
      taken[player] += captured;
    }

    const plies = state.plies + 1;
    const quiet = captured > 0 ? 0 : state.quiet + 1;
    const foe = other(player);

    let status: GameStatus = "ongoing";
    let winner: PlayerIndex | null = null;
    let reason = "";

    const next: GonuState = {
      ...state,
      cells,
      turn: foe,
      plies,
      quiet,
      taken,
      last: { from, to },
      status,
      winner,
      reason,
    };

    if (layout.capture && countOf(cells, foe) <= 1) {
      status = "win";
      winner = player;
      reason = "상대 말이 하나만 남아 더 이상 잡을 수 없습니다.";
    } else if (movesFor(next, layout, foe).length === 0) {
      status = "win";
      winner = player;
      reason = "상대를 가두어 움직일 수 없게 만들었습니다.";
    } else if (quiet >= layout.drawAfter) {
      status = "draw";
      winner = null;
      reason = layout.capture
        ? `${layout.drawAfter}수 동안 잡은 말이 없어 무승부입니다.`
        : `${layout.drawAfter}수 동안 승부가 나지 않아 무승부입니다.`;
    }

    next.status = status;
    next.winner = winner;
    next.reason = reason;
    return { ok: true, state: next, status: { status, winner, reason } };
  },

  pieces(state): BoardPiece[] {
    const layout = getGonuLayout(state.variant);
    const out: BoardPiece[] = [];
    for (let i = 0; i < layout.points.length; i++) {
      const owner = state.cells[i];
      if (owner === null || owner === undefined) continue;
      out.push({
        pos: layout.points[i],
        owner,
        glyph: owner === 0 ? "●" : "○",
        highlight: state.last?.to === i,
      });
    }
    return out;
  },
};
