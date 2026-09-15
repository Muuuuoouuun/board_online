import { randomBytes, randomUUID } from "node:crypto";
import { getEngine, type GameId, type PlayerIndex } from "@board-online/shared";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L to avoid confusion

function generateCode(): string {
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

interface Seat {
  playerIndex: PlayerIndex;
  socketId: string | null;
  seatToken: string;
  connected: boolean;
}

export interface Room {
  code: string;
  gameId: GameId;
  /** pre-game setup choice (e.g. janggi formation); reused on rematch */
  setupId?: string;
  state: unknown;
  seats: Seat[];
  createdAt: number;
  lastActivityAt: number;
}

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();

export { isGameId as isValidGameId } from "@board-online/shared";

export function createRoom(gameId: GameId, socketId: string, setupId?: string) {
  let code = generateCode();
  while (rooms.has(code)) code = generateCode();

  const engine = getEngine(gameId);
  const seat: Seat = { playerIndex: 0, socketId, seatToken: randomUUID(), connected: true };
  const room: Room = {
    code,
    gameId,
    setupId,
    state: engine.createInitialState(setupId),
    seats: [seat],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  rooms.set(code, room);
  socketToRoom.set(socketId, code);
  return { room, seat };
}

export function findRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export type JoinResult =
  | { ok: true; room: Room; seat: Seat }
  | { ok: false; error: string };

export function joinRoom(code: string, socketId: string, seatToken?: string): JoinResult {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false, error: "존재하지 않는 방 코드입니다." };

  // Idempotent: a duplicate join from a socket that already holds a seat here
  // (e.g. a client re-firing its join effect) just returns that seat again.
  const already = room.seats.find((s) => s.socketId === socketId);
  if (already) {
    already.connected = true;
    room.lastActivityAt = Date.now();
    return { ok: true, room, seat: already };
  }

  if (seatToken) {
    const existing = room.seats.find((s) => s.seatToken === seatToken);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      socketToRoom.set(socketId, room.code);
      room.lastActivityAt = Date.now();
      return { ok: true, room, seat: existing };
    }
  }

  if (room.seats.length < 2) {
    const usedIndexes = new Set(room.seats.map((s) => s.playerIndex));
    const nextIndex: PlayerIndex = usedIndexes.has(0) ? 1 : 0;
    const seat: Seat = { playerIndex: nextIndex, socketId, seatToken: randomUUID(), connected: true };
    room.seats.push(seat);
    socketToRoom.set(socketId, room.code);
    room.lastActivityAt = Date.now();
    return { ok: true, room, seat };
  }

  const disconnectedSeat = room.seats.find((s) => !s.connected);
  if (disconnectedSeat) {
    disconnectedSeat.socketId = socketId;
    disconnectedSeat.connected = true;
    disconnectedSeat.seatToken = randomUUID();
    socketToRoom.set(socketId, room.code);
    room.lastActivityAt = Date.now();
    return { ok: true, room, seat: disconnectedSeat };
  }

  return { ok: false, error: "방이 가득 찼습니다." };
}

export function seatForSocket(socketId: string): { room: Room; seat: Seat } | null {
  const code = socketToRoom.get(socketId);
  if (!code) return null;
  const room = rooms.get(code);
  if (!room) return null;
  const seat = room.seats.find((s) => s.socketId === socketId);
  if (!seat) return null;
  return { room, seat };
}

export function disconnectSocket(socketId: string): { room: Room; seat: Seat } | null {
  const found = seatForSocket(socketId);
  if (!found) return null;
  found.seat.connected = false;
  found.seat.socketId = null;
  found.room.lastActivityAt = Date.now();
  socketToRoom.delete(socketId);
  return found;
}

export function resetRoom(room: Room) {
  const engine = getEngine(room.gameId);
  room.state = engine.createInitialState(room.setupId);
  room.lastActivityAt = Date.now();
}

export function roomSummary(room: Room) {
  return {
    code: room.code,
    gameId: room.gameId,
    state: room.state,
    players: room.seats.map((s) => ({ index: s.playerIndex, connected: s.connected })),
  };
}

/** Periodically drop rooms nobody is connected to. Call once at server startup. */
export function startRoomCleanup(intervalMs = 5 * 60 * 1000, staleMs = 30 * 60 * 1000) {
  return setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const anyoneConnected = room.seats.some((s) => s.connected);
      if (!anyoneConnected && now - room.lastActivityAt > staleMs) {
        rooms.delete(code);
      }
    }
  }, intervalMs);
}

export function roomCount(): number {
  return rooms.size;
}
