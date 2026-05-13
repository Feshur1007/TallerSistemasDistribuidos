require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('Missing required environment variable: JWT_SECRET');
  process.exit(1);
}

// Configuración del mundo del juego
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const PLAYER_RADIUS = 20;
const PLAYER_SPEED = 200; // px/seg
const TICK_RATE = 20; // Hz
const TICK_MS = 1000 / TICK_RATE;

if (!Number.isFinite(PORT) || PORT <= 0) {
  console.error('Invalid PORT');
  process.exit(1);
}

// userId -> {
//   userId,
//   username,
//   provider,
//   socket,
//   connectedAt,
//   x,
//   y,
//   intent,
//   extras
// }
const players = new Map();

function isSocketOpen(ws) {
  return ws && ws.readyState === 1;
}

function snapshot() {
  return Array.from(players.values()).map((player) => ({
    userId: player.userId,
    username: player.username,
    provider: player.provider,
    x: player.x,
    y: player.y,
    extras: player.extras
  }));
}

function broadcast(data) {
  const message = JSON.stringify(data);

  for (const player of players.values()) {
    if (isSocketOpen(player.socket)) {
      player.socket.send(message);
    }
  }
}

// Se mantiene por compatibilidad con el lobby viejo.
// El juego nuevo usará principalmente el mensaje "state".
function broadcastPlayers() {
  broadcast({
    type: 'players_update',
    players: Array.from(players.values()).map((player) => ({
      userId: String(player.userId),
      username: player.username
    }))
  });
}

function closeInvalidToken(socket, req, head) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.close(4001, 'invalid token');
  });
}

function randomSpawnX() {
  return PLAYER_RADIUS + Math.random() * (WORLD_WIDTH - 2 * PLAYER_RADIUS);
}

function randomSpawnY() {
  return PLAYER_RADIUS + Math.random() * (WORLD_HEIGHT - 2 * PLAYER_RADIUS);
}

function sanitizeDirectionValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;

  const sign = Math.sign(value);
  if (sign === -1) return -1;
  if (sign === 1) return 1;
  return 0;
}

function handleIntentMessage(player, msg) {
  const dir = msg.intent && msg.intent.dir;

  if (!dir || typeof dir !== 'object' || Array.isArray(dir)) {
    return;
  }

  player.intent = {
    x: sanitizeDirectionValue(dir.x),
    y: sanitizeDirectionValue(dir.y)
  };
}

function handleExtrasUpdateMessage(player, msg) {
  if (!msg.extras || typeof msg.extras !== 'object' || Array.isArray(msg.extras)) {
    return;
  }

  const serializedExtras = JSON.stringify(msg.extras);

  if (serializedExtras.length > 1024) {
    return;
  }

  player.extras = msg.extras;
}

server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname !== '/connect') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const token = parsedUrl.query.token;

  if (!token || typeof token !== 'string') {
    closeInvalidToken(socket, req, head);
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, payload);
    });
  } catch (err) {
    closeInvalidToken(socket, req, head);
  }
});

wss.on('connection', (ws, payload) => {
  const numericUserId = Number(payload.userId);
  const username = payload.username;
  const provider = payload.provider || 'local';

  if (!Number.isInteger(numericUserId) || numericUserId <= 0 || !username) {
    ws.close(4001, 'invalid token');
    return;
  }

  const userId = numericUserId;
  const playerKey = String(userId);

  if (players.has(playerKey)) {
    const previousPlayer = players.get(playerKey);

    if (isSocketOpen(previousPlayer.socket)) {
      previousPlayer.socket.close(4000, 'Concurrent session replaced');
    }

    players.delete(playerKey);
  }

  const player = {
    userId,
    username,
    provider,
    socket: ws,
    connectedAt: new Date().toISOString(),
    x: randomSpawnX(),
    y: randomSpawnY(),
    intent: { x: 0, y: 0 },
    extras: {}
  };

  players.set(playerKey, player);

  console.log(`Player connected: ${username} (${userId})`);

  ws.send(JSON.stringify({
    type: 'welcome',
    you: {
      userId,
      username,
      provider
    },
    world: {
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      playerRadius: PLAYER_RADIUS,
      tickRate: TICK_RATE
    }
  }));

  broadcastPlayers();

  ws.on('message', (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }

    const currentPlayer = players.get(playerKey);
    if (!currentPlayer || currentPlayer.socket !== ws) {
      return;
    }

    if (msg.type === 'intent') {
      handleIntentMessage(currentPlayer, msg);
      return;
    }

    if (msg.type === 'extras_update') {
      handleExtrasUpdateMessage(currentPlayer, msg);
    }
  });

  ws.on('close', () => {
    const currentPlayer = players.get(playerKey);

    if (currentPlayer && currentPlayer.socket === ws) {
      players.delete(playerKey);
      console.log(`Player disconnected: ${username} (${userId})`);
      broadcastPlayers();
    }
  });

  ws.on('error', (err) => {
    console.error(`Socket error for ${username} (${userId}):`, err.message);
  });
});

// Game loop autoritativo.
// El cliente NO mueve jugadores; solo manda intent.
// El servidor aplica movimiento y replica el state.
let lastTick = Date.now();

function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  for (const player of players.values()) {
    const ix = player.intent.x;
    const iy = player.intent.y;
    const mag = Math.hypot(ix, iy);

    if (mag > 0) {
      player.x += (ix / mag) * PLAYER_SPEED * dt;
      player.y += (iy / mag) * PLAYER_SPEED * dt;
    }

    player.x = Math.max(
      PLAYER_RADIUS,
      Math.min(WORLD_WIDTH - PLAYER_RADIUS, player.x)
    );

    player.y = Math.max(
      PLAYER_RADIUS,
      Math.min(WORLD_HEIGHT - PLAYER_RADIUS, player.y)
    );
  }

  broadcast({
    type: 'state',
    t: now,
    players: snapshot()
  });
}

setInterval(tick, TICK_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Coordinator service running on port ${PORT}`);
});