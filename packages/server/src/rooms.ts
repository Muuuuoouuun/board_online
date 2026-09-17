import { randomBytes, randomUUID } from "node:crypto";
import { applyMoveSafely, getEngine, type GameId, type PlayerIndex } from "@board-online/shared";

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
  /** Pending turn-clock timer — only games with a `clock` ever have one (see syncTurnClock). */
  clockTimer?: NodeJS.Timeout;
  /** Whether the turn clock is currently running, so resuming play cannot be mistaken for carrying on. */
  clockRunning?: boolean;
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
  stopTurnClock(room);
}

function stopTurnClock(room: Room) {
  if (room.clockTimer) clearTimeout(room.clockTimer);
  room.clockTimer = undefined;
  room.clockRunning = false;
}

/**
 * Brings the room's turn clock in line with the room as it now stands. Safe to
 * call after anything that could change either — a move, a join, a disconnect, a
 * rematch — and a no-op for games that are not timed.
 *
 * The clock only runs while there are two connected players: a room waiting for
 * its second player, or one whose opponent has dropped, must not burn somebody's
 * turn. Resuming after such a wait restarts the turn with its full time, which
 * does mean a player could reconnect to buy themselves a fresh clock — a slow and
 * self-defeating trick in a game you are playing with a friend, and far better
 * than losing turns to a flaky connection.
 *
 * `onTimeout` is called (with the clock and the room already back in step) when a
 * turn actually runs out, so the caller can broadcast the new state.
 */
export function syncTurnClock(room: Room, onTimeout: (room: Room) => void) {
  const engine = getEngine(room.gameId);
  const clock = engine.clock;
  if (!clock) return;

  if (room.clockTimer) clearTimeout(room.clockTimer);
  room.clockTimer = undefined;

  const playable = engine.status(room.state).status === "ongoing";
  const ready = playable && room.seats.length === 2 && room.seats.every((s) => s.connected);
  if (!ready) {
    if (room.clockRunning) room.state = clock.pause(room.state);
    room.clockRunning = false;
    return;
  }

  // Play is starting or restarting after a wait: the turn on the table gets its
  // time back. An ordinary move leaves the clock running, so it is not touched.
  if (!room.clockRunning) {
    room.state = clock.restart(room.state, Date.now());
    room.clockRunning = true;
  }

  const deadline = clock.deadline(room.state);
  if (deadline === null) return;
  // A hair past the deadline, so the engine never sees a timeout arrive early.
  room.clockTimer = setTimeout(() => {
    room.clockTimer = undefined;
    const turn = engine.turn(room.state);
    const result = applyMoveSafely(engine, room.state, clock.timeoutMove(), turn, undefined, Date.now());
    if (!result.ok) {
      // The clock and the state disagree (a move landed as the timer fired):
      // re-sync against whatever the state actually says now and leave it there.
      syncTurnClock(room, onTimeout);
      return;
    }
    room.state = result.state;
    syncTurnClock(room, onTimeout);
    onTimeout(room);
  }, Math.max(0, deadline - Date.now()) + 30);
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
        stopTurnClock(room);
        rooms.delete(code);
      }
    }
  }, intervalMs);
}

export function roomCount(): number {
  return rooms.size;
}
