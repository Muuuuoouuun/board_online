import type {
  ApplyResult,
  BaseState,
  BoardPiece,
  GameEngine,
  PlayerIndex,
  StatusResult,
} from "../types.js";

/**
 * 윷놀이 (Yut Nori) — standard 2-player, 4-말 race game.
 *
 * Board (29 stations total): 20 outer stations on the "out" track (idx 0..19;
 * 0/5/10/15 are the four corners, idx 0 doubling as the shared start/finish
 * corner) plus two diagonal shortcuts through a shared centre station:
 *   - "s5"  runs corner(5)  -> d1 -> d2 -> CENTRE -> d3 -> d4 -> corner(15)
 *   - "s10" runs corner(10) -> e1 -> e2 -> CENTRE -> e3 -> e4 -> HOME (corner 0)
 * 20 + (4 + 4 + 1) = 29 stations, matching the physical board.
 *
 * A token only takes a shortcut when the move about to happen STARTS exactly
 * on corner 5 or corner 10 (checked once, against the position held before
 * the very first single step of that move). Merely passing over a corner
 * mid-move keeps going on whichever track the token was already on, so every
 * outer station stays reachable and every path is strictly forward — a token
 * can never be pushed backwards or left stranded. Overshooting the finish
 * (any throw that would carry a token past the last station) simply finishes
 * it; no exact count is required, which is what keeps the game from stalling.
 */

type Track = "out" | "s5" | "s10";
export interface TrackPos {
  track: Track;
  idx: number;
}
export type YutPos = "start" | "home" | TrackPos;

export interface YutThrowResult {
  flats: [boolean, boolean, boolean, boolean];
  value: number;
  label: string;
}

export interface YutState extends BaseState {
  /** tokens[0] = player 0's 4 말, tokens[1] = player 1's. Index is the tokenId used in moves. */
  tokens: [YutPos[], YutPos[]];
  /** Rolled values (1-5) not yet spent on a token move, oldest first. */
  pendingThrows: number[];
  /** Throws the current player must still take before they may spend anything. Starts each turn at 1. */
  throwsOwed: number;
  /** Most recent throw, kept for display purposes only. */
  lastThrow: YutThrowResult | null;
}

/** TMove is bespoke: yut's board isn't a grid, so it does not reuse the shared Move shape. */
export type YutMove = { kind: "throw" } | { kind: "move"; tokenId: number; throwIndex: number };

const OUTER_LEN = 20; // idx 0..19; corners at 0 (start/finish), 5, 10, 15
const DIAG_LEN = 5; // interior nodes per shortcut: d1, d2, centre, d3, d4 (idx 0..4)
const PLAYER_LABELS: [string, string] = ["흑", "백"];

const LABEL_BY_VALUE: Record<number, string> = { 1: "도", 2: "개", 3: "걸", 4: "윷", 5: "모" };
/** Index = how many of the 4 sticks land flat-up. 모(0 flats)와 윷(4 flats) are the two extremes,
 * which is why this is not simply "value = flat count" — see the distribution check in the test script. */
const RESULT_BY_FLATS: { value: number; label: string }[] = [5, 1, 2, 3, 4].map((value) => ({
  value,
  label: LABEL_BY_VALUE[value],
}));

function posKey(pos: YutPos): string {
  if (pos === "start" || pos === "home") return pos;
  return `${pos.track}:${pos.idx}`;
}

function stepOnce(pos: TrackPos): TrackPos | "home" {
  if (pos.track === "out") {
    if (pos.idx + 1 >= OUTER_LEN) return "home";
    return { track: "out", idx: pos.idx + 1 };
  }
  if (pos.track === "s5") {
    if (pos.idx + 1 >= DIAG_LEN) return { track: "out", idx: 15 };
    return { track: "s5", idx: pos.idx + 1 };
  }
  // s10
  if (pos.idx + 1 >= DIAG_LEN) return "home";
  return { track: "s10", idx: pos.idx + 1 };
}

/**
 * Advances a token `steps` stations forward. The corner-shortcut check only fires on the
 * very first sub-step, against the position the token held before this whole move began —
 * so a throw that merely passes over corner 5/10 mid-move does not divert it.
 */
