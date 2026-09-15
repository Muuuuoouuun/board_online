import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AI_LEVELS, GAME_LIST, getEngine, type AiLevel, type GameId } from "@board-online/shared";
import { emitAck } from "../lib/socket.js";
import { setSeatToken } from "../lib/storage.js";
import "../styles/home.css";

/** Shared 4x4 checkerboard cells reused by the chess/checkers motifs. */
const CHECKERBOARD_CELLS: { x: number; y: number; dark: boolean }[] = (() => {
  const cells: { x: number; y: number; dark: boolean }[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      cells.push({ x: 6 + c * 13, y: 6 + r * 13, dark: (r + c) % 2 === 0 });
    }
  }
  return cells;
})();

function CheckerboardCells({ darkFill, lightFill }: { darkFill: string; lightFill: string }) {
  return (
    <>
      {CHECKERBOARD_CELLS.map((cell, i) => (
        <rect key={i} x={cell.x} y={cell.y} width={13} height={13} fill={cell.dark ? darkFill : lightFill} />
      ))}
    </>
  );
}

/** Small decorative, hand-drawn inline-SVG motif hinting at each game's board/pieces. */
function GameMotif({ id }: { id: GameId }) {
  return (
    <svg className="home-motif-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {id === "gomoku" && (
        <>
          <g stroke="#b58863" strokeWidth="1.3" opacity="0.55">
            <line x1="14" y1="10" x2="14" y2="54" />
            <line x1="26" y1="10" x2="26" y2="54" />
            <line x1="38" y1="10" x2="38" y2="54" />
            <line x1="50" y1="10" x2="50" y2="54" />
            <line x1="10" y1="14" x2="54" y2="14" />
            <line x1="10" y1="26" x2="54" y2="26" />
            <line x1="10" y1="38" x2="54" y2="38" />
            <line x1="10" y1="50" x2="54" y2="50" />
          </g>
          <circle cx="26" cy="26" r="7.5" fill="#2b2620" />
          <circle cx="38" cy="38" r="7.5" fill="#faf6ec" stroke="#8a6a45" strokeWidth="1.3" />
        </>
      )}

      {id === "chess" && (
        <>
          <CheckerboardCells darkFill="#b58863" lightFill="#efe2c6" />
          <g fill="#2f6bff">
            <path d="M21 43 L32 25 L43 43 Z" />
            <circle cx="32" cy="19" r="3.6" />
            <rect x="30.4" y="11" width="3.2" height="6.5" />
            <rect x="27" y="13.2" width="10" height="3" />
          </g>
        </>
      )}

      {id === "janggi" && (
        <>
          <g stroke="#8a6a45" strokeWidth="1.6" fill="none">
            <rect x="13" y="13" width="38" height="38" />
            <line x1="13" y1="13" x2="51" y2="51" />
            <line x1="51" y1="13" x2="13" y2="51" />
          </g>
          <polygon
            points="32,19 41,24 41,40 32,45 23,40 23,24"
            fill="#dfb579"
            stroke="#8a6a45"
            strokeWidth="1.4"
          />
          <line x1="26" y1="32" x2="38" y2="32" stroke="#5c3d21" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}

      {id === "checkers" && (
        <>
          <CheckerboardCells darkFill="#b58863" lightFill="#efe2c6" />
          <circle cx="32" cy="37" r="9" fill="#b58863" stroke="#5c3d21" strokeWidth="1.2" />
          <circle cx="32" cy="27" r="9" fill="#efe2c6" stroke="#8a6a45" strokeWidth="1.2" />
        </>
      )}

      {id === "yut" && (
        <>
          <rect x="12" y="12" width="40" height="40" rx="2" fill="none" stroke="#8a6a45" strokeWidth="1.6" />
          <line x1="12" y1="12" x2="52" y2="52" stroke="#c9b48c" strokeWidth="1.2" />
          <line x1="52" y1="12" x2="12" y2="52" stroke="#c9b48c" strokeWidth="1.2" />
          <g fill="#faf6ec" stroke="#8a6a45" strokeWidth="1.2">
            <circle cx="12" cy="12" r="4.6" />
            <circle cx="52" cy="12" r="4.6" />
            <circle cx="12" cy="52" r="4.6" />
            <circle cx="52" cy="52" r="4.6" />
            <circle cx="32" cy="32" r="5.2" />
          </g>
          <circle cx="32" cy="12" r="3.4" fill="#2b2620" />
          <circle cx="12" cy="32" r="3.4" fill="#b3261e" />
        </>
      )}

      {id === "gonu" && (
        <>
          <g stroke="#8a6a45" strokeWidth="1.6" fill="none">
            <rect x="14" y="14" width="36" height="36" />
            <line x1="32" y1="14" x2="32" y2="50" />
            <line x1="14" y1="32" x2="50" y2="32" />
          </g>
          <circle cx="14" cy="14" r="5" fill="#2b2620" />
          <circle cx="50" cy="14" r="5" fill="#faf6ec" stroke="#8a6a45" strokeWidth="1.2" />
          <circle cx="14" cy="50" r="5" fill="#faf6ec" stroke="#8a6a45" strokeWidth="1.2" />
          <circle cx="50" cy="50" r="5" fill="#2b2620" />
        </>
      )}

      {id === "territory" && (
        <>
          <rect x="8" y="8" width="48" height="48" fill="#faf6ec" stroke="#c9b48c" strokeWidth="1.2" />
          <path d="M8 8 H32 V20 H20 V32 H8 Z" fill="#2f6bff" opacity="0.75" />
          <path d="M56 56 H32 V44 H44 V32 H56 Z" fill="#d4622a" opacity="0.75" />
          <polyline
            points="32,20 40,20 40,28 32,28"
            fill="none"
            stroke="#2f6bff"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 2.5"
          />
        </>
      )}

      {id === "flick" && (
        <>
          <rect x="8" y="8" width="48" height="48" rx="3" fill="#faf6ec" stroke="#c9b48c" strokeWidth="1.2" />
          <path d="M8 8 A24 24 0 0 1 32 32 L8 32 Z" fill="#2f6bff" opacity="0.7" />
          <path d="M56 56 A20 20 0 0 0 36 36 L56 36 Z" fill="#d4622a" opacity="0.7" />
          <polyline
            points="18,24 34,18 44,30"
            fill="none"
            stroke="#5c3d21"
            strokeWidth="1.8"
            strokeDasharray="3 2"
            strokeLinecap="round"
          />
          <circle cx="44" cy="30" r="4.6" fill="#2b2620" />
        </>
      )}

      {id === "reversi" && (
        <>
          <g stroke="#c9b48c" strokeWidth="1.2">
            <line x1="8" y1="20" x2="56" y2="20" />
            <line x1="8" y1="32" x2="56" y2="32" />
            <line x1="8" y1="44" x2="56" y2="44" />
            <line x1="20" y1="8" x2="20" y2="56" />
            <line x1="32" y1="8" x2="32" y2="56" />
            <line x1="44" y1="8" x2="44" y2="56" />
          </g>
          <circle cx="26" cy="26" r="6.4" fill="#2b2620" />
          <circle cx="38" cy="26" r="6.4" fill="#faf6ec" stroke="#c9b48c" strokeWidth="1" />
          <circle cx="26" cy="38" r="6.4" fill="#faf6ec" stroke="#c9b48c" strokeWidth="1" />
          <circle cx="38" cy="38" r="6.4" fill="#2b2620" />
        </>
      )}
    </svg>
  );
}

