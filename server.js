import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import pty from 'node-pty';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const server = createServer((req, res) => {
  let filePath = join(DIST_DIR, req.url === '/' ? 'index.html' : decodeURIComponent(req.url));
  
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(DIST_DIR, 'index.html');
  }
  
  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
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
    console.log(`[PTY→WS] ${JSON.stringify(data)}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });
  
  ptyProcess.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close(1000, 'PTY exited');
  });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (msg) => {
    const raw = msg.toString();
    console.log(`[WS→PTY] raw: ${JSON.stringify(raw)}, bytes: [${Buffer.from(raw).toString('hex').match(/.{2}/g)?.join(' ')}]`);
    
    try {
      const data = JSON.parse(raw);
      if (data.type === 'input') {
        console.log(`[WS→PTY] input: ${JSON.stringify(data.data)}`);
        ptyProcess.write(data.data);
      } else if (data.type === 'resize') {
        const cols = Math.max(1, Math.min(500, data.cols || 80));
        const rows = Math.max(1, Math.min(200, data.rows || 24));
        ptyProcess.resize(cols, rows);
      }
    } catch (e) {
      // JSON 아닌 경우 직접 전달 (진단용)
      console.log(`[WS→PTY] direct: ${JSON.stringify(raw)}, bytes: [${Buffer.from(raw).toString('hex').match(/.{2}/g)?.join(' ')}]`);
      ptyProcess.write(raw);
    }
  });

  ws.on('close', () => ptyProcess.kill());
  ws.on('error', () => ptyProcess.kill());
});

server.listen(3000);
