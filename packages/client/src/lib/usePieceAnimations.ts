import { useEffect, useRef, useState } from "react";
import type { BoardPiece, Pos } from "@board-online/shared";

export type BoardChangeKind = "place" | "move" | "capture";

export interface BoardChange {
  kind: BoardChangeKind;
  flipped: number;
}

export interface PieceAnimations {
  /** destination posKey -> board square the piece travelled from */
  slideFrom: Record<string, Pos>;
  entered: Set<string>;
  flipped: Set<string>;
  /** pieces that left the board, kept mounted briefly so they can fade out */
  ghosts: BoardPiece[];
  lastMove: { from: Pos | null; to: Pos } | null;
  change: BoardChange | null;
  /** bumped on every board change so one-shot effects can re-fire */
  nonce: number;
}

const EMPTY: PieceAnimations = {
  slideFrom: {},
  entered: new Set(),
  flipped: new Set(),
  ghosts: [],
  lastMove: null,
  change: null,
  nonce: 0,
};

const GHOST_MS = 260;

export function posKey(p: Pos): string {
  return `${p.x},${p.y}`;
}

function signatureOf(pieces: BoardPiece[]): string {
  return pieces.map((p) => `${p.pos.x},${p.pos.y},${p.owner},${p.glyph},${p.highlight ? 1 : 0}`).join("|");
}

/**
 * Diffs the board between updates so the renderer can animate what changed.
 * Piece identity is inferred from the diff (engines emit plain position lists,
 * so a move shows up as one square emptying and another filling).
 */
export function usePieceAnimations(pieces: BoardPiece[]): PieceAnimations {
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const prevRef = useRef<BoardPiece[] | null>(null);
  const nonceRef = useRef(0);
  const [anim, setAnim] = useState<PieceAnimations>(EMPTY);

  const signature = signatureOf(pieces);

  useEffect(() => {
    const current = piecesRef.current;
    const prev = prevRef.current;
    prevRef.current = current;
    if (!prev) return; // first paint: show the board as-is, nothing to animate

    const prevMap = new Map(prev.map((p) => [posKey(p.pos), p]));
    const currMap = new Map(current.map((p) => [posKey(p.pos), p]));

    const appeared: BoardPiece[] = [];
    const flipped = new Set<string>();
    for (const [key, piece] of currMap) {
      const before = prevMap.get(key);
      if (!before) appeared.push(piece);
      else if (before.owner !== piece.owner) flipped.add(key);
    }
    const vanished: BoardPiece[] = [];
    for (const [key, piece] of prevMap) {
      if (!currMap.has(key)) vanished.push(piece);
    }

    if (appeared.length === 0 && vanished.length === 0 && flipped.size === 0) return;

    const slideFrom: Record<string, Pos> = {};
    const entered = new Set<string>();
    let ghosts = vanished;
    let kind: BoardChangeKind = "place";

    // A single piece appearing while one of its own colour vanished is that
    // piece moving; anything else that vanished was captured.
    const mover = appeared.length === 1 ? vanished.find((v) => v.owner === appeared[0].owner) : undefined;
    if (appeared.length === 1 && mover) {
      slideFrom[posKey(appeared[0].pos)] = mover.pos;
      ghosts = vanished.filter((v) => v !== mover);
      kind = ghosts.length > 0 ? "capture" : "move";
    } else {
      for (const piece of appeared) entered.add(posKey(piece.pos));
      kind = vanished.length > 0 ? "capture" : "place";
    }

    const destination = appeared[0]?.pos ?? null;
    nonceRef.current += 1;
    setAnim({
      slideFrom,
      entered,
      flipped,
      ghosts,
      lastMove: destination ? { from: mover?.pos ?? null, to: destination } : null,
      change: { kind, flipped: flipped.size },
      nonce: nonceRef.current,
    });

    const timer = setTimeout(() => {
      setAnim((a) => (a.ghosts.length > 0 ? { ...a, ghosts: [] } : a));
    }, GHOST_MS);
    return () => clearTimeout(timer);
  }, [signature]);

  return anim;
}
