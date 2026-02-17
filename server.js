import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : decodeURIComponent(req.url);
  const file = url.slice(1);
  const ext = file.includes('.') ? '.' + file.split('.').pop() : '.html';
  
  if (existsSync(file)) {
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(readFileSync(file));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const wss = new WebSocketServer({ server });

// 연결 ID 생성
let connectionId = 0;

// Heartbeat: 30초마다 죽은 연결 정리
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', (ws) => {
  ws.id = ++connectionId;
  ws.isAlive = true;
  
  const shell = process.env.SHELL || '/bin/zsh';
  
  const env = Object.assign({}, process.env, {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'ko_KR.UTF-8',
    LC_ALL: 'ko_KR.UTF-8',
    LC_CTYPE: 'ko_KR.UTF-8',
  });
  
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: env,
  });

  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });
  
  ptyProcess.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close(1000, 'PTY exited');
  });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'input') {
        ptyProcess.write(data.data);
      } else if (data.type === 'resize') {
        const cols = Math.max(1, Math.min(500, data.cols || 80));
        const rows = Math.max(1, Math.min(200, data.rows || 24));
        ptyProcess.resize(cols, rows);
      }
    } catch (e) {
      // JSON 파싱 실패 시 무시
    }
  });

  ws.on('close', () => ptyProcess.kill());
  ws.on('error', () => ptyProcess.kill());
});

server.listen(3000);
