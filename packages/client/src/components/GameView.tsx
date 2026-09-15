import type { BoardPiece, GameEngine, PlayerIndex } from "@board-online/shared";
import Board from "./Board.js";
import FlickBoard from "./boards/FlickBoard.js";
import GonuBoard from "./boards/GonuBoard.js";

interface GameViewProps {
  engine: GameEngine<any, any>;
  state: any;
  pieces: BoardPiece[];
  legalMoves: any[];
  onMove: (move: any) => void;
  interactive: boolean;
  you: PlayerIndex | null;
}

/**
 * Picks the renderer for a game. Grid games share <Board>; games whose board is
 * not a grid of squares or intersections declare their own via meta.renderer.
 */
export default function GameView({ engine, state, pieces, legalMoves, onMove, interactive, you }: GameViewProps) {
  const custom = { state, legalMoves, onMove, interactive, you };

  switch (engine.meta.renderer) {
    case "flick":
      return <FlickBoard {...custom} />;
    case "gonu":
      return <GonuBoard {...custom} />;
    default:
      return (
        <Board meta={engine.meta} pieces={pieces} legalMoves={legalMoves} onMove={onMove} interactive={interactive} />
      );
  }
}
