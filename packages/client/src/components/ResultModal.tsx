import Modal from "./Modal.js";

export type ResultKind = "win" | "lose" | "draw";

interface ResultModalProps {
  open: boolean;
  kind: ResultKind;
  title: string;
  subtitle?: string;
  onRematch: () => void;
  onClose: () => void;
}

const ICON: Record<ResultKind, string> = {
  win: "🎉",
  lose: "💀",
  draw: "🤝",
};

export default function ResultModal({ open, kind, title, subtitle, onRematch, onClose }: ResultModalProps) {
  return (
    <Modal open={open} onClose={onClose} panelClassName={`result-panel result-${kind}`}>
      <div className="result-icon">{ICON[kind]}</div>
      <h2 className="result-title">{title}</h2>
      {subtitle && <p className="result-subtitle">{subtitle}</p>}
      <div className="result-actions">
        <button className="rematch-btn" onClick={onRematch}>
          다시 하기
        </button>
        <button className="secondary-btn" onClick={onClose}>
          보드 보기
        </button>
      </div>
    </Modal>
  );
}
