import { useEffect, useMemo, useState } from "react";
// Board geometry comes from the engine so the renderer and the rules cannot drift.
import {
  GONU_LINES,
  POINT_IDS,
  POINTS,
  posEq,
  type GonuState,
  type Move,
  type PointId,
  type Pos,
} from "@board-online/shared";
import type { GameViewProps } from "./types.js";
import { playSound } from "../../lib/sound.js";
import PieceArt, { PieceDefs } from "../PieceArt.js";

const CELL = 100;
const FRAME = 60;
const PAD = 14;
const SIZE = FRAME * 2 + CELL * 2;

function toPx(p: Pos): { cx: number; cy: number } {
  return { cx: FRAME + p.x * CELL, cy: FRAME + p.y * CELL };
}

function posKey(p: Pos): string {
  return `${p.x},${p.y}`;
}

const POINT_LABELS: Record<PointId, string> = {
  TL: "왼쪽 위", TR: "오른쪽 위", BR: "오른쪽 아래", BL: "왼쪽 아래", C: "가운데",
};

/** Lobby preview uses the engine's geometry and actual opening position. */
export function GonuPreview() {
  return <svg viewBox="0 0 400 200" width="100%" height="100%" aria-hidden="true">
    <image href="/art/ash-wood.webp" width="400" height="200" preserveAspectRatio="xMidYMid slice" />
    <g transform="translate(130 30) scale(.7)" stroke="#614d31" strokeWidth="3" strokeLinecap="round">
      {GONU_LINES.map((line, i) => <line key={i} x1={line.x1 * 100} y1={line.y1 * 100} x2={line.x2 * 100} y2={line.y2 * 100} />)}
      <circle cx="100" cy="100" r="3" fill="#614d31" />
      {[0,200].map(x => <g key={x}>
        <circle cx={x+2} cy="3" r="24" fill="#5d4b30" opacity=".2" stroke="none" />
        <circle cx={x} cy="0" r="24" fill="#fff9e9" stroke="#c1b18f" strokeWidth="1.5" />
        <circle cx={x+2} cy="203" r="24" fill="#5d4b30" opacity=".2" stroke="none" />
        <circle cx={x} cy="200" r="24" fill="#30372b" stroke="#172015" strokeWidth="1.5" />
      </g>)}
    </g>
    <text x="130" y="102" textAnchor="middle" fill="#715e43" fontSize="12" fontFamily="'Noto Serif KR', serif">우물</text>
  </svg>;
}

