import { useEffect, useMemo, useState } from "react";
// Board geometry comes from the engine so the renderer and the rules cannot drift.
import {
  getGonuLayout,
  posEq,
  type GonuArc,
  type GonuLayout,
  type GonuState,
  type Move,
  type Pos,
} from "@board-online/shared";
import type { GameViewProps } from "./types.js";
import { playSound } from "../../lib/sound.js";

/** Every board is drawn into a square of this many pixels, whatever its extent. */
const CANVAS = 440;
const FRAME = 16;

interface Geometry {
  cell: number;
  offsetX: number;
  offsetY: number;
  /** Shortest distance in px between two joined points. */
  pitch: number;
  /** Stone radius, ~0.44 of the closest point spacing so the lines stay visible. */
  stone: number;
}

function geometryOf(layout: GonuLayout): Geometry {
  const { margin } = layout;
  const spanX = margin.left + layout.width + margin.right;
  const spanY = margin.top + layout.height + margin.bottom;
  const span = Math.max(spanX, spanY);
  const cell = (CANVAS - FRAME * 2) / span;

  let pitch = Infinity;
  for (let i = 0; i < layout.points.length; i++) {
    for (const j of layout.adj[i]) {
      const a = layout.points[i];
      const b = layout.points[j];
      pitch = Math.min(pitch, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }

  const pitchPx = (pitch === Infinity ? 1 : pitch) * cell;
  return {
    cell,
    // Centre the drawing inside the square canvas.
    offsetX: FRAME + ((span - spanX) / 2 + margin.left) * cell,
    offsetY: FRAME + ((span - spanY) / 2 + margin.top) * cell,
    pitch: pitchPx,
    stone: pitchPx * 0.22,
  };
}

function toPx(g: Geometry, p: Pos): { cx: number; cy: number } {
  return { cx: g.offsetX + p.x * g.cell, cy: g.offsetY + p.y * g.cell };
}

function posKey(p: Pos): string {
  return `${p.x},${p.y}`;
}

/** An arc of the board ring, as an SVG path. Angles sweep clockwise on screen. */
function arcPath(g: Geometry, arc: GonuArc): string {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const at = (deg: number) =>
    toPx(g, { x: arc.cx + arc.r * Math.cos(rad(deg)), y: arc.cy + arc.r * Math.sin(rad(deg)) });
  const start = at(arc.from);
  const end = at(arc.to);
  const r = arc.r * g.cell;
  const large = Math.abs(arc.to - arc.from) > 180 ? 1 : 0;
  return `M ${start.cx} ${start.cy} A ${r} ${r} 0 ${large} 1 ${end.cx} ${end.cy}`;
}

export default function GonuBoard(props: GameViewProps<GonuState, Move>) {
  const { state, legalMoves, onMove, interactive } = props;
  const [selected, setSelected] = useState<Pos | null>(null);

  const layout = useMemo(() => getGonuLayout(state.variant), [state.variant]);
  const geo = useMemo(() => geometryOf(layout), [layout]);

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

  /** Destinations for the selected stone, flagged when the move takes a stone. */
  const destinations = useMemo(() => {
    if (!selected) return [] as { pos: Pos; captures: boolean }[];
    const before = state.cells.filter((c) => c !== null && c !== state.turn).length;
    return legalMoves
      .filter((m) => m.from && posEq(m.from, selected))
      .map((m) => {
        let captures = false;
        if (layout.capture) {
          const preview = survivingFoes(state, m);
          captures = preview !== null && preview < before;
        }
        return { pos: m.to, captures };
      });
  }, [legalMoves, selected, state, layout]);

  const destinationKeys = useMemo(
    () => new Map(destinations.map((d) => [posKey(d.pos), d.captures])),
    [destinations],
  );

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
    }
    const canSelect = selectablePieces.some((p) => posEq(p, pos));
    setSelected(canSelect ? pos : null);
    if (canSelect) playSound("click");
  }

  const stones = layout.points
    .map((pos, index) => ({ index, pos, owner: state.cells[index] }))
    .filter((s): s is { index: number; pos: Pos; owner: 0 | 1 } => s.owner === 0 || s.owner === 1);

  // 우물고누: the opening tradition forbids, marked so nobody wonders why that
  // stone will not pick up.
  const bannedOpening =
    layout.bannedOpening && state.plies === 0 && state.status === "ongoing" ? layout.bannedOpening : null;

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${CANVAS} ${CANVAS}`}
      role="group"
      aria-label={`${layout.nameKo} 보드`}
    >
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

      <rect x={0} y={0} width={CANVAS} height={CANVAS} rx={10} fill="#8a6234" />
      <rect x={7} y={7} width={CANVAS - 14} height={CANVAS - 14} rx={6} fill="#dfb579" />

      <g stroke="#3a2f28" strokeWidth={3.2} strokeLinecap="round" fill="none">
        {layout.arcs.map((arc, i) =>
          arc.to - arc.from >= 360 ? (
            <circle
              key={`arc-${i}`}
              cx={toPx(geo, { x: arc.cx, y: arc.cy }).cx}
              cy={toPx(geo, { x: arc.cx, y: arc.cy }).cy}
              r={arc.r * geo.cell}
            />
          ) : (
            <path key={`arc-${i}`} d={arcPath(geo, arc)} />
          ),
        )}
        {layout.strokes.map(([a, b], i) => {
          const pa = toPx(geo, layout.points[a]);
          const pb = toPx(geo, layout.points[b]);
          return <line key={`stroke-${i}`} x1={pa.cx} y1={pa.cy} x2={pb.cx} y2={pb.cy} />;
        })}
      </g>

      {/* 우물 gap, 진영 captions — painted on the board the way they were chalked on. */}
      {layout.labels.map((label, i) => {
        const { cx, cy } = toPx(geo, label.pos);
        return (
          <text
            key={`label-${i}`}
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.max(13, geo.cell * 0.19)}
            fill="#6b5338"
            fontWeight={700}
            letterSpacing="0.05em"
          >
            {label.text}
          </text>
        );
      })}

      {layout.points.map((pos, i) => {
        const { cx, cy } = toPx(geo, pos);
        return <circle key={`dot-${i}`} cx={cx} cy={cy} r={3.4} fill="#3a2f28" />;
      })}

      {/* last move */}
      {state.last && (
        <circle
          className="board-lastmove"
          cx={toPx(geo, layout.points[state.last.to]).cx}
          cy={toPx(geo, layout.points[state.last.to]).cy}
          r={geo.stone * 1.45}
        />
      )}

      {/* click targets */}
      {layout.points.map((pos, i) => {
        const { cx, cy } = toPx(geo, pos);
        const key = posKey(pos);
        const legal = interactive && destinationKeys.has(key);
        const selectable = interactive && !selected && selectablePieces.some((p) => posKey(p) === key);
        const classes = ["board-hit"];
        if (legal) classes.push("board-hit--legal");
        if (selectable) classes.push("board-hit--selectable");
        return (
          <circle
            key={`hit-${i}`}
            data-pos={key}
            className={classes.join(" ")}
            cx={cx}
            cy={cy}
            r={geo.pitch * 0.45}
            fill="transparent"
            onClick={() => handlePointClick(pos)}
            style={{ cursor: interactive ? "pointer" : "default" }}
          />
        );
      })}

      {/* legal destinations */}
      {interactive &&
        destinations.map((d, i) => {
          const { cx, cy } = toPx(geo, d.pos);
          return (
            <circle
              key={`dest-${i}`}
              className={d.captures ? "board-dest board-dest--capture" : "board-dest"}
              cx={cx}
              cy={cy}
              r={d.captures ? geo.stone * 1.2 : geo.stone * 0.42}
            />
          );
        })}

      {/* selectable-stone hints */}
      {interactive &&
        !selected &&
        selectablePieces.map((p, i) => {
          const { cx, cy } = toPx(geo, p);
          return (
            <circle
              key={`sel-hint-${i}`}
              className="board-selectable"
              cx={cx}
              cy={cy}
              r={geo.stone * 1.3}
            />
          );
        })}

      {selected &&
        (() => {
          const { cx, cy } = toPx(geo, selected);
          return <circle className="board-selected" cx={cx} cy={cy} r={geo.stone * 1.3} />;
        })()}

      {/* stones */}
      {stones.map(({ index, pos, owner }) => {
        const { cx, cy } = toPx(geo, pos);
        const r = geo.stone;
        return (
          <g key={`stone-${index}`} pointerEvents="none">
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

      {bannedOpening &&
        (() => {
          const from = toPx(geo, layout.points[bannedOpening.from]);
          const to = toPx(geo, layout.points[bannedOpening.to]);
          const mx = (from.cx + to.cx) / 2;
          const my = (from.cy + to.cy) / 2;
          const arm = geo.stone * 0.42;
          // Push the caption off the line, away from the middle of the board,
          // so it never lands on a stone.
          const len = Math.hypot(to.cx - from.cx, to.cy - from.cy) || 1;
          const nx = -(to.cy - from.cy) / len;
          const ny = (to.cx - from.cx) / len;
          const centre = toPx(geo, { x: layout.width / 2, y: layout.height / 2 });
          const away = (mx + nx - centre.cx) ** 2 + (my + ny - centre.cy) ** 2 >
            (mx - nx - centre.cx) ** 2 + (my - ny - centre.cy) ** 2 ? 1 : -1;
          const offset = geo.stone * 1.5 * away;
          return (
            <g pointerEvents="none">
              <line
                x1={from.cx}
                y1={from.cy}
                x2={to.cx}
                y2={to.cy}
                stroke="#b3261e"
                strokeWidth={2.5}
                strokeDasharray="7 6"
                opacity={0.6}
              />
              <g stroke="#b3261e" strokeWidth={3} strokeLinecap="round" opacity={0.9}>
                <line x1={mx - arm} y1={my - arm} x2={mx + arm} y2={my + arm} />
                <line x1={mx + arm} y1={my - arm} x2={mx - arm} y2={my + arm} />
              </g>
              <text
                x={mx + nx * offset}
                y={my + ny * offset}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(12, geo.cell * 0.15)}
                fill="#b3261e"
                fontWeight={700}
              >
                첫수 금지
              </text>
            </g>
          );
        })()}
    </svg>
  );
}

/**
 * How many enemy stones would survive this move. Used only to paint 넉줄고누
 * capture targets red; the engine stays the authority on what a move does.
 */
function survivingFoes(state: GonuState, move: Move): number | null {
  const layout = getGonuLayout(state.variant);
  const index = (p: Pos) => layout.points.findIndex((pt) => posEq(pt, p));
  const from = index(move.from!);
  const to = index(move.to);
  if (from < 0 || to < 0) return null;

  const cells = [...state.cells];
  const player = state.turn;
  const foe = player === 0 ? 1 : 0;
  cells[from] = null;
  cells[to] = player;

  const at = (i: number, dx: number, dy: number) => {
    const pt = layout.points[i];
    return layout.points.findIndex((q) => q.x === pt.x + dx && q.y === pt.y + dy);
  };
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const victim = at(to, dx, dy);
    if (victim < 0 || cells[victim] !== foe) continue;
    const behind = at(victim, dx, dy);
    const vp = layout.points[victim];
    const corner = (vp.x === 0 || vp.x === layout.width) && (vp.y === 0 || vp.y === layout.height);
    if ((behind >= 0 && cells[behind] === player) || (corner && layout.adj[victim].every((n) => cells[n] === player))) {
      cells[victim] = null;
    }
  }
  return cells.filter((c) => c === foe).length;
}
