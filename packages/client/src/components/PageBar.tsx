import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface PageBarProps {
  /** The game's name. */
  title: string;
  /** How it is being played — "컴퓨터와 대전", "같은 화면 2인" — shown quieter than the name. */
  mode?: string;
  /** Anything that belongs on the right of the bar, e.g. the room code. */
  children?: ReactNode;
}

/**
 * Top bar of a game page. Leaving is the one thing a player needs that is not
 * about the game, so it sits in the corner instead of below a board they would
 * have to scroll past.
 */
export default function PageBar({ title, mode, children }: PageBarProps) {
  return (
    <div className="page-bar">
      <Link to="/" className="page-back">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M10 3 5 8l5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        홈
      </Link>
      <h1 className="page-title">
        {title}
        {mode && <span className="page-title-mode"> {mode}</span>}
      </h1>
      {children}
    </div>
  );
}
