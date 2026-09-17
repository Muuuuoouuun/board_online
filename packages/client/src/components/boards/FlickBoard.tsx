import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
} from "react";
import {
  FLICK_MAX,
  FLICK_SIZE,
  type FlickGrid,
  type FlickMove,
  type FlickPos,
  type FlickShot,
  type FlickState,
  type PlayerIndex,
} from "@board-online/shared";
import { playSound } from "../../lib/sound.js";
import type { GameViewProps } from "./types.js";

const SIZE = FLICK_SIZE;
const MAX_FLICK = FLICK_MAX;

const FRAME = 2;
const VB = SIZE + FRAME * 2;
/** Minimum pull (board units) that counts as a shot rather than a stray tap. */
const MIN_PULL = 0.8;
/** How close to the stone a press has to land to grab it. Generous, because the stone is small. */
const GRAB_RADIUS = 5;
/** How far the stone itself is drawn back while aiming, however far the pull actually goes. */
const LEAN = 2.2;

const PLAYER_COLORS: [string, string] = ["#2f6bff", "#e2622c"];
const CREAM = "#f5f3ee";

interface Flight {
  shot: FlickShot;
  /** The board as it looked before the shot, so claimed land appears when the stone lands. */
  grid: FlickGrid;
  /** The trail traced so far this turn, for the same reason. */
  path: FlickPos[];
  ms: number;
}

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

/** Identifies one shot. Two flicks can share a start, an end and an outcome, but never
 *  the turn/flick counter as well — so a change here always means a *new* shot to play. */
