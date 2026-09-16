import { Link } from "react-router-dom";
import { AI_LEVELS, type AiLevel, type GameMeta, type PlayerIndex } from "@board-online/shared";
import { GAME_DETAILS } from "../lib/catalogue.js";
import "../styles/match.css";

interface Props {
  meta: GameMeta;
  mode: string;
  setupId?: string;
  onSetupChange: (id: string) => void;
  level?: AiLevel;
  onLevelChange?: (level: AiLevel) => void;
  human?: PlayerIndex;
  onSideChange?: (side: PlayerIndex) => void;
  onStart: () => void;
  onCancel?: () => void;
  busy?: boolean;
  error?: string | null;
  startLabel?: string;
}

export default function GameSetup({ meta, mode, setupId, onSetupChange, level, onLevelChange, human, onSideChange, onStart, onCancel, busy, error, startLabel = "게임 시작" }: Props) {
  return <main className="game-setup">
    {onCancel ? <button className="setup-back" onClick={onCancel} disabled={busy}>← 돌아가기</button> : <Link className="setup-back" to="/">← 게임 목록</Link>}
    <header className="setup-heading">
      <span>{mode}</span>
      <h1>{meta.nameKo}<span>한 판 준비</span></h1>
      <p>{meta.setupOptions ? "마와 상의 자리를 고르고 시작하세요." : GAME_DETAILS[meta.id].description}</p>
    </header>
    {meta.setupOptions && <fieldset className="setup-fieldset">
      <legend>시작 배치</legend>
      <p className="setup-help">내 쪽에서 바라본 왼쪽 → 오른쪽 순서입니다. 양쪽에 같은 배치를 적용합니다.</p>
      <div className="formation-options">
        {meta.setupOptions.map(option => <label className={`formation-option${setupId === option.id ? " is-selected" : ""}`} key={option.id}>
          <input type="radio" aria-label={option.label} name="formation" value={option.id} checked={setupId === option.id} onChange={() => onSetupChange(option.id)} disabled={busy} />
          <span className="formation-title">{option.label}<span aria-hidden="true">{setupId === option.id ? "✓" : "○"}</span></span>
          <span className="formation-pieces" aria-hidden="true">{[...option.label].map((piece, i) => <span key={i}>{piece === "마" ? "馬" : "象"}</span>)}</span>
          <small>{option.description}</small>
        </label>)}
      </div>
    </fieldset>}
    {onLevelChange && <fieldset className="setup-fieldset">
      <legend>컴퓨터 난이도</legend>
      <div className="setup-segments">{AI_LEVELS.map(item => <button key={item.id} aria-pressed={level === item.id} onClick={() => onLevelChange(item.id)}>{item.label}</button>)}</div>
    </fieldset>}
    {onSideChange && <fieldset className="setup-fieldset">
      <legend>내 차례</legend>
      <div className="setup-segments">{meta.playerLabels.map((label, index) => <button key={label} aria-pressed={human === index} onClick={() => onSideChange(index as PlayerIndex)}>{label} · {index === 0 ? "선공" : "후공"}</button>)}</div>
    </fieldset>}
    <div className="setup-summary"><strong>{meta.playerLabels[0]} 선공</strong><span>{GAME_DETAILS[meta.id].instruction}</span></div>
    {error && <p className="error-text" role="alert">{error}</p>}
    <button className="setup-start" onClick={onStart} disabled={busy}>{busy ? "준비하는 중…" : startLabel}<span aria-hidden="true">→</span></button>
    <p className="setup-footnote">시작하면 보드가 크게 표시됩니다. 규칙과 소리는 메뉴에서 확인하세요.</p>
  </main>;
}
