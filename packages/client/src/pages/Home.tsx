import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GAME_LIST, getEngine } from "@board-online/shared";
import { emitAck } from "../lib/socket.js";
import { setSeatToken } from "../lib/storage.js";

export default function Home() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [busyGame, setBusyGame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(gameId: string) {
    setBusyGame(gameId);
    setError(null);
    const res = await emitAck<any>("room:create", { gameId });
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
    <div className="page">
      <header className="hero">
        <h1>보드온라인</h1>
        <p>로그인 없이, 방 코드 하나로 친구와 바로 한 판.</p>
      </header>

      <form className="join-form" onSubmit={handleJoin}>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="방 코드로 입장 (예: 4UEJT3)"
          maxLength={8}
        />
        <button type="submit">입장하기</button>
      </form>

      {error && <p className="error-text">{error}</p>}

      <div className="game-grid">
        {GAME_LIST.map((id) => {
          const engine = getEngine(id);
          return (
            <div className="game-card" key={id}>
              <h2>{engine.meta.nameKo}</h2>
              <p className="game-card-sub">{engine.meta.playerLabels.join(" vs ")}</p>
              <div className="game-card-actions">
                <button disabled={busyGame === id} onClick={() => handleCreate(id)}>
                  {busyGame === id ? "만드는 중..." : "친구와 온라인으로"}
                </button>
                <Link to={`/local/${id}`}>같은 화면 2인 플레이</Link>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="home-footer">
        <p>초기 MVP · 계정 없이 브라우저에서 바로 플레이합니다.</p>
      </footer>
    </div>
  );
}
