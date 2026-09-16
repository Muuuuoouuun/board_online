import { useEffect } from "react";
import { playSound } from "../lib/sound.js";

export type ResultKind = "win" | "lose" | "draw";
interface ResultModalProps {
  open: boolean;
  kind: ResultKind;
  title: string;
  subtitle?: string;
  onRematch: () => void;
  onClose: () => void;
}

/** Results stay below the board so the deciding move remains visible. */
export default function ResultModal({ open, kind, title, subtitle, onRematch, onClose }: ResultModalProps) {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => playSound(kind), 260);
    return () => clearTimeout(timer);
  }, [open, kind]);
  if (!open) return null;
  return <section className={`match-result result-${kind}`} aria-label="게임 결과">
    <div role="status"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
    <button className="rematch-btn" onClick={onRematch}>다시 하기</button>
    <button className="secondary-btn" onClick={onClose}>보드만 보기</button>
  </section>;
}
