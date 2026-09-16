import { FormEvent, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AI_LEVELS,
  GAME_LIST,
  getEngine,
  type AiLevel,
  type GameId,
} from "@board-online/shared";
import { GonuPreview } from "../components/boards/GonuBoard.js";
import GameSetup from "../components/GameSetup.js";
import SiteHeader, { ArrowIcon } from "../components/SiteHeader.js";
import { GAME_DETAILS, type Category } from "../lib/catalogue.js";
import { emitAck } from "../lib/socket.js";
import { setSeatToken } from "../lib/storage.js";
import "../styles/home.css";

type PlayMode = "ai" | "online" | "local";
const MODES: { id: PlayMode; label: string }[] = [
  { id: "local", label: "같은 화면" },
  { id: "online", label: "친구 초대" },
  { id: "ai", label: "컴퓨터 대전" },
];
const CATEGORIES: Category[] = ["전체", "전략", "전통", "가볍게"];

export default function Home() {
  const navigate = useNavigate();
  const [setupGame, setSetupGame] = useState<GameId | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [busyGame, setBusyGame] = useState<GameId | null>(null);
  const creating = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [setupChoice, setSetupChoice] = useState<Record<string, string>>({});
  const [aiLevel, setAiLevel] = useState<AiLevel>("normal");
  const [mode, setMode] = useState<PlayMode>("local");
  const [category, setCategory] = useState<Category>("전체");
  const visibleGames = GAME_LIST.filter(
    (id) =>
      category === "전체" || GAME_DETAILS[id].categories.includes(category),
  );

  async function handleCreate(gameId: GameId) {
    if (creating.current) return;
    creating.current = true;
    setBusyGame(gameId);
    setError(null);
    try {
      const res = await emitAck<any>("room:create", {
        gameId,
        setupId: setupChoice[gameId],
      });
      if (!res.ok) {
        setError(res.error ?? "방을 만들지 못했습니다.");
        return;
      }
      setSeatToken(res.code, res.seatToken);
      navigate(`/room/${res.code}`);
    } catch {
      setError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      creating.current = false;
      setBusyGame(null);
    }
  }

  function handleJoin(e: FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(code)) navigate(`/room/${code}`);
  }

  function playPath(id: GameId) {
    const query = new URLSearchParams();
    if (mode === "ai") query.set("level", aiLevel);
    if (setupChoice[id]) query.set("setup", setupChoice[id]);
    return `/${mode === "ai" ? "ai" : "local"}/${id}${query.size ? `?${query}` : ""}`;
  }

  if (setupGame) {
    const meta = getEngine(setupGame).meta;
    return <GameSetup meta={meta} mode="친구 초대" setupId={setupChoice[setupGame] ?? meta.setupOptions?.[0].id} onSetupChange={id => setSetupChoice(prev => ({ ...prev, [setupGame]: id }))} onStart={() => handleCreate(setupGame)} onCancel={() => { setSetupGame(null); setError(null); }} busy={busyGame !== null} error={error} startLabel="방 만들고 친구 초대" />;
  }

  return (
    <div className="home-page">
      <SiteHeader />
      <main>
        <section className="home-hero" aria-labelledby="hero-title">
          <div className="home-hero-image" aria-hidden="true">
            <img
              src="/art/table-still-life.webp"
              alt=""
              width="1536"
              height="1024"
            />
          </div>
          <div className="home-hero-copy">
            <h1 id="hero-title">
              마주 앉는 즐거움,
              <br />
              어디서나 한 판.
            </h1>
            <p>
              하나의 화면, 마주 앉은 두 사람.
              <br />
              오래된 게임의 새로운 플레이 공간.
            </p>
            <div className="home-hero-actions">
              <Link className="home-hero-primary" to="/local/gomoku">
                둘이서 한 판
              </Link>
              <a className="home-text-link" href="#games">
                게임 둘러보기 <ArrowIcon />
              </a>
            </div>
          </div>
        </section>

        <section className="home-join" aria-label="방 코드로 입장하기">
          <div className="home-join-copy">
            <svg
              className="home-friends-icon"
              viewBox="0 0 32 32"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="12" cy="10" r="4" />
              <path d="M3 26v-3a9 9 0 0 1 18 0v3Z" />
              <circle cx="23" cy="11" r="3.5" />
              <path d="M23 18a7 7 0 0 1 7 7v1h-6v-3a12 12 0 0 0-1-5Z" />
            </svg>
            <div>
              <h2>친구가 기다리고 있나요?</h2>
              <p>초대받은 방 코드로 바로 입장하세요.</p>
            </div>
          </div>
          <form className="home-join-form" onSubmit={handleJoin}>
            <input
              aria-label="방 코드 6자리"
              value={joinCode}
              onChange={(e) =>
                setJoinCode(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                )
              }
              placeholder="방 코드 6자리"
              maxLength={6}
              minLength={6}
              pattern="[A-Za-z0-9]{6}"
              required
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit">입장하기</button>
          </form>
        </section>

        <section
          className="home-catalogue"
          id="games"
          aria-labelledby="games-title"
        >
          <div className="home-catalogue-heading">
            <div>
              <h2 id="games-title">오늘은 어떤 게임을 할까요?</h2>
              <p>{GAME_LIST.length}가지 클래식, 취향대로 골라보세요.</p>
            </div>
            <div className="home-modes" role="group" aria-label="대전 방식">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={mode === item.id}
                  onClick={() => setMode(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="home-filters">
            <div
              className="home-categories"
              role="group"
              aria-label="게임 분류"
            >
              {CATEGORIES.map((item) => (
                <button
                  key={item}
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            {mode === "ai" ? (
              <label className="home-difficulty">
                난이도
                <select
                  value={aiLevel}
                  onChange={(e) => setAiLevel(e.target.value as AiLevel)}
                  aria-label="컴퓨터 난이도"
                >
                  {AI_LEVELS.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="home-mode-note">
                {mode === "online"
                  ? "방 코드로 친구와 함께"
                  : "한 기기에서 번갈아 두기"}
              </span>
            )}
          </div>
          {error && (
            <p className="home-error" role="alert">
              {error}
            </p>
          )}
          <div className="home-grid">
            {visibleGames.map((id) => {
              const engine = getEngine(id);
              const detail = GAME_DETAILS[id];
              const action = mode === "online" ? "친구 초대하기" : "시작하기";
              return (
                <article className="home-card" key={id}>
                  {id === "gonu" ? <div className="home-card-photo home-card-photo--gonu"><GonuPreview /></div> : <div
                    className="home-card-photo"
                    aria-hidden="true"
                    style={{
                      backgroundPosition: `${(detail.art % 3) * 50}% ${Math.floor(detail.art / 3) * 50}%`,
                    }}
                  />}
                  <div className="home-card-body">
                    <h3>{engine.meta.nameKo}</h3>
                    <p className="home-card-description">
                      {detail.description}
                    </p>
                    <div className="home-card-bottom">
                      <span>{engine.meta.playerLabels.join(" vs ")}</span>
                      {mode === "online" ? (
                        <button
                          className="home-card-action"
                          disabled={busyGame !== null}
                          onClick={() => { setError(null); setSetupGame(id); }}
                          aria-label={`${engine.meta.nameKo} 친구 초대하기`}
                        >
                          {busyGame === id ? "방 만드는 중..." : action}
                          <ArrowIcon />
                        </button>
                      ) : (
                        <Link
                          className="home-card-action"
                          to={playPath(id)}
                          aria-label={`${engine.meta.nameKo} ${mode === "ai" ? "컴퓨터 대전" : "같은 화면"} 시작하기`}
                        >
                          {action}
                          <ArrowIcon />
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <footer className="home-footer">
        <span>보드온라인</span>
        <p>설치도, 로그인도 없이. 우리 사이에 한 판.</p>
        <span>고전·전통 보드게임 {GAME_LIST.length}종</span>
      </footer>
    </div>
  );
}
