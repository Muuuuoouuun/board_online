import { useEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
// Types come from the engine so the renderer and the rules cannot drift.
import type { PlayerIndex, Pos, TerritoryMove, TerritoryState } from "@board-online/shared";
import type { GameViewProps } from "./types.js";

const CELL = 30;
const FRAME = 12;

const CREAM = "#f5f3ee";
const WOOD = "#dfb579";
const WOOD_LINE = "rgba(107, 74, 51, 0.32)";
const WOOD_EDGE = "#8a6234";
const P0_COLOR = "#2f6bff"; // player 0 — blue
const P0_DARK = "#1f52d1";
const P1_COLOR = "#e0563f"; // player 1 — warm red-orange
const P1_DARK = "#b8402c";
const PATH_ACCENT = "#ffd24c";

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function ownerFill(owner: PlayerIndex | null): string {
  if (owner === 0) return P0_COLOR;
  if (owner === 1) return P1_COLOR;
  return CREAM;
}

function moverColor(turn: PlayerIndex): string {
  return turn === 0 ? P0_COLOR : P1_COLOR;
}

export default function TerritoryBoard({ state, legalMoves, onMove, interactive, you }: GameViewProps<TerritoryState, TerritoryMove>) {
  const draggingRef = useRef(false);
  const lastCellRef = useRef<string | null>(null);

  useEffect(() => {
    function stop() {
      draggingRef.current = false;
      lastCellRef.current = null;
    }
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  const legalSet = useMemo(() => {
    const s = new Set<string>();
    for (const m of legalMoves) s.add(key(m.to.x, m.to.y));
    return s;
  }, [legalMoves]);

  const pathSet = useMemo(() => {
    const s = new Set<string>();
    for (const p of state.path) s.add(key(p.x, p.y));
    return s;
  }, [state.path]);

  const { count0, count1 } = useMemo(() => {
    let c0 = 0;
    let c1 = 0;
    for (const row of state.board) {
      for (const cell of row) {
        if (cell === 0) c0++;
        else if (cell === 1) c1++;
      }
    }
    return { count0: c0, count1: c1 };
  }, [state.board]);

  function tryMove(x: number, y: number) {
    const k = key(x, y);
    if (lastCellRef.current === k) return; // already the most recently attempted cell
    lastCellRef.current = k;
    if (!interactive || !legalSet.has(k)) return;
    onMove({ to: { x, y } });
  }

  function handleCellDown(x: number, y: number, e: ReactPointerEvent<SVGRectElement>) {
    if (!interactive) return;
    e.preventDefault();
    draggingRef.current = true;
    lastCellRef.current = null;
    tryMove(x, y);
  }

  // Drag continuation is hit-tested manually (rather than relying on per-cell
  // pointerenter) because touch pointers implicitly capture to the cell where
  // the drag started, so enter/leave events on *other* cells would never fire.
  function handleRootMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!draggingRef.current || !interactive) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const posAttr = el?.getAttribute("data-pos");
    if (!posAttr) return;
    const [xs, ys] = posAttr.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    tryMove(x, y);
  }

  const { width, height } = state;
  const innerW = width * CELL;
  const innerH = height * CELL;
  const boardW = innerW + FRAME * 2;
  const boardH = innerH + FRAME * 2;

  const cells: Pos[] = useMemo(() => {
    const out: Pos[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.push({ x, y });
    return out;
  }, [width, height]);

  const pathPoints = state.path
    .map((p) => `${FRAME + p.x * CELL + CELL / 2},${FRAME + p.y * CELL + CELL / 2}`)
    .join(" ");
  const mover = moverColor(state.turn);

  return (
    <div className="terr-board-root">
      <style>{`
        .terr-board-root { width: 100%; display: flex; flex-direction: column; gap: 10px; align-items: center; }
        .terr-score-row { display: flex; gap: 10px; width: 100%; max-width: 480px; }
        .terr-score {
          flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; border-radius: 10px; background: var(--bo-surface);
          border: 1px solid var(--bo-line); font-weight: 700; font-size: 0.85rem; color: var(--bo-ink);
        }
        .terr-score--you { box-shadow: 0 0 0 2px currentColor inset; }
        .terr-score-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; background: currentColor; }
        .terr-score-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .terr-score-count { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 1.05rem; flex-shrink: 0; }
        .terr-svg-wrap { width: 100%; max-width: 480px; }
        .terr-svg { width: 100%; height: auto; display: block; touch-action: none; }
        .terr-legal-ring { animation: terr-pulse 1.1s ease-in-out infinite; }
        @keyframes terr-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.95; } }
        @media (prefers-reduced-motion: reduce) {
          .terr-legal-ring { animation: none; opacity: 0.75; }
        }
      `}</style>

      <div className="terr-score-row">
        <div className={`terr-score${you === 0 ? " terr-score--you" : ""}`} style={{ color: P0_DARK }}>
          <span className="terr-score-dot" />
          <span className="terr-score-label">파랑{you === 0 ? " (나)" : ""}</span>
          <span className="terr-score-count">{count0}</span>
        </div>
        <div className={`terr-score${you === 1 ? " terr-score--you" : ""}`} style={{ color: P1_DARK }}>
          <span className="terr-score-dot" />
          <span className="terr-score-label">빨강{you === 1 ? " (나)" : ""}</span>
          <span className="terr-score-count">{count1}</span>
        </div>
      </div>

      <div className="terr-svg-wrap">
        <svg
          className="terr-svg"
          viewBox={`0 0 ${boardW} ${boardH}`}
          role="group"
          aria-label="땅따먹기 보드"
          onPointerMove={handleRootMove}
        >
          <rect x={0} y={0} width={boardW} height={boardH} rx={8} fill={WOOD} pointerEvents="none" />
          <image href="/art/ash-wood.webp" x={0} y={0} width={boardW} height={boardH} opacity=".35" preserveAspectRatio="none" pointerEvents="none" />
          <rect
            x={FRAME - 2}
            y={FRAME - 2}
            width={innerW + 4}
            height={innerH + 4}
            rx={3}
            fill={WOOD_EDGE}
            opacity={0.35}
            pointerEvents="none"
          />

          {/* cells: fill = owner (or in-progress-path tint); also the interactive hit target */}
          {cells.map(({ x, y }) => {
            const owner = state.board[y][x];
            const inPath = pathSet.has(key(x, y));
            const legal = interactive && legalSet.has(key(x, y));
            const cx = FRAME + x * CELL;
            const cy = FRAME + y * CELL;
            return (
              <rect
                key={`cell-${x}-${y}`}
                data-pos={`${x},${y}`}
                x={cx}
                y={cy}
                width={CELL}
                height={CELL}
                fill={inPath ? mover : ownerFill(owner)}
                fillOpacity={inPath ? 0.55 : 1}
                stroke={WOOD_LINE}
                strokeWidth={1}
                style={{ cursor: legal ? "pointer" : "default" }}
                onPointerDown={(e) => handleCellDown(x, y, e)}
              />
            );
          })}

          {/* in-progress path: a visible drawn line plus a dot on every cell it covers */}
          {state.path.length > 1 && (
            <polyline
              points={pathPoints}
              fill="none"
              stroke={PATH_ACCENT}
              strokeWidth={CELL * 0.16}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
              pointerEvents="none"
            />
          )}
          {state.path.map((p) => (
            <circle
              key={`path-dot-${p.x}-${p.y}`}
              cx={FRAME + p.x * CELL + CELL / 2}
              cy={FRAME + p.y * CELL + CELL / 2}
              r={CELL * 0.12}
              fill={PATH_ACCENT}
              pointerEvents="none"
            />
          ))}

          {/* legal next cells */}
          {interactive &&
            legalMoves.map((m) => (
              <circle
                key={`legal-${m.to.x}-${m.to.y}`}
                className="terr-legal-ring"
                cx={FRAME + m.to.x * CELL + CELL / 2}
                cy={FRAME + m.to.y * CELL + CELL / 2}
                r={CELL * 0.24}
                fill="none"
                stroke={mover}
                strokeWidth={CELL * 0.09}
                pointerEvents="none"
              />
            ))}
        </svg>
      </div>
    </div>
  );
}
