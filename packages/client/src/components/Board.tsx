import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { BoardPiece, GameMeta, Move, Pos } from "@board-online/shared";
import { posEq } from "@board-online/shared";
import { posKey, usePieceAnimations } from "../lib/usePieceAnimations.js";
import { playSound } from "../lib/sound.js";
import PieceArt, { PieceDefs } from "./PieceArt.js";

interface BoardProps {
  meta: GameMeta;
  pieces: BoardPiece[];
  legalMoves: Move[];
  onMove: (move: Move) => void;
  interactive: boolean;
}

const CELL = 44;
const FRAME = 10;

type BoardTheme =
  | { kind: "flat"; surface: string; line: string; edge: string }
  | { kind: "checker"; light: string; dark: string; edge: string }
  | { kind: "wood"; surface: string; line: string; edge: string };

function themeFor(gameId: GameMeta["id"]): BoardTheme {
  switch (gameId) {
    case "reversi":
      return { kind: "flat", surface: "url(#bo-felt)", line: "rgba(8,40,26,0.45)", edge: "#20503b" };
    case "chess":
    case "checkers":
      return { kind: "checker", light: "#f2dcb8", dark: "#b07d56", edge: "#6b4a33" };
    default:
      return { kind: "wood", surface: "url(#bo-wood)", line: "rgba(58,38,20,0.55)", edge: "#8a6234" };
  }
}

/** 화점 — the marked reference points on a 15x15 gomoku board. */
const GOMOKU_STARS: Pos[] = [
  { x: 3, y: 3 },
  { x: 11, y: 3 },
  { x: 3, y: 11 },
  { x: 11, y: 11 },
  { x: 7, y: 7 },
];

