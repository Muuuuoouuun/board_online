import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getEngine, isGameId, type GameId, type Move } from "@board-online/shared";
import GameView from "../components/GameView.js";
import GameSetup from "../components/GameSetup.js";
import MatchLayout from "../components/MatchLayout.js";
import RulesModal from "../components/RulesModal.js";
import ResultModal from "../components/ResultModal.js";
import { GAME_DETAILS } from "../lib/catalogue.js";

export default function Local() {
  const { gameId = "" } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  if (!isGameId(gameId)) return <div className="page"><p className="error-text">알 수 없는 게임입니다.</p><Link to="/">홈으로 돌아가기</Link></div>;
  return <LocalGame key={gameId} gameId={gameId} initialSetup={searchParams.get("setup") ?? undefined} />;
}

function LocalGame({ gameId, initialSetup }: { gameId: GameId; initialSetup?: string }) {
  const engine = useMemo(() => getEngine(gameId), [gameId]);
  const [setupId, setSetupId] = useState(() => engine.meta.setupOptions?.find(option => option.id === initialSetup)?.id ?? engine.meta.setupOptions?.[0].id);
  const [state, setState] = useState(() => engine.createInitialState(setupId));
  const [started, setStarted] = useState(false);
  const [gameSerial, setGameSerial] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);
  const status = engine.status(state);
  const turn = engine.turn(state);
  const legalMoves = status.status === "ongoing" ? engine.legalMoves(state, turn) : [];
  function handleMove(move: Move) {
    if (!started) return;
    const result = engine.applyMove(state, move, turn);
    if (result.ok) setState(result.state);
  }
  function startGame() {
    setState(engine.createInitialState(setupId));
    setResultDismissed(false);
    setGameSerial(serial => serial + 1);
    setStarted(true);
  }
  if (!started) return <GameSetup meta={engine.meta} mode="같은 화면 2인 플레이" setupId={setupId} onSetupChange={setSetupId} onStart={startGame} />;
  const resultTitle = status.status === "win" ? `${engine.meta.playerLabels[status.winner!]}이 이겼어요!` : "비겼어요";
  return <>
    <MatchLayout meta={engine.meta} status={status.status === "ongoing" ? `${engine.meta.playerLabels[turn]} 차례` : resultTitle} onRules={() => setShowRules(true)} onSetup={() => setStarted(false)}
      details={<><p>같은 화면에서 번갈아 두세요. {GAME_DETAILS[gameId].instruction}</p><p>{GAME_DETAILS[gameId].hint}</p>{status.status !== "ongoing" && resultDismissed && <button className="rematch-btn" onClick={startGame}>다시 하기</button>}</>}
      result={<ResultModal open={status.status !== "ongoing" && !resultDismissed} kind={status.status === "win" ? "win" : "draw"} title={resultTitle} subtitle={status.reason} onRematch={startGame} onClose={() => setResultDismissed(true)} />}>
      <GameView key={gameSerial} engine={engine} state={state} pieces={engine.pieces(state)} legalMoves={legalMoves} onMove={handleMove} interactive={status.status === "ongoing"} you={null} />
    </MatchLayout>
    <RulesModal open={showRules} onClose={() => setShowRules(false)} gameId={gameId} />
  </>;
}
