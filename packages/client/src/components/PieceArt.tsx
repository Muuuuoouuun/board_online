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
        <stop offset="0%" stopColor="#666861" />
        <stop offset="32%" stopColor="#383a33" />
        <stop offset="72%" stopColor="#1c1e19" />
        <stop offset="100%" stopColor="#10120f" />
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
      <linearGradient id="bo-chess-white-grad" x1="0%" y1="10%" x2="100%" y2="65%">
        <stop offset="0%" stopColor="#c8b78f" />
        <stop offset="32%" stopColor="#fffbed" />
        <stop offset="60%" stopColor="#f1e7cd" />
        <stop offset="100%" stopColor="#c1aa7e" />
      </linearGradient>
      <linearGradient id="bo-chess-black-grad" x1="0%" y1="10%" x2="100%" y2="65%">
        <stop offset="0%" stopColor="#20261f" />
        <stop offset="32%" stopColor="#606959" />
        <stop offset="65%" stopColor="#303a2c" />
        <stop offset="100%" stopColor="#171d16" />
      </linearGradient>

      {/* Janggi wooden tile */}
      <radialGradient id="bo-wood-grad" cx="38%" cy="30%" r="78%">
        <stop offset="0%" stopColor="#fffdf0" />
        <stop offset="45%" stopColor="#f4ecd5" />
        <stop offset="100%" stopColor="#dfceaa" />
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
  const hlOpacity = isBlack ? 0.07 : 0.18;
  return (
    <g pointerEvents="none">
      <ellipse cx={cx} cy={cy + r * 0.58} rx={r * 0.92} ry={r * 0.3} fill="url(#bo-shadow-grad)" />
      <circle cx={cx + 0.6} cy={cy + 2} r={r} fill="#29251c" opacity=".22" />
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

function ChessPiece({ glyph, owner, cx, cy, size }: Omit<PieceArtProps, "game">) {
  const white = owner === 0;
  const fill = `url(#bo-chess-${white ? "white" : "black"}-grad)`;
  const edge = white ? "#776549" : "#181b16";
  const detail = white ? "#ad9872" : "#899080";
  const pawn = glyph === "♟";

  return (
    <g transform={`translate(${cx} ${cy}) scale(${size / BASE_CELL})`} pointerEvents="none">
      <ellipse cy="18" rx={pawn ? 12 : 16} ry="3.2" fill="url(#bo-shadow-grad)" />
      <g fill={fill} stroke={edge} strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round">
        {pawn && <>
          <path d="M-9 12 Q-3 6-4-1 H4 Q3 6 9 12Z" />
          <path d="M-6-2 Q0-4 6-2 L5 1 H-5Z" />
          <circle cy="-8" r="5.8" />
        </>}
        {glyph === "♜" && <>
          <path d="M-11 12 L-7 7-7-6 H7 L7 7 11 12Z" />
          <path d="M-10-6 V-16 H-6 V-12 H-2 V-16 H2 V-12 H6 V-16 H10 V-6Z" />
          <path d="M-7-4 H7 M-8 8 H8" fill="none" stroke={detail} />
        </>}
        {glyph === "♝" && <>
          <path d="M-11 12 Q-4 8-4 1 H4 Q4 8 11 12Z" />
          <path d="M0-18 C-4-14-8-11-7-6 Q-6-1 0 0 Q6-1 7-6 C8-11 4-14 0-18Z" />
          <circle cy="-18" r="1.7" />
          <path d="M2-13 L-2-7" fill="none" stroke={detail} strokeWidth="2" />
          <path d="M-6 2 H6" fill="none" stroke={detail} />
        </>}
        {glyph === "♞" && <>
          <path d="M-12 12 C-11 6-10 3-6 0 L-1-5-6-4-10-1-14-4-11-10-5-15-4-20 0-17 3-18 C13-13 12 0 9 6 L12 12Z" />
          <path d="M3-13 C8-9 8-1 5 5 M-5-13 L-9-8" fill="none" stroke={detail} strokeWidth="1.4" />
          <circle cx="-4" cy="-10" r="1.2" fill={edge} stroke="none" />
          <path d="M-12-4 L-9-5" stroke={detail} />
        </>}
        {glyph === "♛" && <>
          <path d="M-12 12 Q-5 6-6-1 H6 Q5 6 12 12Z" />
          <path d="M-7-2 L-12-15-6-10-4-18 0-11 4-18 6-10 12-15 7-2Z" />
          {[[-12,-16],[-4,-19],[4,-19],[12,-16]].map(([x,y]) => <circle key={x} cx={x} cy={y} r="1.7" />)}
          <path d="M-7-2 Q0 0 7-2 M-6 2 H6" fill="none" stroke={detail} />
        </>}
        {glyph === "♚" && <>
          <path d="M-12 12 Q-5 7-6-1 H6 Q5 7 12 12Z" />
          <path d="M-6-1 L-9-8 Q-8-13-3-11 H3 Q8-13 9-8 L6-1Z" />
          <path d="M-1.7-11 V-15 H-5 V-18 H-1.7 V-21 H1.7 V-18 H5 V-15 H1.7 V-11Z" />
          <path d="M-6 1 H6 M-5-7 Q0-5 5-7" fill="none" stroke={detail} />
        </>}
        <path d={pawn ? "M-9 11 Q0 9 9 11 L11 15 H-11Z" : "M-12 11 Q0 9 12 11 L14 15 H-14Z"} />
        <path d={pawn ? "M-11 15 H11 L12 18 H-12Z" : "M-14 15 H14 L15 18 H-15Z"} />
        <path d={pawn ? "M-8 13 H7" : "M-11 13 H10"} stroke={white ? "#fffdf4" : "#a4aa99"} opacity=".65" />
      </g>
    </g>
  );
}

/* Layered ivory octagons: rank is expressed by size, team by engraved ink. */
const JANGGI_RANK_SCALE: Record<string, number> = {
  楚: 1.12, 漢: 1.12, 車: 1.04, 包: 1.04, 馬: 1, 象: 1, 士: .92, 卒: .9, 兵: .9,
};

function JanggiTile({ glyph, owner, cx, cy, size }: Omit<PieceArtProps, "game">) {
  const r = size * .43 * (JANGGI_RANK_SCALE[glyph] ?? 1);
  const ink = owner === 0 ? "#146448" : "#af352c";
  return (
    <g pointerEvents="none">
      <ellipse cx={cx + 1} cy={cy + r * .8} rx={r} ry={r * .35} fill="url(#bo-shadow-grad)" />
      <polygon points={octagonPoints(cx, cy + size * .065, r, 1)} fill="#bba17b" stroke="#846e4e" strokeWidth=".7" strokeLinejoin="round" />
      <polygon points={octagonPoints(cx, cy, r, 1)} fill="url(#bo-wood-grad)" stroke="#fff8e4" strokeWidth="1.1" strokeLinejoin="round" />
      <polygon points={octagonPoints(cx, cy, r * .86, 1)} fill="none" stroke={ink} strokeWidth={size * .015} opacity=".55" strokeLinejoin="round" />
      <text x={cx} y={cy + r * .04} textAnchor="middle" dominantBaseline="central"
        fontSize={r * 1.22} fontWeight="700" fontFamily="'Noto Serif KR', 'Songti SC', serif" fill={ink}>
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
    case "gonu":
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
