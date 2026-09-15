/**
 * PieceArt — decorative SVG artwork for every board-game piece in the app.
 *
 * This module renders pure <g> fragments meant to be dropped inside an
 * existing <svg>. It never renders <svg>, HTML, or <div> itself.
 *
 * Usage:
 *   <svg>
 *     <PieceDefs />
 *     ...
 *     <PieceArt game="chess" owner={0} glyph="♞" cx={100} cy={100} size={44} />
 *   </svg>
 */

export interface PieceArtProps {
  /** Games with their own renderer draw their own pieces, so those ids fall through to null. */
  game: string;
  owner: 0 | 1;
  glyph: string;
  highlight?: boolean;
  cx: number;
  cy: number;
  size: number;
}

const BASE_CELL = 44;

/* ------------------------------------------------------------------ */
/* Shared gradient / filter definitions                                */
/* ------------------------------------------------------------------ */

export function PieceDefs() {
  return (
    <defs>
      {/* Go-style stones (gomoku / reversi) */}
      <radialGradient id="bo-stone-black-grad" cx="35%" cy="28%" r="75%">
        <stop offset="0%" stopColor="#5a6472" />
        <stop offset="14%" stopColor="#262b34" />
        <stop offset="55%" stopColor="#0c0e12" />
        <stop offset="100%" stopColor="#000000" />
      </radialGradient>
      <radialGradient id="bo-stone-white-grad" cx="35%" cy="28%" r="78%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="35%" stopColor="#f6f1e4" />
        <stop offset="72%" stopColor="#e2d7bd" />
        <stop offset="100%" stopColor="#c6b995" />
      </radialGradient>
      <radialGradient id="bo-shadow-grad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="rgba(0,0,0,0.42)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0)" />
      </radialGradient>

      {/* Checkers discs */}
      <radialGradient id="bo-checker-black-grad" cx="35%" cy="26%" r="80%">
        <stop offset="0%" stopColor="#4a5058" />
        <stop offset="30%" stopColor="#1c2027" />
        <stop offset="100%" stopColor="#020304" />
      </radialGradient>
      <radialGradient id="bo-checker-white-grad" cx="35%" cy="26%" r="80%">
        <stop offset="0%" stopColor="#fffdf7" />
        <stop offset="40%" stopColor="#f1e6ca" />
        <stop offset="100%" stopColor="#cdb684" />
      </radialGradient>
      <linearGradient id="bo-checker-gold-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#fff3c4" />
        <stop offset="45%" stopColor="#d4af37" />
        <stop offset="100%" stopColor="#8a6a1a" />
      </linearGradient>

      {/* Chess pieces */}
      <linearGradient id="bo-chess-white-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#fffaf0" />
        <stop offset="55%" stopColor="#eee2c6" />
        <stop offset="100%" stopColor="#d3c3a0" />
      </linearGradient>
      <linearGradient id="bo-chess-black-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#54545c" />
        <stop offset="55%" stopColor="#2c2c31" />
        <stop offset="100%" stopColor="#131316" />
      </linearGradient>

      {/* Janggi wooden tile */}
      <radialGradient id="bo-wood-grad" cx="38%" cy="30%" r="78%">
        <stop offset="0%" stopColor="#f3dfae" />
        <stop offset="45%" stopColor="#dcb877" />
        <stop offset="100%" stopColor="#a5702f" />
      </radialGradient>
    </defs>
  );
}

/* ------------------------------------------------------------------ */
/* Small geometry helpers                                              */
/* ------------------------------------------------------------------ */

function octagonPoints(cx: number, cy: number, r: number, elongateY: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const theta = (Math.PI / 8) * (2 * i + 1) - Math.PI / 2;
    const x = cx + r * Math.sin(theta);
    const y = cy + r * Math.cos(theta) * elongateY;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(" ");
}