export default function GonuBoard(props: GameViewProps<GonuState, Move>) {
  const { state, legalMoves, onMove, interactive } = props;
  const [selected, setSelected] = useState<Pos | null>(null);

  // A board update (our own confirmed move, the opponent's move, or a resync)
  // invalidates any pending selection.
  useEffect(() => {
    setSelected(null);
  }, [state]);

  const selectablePieces: Pos[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Pos[] = [];
    for (const m of legalMoves) {
      if (!m.from) continue;
      const key = posKey(m.from);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m.from);
      }
    }
    return out;
  }, [legalMoves]);

  const destinations: Pos[] = useMemo(() => {
    if (!selected) return [];
    return legalMoves.filter((m) => m.from && posEq(m.from, selected)).map((m) => m.to);
  }, [legalMoves, selected]);

  const destinationKeys = useMemo(() => new Set(destinations.map(posKey)), [destinations]);

  function handlePointClick(pos: Pos) {
    if (!interactive) return;
    if (selected) {
      if (posEq(selected, pos)) {
        setSelected(null);
        return;
      }
      const move = legalMoves.find((m) => m.from && posEq(m.from, selected) && posEq(m.to, pos));
      if (move) {
        playSound("move");
        onMove(move);
        setSelected(null);
        return;
      }
      const canSelect = selectablePieces.some((p) => posEq(p, pos));
      setSelected(canSelect ? pos : null);
      if (canSelect) playSound("click");
    } else {
      const canSelect = selectablePieces.some((p) => posEq(p, pos));
      if (canSelect) {
        setSelected(pos);
        playSound("click");
      }
    }
  }

  const stones = POINT_IDS.map((id) => ({ id, pos: POINTS[id], owner: state.board[id] })).filter(
    (s): s is { id: PointId; pos: Pos; owner: 0 | 1 } => s.owner !== null,
  );

  return (
    <svg className="board-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label="고누 보드">
        <PieceDefs />
        <rect width={SIZE} height={SIZE} rx={12} fill="#997c53" />
        <rect x={3} y={3} width={SIZE-6} height={SIZE-6} rx={10} fill="#d7bb8d" stroke="#eddbb5" />
        <rect x={PAD} y={PAD} width={SIZE - PAD * 2} height={SIZE - PAD * 2} rx={5} fill="#dfc397" />
        <image href="/art/ash-wood.webp" x={PAD} y={PAD} width={SIZE - PAD * 2} height={SIZE - PAD * 2} preserveAspectRatio="none" pointerEvents="none" />
        <rect x={PAD} y={PAD} width={SIZE - PAD * 2} height={SIZE - PAD * 2} rx={5} fill="none" stroke="#917249" strokeOpacity=".45" />
        {GONU_LINES.map((line, i) => {
          const a = toPx({ x: line.x1, y: line.y1 });
          const b = toPx({ x: line.x2, y: line.y2 });
          return <line key={i} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} stroke="#604c30" strokeWidth={2.6} strokeLinecap="round" />;
        })}
        <g pointerEvents="none" fill="#756347" textAnchor="middle">
          <text x={FRAME} y={SIZE/2 - 3} fontFamily="'Noto Serif KR', serif" fontSize="15">우물</text>
          <text x={FRAME} y={SIZE/2 + 15} fontSize="8.5" letterSpacing="1">건널 수 없어요</text>
        </g>

        {POINT_IDS.map((id) => {
          const { cx, cy } = toPx(POINTS[id]);
          return <circle key={`dot-${id}`} cx={cx} cy={cy} r={3.5} fill="#3a2f28" />;
        })}

        {/* click targets */}
        {POINT_IDS.map((id) => {
          const pos = POINTS[id];
          const { cx, cy } = toPx(pos);
          const key = posKey(pos);
          const legal = interactive && destinationKeys.has(key);
          const canSelect = interactive && selectablePieces.some((p) => posKey(p) === key);
          const selectable = canSelect && !selected;
          const classes = ["board-hit"];
          if (legal) classes.push("board-hit--legal");
          if (selectable) classes.push("board-hit--selectable");
          return (
            <circle
              key={`hit-${id}`}
              data-pos={key}
              role="button"
              aria-label={`${POINT_LABELS[id]}${state.board[id] === null ? " 빈 자리" : state.board[id] === 0 ? " 흑돌" : " 백돌"}${legal ? ", 이동 가능" : selectable ? ", 선택 가능" : ""}`}
              aria-disabled={!legal && !canSelect}
              aria-pressed={state.board[id] !== null ? !!selected && posEq(selected, pos) : undefined}
              tabIndex={legal || canSelect ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handlePointClick(pos);
                }
              }}
              className={classes.join(" ")}
              cx={cx}
              cy={cy}
              r={CELL * 0.42}
              fill="transparent"
              onClick={() => handlePointClick(pos)}
              style={{ cursor: legal || canSelect ? "pointer" : "default" }}
            />
          );
        })}

        {/* legal destination dots */}
        {interactive &&
          destinations.map((d, i) => {
            const { cx, cy } = toPx(d);
            return <circle key={`dest-${i}`} className="board-dest" cx={cx} cy={cy} r={CELL * 0.13} />;
          })}

        {/* selectable-piece hint rings */}
        {interactive &&
          !selected &&
          selectablePieces.map((p, i) => {
            const { cx, cy } = toPx(p);
            return <circle key={`sel-hint-${i}`} className="board-selectable" cx={cx} cy={cy} r={CELL * 0.3} />;
          })}

        {selected &&
          (() => {
            const { cx, cy } = toPx(selected);
            return <circle className="board-selected" cx={cx} cy={cy} r={CELL * 0.3} />;
          })()}

        {/* stones */}
        {stones.map(({ id, pos, owner }) => {
          const { cx, cy } = toPx(pos);
          return <PieceArt key={id} game="gonu" owner={owner} glyph="" cx={cx} cy={cy} size={60} />;
        })}
        {state.status === "win" && <g className="board-feedback board-feedback--win" pointerEvents="none" aria-label="승리한 돌">
          {stones.filter(stone => stone.owner === state.winner).map(({ id, pos }) => {
            const { cx, cy } = toPx(pos);
            return <circle key={id} className="board-feedback-ring" cx={cx} cy={cy} r={30} />;
          })}
        </g>}
    </svg>
  );
}
