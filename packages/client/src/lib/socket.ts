import { io, type Socket } from "socket.io-client";

const SERVER_URL = import.meta.env.DEV ? "http://localhost:3001" : window.location.origin;

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],
});

export function emitAck<TRes = any>(event: string, payload: unknown): Promise<TRes> {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}
