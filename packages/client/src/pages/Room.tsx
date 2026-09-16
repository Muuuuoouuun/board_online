import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getEngine, type GameId, type Move, type PlayerIndex } from "@board-online/shared";
import { emitAck, socket } from "../lib/socket.js";
import { getSeatToken, setSeatToken } from "../lib/storage.js";
import GameView from "../components/GameView.js";
import RulesModal from "../components/RulesModal.js";
import ResultModal, { type ResultKind } from "../components/ResultModal.js";
import MatchLayout from "../components/MatchLayout.js";

interface RoomData {
  gameId: GameId;
  state: any;
  players: { index: PlayerIndex; connected: boolean }[];
}

export default function Room() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();

  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [you, setYou] = useState<PlayerIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);

  const syncRoom = useCallback(async () => {
    const token = getSeatToken(code);
    const res = await emitAck<any>("room:join", { code, seatToken: token });
    if (!res.ok) {
      // A missing server is not a permanent error: keep the retry-on-connect
      // handler alive by leaving roomData alone, but tell the player why nothing happens.
      setError(res.error ?? "방에 입장할 수 없습니다.");
      return;
    }
    setError(null);
    setSeatToken(code, res.seatToken);
    setYou(res.you);
    setRoomData({ gameId: res.gameId, state: res.state, players: res.players });
  }, [code]);

  useEffect(() => {
    if (!code) return;
    syncRoom();
    socket.on("connect", syncRoom);
    function onState(payload: any) {
      if (payload.code !== code) return;
      setRoomData({ gameId: payload.gameId, state: payload.state, players: payload.players });
    }
    socket.on("room:state", onState);
    return () => {
      socket.off("connect", syncRoom);
      socket.off("room:state", onState);
    };
  }, [code, syncRoom]);

  const statusKey = roomData ? `${engineStatusKey(roomData)}` : "";
  useEffect(() => {
    setResultDismissed(false);
  }, [statusKey]);

  async function handleMove(move: Move) {
    setMoveError(null);
    const res = await emitAck<any>("move", { code, move });
    if (!res.ok) setMoveError(res.error ?? "둘 수 없는 이동입니다.");
  }

  async function handleRematch() {
    await emitAck("rematch", { code });
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/room/${code}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (error) {
    return (
      <div className="page">
        <p className="error-text">{error}</p>
        <Link to="/">홈으로 돌아가기</Link>
      </div>
    );
  }

  if (!roomData || you === null) {
    return (
      <div className="page">
        <p>방에 연결하는 중...</p>
      </div>
    );
  }

  const engine = getEngine(roomData.gameId);
  const status = engine.status(roomData.state);
  const turn = engine.turn(roomData.state);
  const pieces = engine.pieces(roomData.state);
  const legalMoves = status.status === "ongoing" ? engine.legalMoves(roomData.state, you) : [];
  const myTurn = status.status === "ongoing" && turn === you;
  const opponent = roomData.players.find((p) => p.index !== you);
  const waitingForOpponent = roomData.players.length < 2;

  let statusText: string;
  if (status.status !== "ongoing") {
    statusText = "";
  } else if (waitingForOpponent) {
    statusText = "친구가 들어오길 기다리는 중...";
  } else if (!opponent?.connected) {
    statusText = "상대방의 연결이 끊겼습니다. 잠시만 기다려주세요.";
  } else {
    statusText = myTurn ? "당신의 차례입니다" : "상대방의 차례입니다";
  }

  let resultKind: ResultKind = "draw";
  let resultTitle = "";
  if (status.status === "win") {
    resultKind = status.winner === you ? "win" : "lose";
    resultTitle = status.winner === you ? "승리했습니다!" : "패배했습니다";
  } else if (status.status === "draw") {
    resultKind = "draw";
    resultTitle = "무승부";
  }

  return <>
    <MatchLayout meta={engine.meta} status={status.status === "ongoing" ? statusText : resultTitle} onRules={() => setShowRules(true)}
      details={<><p>나는 {engine.meta.playerLabels[you]}</p><div className="room-code-box"><span>방 코드</span><strong>{code}</strong><button onClick={handleCopyLink}>{copied ? "복사됨" : "초대 링크 복사"}</button></div>{status.status !== "ongoing" && resultDismissed && <button className="rematch-btn" onClick={handleRematch}>다시 하기</button>}</>}
      result={<ResultModal open={status.status !== "ongoing" && !resultDismissed} kind={resultKind} title={resultTitle} subtitle={status.reason} onRematch={handleRematch} onClose={() => setResultDismissed(true)} />}>
      {waitingForOpponent && <div className="match-invite"><span>방 코드 <strong>{code}</strong></span><button className="secondary-btn" onClick={handleCopyLink}>{copied ? "복사됨" : "초대 링크 복사"}</button></div>}
      {moveError && <p className="error-text" role="alert">{moveError}</p>}
      <GameView engine={engine} state={roomData.state} pieces={pieces} legalMoves={legalMoves} onMove={handleMove} interactive={myTurn && !!opponent?.connected} you={you} />
    </MatchLayout>
    <RulesModal open={showRules} onClose={() => setShowRules(false)} gameId={roomData.gameId} />
  </>;
}

function engineStatusKey(roomData: RoomData): string {
  const engine = getEngine(roomData.gameId);
  const status = engine.status(roomData.state);
  return `${status.status}:${status.winner}:${status.reason}`;
}
