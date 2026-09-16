import { useMemo, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from "react";
import {
  FLICK_MAX,
  FLICK_SIZE,
  type FlickGrid,
  type FlickMove,
  type FlickPos,
  type FlickState,
  type PlayerIndex,
} from "@board-online/shared";
import type { GameViewProps } from "./types.js";

const SIZE = FLICK_SIZE;
const MAX_FLICK = FLICK_MAX;

const FRAME = 2;
const VB = SIZE + FRAME * 2;
/** Minimum drag/click distance (board units) that counts as a deliberate flick, filtering out taps. */
const MIN_DRAG = 0.8;

const PLAYER_COLORS: [string, string] = ["var(--bo-player-0)", "var(--bo-player-1)"];
const CREAM = "#f5f3ee";

function clampCell(v: number): number {
  return Math.min(SIZE - 1, Math.max(0, Math.floor(v)));
}

function ownerAt(grid: FlickGrid, p: FlickPos): PlayerIndex | null {
  return grid[clampCell(p.y)][clampCell(p.x)];
}

function clampVector(dx: number, dy: number, max: number): { dx: number; dy: number; power: number } {
  const mag = Math.hypot(dx, dy);
  if (mag <= max || mag === 0) return { dx, dy, power: mag };
  const s = max / mag;
  return { dx: dx * s, dy: dy * s, power: max };
}

function toSvg(p: FlickPos): { x: number; y: number } {
  return { x: p.x + FRAME, y: p.y + FRAME };
}

function polygonPoints(path: FlickPos[]): string {
  return path.map((p) => `${p.x + FRAME},${p.y + FRAME}`).join(" ");
}

/** One SVG path per owner, built from unit-square subpaths — far cheaper to render/diff
 *  than one <rect> per cell across a 48x48 grid. */
function territoryPathD(grid: FlickGrid, owner: PlayerIndex): string {
  let d = "";
  for (let y = 0; y < SIZE; y++) {
    const row = grid[y];
    for (let x = 0; x < SIZE; x++) {
      if (row[x] === owner) {
        d += `M${x + FRAME} ${y + FRAME}h1v1h-1Z`;
      }
    }
  }
  return d;
}

export default function FlickBoard({ state, onMove, interactive, you }: GameViewProps<FlickState, FlickMove>) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ dx: number; dy: number; power: number } | null>(null);

  const mover = state.turn;
  const moverColor = PLAYER_COLORS[mover];
  const restingIdx: PlayerIndex = mover === 0 ? 1 : 0;
  const activeStone = state.stones[mover];
  const restingStone = state.stones[restingIdx];
  const canPlay = interactive && state.status === "ongoing";

  const total = SIZE * SIZE;
  const { p0, p1 } = useMemo(() => {
    let c0 = 0;
    let c1 = 0;
    for (const row of state.grid) {
      for (const cell of row) {
        if (cell === 0) c0++;
        else if (cell === 1) c1++;
      }
    }
    return { p0: c0, p1: c1 };
  }, [state.grid]);
  const pct0 = (p0 / total) * 100;
  const pct1 = (p1 / total) * 100;

  const p0Path = useMemo(() => territoryPathD(state.grid, 0), [state.grid]);
  const p1Path = useMemo(() => territoryPathD(state.grid, 1), [state.grid]);

  function boardPointFromClient(clientX: number, clientY: number): FlickPos {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const scale = VB / rect.width;
    return { x: (clientX - rect.left) * scale - FRAME, y: (clientY - rect.top) * scale - FRAME };
  }

  function handleStonePointerDown(e: RPointerEvent<SVGCircleElement>) {
    if (!canPlay) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ dx: 0, dy: 0, power: 0 });
  }

  function handleStonePointerMove(e: RPointerEvent<SVGCircleElement>) {
    if (!canPlay || !drag) return;
    const p = boardPointFromClient(e.clientX, e.clientY);
    setDrag(clampVector(p.x - activeStone.x, p.y - activeStone.y, MAX_FLICK));
  }

  function handleStonePointerUp(e: RPointerEvent<SVGCircleElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!canPlay || !drag) {
      setDrag(null);
      return;
    }
    const { dx, dy, power } = drag;
    setDrag(null);
    if (power >= MIN_DRAG) onMove({ kind: "flick", dx, dy });
  }

  /** Click-to-aim: fires immediately toward the clicked point. Lives on a sibling of the
   *  stone (never an ancestor), so it never double-fires after a stone drag — a click whose
   *  target was the stone bubbles through the <svg>, not sideways into this rect. This is
   *  also what lets a test drive a flick with a plain click, no drag simulation required. */
  function handleAimClick(e: RMouseEvent<SVGRectElement>) {
    if (!canPlay) return;
    const p = boardPointFromClient(e.clientX, e.clientY);
    const { dx, dy, power } = clampVector(p.x - activeStone.x, p.y - activeStone.y, MAX_FLICK);
    if (power >= MIN_DRAG) onMove({ kind: "flick", dx, dy });
  }

  function handleGiveUp() {
    if (!canPlay) return;
    onMove({ kind: "giveup" });
  }

  const projected = drag ? { x: activeStone.x + drag.dx, y: activeStone.y + drag.dy } : null;
  const projectedOnBoard = projected ? projected.x >= 0 && projected.x <= SIZE && projected.y >= 0 && projected.y <= SIZE : false;
  const projectedOwner = projected && projectedOnBoard ? ownerAt(state.grid, projected) : null;
  const willClaim = projected !== null && projectedOnBoard && projectedOwner === mover;
  const previewPoints = drag && projected ? polygonPoints([...state.path, projected]) : "";
  const committedPoints = state.path.length >= 2 ? polygonPoints(state.path) : "";

  const powerRatio = drag ? drag.power / MAX_FLICK : 0;
  const RING_R = 3.4;
  const RING_C = 2 * Math.PI * RING_R;
  const svgA = toSvg(activeStone);
  const aimColor = !projectedOnBoard ? "#c0362c" : willClaim ? "#1f9d55" : moverColor;

  const p0Label = you === 0 ? "파랑 (나)" : "파랑";
  const p1Label = you === 1 ? "주황 (나)" : "주황";
  const pipStyle = { "--pip-color": moverColor } as CSSProperties;

  return (
    <div className="fb-wrap" data-flick="wrap">
      <div className="fb-stats">
        <div className={`fb-stat${mover === 0 ? " fb-stat--active" : ""}`}>
          <span className="fb-dot" style={{ background: PLAYER_COLORS[0] }} />
          {p0Label}
          <strong data-flick="area-0">{pct0.toFixed(1)}%</strong>
        </div>
        {state.status === "ongoing" && (
          <div className="fb-flicks" data-flick="flicks-left" aria-label={`남은 튕기기 ${state.flicksLeft}`}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={`fb-pip${n <= state.flicksLeft ? " fb-pip--on" : ""}`} style={pipStyle} />
            ))}
          </div>
        )}
        <div className={`fb-stat${mover === 1 ? " fb-stat--active" : ""}`}>
          <span className="fb-dot" style={{ background: PLAYER_COLORS[1] }} />
          {p1Label}
          <strong data-flick="area-1">{pct1.toFixed(1)}%</strong>
        </div>
      </div>

      {state.status === "ongoing" && state.reason && (
        <p className="fb-reason" key={state.round}>
          {state.reason}
        </p>
      )}

      <svg ref={svgRef} data-flick="board" className="board-svg fb-svg" viewBox={`0 0 ${VB} ${VB}`} role="img" aria-label="땅따먹기 보드">
        <defs>
          <linearGradient id="fb-frame" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a9763f" />
            <stop offset="100%" stopColor="#7d5227" />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={VB} height={VB} rx={2} fill="url(#fb-frame)" />
        <rect x={FRAME} y={FRAME} width={SIZE} height={SIZE} fill={CREAM} />
        <image href="/art/ash-wood.webp" x={FRAME} y={FRAME} width={SIZE} height={SIZE} opacity=".12" preserveAspectRatio="none" pointerEvents="none" />

        <path d={p0Path} fill={PLAYER_COLORS[0]} fillOpacity={0.82} pointerEvents="none" />
        <path d={p1Path} fill={PLAYER_COLORS[1]} fillOpacity={0.82} pointerEvents="none" />

        <rect
          data-flick="aim-surface"
          x={FRAME}
          y={FRAME}
          width={SIZE}
          height={SIZE}
          fill="transparent"
          style={{ cursor: canPlay ? "crosshair" : "default", touchAction: "none" }}
          onClick={handleAimClick}
        />

        {willClaim && previewPoints && (
          <polygon points={previewPoints} fill={moverColor} fillOpacity={0.28} stroke={moverColor} strokeWidth={0.3} pointerEvents="none" />
        )}

        {committedPoints && (
          <polyline
            points={committedPoints}
            fill="none"
            stroke={moverColor}
            strokeWidth={0.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {state.path.slice(1).map((p, i) => {
          const sp = toSvg(p);
          return <circle key={i} cx={sp.x} cy={sp.y} r={0.6} fill={moverColor} pointerEvents="none" />;
        })}

        {drag && projected && (
          <>
            <line
              x1={svgA.x}
              y1={svgA.y}
              x2={toSvg(projected).x}
              y2={toSvg(projected).y}
              stroke={aimColor}
              strokeWidth={0.4}
              strokeDasharray="1.4 1"
              pointerEvents="none"
            />
            <circle cx={toSvg(projected).x} cy={toSvg(projected).y} r={0.9} fill={aimColor} pointerEvents="none" />
            <circle
              cx={svgA.x}
              cy={svgA.y}
              r={RING_R}
              fill="none"
              stroke={aimColor}
              strokeWidth={0.5}
              strokeDasharray={`${RING_C * powerRatio} ${RING_C}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${svgA.x} ${svgA.y})`}
              pointerEvents="none"
            />
          </>
        )}

        {(() => {
          const rp = toSvg(restingStone);
          return (
            <circle
              data-flick={`stone-${restingIdx}`}
              cx={rp.x}
              cy={rp.y}
              r={1.3}
              fill={PLAYER_COLORS[restingIdx]}
              opacity={0.85}
              stroke="#00000030"
              strokeWidth={0.15}
              pointerEvents="none"
            />
          );
        })()}

        <circle
          data-flick="stone"
          cx={svgA.x}
          cy={svgA.y}
          r={1.5}
          fill={PLAYER_COLORS[mover]}
          stroke="#ffffff"
          strokeWidth={0.25}
          className={canPlay ? "fb-stone fb-stone--active" : "fb-stone"}
          style={{ cursor: canPlay ? "grab" : "default", touchAction: "none" }}
          onPointerDown={handleStonePointerDown}
          onPointerMove={handleStonePointerMove}
          onPointerUp={handleStonePointerUp}
          onPointerCancel={() => setDrag(null)}
        />
      </svg>

      <div className="fb-actions">
        <button type="button" className="fb-giveup" data-flick="giveup" disabled={!canPlay} onClick={handleGiveUp}>
          이번 차례 포기
        </button>
      </div>

      <style>{`
        .fb-wrap { width: 100%; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
        .fb-stats { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 0.85rem; color: var(--bo-ink-soft); font-weight: 600; }
        .fb-stat { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--bo-surface); border: 1px solid var(--bo-line); }
        .fb-stat--active { border-color: var(--bo-accent); box-shadow: 0 0 0 2px var(--bo-accent-wash); }
        .fb-stat strong { color: var(--bo-ink); font-size: 0.95rem; }
        .fb-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
        .fb-flicks { display: flex; gap: 5px; align-items: center; }
        .fb-pip { width: 10px; height: 10px; border-radius: 50%; background: var(--bo-sunk); border: 1.5px solid var(--bo-line-strong); display: inline-block; }
        .fb-pip--on { background: var(--pip-color, var(--bo-player-0)); border-color: transparent; }
        .fb-reason { margin: 0; text-align: center; font-size: 0.85rem; font-weight: 600; color: var(--bo-ink-faint); animation: fb-fade-in 220ms ease-out; }
        .fb-svg { width: 100%; height: auto; display: block; touch-action: none; }
        .fb-stone--active { animation: fb-pulse 1.6s ease-in-out infinite; }
        .fb-actions { display: flex; justify-content: center; }
        .fb-giveup { background: var(--bo-surface); border: 1px solid var(--bo-line); color: var(--bo-ink-soft); font-size: 0.82rem; min-height: var(--bo-control-h-sm); padding: 0 14px; }
        .fb-giveup:hover:not(:disabled) { background: var(--bo-sunk); border-color: var(--bo-line-strong); color: var(--bo-ink); }
        @keyframes fb-pulse { 0%, 100% { filter: drop-shadow(0 0 0 rgba(0,0,0,0)); } 50% { filter: drop-shadow(0 0 2px rgba(0,0,0,0.4)); } }
        @keyframes fb-fade-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .fb-stone--active, .fb-reason { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