function advance(pos: YutPos, steps: number): YutPos {
  let cur: TrackPos = pos === "start" ? { track: "out", idx: 0 } : (pos as TrackPos);
  for (let i = 0; i < steps; i++) {
    if (i === 0 && cur.track === "out" && (cur.idx === 5 || cur.idx === 10)) {
      cur = { track: cur.idx === 5 ? "s5" : "s10", idx: 0 };
      continue;
    }
    const next = stepOnce(cur);
    if (next === "home") return "home";
    cur = next;
  }
  return cur;
}

/**
 * Groups a player's tokens into distinct movable clusters: off-board tokens are one
 * cluster (only one of them actually enters per move), on-board tokens sharing a
 * station are an 업기 stack that moves together. Home tokens are excluded (done).
 */
function movableGroups(tokens: YutPos[]): { repId: number; pos: YutPos }[] {
  const seen = new Set<string>();
  const out: { repId: number; pos: YutPos }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const pos = tokens[i];
    if (pos === "home") continue;
    const key = posKey(pos);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repId: i, pos });
  }
  return out;
}

/** The lowest tokenId sharing tokenId's current position — the id legalMoves would have offered. */
function representativeId(tokens: YutPos[], tokenId: number): number {
  const key = posKey(tokens[tokenId]);
  for (let i = 0; i < tokens.length; i++) {
    if (posKey(tokens[i]) === key) return i;
  }
  return tokenId;
}

function cloneTokens(tokens: [YutPos[], YutPos[]]): [YutPos[], YutPos[]] {
  return [tokens[0].slice(), tokens[1].slice()];
}

/** Board coordinates for the 29 stations. Used only by pieces() below — the custom
 * client renderer lays its own board out and does not consume this. */
