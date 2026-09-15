import { useMemo, useState } from "react";
import type { BoardPiece, GameMeta, Move, PlayerIndex, Pos } from "@board-online/shared";
import { posEq } from "@board-online/shared";

interface BoardProps {
  meta: GameMeta;
  pieces: BoardPiece[];
  legalMoves: Move[];
  onMove: (move: Move) => void;
  interactive: boolean;
}

const CELL = 44;

const DISC_GLYPHS = new Set(["●", "○"]);

function themeFor(gameId: GameMeta["id"]) {
  switch (gameId) {
    case "reversi":
      return { kind: "flat" as const, bg: "#2f6b4f", line: "#1f4f39" };
    case "chess":
    case "checkers":
      return { kind: "checker" as const, light: "#f0d9b5", dark: "#b58863" };
    default:
      return { kind: "wood" as const, bg: "#dfb579", line: "#3a2f28" };
  }
}

export default function Board({ meta, pieces, legalMoves, onMove, interactive }: BoardProps) {
  const [selected, setSelected] = useState<Pos | null>(null);
  const theme = themeFor(meta.id);
  const intersection = meta.gridStyle === "intersection";
  const pad = intersection ? CELL / 2 : 0;
  const boardW = intersection ? (meta.width - 1) * CELL + pad * 2 : meta.width * CELL;
  const boardH = intersection ? (meta.height - 1) * CELL + pad * 2 : meta.height * CELL;

  const toPx = (p: Pos) =>
    intersection
      ? { cx: pad + p.x * CELL, cy: pad + p.y * CELL }
      : { cx: p.x * CELL + CELL / 2, cy: p.y * CELL + CELL / 2 };

  const needsFrom = useMemo(() => legalMoves.some((m) => m.from), [legalMoves]);

  const destinations: Pos[] = useMemo(() => {
    if (!needsFrom) return legalMoves.map((m) => m.to);
    if (!selected) return [];
    return legalMoves.filter((m) => m.from && posEq(m.from, selected)).map((m) => m.to);
  }, [legalMoves, needsFrom, selected]);

  const selectablePieces: Pos[] = useMemo(() => {
    if (!needsFrom) return [];
    const seen = new Set<string>();
    const out: Pos[] = [];
    for (const m of legalMoves) {
      if (!m.from) continue;
      const key = `${m.from.x},${m.from.y}`;
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
      } else {
        const canSelect = selectablePieces.some((p) => posEq(p, pos));
        if (canSelect) setSelected(pos);
      }
    } else {
      const move = legalMoves.find((m) => posEq(m.to, pos));
      if (move) onMove(move);
    }
  }

  const cells: { x: number; y: number }[] = [];
  if (!intersection) {
    for (let y = 0; y < meta.height; y++) for (let x = 0; x < meta.width; x++) cells.push({ x, y });
  }
  const points: Pos[] = [];
  if (intersection) {
    for (let y = 0; y < meta.height; y++) for (let x = 0; x < meta.width; x++) points.push({ x, y });
  }

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${boardW} ${boardH}`}
      role="group"
      aria-label={`${meta.nameKo} 보드`}
    >
      {theme.kind === "checker" &&
        cells.map(({ x, y }) => (
          <rect
            key={`bg-${x}-${y}`}
            x={x * CELL}
            y={y * CELL}
            width={CELL}
            height={CELL}
            fill={(x + y) % 2 === 0 ? theme.light : theme.dark}
          />
        ))}

      {theme.kind === "flat" && (
        <>
          <rect x={0} y={0} width={boardW} height={boardH} fill={theme.bg} />
          {cells.map(({ x, y }) => (
            <rect
              key={`grid-${x}-${y}`}
              x={x * CELL}
              y={y * CELL}
              width={CELL}
              height={CELL}
              fill="none"
              stroke={theme.line}
              strokeWidth={1}
            />
          ))}
        </>
      )}

      {theme.kind === "wood" && (
        <>
          <rect x={0} y={0} width={boardW} height={boardH} fill={theme.bg} />
          {Array.from({ length: meta.width }, (_, x) => (
            <line
              key={`v-${x}`}
              x1={pad + x * CELL}
              y1={pad}
              x2={pad + x * CELL}
              y2={boardH - pad}
              stroke={theme.line}
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: meta.height }, (_, y) => (
            <line
              key={`h-${y}`}
              x1={pad}
              y1={pad + y * CELL}
              x2={boardW - pad}
              y2={pad + y * CELL}
              stroke={theme.line}
              strokeWidth={1}
            />
          ))}
          {meta.decorations?.map((d, i) => (
            <line
              key={`dec-${i}`}
              x1={pad + d.x1 * CELL}
              y1={pad + d.y1 * CELL}
              x2={pad + d.x2 * CELL}
              y2={pad + d.y2 * CELL}
              stroke={theme.line}
              strokeWidth={1}
            />
          ))}
        </>
      )}

      {/* click targets */}
      {!intersection &&
        cells.map(({ x, y }) => (
          <rect
            key={`hit-${x}-${y}`}
            data-pos={`${x},${y}`}
            x={x * CELL}
            y={y * CELL}
            width={CELL}
            height={CELL}
            fill="transparent"
            onClick={() => handlePointClick({ x, y })}
            style={{ cursor: interactive ? "pointer" : "default" }}
          />
        ))}
      {intersection &&
        points.map((p) => {
          const { cx, cy } = toPx(p);
          return (
            <circle
              key={`hit-${p.x}-${p.y}`}
              data-pos={`${p.x},${p.y}`}
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
            <circle key={`dest-${i}`} cx={cx} cy={cy} r={CELL * 0.46} fill="none" stroke="#e5484d" strokeWidth={3} pointerEvents="none" />
          ) : (
            <circle key={`dest-${i}`} cx={cx} cy={cy} r={CELL * 0.14} fill="rgba(20,20,20,0.4)" pointerEvents="none" />
          );
        })}

      {/* selectable piece hint */}
      {interactive &&
        !selected &&
        selectablePieces.map((p, i) => {
          const { cx, cy } = toPx(p);
          return (
            <circle
              key={`sel-hint-${i}`}
              cx={cx}
              cy={cy}
              r={CELL * 0.46}
              fill="none"
              stroke="#2f6bff"
              strokeOpacity={0.35}
              strokeWidth={2}
              pointerEvents="none"
            />
          );
        })}

      {/* selected marker */}
      {selected &&
        (() => {
          const { cx, cy } = toPx(selected);
          return <circle cx={cx} cy={cy} r={CELL * 0.46} fill="none" stroke="#2f6bff" strokeWidth={3} pointerEvents="none" />;
        })()}

      {/* pieces */}
      {pieces.map((piece, i) => {
        const { cx, cy } = toPx(piece.pos);
        const isDisc = DISC_GLYPHS.has(piece.glyph);
        const isDark = meta.ownerIsDark ? meta.ownerIsDark[piece.owner] : piece.owner === 0;
        const fill = isDark ? "#1f2933" : "#f7f7f5";
        const stroke = isDark ? "#05070a" : "#9aa5b1";
        const textFill = isDark ? "#f7f7f5" : "#1f2933";
        return (
          <g key={`piece-${i}`} pointerEvents="none">
            {piece.highlight && (
              <circle cx={cx} cy={cy} r={CELL * 0.46} fill="none" stroke="#d4af37" strokeWidth={3} />
            )}
            <circle cx={cx} cy={cy} r={CELL * 0.42} fill={fill} stroke={stroke} strokeWidth={2} />
            {!isDisc && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={CELL * 0.5}
                fill={textFill}
                fontFamily="'Noto Sans KR', sans-serif"
              >
                {piece.glyph}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
