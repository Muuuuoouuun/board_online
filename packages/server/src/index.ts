import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { getEngine, type Move } from "@board-online/shared";
import {
  createRoom,
  disconnectSocket,
  findRoom,
  isValidGameId,
  joinRoom,
  resetRoom,
  roomCount,
  roomSummary,
  seatForSocket,
  startRoomCleanup,
} from "./rooms.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rooms: roomCount() });
});

const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

io.on("connection", (socket) => {
  socket.on("room:create", (payload: { gameId?: string }, ack?: (res: unknown) => void) => {
    const gameId = payload?.gameId;
    if (!gameId || !isValidGameId(gameId)) {
      ack?.({ ok: false, error: "알 수 없는 게임입니다." });
      return;
    }
    const { room, seat } = createRoom(gameId, socket.id);
    socket.join(room.code);
    ack?.({ ok: true, you: seat.playerIndex, seatToken: seat.seatToken, ...roomSummary(room) });
  });

  socket.on("room:join", (payload: { code?: string; seatToken?: string }, ack?: (res: unknown) => void) => {
    const code = payload?.code?.trim();
    if (!code) {
      ack?.({ ok: false, error: "방 코드를 입력하세요." });
      return;
    }
    const result = joinRoom(code, socket.id, payload?.seatToken);
    if (!result.ok) {
      ack?.(result);
      return;
    }
    socket.join(result.room.code);
    ack?.({ ok: true, you: result.seat.playerIndex, seatToken: result.seat.seatToken, ...roomSummary(result.room) });
    io.to(result.room.code).emit("room:state", roomSummary(result.room));
  });

  socket.on("move", (payload: { code?: string; move?: Move }, ack?: (res: unknown) => void) => {
    const code = payload?.code;
    const move = payload?.move;
    if (!code || !move) {
      ack?.({ ok: false, error: "잘못된 요청입니다." });
      return;
    }
    const found = seatForSocket(socket.id);
    if (!found || found.room.code !== code.toUpperCase()) {
      ack?.({ ok: false, error: "이 방에 참가하지 않았습니다." });
      return;
    }
    const engine = getEngine(found.room.gameId);
    const result = engine.applyMove(found.room.state, move, found.seat.playerIndex);
    if (!result.ok) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    found.room.state = result.state;
    found.room.lastActivityAt = Date.now();
    ack?.({ ok: true });
    io.to(found.room.code).emit("room:state", roomSummary(found.room));
  });

  socket.on("rematch", (payload: { code?: string }, ack?: (res: unknown) => void) => {
    const code = payload?.code;
    const found = seatForSocket(socket.id);
    if (!found || !code || found.room.code !== code.toUpperCase()) {
      ack?.({ ok: false, error: "이 방에 참가하지 않았습니다." });
      return;
    }
    resetRoom(found.room);
    ack?.({ ok: true });
    io.to(found.room.code).emit("room:state", roomSummary(found.room));
  });

  socket.on("room:sync", (payload: { code?: string }, ack?: (res: unknown) => void) => {
    const code = payload?.code;
    if (!code) {
      ack?.({ ok: false, error: "잘못된 요청입니다." });
      return;
    }
    const room = findRoom(code);
    if (!room) {
      ack?.({ ok: false, error: "존재하지 않는 방 코드입니다." });
      return;
    }
    ack?.({ ok: true, ...roomSummary(room) });
  });

  socket.on("disconnect", () => {
    const found = disconnectSocket(socket.id);
    if (found) {
      io.to(found.room.code).emit("room:state", roomSummary(found.room));
    }
  });
});

startRoomCleanup();

httpServer.listen(PORT, () => {
  console.log(`board-online server listening on port ${PORT}`);
});
