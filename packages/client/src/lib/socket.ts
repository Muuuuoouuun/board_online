import { io, type Socket } from "socket.io-client";

/**
 * Where the realtime server lives. In development it is the local tsx server;
 * in production it defaults to the page's own origin (the Docker image serves
 * client + server together). Set VITE_SERVER_URL at build time when the client
 * is hosted separately from the server (e.g. static client on Vercel, Socket.IO
 * server on Render).
 */
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],
});

export const CONNECT_ERROR = "온라인 서버에 연결할 수 없어요. 컴퓨터와 대전이나 같은 화면 2인 플레이는 그대로 됩니다.";

/**
 * Emits and waits for the server's ack. Rejecting never made sense for the UI,
 * so a missing server resolves to a normal `{ ok: false }` reply after
 * `timeoutMs` instead of hanging forever.
 */
export function emitAck<TRes = any>(event: string, payload: unknown, timeoutMs = 8000): Promise<TRes> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: CONNECT_ERROR, offline: true } as unknown as TRes);
    }, timeoutMs);
    socket.emit(event, payload, (res: TRes) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    });
  });
}
