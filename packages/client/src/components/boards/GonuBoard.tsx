import { useEffect, useMemo, useState } from "react";
// Board geometry comes from the engine so the renderer and the rules cannot drift.
import {
  EDGES,
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

const CELL = 96;
const FRAME = 44;
const PAD = 14;
const SIZE = FRAME * 2 + CELL * 2;

function toPx(p: Pos): { cx: number; cy: number } {
  return { cx: FRAME + p.x * CELL, cy: FRAME + p.y * CELL };
}

function posKey(p: Pos): string {
  return `${p.x},${p.y}`;
}

/** Each undirected edge once, as board-coordinate endpoints, for drawing. */
const LINE_SEGMENTS: { a: Pos; b: Pos }[] = (() => {
  const seen = new Set<string>();
  const out: { a: Pos; b: Pos }[] = [];
  for (const id of POINT_IDS) {
    for (const n of EDGES[id]) {
      const key = [id, n].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: POINTS[id], b: POINTS[n] });
    }
  }
  return out;
})();

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
        <defs>
          <radialGradient id="gonu-stone-dark" cx="35%" cy="28%" r="75%">
            <stop offset="0%" stopColor="#5a6472" />
            <stop offset="16%" stopColor="#262b34" />
            <stop offset="55%" stopColor="#0c0e12" />
            <stop offset="100%" stopColor="#000000" />
          </radialGradient>
          <radialGradient id="gonu-stone-light" cx="35%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="35%" stopColor="#f6f1e4" />
            <stop offset="72%" stopColor="#e2d7bd" />
            <stop offset="100%" stopColor="#c6b995" />
          </radialGradient>
        </defs>

        <rect x={0} y={0} width={SIZE} height={SIZE} rx={10} fill="#8a6234" />
        <rect x={PAD} y={PAD} width={SIZE - PAD * 2} height={SIZE - PAD * 2} rx={6} fill="#dfb579" />

        {/*
          The left side has no line: that gap is the 우물 (well), which stones may
          never cross. It is left unlabelled because the rotated caption did not fit
          the frame; the rules modal explains it.
        */}
        {LINE_SEGMENTS.map(({ a, b }, i) => {
          const pa = toPx(a);
          const pb = toPx(b);
          return (
            <line
              key={`edge-${i}`}
              x1={pa.cx}
              y1={pa.cy}
              x2={pb.cx}
              y2={pb.cy}
              stroke="#3a2f28"
              strokeWidth={4}
              strokeLinecap="round"
            />
          );
        })}

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
          const selectable = interactive && !selected && selectablePieces.some((p) => posKey(p) === key);
          const classes = ["board-hit"];
          if (legal) classes.push("board-hit--legal");
          if (selectable) classes.push("board-hit--selectable");
          return (
            <circle
              key={`hit-${id}`}
              data-pos={key}
              className={classes.join(" ")}
              cx={cx}
              cy={cy}
              r={CELL * 0.42}
              fill="transparent"
              onClick={() => handlePointClick(pos)}
              style={{ cursor: interactive ? "pointer" : "default" }}
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
          const r = CELL * 0.24;
          return (
            <g key={`stone-${id}`} pointerEvents="none">
              <circle cx={cx + 1.5} cy={cy + 2.5} r={r} fill="rgba(0,0,0,0.28)" />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={owner === 0 ? "url(#gonu-stone-dark)" : "url(#gonu-stone-light)"}
                stroke={owner === 0 ? "#000000" : "#a89568"}
                strokeWidth={1}
              />
            </g>
          );
        })}
    </svg>
  );
}
