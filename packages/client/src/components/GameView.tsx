import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardPiece, GameEngine, PlayerIndex } from "@board-online/shared";
import Board from "./Board.js";
import FlickBoard from "./boards/FlickBoard.js";
import GonuBoard from "./boards/GonuBoard.js";
import YutBoard from "./boards/YutBoard.js";
import TerritoryBoard from "./boards/TerritoryBoard.js";

interface GameViewProps {
  engine: GameEngine<any, any>;
  state: any;
  pieces: BoardPiece[];
  legalMoves: any[];
  onMove: (move: any) => void;
  interactive: boolean;
  you: PlayerIndex | null;
}

export default function GameView({ engine, state, pieces, legalMoves, onMove, interactive, you }: GameViewProps) {
  const custom = { state, legalMoves, onMove, interactive, you };
  const status = engine.status(state);
  const feedback = useMemo(() => engine.feedback?.(state) ?? null, [engine, state]);
  const wasChecked = useRef(false);
  const [resolved, setResolved] = useState(false);
  const checked = feedback?.kind === "check";
  useEffect(() => {
    if (wasChecked.current && !checked && status.status === "ongoing") setResolved(true);
    else setResolved(false);
    wasChecked.current = checked;
  }, [state, checked, status.status]);
  useEffect(() => {
    if (!resolved) return;
    const timer = setTimeout(() => setResolved(false), 2200);
    return () => clearTimeout(timer);
  }, [resolved]);

  let board;
  switch (engine.meta.renderer) {
    case "flick": board = <FlickBoard {...custom} />; break;
    case "gonu": board = <GonuBoard {...custom} />; break;
    case "yut": board = <YutBoard {...custom} />; break;
    case "territory": board = <TerritoryBoard {...custom} />; break;
    default: {
      const boardFeedback = feedback ?? (status.status === "win" ? {
        kind: "win" as const,
        label: "승리한 말",
        positions: pieces.filter(piece => piece.owner === status.winner).map(piece => piece.pos),
      } : null);
      board = <Board meta={engine.meta} pieces={pieces} feedback={boardFeedback} legalMoves={legalMoves} onMove={onMove} interactive={interactive} />;
    }
  }
  const label = feedback?.label ?? (status.status === "win" ? `${engine.meta.playerLabels[status.winner!]} 승리` : status.status === "draw" ? "무승부" : resolved ? (engine.meta.id === "janggi" ? "멍군 · 장군을 막았습니다" : "체크 해제") : "");
  return <div data-winner={status.winner ?? undefined} className={`game-view${status.status === "win" ? " game-view--won" : ""}`}>
    <div className={`board-notice${checked ? " board-notice--check" : ""}`} role="status" aria-live="polite">
      {label && <span>{label}{checked ? (engine.meta.id === "janggi" ? " · 궁을 지키세요" : " · 왕을 지키세요") : ""}</span>}
    </div>
    {board}
  </div>;
}