const SIZE = 280;
const ORIGIN = 20;
function outerPoint(idx: number): { x: number; y: number } {
  const corners = [
    { x: ORIGIN + SIZE, y: ORIGIN + SIZE },
    { x: ORIGIN + SIZE, y: ORIGIN },
    { x: ORIGIN, y: ORIGIN },
    { x: ORIGIN, y: ORIGIN + SIZE },
  ];
  const seg = Math.floor(idx / 5);
  const t = (idx % 5) / 5;
  const a = corners[seg];
  const b = corners[(seg + 1) % 4];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function diagPoint(from: { x: number; y: number }, to: { x: number; y: number }, idx: number): { x: number; y: number } {
  const t = (idx + 1) / 6;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}
function stationPoint(pos: TrackPos): { x: number; y: number } {
  if (pos.track === "out") return outerPoint(pos.idx);
  const TR = outerPoint(5);
  const BL = outerPoint(15);
  const TL = outerPoint(10);
  const BR = outerPoint(0);
  return pos.track === "s5" ? diagPoint(TR, BL, pos.idx) : diagPoint(TL, BR, pos.idx);
}

function initialTokens(): [YutPos[], YutPos[]] {
  return [
    ["start", "start", "start", "start"],
    ["start", "start", "start", "start"],
  ];
}

function legalMovesFor(state: YutState, player: PlayerIndex): YutMove[] {
  if (state.status !== "ongoing" || state.turn !== player) return [];
  if (state.throwsOwed > 0) return [{ kind: "throw" }];
  if (state.pendingThrows.length === 0) return [];
  const groups = movableGroups(state.tokens[player]);
  const moves: YutMove[] = [];
  for (const g of groups) {
    for (let i = 0; i < state.pendingThrows.length; i++) {
      moves.push({ kind: "move", tokenId: g.repId, throwIndex: i });
    }
  }
  return moves;
}

export const yutEngine: GameEngine<YutState, YutMove> = {
  meta: {
    id: "yut",
    nameKo: "윷놀이",
    // Unused by the custom "yut" renderer (kept only because GameMeta requires them).
    width: 7,
    height: 7,
    gridStyle: "cell",
    playerLabels: PLAYER_LABELS,
    renderer: "yut",
  },

  createInitialState(): YutState {
    return {
      tokens: initialTokens(),
      pendingThrows: [],
      throwsOwed: 1,
      lastThrow: null,
      turn: 0,
      status: "ongoing",
      winner: null,
      reason: "",
    };
  },

  turn(state) {
    return state.turn;
  },

  status(state): StatusResult {
    return { status: state.status, winner: state.winner, reason: state.reason };
  },

  legalMoves(state, player): YutMove[] {
    return legalMovesFor(state, player);
  },

  applyMove(state, move, player, rng): ApplyResult<YutState> {
    const random = rng ?? Math.random;
    const current: StatusResult = { status: state.status, winner: state.winner, reason: state.reason };
    const fail = (error: string): ApplyResult<YutState> => ({ ok: false, state, error, status: current });

    try {
      if (state.status !== "ongoing") return fail("게임이 이미 종료되었습니다.");
      if (state.turn !== player) return fail("상대방의 차례입니다.");
      if (!move || typeof move !== "object") return fail("알 수 없는 명령입니다.");

      if (move.kind === "throw") {
        if (state.throwsOwed <= 0) return fail("지금은 윷을 던질 수 없습니다. 먼저 말을 움직이세요.");
        const flats = [random() < 0.5, random() < 0.5, random() < 0.5, random() < 0.5] as [
          boolean,
          boolean,
          boolean,
          boolean,
        ];
        const flatCount = flats.filter(Boolean).length;
        const { value, label } = RESULT_BY_FLATS[flatCount];
        const pendingThrows = [...state.pendingThrows, value];
        let throwsOwed = state.throwsOwed - 1;
        if (value === 4 || value === 5) throwsOwed += 1;
        const nextState: YutState = { ...state, pendingThrows, throwsOwed, lastThrow: { flats, value, label } };
        return { ok: true, state: nextState, status: current };
      }

      if (move.kind === "move") {
        if (state.throwsOwed > 0) return fail("아직 던질 윷이 남아 있습니다.");
        const throwIndex = move.throwIndex;
        if (!Number.isInteger(throwIndex) || throwIndex < 0 || throwIndex >= state.pendingThrows.length) {
          return fail("유효하지 않은 던지기 결과입니다.");
        }
        const myTokens = state.tokens[player];
        const tokenId = move.tokenId;
        if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= myTokens.length) {
          return fail("유효하지 않은 말입니다.");
        }
        const fromPos = myTokens[tokenId];
        if (fromPos === "home") return fail("이미 도착한 말입니다.");
        if (representativeId(myTokens, tokenId) !== tokenId) {
          return fail("업힌 말은 대표 말을 선택해야 합니다.");
        }

        const steps = state.pendingThrows[throwIndex];
        const toPos = advance(fromPos, steps);

        const tokens = cloneTokens(state.tokens);
        if (fromPos === "start") {
          tokens[player][tokenId] = toPos;
        } else {
          const key = posKey(fromPos);
          for (let i = 0; i < tokens[player].length; i++) {
            if (posKey(tokens[player][i]) === key) tokens[player][i] = toPos;
          }
        }

        const pendingThrows = state.pendingThrows.slice();
        pendingThrows.splice(throwIndex, 1);
        let throwsOwed = state.throwsOwed;

        const oppIdx: PlayerIndex = player === 0 ? 1 : 0;
        if (toPos !== "home" && toPos !== "start") {
          const key = posKey(toPos);
          let captured = false;
          for (let i = 0; i < tokens[oppIdx].length; i++) {
            if (posKey(tokens[oppIdx][i]) === key) {
              tokens[oppIdx][i] = "start";
              captured = true;
            }
          }
          if (captured) throwsOwed += 1;
        }

        const allHome = tokens[player].every((p) => p === "home");
        let status: YutState["status"] = state.status;
        let winner = state.winner;
        let reason = state.reason;
        let turn = state.turn;
        let lastThrow = state.lastThrow;

        if (allHome) {
          status = "win";
          winner = player;
          reason = `${PLAYER_LABELS[player]}이(가) 말 4개를 모두 들여보냈습니다.`;
        } else if (throwsOwed === 0 && pendingThrows.length === 0) {
          turn = oppIdx;
          throwsOwed = 1;
          lastThrow = null;
        }

        const nextState: YutState = { ...state, tokens, pendingThrows, throwsOwed, turn, status, winner, reason, lastThrow };
        return { ok: true, state: nextState, status: { status, winner, reason } };
      }

      return fail("알 수 없는 명령입니다.");
    } catch {
      return fail("이동을 처리할 수 없습니다.");
    }
  },

  pieces(state): BoardPiece[] {
    const out: BoardPiece[] = [];
    for (const owner of [0, 1] as PlayerIndex[]) {
      for (const pos of state.tokens[owner]) {
        if (pos === "start" || pos === "home") continue;
        const { x, y } = stationPoint(pos);
        out.push({ pos: { x, y }, owner, glyph: owner === 0 ? "●" : "○" });
      }
    }
    return out;
  },
};