function crownPoints(cx: number, cy: number, r: number): string {
  const w = r * 1.1;
  const h = r * 0.72;
  const pts: [number, number][] = [
    [cx - w / 2, cy + h * 0.32],
    [cx - w / 2, cy - h * 0.3],
    [cx - w / 6, cy + h * 0.02],
    [cx, cy - h * 0.55],
    [cx + w / 6, cy + h * 0.02],
    [cx + w / 2, cy - h * 0.3],
    [cx + w / 2, cy + h * 0.32],
  ];
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

/* ------------------------------------------------------------------ */
/* Go-style stones — gomoku & reversi                                  */
/* ------------------------------------------------------------------ */

function GoStone({ owner, cx, cy, size }: { owner: 0 | 1; cx: number; cy: number; size: number }) {
  const r = size * 0.44;
  const isBlack = owner === 0;
  const grad = isBlack ? "url(#bo-stone-black-grad)" : "url(#bo-stone-white-grad)";
  const rim = isBlack ? "#000000" : "#9a8f74";
  const hlOpacity = isBlack ? 0.5 : 0.85;
  return (
    <g pointerEvents="none">
      <ellipse cx={cx} cy={cy + r * 0.58} rx={r * 0.92} ry={r * 0.3} fill="url(#bo-shadow-grad)" />
      <circle cx={cx} cy={cy} r={r} fill={grad} stroke={rim} strokeWidth={size * 0.02} />
      <ellipse
        cx={cx - r * 0.32}
        cy={cy - r * 0.36}
        rx={r * 0.3}
        ry={r * 0.18}
        fill="#ffffff"
        opacity={hlOpacity}
        transform={`rotate(-28 ${cx - r * 0.32} ${cy - r * 0.36})`}
      />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Checkers discs                                                      */
/* ------------------------------------------------------------------ */

function CheckerDisc({
  owner,
  cx,
  cy,
  size,
  king,
}: {
  owner: 0 | 1;
  cx: number;
  cy: number;
  size: number;
  king: boolean;
}) {
  const r = size * 0.4;
  const lift = size * 0.075;
  const isBlack = owner === 0;
  const topGrad = isBlack ? "url(#bo-checker-black-grad)" : "url(#bo-checker-white-grad)";
  const bottomFill = isBlack ? "#050505" : "#8f7a52";
  const rim = isBlack ? "#000000" : "#8a7a55";
  const ringStroke = isBlack ? "#494f58" : "#c8b787";
  return (
    <g pointerEvents="none">
      <ellipse cx={cx} cy={cy + r * 0.7} rx={r * 0.95} ry={r * 0.28} fill="url(#bo-shadow-grad)" />
      <circle cx={cx} cy={cy + lift} r={r} fill={bottomFill} />
      <circle cx={cx} cy={cy} r={r} fill={topGrad} stroke={rim} strokeWidth={size * 0.022} />
      <circle
        cx={cx}
        cy={cy}
        r={r * 0.68}
        fill="none"
        stroke={ringStroke}
        strokeWidth={size * 0.025}
        opacity={0.8}
      />
      {king && (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={r * 1.02}
            fill="none"
            stroke="url(#bo-checker-gold-grad)"
            strokeWidth={size * 0.05}
          />
          <polygon
            points={crownPoints(cx, cy, r * 0.55)}
            fill="url(#bo-checker-gold-grad)"
            stroke="#5c4413"
            strokeWidth={size * 0.012}
            strokeLinejoin="round"
          />
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Chess pieces — original silhouettes, built from primitive shapes    */
/* ------------------------------------------------------------------ */

function ChessPiece({
  glyph,
  owner,
  cx,
  cy,
  size,
}: {
  glyph: string;
  owner: 0 | 1;
  cx: number;
  cy: number;
  size: number;
}) {
  const isWhite = owner === 0;
  const fill = isWhite ? "url(#bo-chess-white-grad)" : "url(#bo-chess-black-grad)";
  const stroke = isWhite ? "#2b2620" : "#d8d2c2";
  const accent = isWhite ? "#8a7d5f" : "#4a4a52";
  const scale = size / BASE_CELL;
  const sw = 1.5;

  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`} pointerEvents="none">
      <ellipse cx={0} cy={17} rx={13} ry={3.4} fill="rgba(0,0,0,0.28)" />
      <g fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
        {glyph === "♟" && (
          <>
            <rect x={-13} y={13} width={26} height={4.5} rx={1.5} />
            <polygon points="-8,13 8,13 5.5,2 -5.5,2" />
            <rect x={-3.2} y={-2} width={6.4} height={4.2} rx={1.6} />
            <circle cx={0} cy={-8.5} r={6.2} />
          </>
        )}

        {glyph === "♜" && (
          <>
            <rect x={-13} y={13} width={26} height={4.5} rx={1.5} />
            <polygon points="-9,13 9,13 7.5,-6 -7.5,-6" />
            <rect x={-9.5} y={-8.5} width={19} height={3} rx={1} />
            <rect x={-8.5} y={-15} width={4.6} height={7} />
            <rect x={-2.3} y={-15} width={4.6} height={7} />
            <rect x={3.9} y={-15} width={4.6} height={7} />
          </>
        )}

        {glyph === "♝" && (
          <>
            <rect x={-13} y={13} width={26} height={4.5} rx={1.5} />
            <polygon points="-10,13 10,13 8,7 -8,7" />
            <path d="M 0 -18 C 8 -14 9 -3 6.2 4.5 C 9.5 6 10.5 9.5 10.5 13 L -10.5 13 C -10.5 9.5 -9.5 6 -6.2 4.5 C -9 -3 -8 -14 0 -18 Z" />
            <line
              x1={-3}
              y1={-13.5}
              x2={2.6}
              y2={-8.5}
              stroke={accent}
              strokeWidth={1.6}
              strokeLinecap="round"
            />
            <circle cx={0} cy={-19.5} r={2.3} />
          </>
        )}

        {glyph === "♞" && (
          <>
            <rect x={-13} y={13} width={26} height={4.5} rx={1.5} />
            <polygon points="-10.5,13 10.5,13 10.5,3.5 -10.5,3.5" />
            <path d="M -8.5 3.5 C -9.5 -3 -6.5 -8.5 -0.5 -11.5 C -3 -13.5 -3.2 -16.5 -0.8 -18.3 C 1.8 -19.8 5 -17.6 4.6 -14.6 C 8 -14.3 11.2 -11.8 12.4 -8.4 C 13.2 -6.1 12.2 -4.3 10 -3.4 C 11 -1.6 10.8 0.5 9 1.6 L 9 3.5 Z" />
            <polygon points="0.4,-18 3.2,-21.6 4.4,-17.6" />
            <circle cx={4.4} cy={-11.3} r={1.15} fill={stroke} stroke="none" />
            <path
              d="M -4.5 -9.5 L -1 -12 M -3 -6 L 0.2 -8.6 M -1.8 -2.6 L 1.6 -5.2"
              stroke={accent}
              strokeWidth={1.3}
              strokeLinecap="round"
              fill="none"
            />
          </>
        )}

        {glyph === "♛" && (
          <>
            <rect x={-13} y={13} width={26} height={4.5} rx={1.5} />
            <polygon points="-9,13 9,13 7,-2.5 -7,-2.5" />
            <rect x={-9} y={-7} width={18} height={4.5} rx={1} />
            <circle cx={-8} cy={-10} r={2.1} />
            <circle cx={-4} cy={-12.5} r={2.1} />
            <circle cx={0} cy={-14.5} r={2.3} />
            <circle cx={4} cy={-12.5} r={2.1} />
            <circle cx={8} cy={-10} r={2.1} />
          </>
        )}

        {glyph === "♚" && (
          <>
            <rect x={-13} y={13} width={26} height={4.5} rx={1.5} />
            <polygon points="-9,13 9,13 7,-2.5 -7,-2.5" />
            <rect x={-9} y={-7} width={18} height={4.5} rx={1} />
            <rect x={-1.6} y={-18} width={3.2} height={9} />
            <rect x={-4.5} y={-15} width={9} height={3.2} />
          </>
        )}
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Janggi octagonal wooden tiles                                       */
/* ------------------------------------------------------------------ */

const JANGGI_RANK_SCALE: Record<string, number> = {
  楚: 1.18,
  漢: 1.18,
  車: 1.06,
  包: 1.06,
  馬: 1.0,
  象: 1.0,
  士: 0.9,
  卒: 0.86,
  兵: 0.86,
};

function JanggiTile({
  glyph,
  owner,
  cx,
  cy,
  size,
  highlight,
}: {
  glyph: string;
  owner: 0 | 1;
  cx: number;
  cy: number;
  size: number;
  highlight: boolean;
}) {
  const rankScale = JANGGI_RANK_SCALE[glyph] ?? 1.0;
  const r = size * 0.42 * rankScale;
  const elongate = 1.12;
  const ringStroke = highlight ? "#8a5a1f" : "#5b3a1e";
  const ringWidth = highlight ? size * 0.06 : size * 0.035;
  const textFill = owner === 0 ? "#0b6e4f" : "#b3261e";
  const fontSize = size * 0.44 * rankScale;

  return (
    <g pointerEvents="none">
      <ellipse cx={cx} cy={cy + r * 0.62} rx={r * 0.95} ry={r * 0.26} fill="url(#bo-shadow-grad)" />
      {highlight && (
        <polygon
          points={octagonPoints(cx, cy, r * 1.16, elongate)}
          fill="none"
          stroke="#c9a227"
          strokeWidth={size * 0.03}
          opacity={0.75}
        />
      )}
      <polygon
        points={octagonPoints(cx, cy, r, elongate)}
        fill="url(#bo-wood-grad)"
        stroke={ringStroke}
        strokeWidth={ringWidth}
        strokeLinejoin="round"
      />
      <polygon
        points={octagonPoints(cx, cy, r * 0.76, elongate)}
        fill="none"
        stroke="#6b4423"
        strokeWidth={size * 0.018}
        opacity={0.55}
      />
      <text
        x={cx}
        y={cy + fontSize * 0.02}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight="bold"
        fontFamily="'Noto Sans KR', sans-serif"
        fill="#3a2a16"
        opacity={0.35}
        transform={`translate(${size * 0.02} ${size * 0.03})`}
      >
        {glyph}
      </text>
      <text
        x={cx}
        y={cy + fontSize * 0.02}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight="bold"
        fontFamily="'Noto Sans KR', sans-serif"
        fill={textFill}
      >
        {glyph}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export default function PieceArt(props: PieceArtProps) {
  const { game, owner, glyph, highlight, cx, cy, size } = props;

  switch (game) {
    case "gomoku":
    case "reversi":
      return <GoStone owner={owner} cx={cx} cy={cy} size={size} />;
    case "checkers":
      return <CheckerDisc owner={owner} cx={cx} cy={cy} size={size} king={!!highlight} />;
    case "chess":
      return <ChessPiece glyph={glyph} owner={owner} cx={cx} cy={cy} size={size} />;
    case "janggi":
      return (
        <JanggiTile glyph={glyph} owner={owner} cx={cx} cy={cy} size={size} highlight={!!highlight} />
      );
    default:
      return null;
  }
}