function aiPath(id: GameId, level: AiLevel, setup?: string): string {
  const q = new URLSearchParams({ level });
  if (setup) q.set("setup", setup);
  return `/ai/${id}?${q.toString()}`;
}

export default function Home() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [busyGame, setBusyGame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupChoice, setSetupChoice] = useState<Record<string, string>>({});
  const [aiLevel, setAiLevel] = useState<AiLevel>("normal");

  async function handleCreate(gameId: string) {
    setBusyGame(gameId);
    setError(null);
    const res = await emitAck<any>("room:create", { gameId, setupId: setupChoice[gameId] });
    setBusyGame(null);
    if (!res.ok) {
      setError(res.error ?? "방을 만들지 못했습니다.");
      return;
    }
    setSeatToken(res.code, res.seatToken);
    navigate(`/room/${res.code}`);
  }

  function handleJoin(e: FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    navigate(`/room/${code}`);
  }

  return (
    <div className="home-page">
      <header className="home-hero">
        <span className="home-hero-eyebrow">설치도, 로그인도 필요 없어요</span>
        <h1 className="home-hero-title">보드온라인</h1>
        <p className="home-hero-sub">로그인 없이, 방 코드 하나로 친구와 바로 한 판.</p>
        <ul className="home-feature-list">
          <li>계정 없이 바로 시작</li>
          <li>방 코드로 친구 초대</li>
          {/* Counted from the registry so adding a game can't leave this stale. */}
          <li>고전·전통 보드게임 {GAME_LIST.length}종</li>
          <li>혼자서도 컴퓨터와 대전</li>
        </ul>
      </header>

      <section className="home-join" aria-label="방 코드로 입장하기">
        <form className="home-join-form" onSubmit={handleJoin}>
          <label className="home-join-label" htmlFor="home-join-input">
            이미 방 코드가 있으신가요?
          </label>
          <div className="home-join-row">
            <input
              id="home-join-input"
              className="home-join-input"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="예: 4UEJT3"
              maxLength={8}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="home-join-btn" type="submit">
              입장하기
            </button>
          </div>
        </form>
        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="home-grid" aria-label="게임 목록">
        {GAME_LIST.map((id, i) => {
          const engine = getEngine(id);
          const busy = busyGame === id;
          return (
            <article className="home-card" key={id} style={{ animationDelay: `${i * 70}ms` }}>
              <div className="home-card-motif">
                <GameMotif id={id} />
              </div>
              <div className="home-card-body">
                <h2 className="home-card-title">{engine.meta.nameKo}</h2>
                <span className="home-card-players">{engine.meta.playerLabels.join(" vs ")}</span>
              </div>
              {engine.meta.setupOptions && (
                <label className="home-card-setup">
                  <span>시작 배치</span>
                  <select
                    value={setupChoice[id] ?? engine.meta.setupOptions[0].id}
                    onChange={(e) => setSetupChoice((prev) => ({ ...prev, [id]: e.target.value }))}
                  >
                    {engine.meta.setupOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="home-card-actions">
                <button className="home-card-primary" disabled={busy} onClick={() => handleCreate(id)}>
                  {busy ? "방 만드는 중..." : "친구와 온라인으로"}
                </button>
                <div className="home-card-ai">
                  <Link className="home-card-secondary home-card-ai-link" to={aiPath(id, aiLevel, setupChoice[id])}>
                    컴퓨터와 대전
                  </Link>
                  <select
                    className="home-card-ai-level"
                    value={aiLevel}
                    onChange={(e) => setAiLevel(e.target.value as AiLevel)}
                    aria-label={`${engine.meta.nameKo} 컴퓨터 난이도`}
                  >
                    {AI_LEVELS.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Link
                  className="home-card-secondary"
                  to={setupChoice[id] ? `/local/${id}?setup=${encodeURIComponent(setupChoice[id])}` : `/local/${id}`}
                >
                  같은 화면 2인 플레이
                </Link>
              </div>
            </article>
          );
        })}
      </section>

      <footer className="home-footer">
        <p>초기 MVP · 계정 없이 브라우저에서 바로 플레이합니다.</p>
      </footer>
    </div>
  );
}
