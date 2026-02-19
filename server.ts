import { existsSync, readFileSync, statSync } from "fs";
import { createServer } from "http";
import * as pty from "node-pty";
import { extname, join } from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";

interface ExtendedWebSocket extends WebSocket {
  id: number;
  isAlive: boolean;
}

const server = createServer((req, res) => {
  let url = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
  let path = join(
    url,
    req.url === "/" ? "index.html" : decodeURIComponent(req.url ?? ""),
  );
  if (!existsSync(path) || !statSync(path).isFile())
    path = join(url, "index.html");
  try {
    res
      .writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".ttf": "font/ttf",
          }[extname(path)] || "application/octet-stream",
      })
      .end(readFileSync(path));
  } catch {
    res.writeHead(404).end("Not Found");
  }
});

let connectionId = 0;
const websocketServer = new WebSocketServer({ server });
websocketServer.on("close", () => clearInterval(heartbeat));
websocketServer.on("connection", (client) => {
  const websocket = client as ExtendedWebSocket;
  websocket.id = ++connectionId;
  websocket.isAlive = true;
  const SESSION_NAME = "webtty-main";
  const ptyProcess = pty.spawn("tmux", ["new-session", "-A", "-s", SESSION_NAME], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: Object.assign({}, process.env, {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "ko_KR.UTF-8",
      LC_ALL: "ko_KR.UTF-8",
      LC_CTYPE: "ko_KR.UTF-8",
    }),
  });
  ptyProcess.onData((data) => {
    if (websocket.readyState === websocket.OPEN) {
      websocket.send(data);
    }
  });
  ptyProcess.onExit(() => {
    if (websocket.readyState === websocket.OPEN)
      websocket.close(1000, "PTY exited");
  });
  websocket.on("close", () => {
    // tmux 세션 유지를 위해 kill하지 않음
  });
  websocket.on("error", () => {
    // 에러 로깅만, tmux 세션은 유지
  });
  websocket.on("message", (msg) => {
    const raw = msg.toString();
    try {
      const data = JSON.parse(raw);
      if (!data.type) throw new Error();
      if (data.type === "input") {
        ptyProcess.write(data.data);
      } else if (data.type === "resize") {
        const cols = Math.max(1, Math.min(500, data.cols || 80));
        const rows = Math.max(1, Math.min(200, data.rows || 24));
        ptyProcess.resize(cols, rows);
      }
    } catch (e) {
      ptyProcess.write(raw);
    }
  });
  websocket.on("pong", () => {
    websocket.isAlive = true;
  });
});
const heartbeat = setInterval(() => {
  websocketServer.clients.forEach((client) => {
    const websocket = client as ExtendedWebSocket;
    if (websocket.isAlive === false) return websocket.terminate();
    websocket.isAlive = false;
    websocket.ping();
  });
}, 30000);

server.listen(3000);
