require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const DATABASE_FILE = process.env.DATABASE_FILE || 'users.db';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'http://localhost:3000';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!JWT_SECRET) {
  console.error('Missing required environment variable: JWT_SECRET');
  process.exit(1);
}

if (!GOOGLE_CLIENT_ID) {
  console.error('Missing required environment variable: GOOGLE_CLIENT_ID');
  process.exit(1);
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const db = new Database(DATABASE_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    provider TEXT NOT NULL CHECK(provider IN ('local','google')),
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    email TEXT,
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

function validateGoogleUsername(username) {
  if (typeof username !== 'string' || !username.trim()) {
    return 'username requerido';
  }

  const cleanUsername = username.trim();

  if (cleanUsername.length < 3 || cleanUsername.length > 32) {
    return 'username 3-32 chars';
  }

  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
    return 'username solo letras, números, _';
  }

  return null;
}

function createToken(user) {
  return jwt.sign(
    {
      userId: String(user.id),
      username: user.username,
      provider: user.provider
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

app.post('/register', async (req, res) => {
  const validationError = validateCredentialsBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const username = req.body.username.trim();
  const password = req.body.password;

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const stmt = db.prepare("INSERT INTO users (username, provider, password_hash) VALUES (?, 'local', ?)");
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
    const user = db
      .prepare('SELECT id, username, provider, password_hash FROM users WHERE username = ?')
      .get(username);

    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    if (user.provider !== 'local') {
      return res.status(401).json({
        error: 'invalid provider',
        hint: 'Este usuario debe iniciar sesión con Google.'
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = createToken(user);

    return res.status(200).json({
      token,
      username: user.username
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'internal server error' });
  }
});

app.post('/auth/google', async (req, res) => {
  const { idToken, username } = req.body || {};

  if (typeof idToken !== 'string' || !idToken.trim()) {
    return res.status(400).json({ error: 'idToken requerido' });
  }

  let payload;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID
    });

    payload = ticket.getPayload();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_id_token' });
  }

  if (!payload || !payload.sub) {
    return res.status(401).json({ error: 'invalid_id_token' });
  }

  if (payload.email_verified !== true) {
    return res.status(401).json({ error: 'email_not_verified' });
  }

  const googleSub = payload.sub;
  const email = payload.email || null;

  try {
    const existing = db
      .prepare('SELECT id, username, provider FROM users WHERE google_sub = ?')
      .get(googleSub);

    if (existing) {
      const token = createToken(existing);

      return res.status(200).json({
        token,
        username: existing.username
      });
    }

    if (!username) {
      return res.status(409).json({
        error: 'username_required',
        hint: 'Primer login con Google. Debes elegir un username.'
      });
    }

    const usernameError = validateGoogleUsername(username);
    if (usernameError) {
      return res.status(400).json({ error: usernameError });
    }

    const cleanUsername = username.trim();

    const stmt = db.prepare(
      "INSERT INTO users (username, provider, google_sub, email) VALUES (?, 'google', ?, ?)"
    );

    const info = stmt.run(cleanUsername, googleSub, email);

    const newUser = {
      id: info.lastInsertRowid,
      username: cleanUsername,
      provider: 'google'
    };

    const token = createToken(newUser);

    return res.status(200).json({
      token,
      username: cleanUsername
    });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'username_taken' });
    }

    console.error('Google auth error:', err.message);
    return res.status(500).json({ error: 'internal server error' });
  }
});

app.get('/validate-token', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      valid: false,
      error: 'missing token'
    });
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    if (!payload.userId || !payload.username || !payload.provider) {
      return res.status(401).json({
        valid: false,
        error: 'invalid token payload'
      });
    }

    return res.status(200).json({
      valid: true,
      user: {
        userId: payload.userId,
        username: payload.username,
        provider: payload.provider
      }
    });
  } catch (err) {
    return res.status(401).json({
      valid: false,
      error: 'invalid or expired token'
    });
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


// For testing purposes, export the app and db instances 