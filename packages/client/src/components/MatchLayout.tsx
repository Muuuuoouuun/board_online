import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { GameMeta } from "@board-online/shared";
import SoundToggle from "./SoundToggle.js";
import "../styles/match.css";

interface Props {
  meta: GameMeta;
  status: string;
  onRules: () => void;
  onSetup?: () => void;
  children: ReactNode;
  details?: ReactNode;
  result?: ReactNode;
}

export default function MatchLayout({ meta, status, onRules, onSetup, children, details, result }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <main className="match-page" data-game={meta.id}>
    <header className="match-bar">
      <Link to="/" className="match-back" aria-label="게임 목록으로 돌아가기">←</Link>
      <h1>{meta.nameKo}</h1>
      <p className="match-turn" role="status">{status}</p>
      <button className="match-menu-toggle" aria-expanded={menuOpen} aria-controls="match-menu" onClick={() => setMenuOpen(open => !open)}>{menuOpen ? "닫기" : "메뉴"}</button>
    </header>
    {menuOpen && <section id="match-menu" className="match-menu" aria-label="게임 메뉴">
      <button className="secondary-btn" onClick={() => { onRules(); setMenuOpen(false); }}>규칙</button>
      <SoundToggle />
      {onSetup && <button className="secondary-btn" onClick={onSetup}>새 판 설정</button>}
      {details && <div className="match-details">{details}</div>}
    </section>}
    <div className="match-stage"><div className="board-wrap match-board">{children}</div></div>
    {result}
  </main>;
}
