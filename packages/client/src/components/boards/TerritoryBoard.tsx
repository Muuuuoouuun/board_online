import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
// Types and rules come from the engine so the renderer and the rules cannot drift.
import {
  TERRITORY_MAX_LINE,
  territoryCanExtend,
  territoryCanStart,
  territoryLineErrorText,
  territoryPreview,
  type PlayerIndex,
  type Pos,
  type TerritoryMove,
  type TerritoryState,
} from "@board-online/shared";
import { playSound } from "../../lib/sound.js";
import type { GameViewProps } from "./types.js";

const CELL = 30;
const FRAME = 16;

const CREAM = "#f5f3ee";
const WOOD = "#dfb579";
const GRID_LINE = "rgba(107, 74, 51, 0.22)";
const WOOD_EDGE = "#8a6234";
const P0_COLOR = "#2f6bff"; // player 0 — blue
const P0_DARK = "#1f52d1";
const P1_COLOR = "#e0563f"; // player 1 — warm red-orange
const P1_DARK = "#b8402c";
const BAD_COLOR = "#c0362c";

/** How far (in cell widths) the pointer may sit from a corner and still snap to it. */
const SNAP = 0.75;

function key(p: Pos): string {
  return `${p.x},${p.y}`;
}

function samePos(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

function colorOf(player: PlayerIndex): string {
  return player === 0 ? P0_COLOR : P1_COLOR;
}

export default function TerritoryBoard({
  state,
  onMove,
  interactive,
  you,
}: GameViewProps<TerritoryState, TerritoryMove>) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** The stroke being drawn, as lattice corners. Kept local: only a finished stroke is a move. */
  const [line, setLine] = useState<Pos[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const lineRef = useRef(line);
  lineRef.current = line;

  const { width, height, turn } = state;
  const mover = turn;
  const moverColor = colorOf(mover);
  const canPlay = interactive && state.status === "ongoing";
  /** Whose stroke this is. In pass-and-play `you` is null, so it is simply whoever is to move. */
  const drawer: PlayerIndex = you ?? mover;

  // Someone else's move landed (or the game ended): whatever was half-drawn is
  // no longer about this board, so drop it rather than leave a stale line.
  const boardKey = `${state.turn}:${state.status}:${state.lastGain.length}:${state.lastBy}`;
  useEffect(() => {
    setLine([]);
    setDrawing(false);
    setHint(null);
  }, [boardKey]);

  const preview = useMemo(
    () => (line.length > 1 ? territoryPreview(state, drawer, line) : { error: null, gain: [] as Pos[] }),
    [state, drawer, line],
  );
  const lastGainSet = useMemo(() => new Set(state.lastGain.map(key)), [state.lastGain]);

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

  /** Pointer position in lattice coordinates (corner (0,0) is the board's top-left corner). */
  function latticeFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    const scale = (width * CELL + FRAME * 2) / rect.width;
    return {
      x: ((clientX - rect.left) * scale - FRAME) / CELL,
      y: ((clientY - rect.top) * scale - FRAME) / CELL,
    };
  }

  /** Nearest lattice corner, or null when the pointer is too far from any of them. */
  function cornerFromClient(clientX: number, clientY: number): Pos | null {
    const p = latticeFromClient(clientX, clientY);
    if (!p) return null;
    const v = { x: Math.round(p.x), y: Math.round(p.y) };
    if (v.x < 0 || v.x > width || v.y < 0 || v.y > height) return null;
    if (Math.abs(p.x - v.x) > SNAP || Math.abs(p.y - v.y) > SNAP) return null;
    return v;
  }

  /** Plays the stroke if it is a legal one, or says why it is not. */
  function submit(candidate: Pos[]) {
    const { error } = territoryPreview(state, drawer, candidate);
    if (error) {
      setHint(territoryLineErrorText(error));
      return;
    }
    playSound("capture");
    onMove({ line: candidate });
    setLine([]);
    setHint(null);
  }

  /**
   * Walks the stroke towards `target` one corner at a time.
   *
   * A pointer only reports a handful of positions per second, so a quick drag
   * skips corners; stepping along the lattice between samples is what makes the
   * line follow the finger instead of jumping. Stepping back onto the previous
   * corner rubs that segment out again, which is how you undo mid-stroke.
   */
  function extendTowards(target: Pos) {
    let current = lineRef.current;
    if (current.length === 0) return;
    let moved = false;
    let blocked = false;

    for (let guard = 0; guard < TERRITORY_MAX_LINE * 2 + 2; guard++) {
      const head = current[current.length - 1];
      if (samePos(head, target)) break;

      // Dragging back over the line rubs it out as far as you go.
      const at = current.findIndex((v) => samePos(v, target));
      if (at >= 0) {
        current = current.slice(0, at + 1);
        moved = true;
        break;
      }

      const dx = Math.sign(target.x - head.x);
      const dy = Math.sign(target.y - head.y);
      // Close the bigger gap first so the line tracks the drag's direction.
      const steps =
        Math.abs(target.x - head.x) >= Math.abs(target.y - head.y)
          ? [
              { x: head.x + dx, y: head.y },
              { x: head.x, y: head.y + dy },
            ]
          : [
              { x: head.x, y: head.y + dy },
              { x: head.x + dx, y: head.y },
            ];

      const step = steps.find((s) => !samePos(s, head) && territoryCanExtend(state, drawer, current, s));
      if (!step) {
        blocked = true;
        break;
      }
      current = [...current, step];
      moved = true;
    }

    if (moved) {
      setLine(current);
      lineRef.current = current;
      setHint(null);
    } else if (blocked && current.length - 1 >= TERRITORY_MAX_LINE) {
      setHint(`선은 ${TERRITORY_MAX_LINE}칸까지만 그을 수 있습니다.`);
    }
  }

  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (!canPlay) return;
    const corner = cornerFromClient(e.clientX, e.clientY);
    if (!corner) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing(true);

    const current = lineRef.current;
    // Touching the head (or anywhere along a stroke in progress) picks the line
    // back up; anywhere else starts fresh from that corner of your land.
    if (current.length > 0) {
      const at = current.findIndex((v) => samePos(v, corner));
      if (at >= 0) {
        const trimmed = current.slice(0, at + 1);
        setLine(trimmed);
        lineRef.current = trimmed;
        setHint(null);
        return;
      }
      if (territoryCanExtend(state, drawer, current, corner)) {
        extendTowards(corner);
        return;
      }
    }
    if (territoryCanStart(state, drawer, corner)) {
      setLine([corner]);
      lineRef.current = [corner];
      setHint(null);
      playSound("click");
    } else {
      setHint(
        current.length === 0
          ? "자기 땅의 모서리에서 시작하세요."
          : "그리던 선의 끝에서 이어 그으세요.",
      );
    }
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!canPlay || !drawing) return;
    const corner = cornerFromClient(e.clientX, e.clientY);
    if (corner) extendTowards(corner);
  }

  function handlePointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDrawing(false);
    if (!canPlay) return;
    const current = lineRef.current;
    // Letting go of a stroke that already encloses something plays it. One that
    // does not just stays on the board, silently, so it can be carried on.
    if (current.length > 1 && territoryPreview(state, drawer, current).error === null) submit(current);
  }

  const innerW = width * CELL;
  const innerH = height * CELL;
  const boardW = innerW + FRAME * 2;
  const boardH = innerH + FRAME * 2;

  const px = (v: number) => FRAME + v * CELL;

  const cells: Pos[] = useMemo(() => {
    const out: Pos[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.push({ x, y });
    return out;
  }, [width, height]);

  /** Corners you could start a stroke from — the only affordance an empty board needs. */
  const startCorners: Pos[] = useMemo(() => {
    if (!canPlay || line.length > 0) return [];
    const out: Pos[] = [];
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        const v = { x, y };
        if (territoryCanStart(state, drawer, v)) out.push(v);
      }
    }
    return out;
  }, [state, drawer, canPlay, line.length, width, height]);

  const linePoints = line.map((v) => `${px(v.x)},${px(v.y)}`).join(" ");
  const lastLinePoints = state.lastLine.map((v) => `${px(v.x)},${px(v.y)}`).join(" ");
  const head = line.length > 0 ? line[line.length - 1] : null;
  const ready = line.length > 1 && preview.error === null;
  const used = Math.max(0, line.length - 1);
  const drawColor = ready ? "#1f9d55" : moverColor;

  const message = hint
    ? hint
    : line.length === 0
      ? canPlay
        ? "내 땅 모서리에서 선을 그어 나갔다가 돌아오세요."
        : null
      : ready
        ? `놓으면 ${preview.gain.length}칸을 차지합니다.`
        : "자기 땅으로 다시 이어 붙이면 둘러싼 만큼 차지합니다.";

  return (
    <div className="terr-board-root">
      <style>{`
        .terr-board-root { width: 100%; display: flex; flex-direction: column; gap: 10px; align-items: center; }
        .terr-score-row { display: flex; gap: 10px; width: 100%; max-width: 480px; }
        .terr-score {
          flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; border-radius: 10px; background: #ffffff;
          border: 1px solid #e5ddc8; font-weight: 700; font-size: 0.85rem; color: #3a2a16;
        }
        .terr-score--you { box-shadow: 0 0 0 2px currentColor inset; }
        .terr-score-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; background: currentColor; }
        .terr-score-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .terr-score-count { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 1.05rem; flex-shrink: 0; }
        .terr-svg-wrap { width: 100%; max-width: 480px; }
        .terr-svg { width: 100%; height: auto; display: block; touch-action: none; }
        .terr-foot { width: 100%; max-width: 480px; display: flex; align-items: center; gap: 10px; min-height: 30px; }
        .terr-msg { margin: 0; flex: 1; font-size: 0.82rem; font-weight: 600; color: #7b8794; }
        .terr-msg--hint { color: #c0362c; }
        .terr-gauge { display: flex; align-items: center; gap: 6px; font-size: 0.78rem; font-weight: 700; color: #7b8794; flex-shrink: 0; }
        .terr-gauge-bar { width: 66px; height: 6px; border-radius: 3px; background: #e4e7eb; overflow: hidden; }
        .terr-gauge-fill { height: 100%; border-radius: 3px; transition: width 90ms linear; }
        .terr-clear { background: #e4e7eb; color: #323f4b; font-size: 0.78rem; padding: 6px 12px; flex-shrink: 0; }
        .terr-clear:hover:not(:disabled) { background: #cbd2d9; }
        .terr-start-dot { animation: terr-pulse 1.4s ease-in-out infinite; }
        .terr-gain { animation: terr-flash 520ms ease-out; }
        @keyframes terr-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.9; } }
        @keyframes terr-flash { from { opacity: 0.15; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .terr-start-dot { animation: none; opacity: 0.7; }
          .terr-gain { animation: none; }
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
          ref={svgRef}
          className="terr-svg"
          viewBox={`0 0 ${boardW} ${boardH}`}
          role="group"
          aria-label="땅따먹기 보드"
          style={{ cursor: canPlay ? "crosshair" : "default" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <rect x={0} y={0} width={boardW} height={boardH} rx={8} fill={WOOD} />
          <rect x={FRAME - 3} y={FRAME - 3} width={innerW + 6} height={innerH + 6} rx={3} fill={WOOD_EDGE} opacity={0.35} />
          <rect x={FRAME} y={FRAME} width={innerW} height={innerH} fill={CREAM} />

          {/* owned land */}
          {cells.map(({ x, y }) => {
            const owner = state.board[y][x];
            if (owner === null) return null;
            const fresh = lastGainSet.has(key({ x, y })) && state.lastBy === owner;
            return (
              <rect
                key={`own-${x}-${y}`}
                className={fresh ? "terr-gain" : undefined}
                x={px(x)}
                y={px(y)}
                width={CELL}
                height={CELL}
                fill={colorOf(owner)}
              />
            );
          })}

          {/* land the stroke would take if it were played right now */}
          {preview.gain.map((p) => (
            <rect
              key={`gain-${p.x}-${p.y}`}
              x={px(p.x)}
              y={px(p.y)}
              width={CELL}
              height={CELL}
              fill={moverColor}
              fillOpacity={0.42}
            />
          ))}

          {/* the lattice the line is drawn along */}
          <g stroke={GRID_LINE} strokeWidth={1}>
            {Array.from({ length: width + 1 }, (_, x) => (
              <line key={`v-${x}`} x1={px(x)} y1={px(0)} x2={px(x)} y2={px(height)} />
            ))}
            {Array.from({ length: height + 1 }, (_, y) => (
              <line key={`h-${y}`} x1={px(0)} y1={px(y)} x2={px(width)} y2={px(y)} />
            ))}
          </g>

          {/* the stroke the previous move drew, left on the board as a record */}
          {state.lastLine.length > 1 && line.length === 0 && state.lastBy !== null && (
            <polyline
              points={lastLinePoints}
              fill="none"
              stroke={colorOf(state.lastBy)}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="4 4"
              opacity={0.5}
            />
          )}

          {/* corners a stroke may start from */}
          {startCorners.map((v) => (
            <circle
              key={`start-${v.x}-${v.y}`}
              className="terr-start-dot"
              cx={px(v.x)}
              cy={px(v.y)}
              r={4}
              fill={moverColor}
            />
          ))}

          {/* the stroke in progress */}
          {line.length > 1 && (
            <polyline
              points={linePoints}
              fill="none"
              stroke={drawColor}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {line.length > 0 && (
            <circle cx={px(line[0].x)} cy={px(line[0].y)} r={5} fill={drawColor} />
          )}
          {head && (
            <circle
              cx={px(head.x)}
              cy={px(head.y)}
              r={7}
              fill="#ffffff"
              stroke={hint ? BAD_COLOR : drawColor}
              strokeWidth={3.5}
            />
          )}
        </svg>
      </div>

      <div className="terr-foot">
        {message && <p className={`terr-msg${hint ? " terr-msg--hint" : ""}`}>{message}</p>}
        {line.length > 0 && (
          <>
            <span className="terr-gauge" aria-label={`선 길이 ${used} / ${TERRITORY_MAX_LINE}`}>
              <span className="terr-gauge-bar">
                <span
                  className="terr-gauge-fill"
                  style={{ width: `${(used / TERRITORY_MAX_LINE) * 100}%`, background: drawColor }}
                />
              </span>
              {TERRITORY_MAX_LINE - used}
            </span>
            <button
              type="button"
              className="terr-clear"
              onClick={() => {
                setLine([]);
                setHint(null);
              }}
            >
              지우기
            </button>
          </>
        )}
      </div>
    </div>
  );
}
