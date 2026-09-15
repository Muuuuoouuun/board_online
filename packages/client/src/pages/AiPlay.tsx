import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AI_LEVELS, getEngine, isAiLevel, isGameId, type AiLevel, type GameId, type PlayerIndex } from "@board-online/shared";
import GameView from "../components/GameView.js";
import RulesModal from "../components/RulesModal.js";
import ResultModal, { type ResultKind } from "../components/ResultModal.js";
import SoundToggle from "../components/SoundToggle.js";
import { requestAiMove } from "../lib/ai.js";

/** The computer answers at least this quickly-looking; instant replies feel like a bug. */
const MIN_THINK_MS = 420;

export default function AiPlay() {
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

  const levelParam = searchParams.get("level") ?? "";
  const sideParam = searchParams.get("side");
  return (
    <AiGame
      gameId={gameId}
      initialLevel={isAiLevel(levelParam) ? levelParam : "normal"}
      initialSide={sideParam === "1" ? 1 : 0}
      initialSetup={searchParams.get("setup") ?? undefined}
    />
  );
}

interface AiGameProps {
  gameId: GameId;
  initialLevel: AiLevel;
  initialSide: PlayerIndex;
  initialSetup?: string;
}

function AiGame({ gameId, initialLevel, initialSide, initialSetup }: AiGameProps) {
  const engine = useMemo(() => getEngine(gameId), [gameId]);
  const setupOptions = engine.meta.setupOptions;
  const [setupId, setSetupId] = useState(() => initialSetup ?? setupOptions?.[0].id);
  const [level, setLevel] = useState<AiLevel>(initialLevel);
  const [human, setHuman] = useState<PlayerIndex>(initialSide);
  const [state, setState] = useState<any>(() => engine.createInitialState(initialSetup));
  const [thinking, setThinking] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);
  // Bumped whenever a new game starts so a computer reply for the old one is discarded.
  const gameSerial = useRef(0);

  const computer: PlayerIndex = human === 0 ? 1 : 0;
  const status = engine.status(state);
  const turn = engine.turn(state);
  const pieces = engine.pieces(state);
  const humanTurn = status.status === "ongoing" && turn === human;
  const legalMoves = humanTurn ? engine.legalMoves(state, human) : [];

  const statusKey = `${status.status}:${status.winner}:${status.reason}`;
  useEffect(() => {
    setResultDismissed(false);
  }, [statusKey]);

  // The computer moves whenever it is its turn. `state` is the dependency, so
  // multi-step turns (extra yut throws, checkers jumps) chain naturally.
  useEffect(() => {
    if (status.status !== "ongoing" || turn !== computer) return;
    const serial = gameSerial.current;
    let cancelled = false;
    setThinking(true);
    const started = Date.now();
    requestAiMove(gameId, state, computer, level).then((move) => {
      const wait = Math.max(0, MIN_THINK_MS - (Date.now() - started));
      setTimeout(() => {
        if (cancelled || serial !== gameSerial.current) return;
        setThinking(false);
        if (move === null || move === undefined) return;
        setState((current: any) => {
          if (current !== state) return current; // a newer state already replaced this one
          const result = engine.applyMove(current, move, computer);
          return result.ok ? result.state : current;
        });
      }, wait);
    });
    return () => {
      cancelled = true;
    };
  }, [state, computer, level, gameId, engine, status.status, turn]);

  function startNewGame(nextSetup = setupId, nextHuman = human) {
    gameSerial.current++;
    setThinking(false);
    setHuman(nextHuman);
    setState(engine.createInitialState(nextSetup));
  }

  function handleMove(move: unknown) {
    if (!humanTurn) return;
    const result = engine.applyMove(state, move, human);
    if (result.ok) setState(result.state);
  }

  function handleSetupChange(next: string) {
    setSetupId(next);
    startNewGame(next);
  }

  function handleSwapSides() {
    startNewGame(setupId, computer);
  }

  let resultKind: ResultKind = "draw";
  let resultTitle = "";
  if (status.status === "win") {
    resultKind = status.winner === human ? "win" : "lose";
    resultTitle = status.winner === human ? "승리했습니다!" : "컴퓨터가 이겼습니다";
  } else if (status.status === "draw") {
    resultTitle = "무승부";
  }

  const levelInfo = AI_LEVELS.find((l) => l.id === level) ?? AI_LEVELS[1];
  let statusText = "";
  if (status.status === "ongoing") {
    statusText = thinking || turn === computer ? "컴퓨터가 생각하는 중..." : "당신의 차례입니다";
  }

  return (
    <div className="page">
      <h1>{engine.meta.nameKo} · 컴퓨터와 대전</h1>

      <div className="toolbar">
        <button className="secondary-btn" onClick={() => setShowRules(true)}>
          규칙 보기
        </button>
        <SoundToggle />
        <label className="toolbar-setup">
          <span>난이도</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as AiLevel)} aria-label="컴퓨터 난이도">
            {AI_LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        {setupOptions && (
          <label className="toolbar-setup">
            <span>배치</span>
            <select value={setupId} onChange={(e) => handleSetupChange(e.target.value)}>
              {setupOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="secondary-btn" onClick={handleSwapSides} title="새 판을 상대 색으로 시작합니다">
          선후 바꾸기
        </button>
        {status.status !== "ongoing" && resultDismissed && (
          <button className="rematch-btn" onClick={() => startNewGame()}>
            처음부터 다시
          </button>
        )}
      </div>

      <p className="you-label">
        나는 <strong>{engine.meta.playerLabels[human]}</strong>, 컴퓨터는{" "}
        <strong>{engine.meta.playerLabels[computer]}</strong> · {levelInfo.label} ({levelInfo.description})
      </p>
      {statusText && (
        <p className={`status-text${thinking ? " status-text--thinking" : ""}`} aria-live="polite">
          {statusText}
        </p>
      )}

      <div className="board-wrap">
        <GameView
          engine={engine}
          state={state}
          pieces={pieces}
          legalMoves={legalMoves}
          onMove={handleMove}
          interactive={humanTurn && !thinking}
          you={human}
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
        onRematch={() => startNewGame()}
        onClose={() => setResultDismissed(true)}
      />
    </div>
  );
}
