import { useEffect, useMemo, useState } from "react";
// Types come from the engine so the renderer and the rules cannot drift.
import type { PlayerIndex, YutMove, YutPos, YutState, YutTrackPos } from "@board-online/shared";
import type { GameViewProps } from "./types.js";

const VALUE_LABEL: Record<number, string> = { 1: "도", 2: "개", 3: "걸", 4: "윷", 5: "모" };

const WOOD = "#dfb579";
const INK = "#3a2f28";
const ACCENT = "#2f6bff";
const PLAYER_COLOR: [string, string] = ["#20242b", "#f7efdd"];

/* ---------------------------------------------------------------------- */
/* Board geometry — a square path with 20 outer stations plus two         */
/* diagonal shortcuts (4 interior points each) sharing one centre station. */
/* ---------------------------------------------------------------------- */

const ORIGIN = 40;
const SIZE = 260;
const VB = ORIGIN * 2 + SIZE;

function outerPoint(idx: number): { x: number; y: number } {
  // Travel order: start/finish (bottom-right) -> up the right edge -> top-right
  // -> across the top -> top-left -> down the left edge -> bottom-left -> across
  // the bottom -> back to start.
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

const CORNER = { BR: outerPoint(0), TR: outerPoint(5), TL: outerPoint(10), BL: outerPoint(15) };

function pointFor(pos: YutTrackPos): { x: number; y: number } {
  if (pos.track === "out") return outerPoint(pos.idx);
  return pos.track === "s5" ? diagPoint(CORNER.TR, CORNER.BL, pos.idx) : diagPoint(CORNER.TL, CORNER.BR, pos.idx);
}

/** A stable, human-friendly station number (0-28) for the whole board, for data-yut only. */
function idFor(pos: YutTrackPos): number {
  if (pos.track === "out") return pos.idx;
  if (pos.idx === 2) return 22; // the shared centre station
  if (pos.track === "s5") return [20, 21, NaN, 23, 24][pos.idx];
  return [25, 26, NaN, 27, 28][pos.idx];
}

interface StationVis {
  id: number;
  x: number;
  y: number;
  corner: boolean;
  center: boolean;
}

const STATIONS: StationVis[] = (() => {
  const out: StationVis[] = [];
  for (let idx = 0; idx < 20; idx++) {
    const { x, y } = outerPoint(idx);
    out.push({ id: idx, x, y, corner: idx % 5 === 0, center: false });
  }
  const s5Ids = [20, 21, 22, 23, 24];
  const s10Ids = [25, 26, 22, 27, 28];
  for (let idx = 0; idx < 5; idx++) {
    if (idx === 2) continue;
    const { x, y } = diagPoint(CORNER.TR, CORNER.BL, idx);
    out.push({ id: s5Ids[idx], x, y, corner: false, center: false });
  }
  {
    const { x, y } = diagPoint(CORNER.TR, CORNER.BL, 2);
    out.push({ id: 22, x, y, corner: false, center: true });
  }
  for (let idx = 0; idx < 5; idx++) {
    if (idx === 2) continue;
    const { x, y } = diagPoint(CORNER.TL, CORNER.BR, idx);
    out.push({ id: s10Ids[idx], x, y, corner: false, center: false });
  }
  return out;
})();

function posKey(pos: YutPos): string {
  if (pos === "start" || pos === "home") return pos;
  return `${pos.track}:${pos.idx}`;
}

interface Group {
  repId: number;
  pos: YutPos;
  ids: number[];
}

function groupTokens(tokens: YutPos[]): Group[] {
  const map = new Map<string, Group>();
  tokens.forEach((pos, id) => {
    const key = posKey(pos);
    const g = map.get(key);
    if (g) g.ids.push(id);
    else map.set(key, { repId: id, pos, ids: [id] });
  });
  return Array.from(map.values());
}

/* ---------------------------------------------------------------------- */

export default function YutBoard(props: GameViewProps<YutState, YutMove>) {
  const { state, legalMoves, onMove, interactive, you } = props;
  const [selToken, setSelToken] = useState<number | null>(null);
  const [selThrow, setSelThrow] = useState<number | null>(null);

  useEffect(() => {
    setSelToken(null);
    setSelThrow(null);
  }, [state]);

  const moveOptions = useMemo(
    () => legalMoves.filter((m): m is Extract<YutMove, { kind: "move" }> => m.kind === "move"),
    [legalMoves],
  );
  const canThrow = legalMoves.some((m) => m.kind === "throw");
  const acting = state.turn;

  function fireThrow() {
    if (!interactive || !canThrow) return;
    onMove({ kind: "throw" });
  }

  function clickThrow(idx: number) {
    if (!interactive) return;
    if (!moveOptions.some((m) => m.throwIndex === idx)) return;
    if (selToken !== null) {
      const match = moveOptions.find((m) => m.tokenId === selToken && m.throwIndex === idx);
      if (match) {
        onMove(match);
        setSelToken(null);
        setSelThrow(null);
        return;
      }
    }
    setSelThrow((prev) => (prev === idx ? null : idx));
  }

  function clickToken(tokenId: number) {
    if (!interactive) return;
    const forThis = moveOptions.filter((m) => m.tokenId === tokenId);
    if (forThis.length === 0) return;
    if (selThrow !== null) {
      const match = forThis.find((m) => m.throwIndex === selThrow);
      if (match) {
        onMove(match);
        setSelToken(null);
        setSelThrow(null);
        return;
      }
    }
    if (forThis.length === 1) {
      onMove(forThis[0]);
      setSelToken(null);
      setSelThrow(null);
      return;
    }
    setSelToken((prev) => (prev === tokenId ? null : tokenId));
    setSelThrow(null);
  }

  const groupsByPlayer: [Group[], Group[]] = [groupTokens(state.tokens[0]), groupTokens(state.tokens[1])];
  const onBoard = (g: Group) => g.pos !== "start" && g.pos !== "home";
  const movableRepIds = new Set(moveOptions.map((m) => m.tokenId));

  const phaseHint =
    state.status !== "ongoing"
      ? ""
      : state.throwsOwed > 0
        ? "윷을 던지세요"
        : state.pendingThrows.length > 0
          ? "던진 결과와 옮길 말을 선택하세요"
          : "";

  const youLabel = (p: PlayerIndex): string => (you === null ? (p === 0 ? "흑" : "백") : you === p ? "나" : "상대");

  return (
    <div className="yb-wrap">
      <div className="yb-status">
        {phaseHint && <p className="yb-hint">{phaseHint}</p>}
        {state.lastThrow && (
          <div className="yb-throwresult" aria-label={`던진 결과 ${state.lastThrow.label}`}>
            <div className="yb-sticks">
              {state.lastThrow.flats.map((flat, i) => (
                <span key={i} className={flat ? "yb-stick yb-stick--flat" : "yb-stick yb-stick--round"} />
              ))}
            </div>
            <strong className="yb-result-label">
              {state.lastThrow.label} ({state.lastThrow.value})
            </strong>
          </div>
        )}
      </div>

      <svg className="board-svg" viewBox={`0 0 ${VB} ${VB}`} role="group" aria-label="윷놀이 보드">
        <defs>
          <linearGradient id="yb-wood" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e8c08d" />
            <stop offset="45%" stopColor={WOOD} />
            <stop offset="100%" stopColor="#cf9c62" />
          </linearGradient>
          <radialGradient id="yb-tok-0" cx="35%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#5a6472" />
            <stop offset="16%" stopColor="#262b34" />
            <stop offset="55%" stopColor="#0c0e12" />
            <stop offset="100%" stopColor="#000000" />
          </radialGradient>
          <radialGradient id="yb-tok-1" cx="35%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="35%" stopColor="#f6f1e4" />
            <stop offset="72%" stopColor="#e2d7bd" />
            <stop offset="100%" stopColor="#c6b995" />
          </radialGradient>
        </defs>

        <rect x={0} y={0} width={VB} height={VB} rx={10} fill="url(#yb-wood)" />

        {/* the square path */}
        <polygon
          points={`${CORNER.BR.x},${CORNER.BR.y} ${CORNER.TR.x},${CORNER.TR.y} ${CORNER.TL.x},${CORNER.TL.y} ${CORNER.BL.x},${CORNER.BL.y}`}
          fill="none"
          stroke={INK}
          strokeWidth={2}
        />
        {/* the two diagonal shortcuts through the centre */}
        <line x1={CORNER.TR.x} y1={CORNER.TR.y} x2={CORNER.BL.x} y2={CORNER.BL.y} stroke={INK} strokeWidth={1.6} />
        <line x1={CORNER.TL.x} y1={CORNER.TL.y} x2={CORNER.BR.x} y2={CORNER.BR.y} stroke={INK} strokeWidth={1.6} />

        {STATIONS.map((s) => (
          <circle
            key={`st-${s.id}`}
            data-yut={`station-${s.id}`}
            cx={s.x}
            cy={s.y}
            r={s.center ? 6.5 : s.corner ? 6 : 3}
            fill={s.center ? "rgba(47,107,255,0.25)" : INK}
            stroke={s.center ? ACCENT : "none"}
            strokeWidth={s.center ? 1.5 : 0}
          />
        ))}
        <circle cx={CORNER.BR.x} cy={CORNER.BR.y} r={11} fill="none" stroke={ACCENT} strokeWidth={1.5} opacity={0.6} />

        {/* tokens */}
        {([0, 1] as PlayerIndex[]).map((owner) =>
          groupsByPlayer[owner].filter(onBoard).map((g) => {
            const { x, y } = pointFor(g.pos as YutTrackPos);
            const canPick = interactive && acting === owner && movableRepIds.has(g.repId);
            const picked = selToken === g.repId;
            return (
              <g key={`tok-${owner}-${g.repId}`}>
                <circle
                  data-yut={`token-${g.repId}`}
                  cx={x}
                  cy={y}
                  r={14}
                  className={canPick ? "board-hit board-hit--selectable" : "board-hit"}
                  fill={canPick ? "rgba(47,107,255,0.12)" : "transparent"}
                  style={{ cursor: canPick ? "pointer" : "default" }}
                  onClick={() => clickToken(g.repId)}
                />
                <circle cx={x + 1} cy={y + 2} r={9} fill="rgba(0,0,0,0.28)" pointerEvents="none" />
                <circle
                  cx={x}
                  cy={y}
                  r={9}
                  fill={`url(#yb-tok-${owner})`}
                  stroke={picked ? ACCENT : owner === 0 ? "#000000" : "#a89568"}
                  strokeWidth={picked ? 2.5 : 1}
                  pointerEvents="none"
                />
                {g.ids.length > 1 && (
                  <g pointerEvents="none">
                    <circle cx={x + 9} cy={y - 9} r={7} fill="white" stroke={INK} strokeWidth={1} />
                    <text x={x + 9} y={y - 9} fontSize={9} fontWeight={700} fill={INK} textAnchor="middle" dominantBaseline="central">
                      {g.ids.length}
                    </text>
                  </g>
                )}
              </g>
            );
          }),
        )}
      </svg>

      <div className="yb-controls">
        <button type="button" data-yut="throw" disabled={!interactive || !canThrow} onClick={fireThrow}>
          윷 던지기
        </button>
        {state.pendingThrows.length > 0 && (
          <div className="yb-pending">
            {state.pendingThrows.map((v, i) => {
              const legal = moveOptions.some((m) => m.throwIndex === i);
              return (
                <button
                  key={i}
                  type="button"
                  data-yut={`pending-${i}`}
                  className={selThrow === i ? "yb-chip yb-chip--selected" : "yb-chip"}
                  disabled={!interactive || !legal}
                  onClick={() => clickThrow(i)}
                >
                  {VALUE_LABEL[v]}({v})
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="yb-yards">
        {([0, 1] as PlayerIndex[]).map((p) => {
          const waiting = groupsByPlayer[p].find((g) => g.pos === "start");
          const finished = groupsByPlayer[p].find((g) => g.pos === "home");
          const waitingCount = waiting?.ids.length ?? 0;
          const finishedCount = finished?.ids.length ?? 0;
          const canEnter = interactive && acting === p && waiting !== undefined && movableRepIds.has(waiting.repId);
          return (
            <div className="yb-yard" key={p}>
              <span className="yb-yard-owner">
                <span className="yb-dot" style={{ background: PLAYER_COLOR[p], border: `1px solid ${INK}` }} />
                {youLabel(p)}
              </span>
              <button
                type="button"
                data-yut={`waiting-${p}`}
                className={canEnter ? "yb-chip yb-chip--waiting" : "yb-chip yb-chip--static"}
                disabled={!canEnter}
                onClick={() => waiting && clickToken(waiting.repId)}
              >
                대기 {waitingCount}
              </button>
              <span className="yb-chip yb-chip--static" data-yut={`finished-${p}`}>
                완주 {finishedCount}
              </span>
            </div>
          );
        })}
      </div>

      <style>{`
        .yb-wrap { width: 100%; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
        .yb-status { min-height: 1px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .yb-hint { margin: 0; font-size: 0.9rem; font-weight: 600; color: #52606d; text-align: center; }
        .yb-throwresult { display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .yb-sticks { display: flex; gap: 5px; }
        .yb-stick { width: 12px; height: 38px; border-radius: 6px; display: inline-block; }
        .yb-stick--flat { background: #f1dcb0; border: 1.5px solid #b98a45; }
        .yb-stick--round { background: #6b4a2c; border: 1.5px solid #3a2712; }
        .yb-result-label { font-size: 1.15rem; color: ${INK}; }
        .yb-controls { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .yb-pending { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
        .yb-chip {
          background: white; color: #323f4b; border: 1.5px solid #cbd2d9; border-radius: 999px;
          padding: 6px 12px; font-size: 0.85rem; font-weight: 700;
        }
        .yb-chip--selected { background: ${ACCENT}; color: white; border-color: ${ACCENT}; }
        .yb-chip--static { background: #e4e7eb; color: #323f4b; cursor: default; }
        .yb-chip--waiting { background: white; border-color: ${ACCENT}; color: ${ACCENT}; }
        .yb-chip:disabled { opacity: 0.55; cursor: not-allowed; }
        .yb-yards { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
        .yb-yard { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center; }
        .yb-yard-owner { display: flex; align-items: center; gap: 5px; font-size: 0.82rem; font-weight: 700; color: #52606d; }
        .yb-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
      `}</style>
    </div>
  );
}
