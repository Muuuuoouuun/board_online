import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getEngine, isAiLevel, isGameId, type AiLevel, type GameId, type PlayerIndex } from "@board-online/shared";
import GameView from "../components/GameView.js";
import RulesModal from "../components/RulesModal.js";
import ResultModal, { type ResultKind } from "../components/ResultModal.js";
import GameSetup from "../components/GameSetup.js";
import MatchLayout from "../components/MatchLayout.js";
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
      key={gameId}
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
  const [setupId, setSetupId] = useState(() => setupOptions?.find(option => option.id === initialSetup)?.id ?? setupOptions?.[0].id);
  const [level, setLevel] = useState<AiLevel>(initialLevel);
  const [human, setHuman] = useState<PlayerIndex>(initialSide);
  const [state, setState] = useState<any>(() => engine.createInitialState(initialSetup));
  const [started, setStarted] = useState(false);
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
  const humanTurn = started && status.status === "ongoing" && turn === human;
  const legalMoves = humanTurn ? engine.legalMoves(state, human) : [];

  const statusKey = `${status.status}:${status.winner}:${status.reason}`;
  useEffect(() => {
    setResultDismissed(false);
  }, [statusKey]);

  // The computer moves whenever it is its turn. `state` is the dependency, so
  // multi-step turns (extra yut throws, checkers jumps) chain naturally.
  useEffect(() => {
    if (!started || status.status !== "ongoing" || turn !== computer) {
      aiSteps.current = 0;
      return;
    }
    const serial = gameSerial.current;
    let cancelled = false;
    setThinking(true);
    const thinkStartedAt = Date.now();
    const minMs = aiSteps.current === 0 ? MIN_THINK_MS : stepDelayMs(gameId);
    requestAiMove(gameId, state, computer, level).then((move) => {
      const wait = Math.max(0, minMs - (Date.now() - thinkStartedAt));
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
  }, [started, state, computer, level, gameId, engine, status.status, turn]);

  function startNewGame(nextSetup = setupId, nextHuman = human) {
    gameSerial.current++;
    aiSteps.current = 0;
    setThinking(false);
    setHuman(nextHuman);
    setState(engine.createInitialState(nextSetup));
    setResultDismissed(false);
    setStarted(true);
  }

  function handleMove(move: unknown) {
    if (!humanTurn) return;
    const result = engine.applyMove(state, move, human);
    if (result.ok) setState(result.state);
  }

  let resultKind: ResultKind = "draw";
  let resultTitle = "";
  if (status.status === "win") {
    resultKind = status.winner === human ? "win" : "lose";
    resultTitle = status.winner === human ? "내가 이겼어요!" : "컴퓨터가 이겼어요";
  } else if (status.status === "draw") {
    resultTitle = "비겼어요";
  }

  let statusText = "";
  if (status.status === "ongoing") {
    statusText = thinking || turn === computer ? "컴퓨터가 생각하는 중..." : "내 차례";
  }

  if (!started) return <GameSetup meta={engine.meta} mode="컴퓨터와 대전" setupId={setupId} onSetupChange={setSetupId} level={level} onLevelChange={setLevel} human={human} onSideChange={setHuman} onStart={() => startNewGame()} />;

  return <>
    <MatchLayout meta={engine.meta} status={status.status === "ongoing" ? statusText : resultTitle} onRules={() => setShowRules(true)} onSetup={() => { gameSerial.current++; setThinking(false); setStarted(false); }}
      details={<><p>나는 {engine.meta.playerLabels[human]}, 컴퓨터는 {engine.meta.playerLabels[computer]}</p>{status.status !== "ongoing" && resultDismissed && <button className="rematch-btn" onClick={() => startNewGame()}>다시 하기</button>}</>}
      result={<ResultModal open={status.status !== "ongoing" && !resultDismissed} kind={resultKind} title={resultTitle} subtitle={status.reason} onRematch={() => startNewGame()} onClose={() => setResultDismissed(true)} />}>
      <GameView key={gameSerial.current} engine={engine} state={state} pieces={pieces} legalMoves={legalMoves} onMove={handleMove} interactive={humanTurn && !thinking} you={human} />
    </MatchLayout>
    <RulesModal open={showRules} onClose={() => setShowRules(false)} gameId={gameId} />
  </>;
}
