require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const DATABASE_FILE = process.env.DATABASE_FILE || 'users.db';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'http://localhost:3000';

if (!JWT_SECRET) {
  console.error('Missing required environment variable: JWT_SECRET');
  process.exit(1);
}

const db = new Database(DATABASE_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(cors({ origin: ALLOW_ORIGIN === '*' ? '*' : ALLOW_ORIGIN }));
app.use(express.json());

function validateCredentialsBody(body) {
  if (!body || typeof body !== 'object') return 'JSON body is required';

  const { username, password } = body;

  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'username and password must be strings';
  }

  if (!username.trim() || !password.trim()) {
    return 'username and password are required';
  }

  return null;
}

app.post('/register', async (req, res) => {
  const validationError = validateCredentialsBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const username = req.body.username.trim();
  const password = req.body.password;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    const info = stmt.run(username, passwordHash);

    return res.status(201).json({
      userId: info.lastInsertRowid,
      username
    });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'username already exists' });
    }

    console.error('Registration error:', err.message);
    return res.status(500).json({ error: 'internal server error' });
  }
});

app.post('/login', async (req, res) => {
  const validationError = validateCredentialsBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const username = req.body.username.trim();
  const password = req.body.password;

  try {
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = jwt.sign(
      { userId: String(user.id), username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(200).json({
      token,
      username: user.username
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'internal server error' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'invalid JSON body' });
  }

  console.error('Unexpected error:', err.message);
  return res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Auth service running on port ${PORT}`);
});
