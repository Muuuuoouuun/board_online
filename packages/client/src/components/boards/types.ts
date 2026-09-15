import type { PlayerIndex } from "@board-online/shared";

/**
 * Props every custom board renderer receives. Games whose board is not a plain
 * grid (yut's path loop, territory's edges, flick's free surface) implement this
 * instead of using the shared <Board>.
 */
export interface GameViewProps<TState = unknown, TMove = unknown> {
  state: TState;
  legalMoves: TMove[];
  onMove: (move: TMove) => void;
  /** false when it is not your turn, the game is over, or you are waiting for an opponent */
  interactive: boolean;
  /** your seat in an online room; null in local pass-and-play */
  you: PlayerIndex | null;
}
