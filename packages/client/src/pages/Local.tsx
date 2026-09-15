import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getEngine, isGameId, type GameId, type Move } from "@board-online/shared";
import Board from "../components/Board.js";
import RulesModal from "../components/RulesModal.js";
import ResultModal, { type ResultKind } from "../components/ResultModal.js";

export default function Local() {
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId ?? "";

  if (!isGameId(gameId)) {
    return (
      <div className="page">
        <p className="error-text">알 수 없는 게임입니다.</p>
        <Link to="/">홈으로 돌아가기</Link>
      </div>
    );
  }

  return <LocalGame gameId={gameId} />;
}

function LocalGame({ gameId }: { gameId: GameId }) {
  const engine = useMemo(() => getEngine(gameId), [gameId]);
  const [state, setState] = useState(() => engine.createInitialState());
  const [showRules, setShowRules] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);

  const status = engine.status(state);
  const turn = engine.turn(state);
  const pieces = engine.pieces(state);
  const legalMoves = status.status === "ongoing" ? engine.legalMoves(state, turn) : [];

  const statusKey = `${status.status}:${status.winner}:${status.reason}`;
  useEffect(() => {
    setResultDismissed(false);
  }, [statusKey]);

  function handleMove(move: Move) {
    const result = engine.applyMove(state, move, turn);
    if (result.ok) setState(result.state);
  }

  function handleReset() {
    setState(engine.createInitialState());
  }

  let resultKind: ResultKind = "draw";
  let resultTitle = "";
  if (status.status === "win") {
    resultKind = "win";
    resultTitle = `${engine.meta.playerLabels[status.winner!]} 승리!`;
  } else if (status.status === "draw") {
    resultKind = "draw";
    resultTitle = "무승부";
  }

  return (
    <div className="page">
      <h1>{engine.meta.nameKo} · 같은 화면 2인 플레이</h1>

      <div className="toolbar">
        <button className="secondary-btn" onClick={() => setShowRules(true)}>
          규칙 보기
        </button>
        {status.status !== "ongoing" && resultDismissed && (
          <button className="rematch-btn" onClick={handleReset}>
            처음부터 다시
          </button>
        )}
      </div>

      {status.status === "ongoing" && <p className="status-text">{engine.meta.playerLabels[turn]} 차례</p>}

      <div className="board-wrap">
        <Board
          meta={engine.meta}
          pieces={pieces}
          legalMoves={legalMoves}
          onMove={handleMove}
          interactive={status.status === "ongoing"}
        />
      </div>

      <Link to="/" className="leave-link">
        홈으로
      </Link>

      <RulesModal open={showRules} onClose={() => setShowRules(false)} gameId={gameId} />
      <ResultModal
        open={status.status !== "ongoing" && !resultDismissed}
        kind={resultKind}
        title={resultTitle}
        subtitle={status.reason}
        onRematch={handleReset}
        onClose={() => setResultDismissed(true)}
      />
    </div>
  );
}