function shotKey(state: FlickState): string {
  const s = state.lastShot;
  if (!s) return "";
  return `${state.round}:${state.flicksLeft}:${s.player}:${s.from.x},${s.from.y}:${s.to.x},${s.to.y}:${s.outcome}`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Sliding-stone feel: quick off the mark, coasting to a stop. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

export default function FlickBoard({ state, onMove, interactive, you }: GameViewProps<FlickState, FlickMove>) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** How far the stone has been pulled back. The shot goes the opposite way. */
  const [pull, setPull] = useState<{ dx: number; dy: number; power: number } | null>(null);
  const pullRef = useRef(pull);
  pullRef.current = pull;

  const [flight, setFlight] = useState<Flight | null>(null);
  const [progress, setProgress] = useState(0);

  // The state arrives with the shot already resolved, so the board it is about
  // is the one rendered *before* it. Captured here, one effect ahead of the one
  // that starts the animation, so that earlier board is still what is showing.
  const prevRef = useRef<{ grid: FlickGrid; path: FlickPos[] }>({ grid: state.grid, path: state.path });

  const key = shotKey(state);
  const lastKeyRef = useRef(key);
  useEffect(() => {
    const shot = state.lastShot;
    const before = prevRef.current;
    prevRef.current = { grid: state.grid, path: state.path };
    if (key === lastKeyRef.current || !shot) {
      lastKeyRef.current = key;
      return;
    }
    lastKeyRef.current = key;

    const distance = Math.hypot(shot.to.x - shot.from.x, shot.to.y - shot.from.y);
    const ms = prefersReducedMotion() ? 1 : Math.min(620, 140 + distance * 24);
    playSound("move");
    setFlight({ shot, grid: before.grid, path: before.path, ms });
    setProgress(0);
  }, [key, state]);

  // Runs the flight itself. Split from the effect above so it only ever restarts
  // when a genuinely new shot arrives, not on every re-render in between.
  useEffect(() => {
    if (!flight) return;
    let raf = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / flight.ms);
      setProgress(t);
      if (t < 1) {
        raf = requestAnimationFrame(step);
        return;
      }
      playSound(flight.shot.outcome === "claim" ? "capture" : "place");
      setFlight(null);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [flight]);

  const mover = state.turn;
  const moverColor = PLAYER_COLORS[mover];
  const activeStone = state.stones[mover];
  const canPlay = interactive && state.status === "ongoing" && !flight;

  // While a shot is in the air the board still shows the position it was taken
  // from, so the land it wins appears the moment the stone lands.
  const shownGrid = flight ? flight.grid : state.grid;
  const shownPath = flight ? flight.path : state.path;
  // Whose stone is the live one: the shooter mid-flight (a turn-ending shot has
  // already handed `turn` over), otherwise whoever is to move. The other stone
  // just sits there — drawing it off `shooter` is what stops a stone in flight
  // from also appearing at the spot it is about to land on.
  const shooter: PlayerIndex = flight ? flight.shot.player : mover;
  const shooterColor = PLAYER_COLORS[shooter];
  const idleIdx: PlayerIndex = shooter === 0 ? 1 : 0;
  const idleStone = state.stones[idleIdx];

  const total = SIZE * SIZE;
  const { p0, p1 } = useMemo(() => {
    let c0 = 0;
    let c1 = 0;
    for (const row of shownGrid) {
      for (const cell of row) {
        if (cell === 0) c0++;
        else if (cell === 1) c1++;
      }
    }
    return { p0: c0, p1: c1 };
  }, [shownGrid]);
  const pct0 = (p0 / total) * 100;
  const pct1 = (p1 / total) * 100;

  const p0Path = useMemo(() => territoryPathD(shownGrid, 0), [shownGrid]);
  const p1Path = useMemo(() => territoryPathD(shownGrid, 1), [shownGrid]);

  function boardPointFromClient(clientX: number, clientY: number): FlickPos {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const scale = VB / rect.width;
    return { x: (clientX - rect.left) * scale - FRAME, y: (clientY - rect.top) * scale - FRAME };
  }

  /** Grab the stone. A press anywhere else on the board is not a shot — you have to pull it. */
  function handlePointerDown(e: RPointerEvent<SVGSVGElement>) {
    if (!canPlay) return;
    const p = boardPointFromClient(e.clientX, e.clientY);
    if (Math.hypot(p.x - activeStone.x, p.y - activeStone.y) > GRAB_RADIUS) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setPull({ dx: 0, dy: 0, power: 0 });
  }

  function handlePointerMove(e: RPointerEvent<SVGSVGElement>) {
    if (!canPlay || !pullRef.current) return;
    const p = boardPointFromClient(e.clientX, e.clientY);
    setPull(clampVector(p.x - activeStone.x, p.y - activeStone.y, MAX_FLICK));
  }

  function handlePointerUp(e: RPointerEvent<SVGSVGElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const held = pullRef.current;
    setPull(null);
    if (!canPlay || !held) return;
    // Let go and it flies the way you pulled it back from.
    if (held.power >= MIN_PULL) onMove({ kind: "flick", dx: -held.dx, dy: -held.dy });
  }

  function handleGiveUp() {
    if (!canPlay) return;
    onMove({ kind: "giveup" });
  }

  // --- aiming preview -------------------------------------------------------
  const launch = pull ? { x: -pull.dx, y: -pull.dy } : null;
  const target = launch ? { x: activeStone.x + launch.x, y: activeStone.y + launch.y } : null;
  const targetOnBoard = target ? target.x >= 0 && target.x <= SIZE && target.y >= 0 && target.y <= SIZE : false;
  const willClaim = target !== null && targetOnBoard && ownerAt(state.grid, target) === mover;
  const previewPoints = target ? polygonPoints([...state.path, target]) : "";
  const aimColor = !targetOnBoard ? "#c0362c" : willClaim ? "#1f9d55" : moverColor;

  // --- what to draw the stone and its trail from ----------------------------
  const flyingAt: FlickPos | null = flight
    ? {
        x: flight.shot.from.x + (flight.shot.to.x - flight.shot.from.x) * easeOut(progress),
        y: flight.shot.from.y + (flight.shot.to.y - flight.shot.from.y) * easeOut(progress),
      }
    : null;
  // The stone leans into the pull rather than following it all the way: a stone
  // resting in its home corner is usually pulled *past* the corner, and a stone
  // drawn out there would sit off the board with nothing to see.
  const lean = pull ? clampVector(pull.dx, pull.dy, LEAN) : null;
  const stoneAt: FlickPos = flyingAt ?? (lean ? { x: activeStone.x + lean.dx, y: activeStone.y + lean.dy } : activeStone);
  /** Where the pull actually is — the hand on the band. */
  const handAt: FlickPos | null = pull ? { x: activeStone.x + pull.dx, y: activeStone.y + pull.dy } : null;
  const trail = flyingAt ? [...shownPath, flyingAt] : shownPath;
  const trailPoints = trail.length >= 2 ? polygonPoints(trail) : "";

  const anchor = toSvg(activeStone);
  const svgStone = toSvg(stoneAt);

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

      <p className="fb-reason" key={`${state.round}:${state.flicksLeft}`}>
        {flight
          ? " "
          : state.status === "ongoing" && state.reason
            ? state.reason
            : canPlay
              ? "돌을 잡아 뒤로 당겼다 놓으면 반대쪽으로 날아갑니다."
              : " "}
      </p>

      <svg
        ref={svgRef}
        data-flick="board"
        className="board-svg fb-svg"
        viewBox={`0 0 ${VB} ${VB}`}
        role="img"
        aria-label="땅따먹기 보드"
        style={{ cursor: canPlay ? (pull ? "grabbing" : "default") : "default" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setPull(null)}
      >
        <defs>
          <linearGradient id="fb-frame" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a9763f" />
            <stop offset="100%" stopColor="#7d5227" />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={VB} height={VB} rx={2} fill="url(#fb-frame)" />
        <rect x={FRAME} y={FRAME} width={SIZE} height={SIZE} fill={CREAM} />

        <path d={p0Path} fill={PLAYER_COLORS[0]} fillOpacity={0.82} pointerEvents="none" />
        <path d={p1Path} fill={PLAYER_COLORS[1]} fillOpacity={0.82} pointerEvents="none" />

        {willClaim && previewPoints && (
          <polygon points={previewPoints} fill={moverColor} fillOpacity={0.28} stroke={moverColor} strokeWidth={0.3} pointerEvents="none" />
        )}

        {trailPoints && (
          <polyline
            points={trailPoints}
            fill="none"
            stroke={shooterColor}
            strokeWidth={0.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {shownPath.slice(1).map((p, i) => {
          const sp = toSvg(p);
          return <circle key={i} cx={sp.x} cy={sp.y} r={0.6} fill={shooterColor} pointerEvents="none" />;
        })}

        {pull && target && handAt && (
          <>
            {/* The band: your hand, through the stone, on to where the shot lands.
                Everything gets a white underlay so it stays readable over either
                player's land. */}
            <line
              x1={toSvg(handAt).x}
              y1={toSvg(handAt).y}
              x2={svgStone.x}
              y2={svgStone.y}
              stroke={aimColor}
              strokeWidth={0.55}
              strokeLinecap="round"
              opacity={0.7}
              pointerEvents="none"
            />
            <circle
              cx={toSvg(handAt).x}
              cy={toSvg(handAt).y}
              r={1.4}
              fill="none"
              stroke={aimColor}
              strokeWidth={0.4}
              opacity={0.7}
              pointerEvents="none"
            />
            <line
              x1={svgStone.x}
              y1={svgStone.y}
              x2={toSvg(target).x}
              y2={toSvg(target).y}
              stroke="#ffffff"
              strokeWidth={1.1}
              strokeLinecap="round"
              opacity={0.85}
              pointerEvents="none"
            />
            <line
              x1={svgStone.x}
              y1={svgStone.y}
              x2={toSvg(target).x}
              y2={toSvg(target).y}
              stroke={aimColor}
              strokeWidth={0.5}
              strokeDasharray="1.6 1.1"
              strokeLinecap="round"
              pointerEvents="none"
            />
            <circle
              cx={toSvg(target).x}
              cy={toSvg(target).y}
              r={1.5}
              fill="#ffffff"
              stroke={aimColor}
              strokeWidth={0.55}
              pointerEvents="none"
            />
            <circle cx={toSvg(target).x} cy={toSvg(target).y} r={0.6} fill={aimColor} pointerEvents="none" />
          </>
        )}

        {(() => {
          const rp = toSvg(idleStone);
          return (
            <circle
              data-flick={`stone-${idleIdx}`}
              cx={rp.x}
              cy={rp.y}
              r={1.3}
              fill={PLAYER_COLORS[idleIdx]}
              opacity={0.85}
              stroke="#00000030"
              strokeWidth={0.15}
              pointerEvents="none"
            />
          );
        })()}

        {/* the grab target: invisible, and wider than the stone so it can be caught on a phone */}
        {canPlay && (
          <circle
            data-flick="grab"
            cx={anchor.x}
            cy={anchor.y}
            r={GRAB_RADIUS}
            fill="transparent"
            style={{ cursor: "grab", touchAction: "none" }}
          />
        )}

        <circle
          data-flick="stone"
          cx={svgStone.x}
          cy={svgStone.y}
          r={1.5}
          fill={PLAYER_COLORS[shooter]}
          stroke="#ffffff"
          strokeWidth={0.25}
          className={canPlay && !pull ? "fb-stone fb-stone--ready" : "fb-stone"}
          pointerEvents="none"
        />
      </svg>

      <div className="fb-actions">
        <button type="button" className="fb-giveup" data-flick="giveup" disabled={!canPlay} onClick={handleGiveUp}>
          이번 차례 포기
        </button>
      </div>

      <style>{`
        .fb-wrap { width: 100%; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
        .fb-stats { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 0.85rem; color: #52606d; font-weight: 600; }
        .fb-stat { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .fb-stat--active { box-shadow: 0 0 0 2px rgba(47,107,255,0.35), 0 1px 3px rgba(0,0,0,0.08); }
        .fb-stat strong { color: #1f2933; font-size: 0.95rem; }
        .fb-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
        .fb-flicks { display: flex; gap: 5px; align-items: center; }
        .fb-pip { width: 10px; height: 10px; border-radius: 50%; background: #e4e7eb; border: 1.5px solid #cbd2d9; display: inline-block; }
        .fb-pip--on { background: var(--pip-color, #2f6bff); border-color: transparent; }
        .fb-reason { margin: 0; text-align: center; font-size: 0.85rem; font-weight: 600; color: #7b8794; min-height: 1.2em; animation: fb-fade-in 220ms ease-out; }
        .fb-svg { width: 100%; height: auto; display: block; touch-action: none; }
        .fb-stone--ready { animation: fb-pulse 1.6s ease-in-out infinite; }
        .fb-actions { display: flex; justify-content: center; }
        .fb-giveup { background: #e4e7eb; color: #323f4b; font-size: 0.8rem; padding: 7px 14px; }
        .fb-giveup:hover:not(:disabled) { background: #cbd2d9; }
        @keyframes fb-pulse { 0%, 100% { filter: drop-shadow(0 0 0 rgba(0,0,0,0)); } 50% { filter: drop-shadow(0 0 2px rgba(0,0,0,0.4)); } }
        @keyframes fb-fade-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .fb-stone--ready, .fb-reason { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
