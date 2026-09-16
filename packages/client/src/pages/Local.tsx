import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getEngine, isGameId, type GameId, type Move } from "@board-online/shared";
import GameView from "../components/GameView.js";
import RulesModal from "../components/RulesModal.js";
import ResultModal, { type ResultKind } from "../components/ResultModal.js";
import SoundToggle from "../components/SoundToggle.js";
import PageBar from "../components/PageBar.js";

export default function Local() {
  const params = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  const gameId = params.gameId ?? "";

  if (!isGameId(gameId)) {
    return (
      <div className="page">
        <p className="error-text">알 수 없는 게임입니다.</p>
        <Link to="/">홈으로 돌아가기</Link>
      </div>
    );
  }

  return <LocalGame gameId={gameId} initialSetup={searchParams.get("setup") ?? undefined} />;
}

function LocalGame({ gameId, initialSetup }: { gameId: GameId; initialSetup?: string }) {
  const engine = useMemo(() => getEngine(gameId), [gameId]);
  const setupOptions = engine.meta.setupOptions;
  const [setupId, setSetupId] = useState(() => initialSetup ?? setupOptions?.[0].id);
  const [state, setState] = useState(() => engine.createInitialState(initialSetup));
  const [showRules, setShowRules] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);
  // Changing the opening formation starts a new game, so it stops being on offer
  // once a move has been played.
  const [started, setStarted] = useState(false);

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
    if (result.ok) {
      setStarted(true);
      setState(result.state);
    }
  }

  function handleReset() {
    setStarted(false);
    setState(engine.createInitialState(setupId));
  }

  function handleSetupChange(next: string) {
    setSetupId(next);
    setStarted(false);
    setState(engine.createInitialState(next));
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
      <PageBar title={engine.meta.nameKo} mode="같은 화면 2인" />

      <div className="toolbar">
        <div className="toolbar-group">
          <button className="secondary-btn" onClick={() => setShowRules(true)}>
            규칙
          </button>
          <SoundToggle />
          {status.status !== "ongoing" && resultDismissed && (
            <button className="rematch-btn" onClick={handleReset}>
              다시 하기
            </button>
          )}
        </div>
        {setupOptions && (
          <div className="toolbar-group toolbar-group--settings">
            <label className="toolbar-setup">
              <span>배치</span>
              <select
                value={setupId}
                disabled={started}
                title={started ? "판이 시작된 뒤에는 배치를 바꿀 수 없습니다" : undefined}
                onChange={(e) => handleSetupChange(e.target.value)}
              >
                {setupOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      <p className="status-text" aria-live="polite">
        {status.status === "ongoing" ? `${engine.meta.playerLabels[turn]} 차례` : resultTitle}
      </p>

      <div className="board-wrap">
        <GameView
          engine={engine}
          state={state}
          pieces={pieces}
          legalMoves={legalMoves}
          onMove={handleMove}
          interactive={status.status === "ongoing"}
          you={null}
        />
      </div>

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
