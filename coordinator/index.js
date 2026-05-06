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

// userId -> { userId, username, socket, connectedAt }
const players = new Map();

function broadcastPlayers() {
  const playersList = Array.from(players.values()).map((player) => ({
    userId: String(player.userId),
    username: player.username
  }));

  const message = JSON.stringify({
    type: 'players_update',
    players: playersList
  });

  for (const player of players.values()) {
    if (player.socket.readyState === player.socket.OPEN) {
      player.socket.send(message);
    }
  }
}

function closeInvalidToken(socket, req, head) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.close(4001, 'invalid token');
  });
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
  const userId = String(payload.userId);
  const username = payload.username;

  if (!userId || !username) {
    ws.close(4001, 'invalid token');
    return;
  }

  if (players.has(userId)) {
    const previousPlayer = players.get(userId);
    if (previousPlayer.socket.readyState === previousPlayer.socket.OPEN) {
      previousPlayer.socket.close(4000, 'Concurrent session replaced');
    }
    players.delete(userId);
  }

  players.set(userId, {
    userId,
    username,
    socket: ws,
    connectedAt: new Date().toISOString()
  });

  console.log(`Player connected: ${username} (${userId})`);
  broadcastPlayers();

  ws.on('close', () => {
    const currentPlayer = players.get(userId);
    if (currentPlayer && currentPlayer.socket === ws) {
      players.delete(userId);
      console.log(`Player disconnected: ${username} (${userId})`);
      broadcastPlayers();
    }
  });

  ws.on('error', (err) => {
    console.error(`Socket error for ${username} (${userId}):`, err.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Coordinator service running on port ${PORT}`);
});
