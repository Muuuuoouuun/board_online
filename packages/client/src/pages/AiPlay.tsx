import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AI_LEVELS, getEngine, isAiLevel, isGameId, type AiLevel, type GameId, type PlayerIndex } from "@board-online/shared";
import GameView from "../components/GameView.js";
import RulesModal from "../components/RulesModal.js";
import ResultModal, { type ResultKind } from "../components/ResultModal.js";
import SoundToggle from "../components/SoundToggle.js";
import PageBar from "../components/PageBar.js";
import { requestAiMove } from "../lib/ai.js";

/** The computer's first action of a turn lands no sooner than this; instant replies feel like a bug. */
const MIN_THINK_MS = 420;
/**
 * Pacing for the rest of a multi-step turn (a yut throw followed by its move,
 * the cells of a 땅따먹기 path, the flicks of a stone). Yut keeps a beat so the
 * thrown sticks can be read; the path games just need to look like drawing.
 */
function stepDelayMs(gameId: GameId): number {
  return gameId === "yut" ? 450 : 160;
}

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
  // How many actions the computer has taken in its current turn (0 = the turn just started).
  const aiSteps = useRef(0);

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
    if (status.status !== "ongoing" || turn !== computer) {
      aiSteps.current = 0;
      return;
    }
    const serial = gameSerial.current;
    let cancelled = false;
    setThinking(true);
    const started = Date.now();
    const minMs = aiSteps.current === 0 ? MIN_THINK_MS : stepDelayMs(gameId);
    requestAiMove(gameId, state, computer, level).then((move) => {
      const wait = Math.max(0, minMs - (Date.now() - started));
      setTimeout(() => {
        if (cancelled || serial !== gameSerial.current) return;
        setThinking(false);
        if (move === null || move === undefined) return;
        setState((current: any) => {
          if (current !== state) return current; // a newer state already replaced this one
          const result = engine.applyMove(current, move, computer);
          if (!result.ok) return current;
          aiSteps.current++;
          return result.state;
        });
      }, wait);
    });
    return () => {
      cancelled = true;
    };
  }, [state, computer, level, gameId, engine, status.status, turn]);

  function startNewGame(nextSetup = setupId, nextHuman = human) {
    gameSerial.current++;
    aiSteps.current = 0;
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

  let statusText = "";
  if (status.status === "ongoing") {
    statusText = thinking || turn === computer ? "컴퓨터가 생각하는 중..." : "당신의 차례입니다";
  }

  return (
    <div className="page">
      <PageBar title={engine.meta.nameKo} mode="컴퓨터와 대전" />

      <div className="toolbar">
        <div className="toolbar-group">
          <button className="secondary-btn" onClick={() => setShowRules(true)}>
            규칙
          </button>
          <SoundToggle />
          {status.status !== "ongoing" && resultDismissed && (
            <button className="rematch-btn" onClick={() => startNewGame()}>
              다시 하기
            </button>
          )}
        </div>
        <div className="toolbar-group toolbar-group--settings">
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
        </div>
      </div>

      <p className="you-label">
        나는 <strong>{engine.meta.playerLabels[human]}</strong>, 컴퓨터는{" "}
        <strong>{engine.meta.playerLabels[computer]}</strong>
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
