import type { GameId } from "@board-online/shared";
import Modal from "./Modal.js";
import { RULES } from "../lib/rules.js";

interface RulesModalProps {
  open: boolean;
  onClose: () => void;
  gameId: GameId;
}

export default function RulesModal({ open, onClose, gameId }: RulesModalProps) {
  const rule = RULES[gameId];
  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="rules-title">{rule.title} 규칙</h2>
      <ul className="rules-list">
        {rule.points.map((point, i) => (
          <li key={i}>{point}</li>
        ))}
      </ul>
      <button className="modal-close-btn" onClick={onClose}>
        닫기
      </button>
    </Modal>
  );
}