export default function Board({ meta, pieces, legalMoves, onMove, interactive }: BoardProps) {
  const [selected, setSelected] = useState<Pos | null>(null);
  const anim = usePieceAnimations(pieces);
  const theme = themeFor(meta.id);
  const intersection = meta.gridStyle === "intersection";
  const pad = intersection ? CELL / 2 : 0;
  const innerW = intersection ? (meta.width - 1) * CELL + pad * 2 : meta.width * CELL;
  const innerH = intersection ? (meta.height - 1) * CELL + pad * 2 : meta.height * CELL;
  const boardW = innerW + FRAME * 2;
  const boardH = innerH + FRAME * 2;

  const toPx = (p: Pos) =>
    intersection
      ? { cx: FRAME + pad + p.x * CELL, cy: FRAME + pad + p.y * CELL }
      : { cx: FRAME + p.x * CELL + CELL / 2, cy: FRAME + p.y * CELL + CELL / 2 };

  useEffect(() => {
    if (!anim.change) return;
    playSound(anim.change.kind);
    if (anim.change.flipped > 0) {
      const timer = setTimeout(() => playSound("flip"), 130);
      return () => clearTimeout(timer);
    }
  }, [anim.nonce]);

  // A board update (usually the opponent moving) invalidates any pending selection.
  useEffect(() => {
    setSelected(null);
  }, [anim.nonce]);

  const needsFrom = useMemo(() => legalMoves.some((m) => m.from), [legalMoves]);

  const destinations: Pos[] = useMemo(() => {
    if (!needsFrom) return legalMoves.map((m) => m.to);
    if (!selected) return [];
    return legalMoves.filter((m) => m.from && posEq(m.from, selected)).map((m) => m.to);
  }, [legalMoves, needsFrom, selected]);

  const destinationKeys = useMemo(() => new Set(destinations.map(posKey)), [destinations]);

  const selectablePieces: Pos[] = useMemo(() => {
    if (!needsFrom) return [];
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
  }, [legalMoves, needsFrom]);

  function handlePointClick(pos: Pos) {
    if (!interactive) return;
    if (needsFrom) {
      if (selected) {
        const move = legalMoves.find((m) => m.from && posEq(m.from, selected) && posEq(m.to, pos));
        if (move) {
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
    } else {
      const move = legalMoves.find((m) => posEq(m.to, pos));
      if (move) onMove(move);
    }
  }

  const squares: Pos[] = useMemo(() => {
    const out: Pos[] = [];
    for (let y = 0; y < meta.height; y++) for (let x = 0; x < meta.width; x++) out.push({ x, y });
    return out;
  }, [meta.width, meta.height]);

  function pieceNode(piece: BoardPiece, variant: "live" | "ghost") {
    const key = posKey(piece.pos);
    const { cx, cy } = toPx(piece.pos);
    const from = anim.slideFrom[key];
    const classes = ["board-piece"];
    const style: CSSProperties = {};
    if (variant === "ghost") {
      classes.push("board-piece--leave");
    } else if (from) {
      const origin = toPx(from);
      classes.push("board-piece--slide");
      (style as Record<string, string>)["--dx"] = `${origin.cx - cx}px`;
      (style as Record<string, string>)["--dy"] = `${origin.cy - cy}px`;
    } else if (anim.entered.has(key)) {
      classes.push("board-piece--enter");
    } else if (anim.flipped.has(key)) {
      classes.push("board-piece--flip");
    }
    return (
      <g key={`${variant}-${key}`} transform={`translate(${cx}, ${cy})`} pointerEvents="none">
        <g className={classes.join(" ")} style={style}>
          <PieceArt
            game={meta.id}
            owner={piece.owner}
            glyph={piece.glyph}
            highlight={piece.highlight}
            cx={0}
            cy={0}
            size={CELL}
          />
        </g>
      </g>
    );
  }

  return (
    <svg className="board-svg" viewBox={`0 0 ${boardW} ${boardH}`} role="group" aria-label={`${meta.nameKo} 보드`}>
      <defs>
        <linearGradient id="bo-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8c08d" />
          <stop offset="45%" stopColor="#dcae76" />
          <stop offset="100%" stopColor="#cf9c62" />
        </linearGradient>
        <linearGradient id="bo-frame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a9763f" />
          <stop offset="100%" stopColor="#7d5227" />
        </linearGradient>
        <radialGradient id="bo-felt" cx="0.5" cy="0.4" r="0.8">
          <stop offset="0%" stopColor="#3b7d5d" />
          <stop offset="100%" stopColor="#245741" />
        </radialGradient>
        <PieceDefs />
      </defs>

      <rect x={0} y={0} width={boardW} height={boardH} rx={8} fill="url(#bo-frame)" />

      {theme.kind === "checker" && (
        <>
          {squares.map(({ x, y }) => (
            <rect
              key={`bg-${x}-${y}`}
              x={FRAME + x * CELL}
              y={FRAME + y * CELL}
              width={CELL}
              height={CELL}
              fill={(x + y) % 2 === 0 ? theme.light : theme.dark}
            />
          ))}
        </>
      )}

      {theme.kind !== "checker" && (
        <rect x={FRAME} y={FRAME} width={innerW} height={innerH} fill={theme.surface} />
      )}

      {theme.kind === "flat" &&
        squares.map(({ x, y }) => (
          <rect
            key={`grid-${x}-${y}`}
            x={FRAME + x * CELL}
            y={FRAME + y * CELL}
            width={CELL}
            height={CELL}
            fill="none"
            stroke={theme.line}
            strokeWidth={1}
          />
        ))}

      {theme.kind === "wood" && (
        <>
          {Array.from({ length: meta.width }, (_, x) => (
            <line
              key={`v-${x}`}
              x1={FRAME + pad + x * CELL}
              y1={FRAME + pad}
              x2={FRAME + pad + x * CELL}
              y2={boardH - FRAME - pad}
              stroke={theme.line}
              strokeWidth={x === 0 || x === meta.width - 1 ? 1.6 : 1}
            />
          ))}
          {Array.from({ length: meta.height }, (_, y) => (
            <line
              key={`h-${y}`}
              x1={FRAME + pad}
              y1={FRAME + pad + y * CELL}
              x2={boardW - FRAME - pad}
              y2={FRAME + pad + y * CELL}
              stroke={theme.line}
              strokeWidth={y === 0 || y === meta.height - 1 ? 1.6 : 1}
            />
          ))}
          {meta.decorations?.map((d, i) => {
            const a = toPx({ x: d.x1, y: d.y1 });
            const b = toPx({ x: d.x2, y: d.y2 });
            return <line key={`dec-${i}`} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} stroke={theme.line} strokeWidth={1} />;
          })}
          {meta.id === "gomoku" &&
            GOMOKU_STARS.map((p, i) => {
              const { cx, cy } = toPx(p);
              return <circle key={`star-${i}`} cx={cx} cy={cy} r={3} fill={theme.line} />;
            })}
        </>
      )}

      {/* last move trail */}
      {anim.lastMove?.from &&
        (() => {
          const { cx, cy } = toPx(anim.lastMove.from);
          return <circle className="board-lastmove" cx={cx} cy={cy} r={CELL * 0.42} />;
        })()}
      {anim.lastMove &&
        (() => {
          const { cx, cy } = toPx(anim.lastMove.to);
          return <circle className="board-lastmove board-lastmove--to" cx={cx} cy={cy} r={CELL * 0.44} />;
        })()}

      {/* click targets */}
      {squares.map((p) => {
        const { cx, cy } = toPx(p);
        const legal = interactive && destinationKeys.has(posKey(p));
        const selectable = interactive && !selected && selectablePieces.some((s) => posEq(s, p));
        const classes = ["board-hit"];
        if (legal) classes.push("board-hit--legal");
        if (selectable) classes.push("board-hit--selectable");
        return (
          <circle
            key={`hit-${p.x}-${p.y}`}
            data-pos={`${p.x},${p.y}`}
            className={classes.join(" ")}
            cx={cx}
            cy={cy}
            r={CELL * 0.48}
            fill="transparent"
            onClick={() => handlePointClick(p)}
            style={{ cursor: interactive ? "pointer" : "default" }}
          />
        );
      })}

      {/* legal destination markers */}
      {interactive &&
        destinations.map((d, i) => {
          const { cx, cy } = toPx(d);
          const occupied = pieces.some((p) => posEq(p.pos, d));
          return occupied ? (
            <circle key={`dest-${i}`} className="board-dest board-dest--capture" cx={cx} cy={cy} r={CELL * 0.46} />
          ) : (
            <circle key={`dest-${i}`} className="board-dest" cx={cx} cy={cy} r={CELL * 0.15} />
          );
        })}

      {/* selectable piece hint */}
      {interactive &&
        !selected &&
        selectablePieces.map((p, i) => {
          const { cx, cy } = toPx(p);
          return <circle key={`sel-hint-${i}`} className="board-selectable" cx={cx} cy={cy} r={CELL * 0.46} />;
        })}

      {selected &&
        (() => {
          const { cx, cy } = toPx(selected);
          return <circle className="board-selected" cx={cx} cy={cy} r={CELL * 0.46} />;
        })()}

      {anim.ghosts.map((piece) => pieceNode(piece, "ghost"))}
      {pieces.map((piece) => pieceNode(piece, "live"))}
    </svg>
  );
}
