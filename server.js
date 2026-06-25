'use strict';
/* ============================================================
   STARSPHERE ONLINE — server.
   Express + better-sqlite3. Accounts, invite codes, and one
   authoritative universe per game. Ticks advance lazily on
   every request plus a background pump, so the universe keeps
   moving even when nobody is watching.
   ============================================================ */

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const G = require('./game');

const PORT = +(process.env.PORT || 8777);
const DEV = process.env.DEV_TICK === '1';

/* ---------- database ---------- */
const db = new Database(path.join(__dirname, 'sphere.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  pass TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members(
  game_id INTEGER NOT NULL REFERENCES games(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  slot INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
`);

/* ---------- auth helpers ---------- */
function hashPass(pass){
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pass, salt, 64).toString('hex');
  return salt + ':' + h;
}
function checkPass(pass, stored){
  const [salt, h] = stored.split(':');
  const h2 = crypto.scryptSync(pass, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(h2, 'hex'));
}
function newSession(userId){
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id, created) VALUES (?,?,?)').run(token, userId, Date.now());
  return token;
}
function userFromToken(token){
  if (!token || !/^\w+$/.test(token)) return null;
  return db.prepare(
    'SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).get(token) || null;
}
function auth(req, res, next){
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  const row = m && userFromToken(m[1]);
  if (!row) return res.status(401).json({ err: 'not signed in' });
  req.user = row;
  next();
}

/* ---------- live push (Server-Sent Events): instant updates on tick / others' actions ---------- */
const gameSubs = new Map(); // gameId -> Set<res>
function notifyGame(id){
  const subs = gameSubs.get(id);
  if (!subs) return;
  for (const res of subs){ try { res.write('data: tick\n\n'); } catch (e){} }
}

/* ---------- game persistence ---------- */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
function genCode(){
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return c;
}
function saveGame(id, U){
  db.prepare('UPDATE games SET state = ?, updated = ? WHERE id = ?').run(JSON.stringify(U), Date.now(), id);
}
function loadGame(id){
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  if (!row) return null;
  const U = JSON.parse(row.state);
  // lazy catch-up: the universe moves whether anyone is watching or not
  if (G.catchUp(U, Date.now()) > 0) saveGame(id, U);
  return { row, U };
}
function memberSlot(gameId, userId){
  const m = db.prepare('SELECT slot FROM members WHERE game_id = ? AND user_id = ?').get(gameId, userId);
  return m ? m.slot : null;
}
function gameView(g, slot){
  return Object.assign(G.view(g.U, slot, Date.now()), { code: g.row.code });
}

/* ---------- app ---------- */
const app = express();
app.use(express.json({ limit: '256kb' }));
// no-cache: a stale client against a newer server causes confusing UI bugs
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache')
}));

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const pass = String(req.body.pass || '');
  if (!/^[\w .-]{2,20}$/.test(name)) return res.status(400).json({ err: 'name: 2-20 letters/digits' });
  if (pass.length < 4) return res.status(400).json({ err: 'password: at least 4 characters' });
  try {
    const r = db.prepare('INSERT INTO users(name, pass, created) VALUES (?,?,?)').run(name, hashPass(pass), Date.now());
    res.json({ token: newSession(r.lastInsertRowid), name });
  } catch (e){
    res.status(400).json({ err: 'that name is taken' });
  }
});
app.post('/api/auth/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE name = ?').get(String(req.body.name || '').trim());
  if (!u || !checkPass(String(req.body.pass || ''), u.pass))
    return res.status(401).json({ err: 'wrong name or password' });
  res.json({ token: newSession(u.id), name: u.name });
});

function cleanStr(v, fallback, max){
  const s = String(v || '').replace(/[<>&"]/g, '').trim();
  return (s || fallback).slice(0, max);
}
app.post('/api/games', auth, (req, res) => {
  const tickMode = req.body.tickMode === 'authentic' ? 'authentic' : 'fast';
  const faction = G.FACTIONS[req.body.faction] ? req.body.faction : 'aurel';
  const planet = cleanStr(req.body.planet, 'New Aurelia', 24);
  const ruler = cleanStr(req.body.ruler, 'Commander', 24);
  const difficulty = G.DIFFICULTY[req.body.difficulty] ? req.body.difficulty : 'normal';
  const format = G.FORMAT[req.body.format] ? req.body.format : 'standard';
  const U = G.newUniverse(tickMode, req.body.pvp === true, difficulty, format);
  const e = G.newEmpire(U, planet, ruler, faction);
  // place the founder in a random home-cluster slot (not always slot 0)
  const openSlots = G.freeSlots(U);
  const slot = openSlots[Math.floor(Math.random() * openSlots.length)];
  G.addPlayer(U, slot, e);
  let code = genCode();
  while (db.prepare('SELECT 1 FROM games WHERE code = ?').get(code)) code = genCode();
  const r = db.prepare('INSERT INTO games(code, state, updated) VALUES (?,?,?)').run(code, JSON.stringify(U), Date.now());
  db.prepare('INSERT INTO members(game_id, user_id, slot) VALUES (?,?,?)').run(r.lastInsertRowid, req.user.id, slot);
  res.json({ id: r.lastInsertRowid, code });
});
app.post('/api/games/join', auth, (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const row = db.prepare('SELECT id FROM games WHERE code = ?').get(code);
  if (!row) return res.status(404).json({ err: 'no round with that code' });
  const existing = memberSlot(row.id, req.user.id);
  if (existing !== null) return res.json({ id: row.id }); // already in — just enter
  const g = loadGame(row.id);
  if (g.U.roundOver) return res.status(400).json({ err: 'that round is already over' });
  const free = G.freeSlots(g.U);
  if (!free.length) return res.status(400).json({ err: 'that cluster is full (8 commanders)' });
  const faction = G.FACTIONS[req.body.faction] ? req.body.faction : 'aurel';
  const planet = cleanStr(req.body.planet, 'New Aurelia', 24);
  const ruler = cleanStr(req.body.ruler, 'Commander', 24);
  const e = G.newEmpire(g.U, planet, ruler, faction);
  G.addPlayer(g.U, free[0], e);
  db.prepare('INSERT INTO members(game_id, user_id, slot) VALUES (?,?,?)').run(row.id, req.user.id, free[0]);
  saveGame(row.id, g.U);
  res.json({ id: row.id });
});
app.get('/api/games', auth, (req, res) => {
  const rows = db.prepare('SELECT g.id, g.code, g.state, m.slot FROM members m JOIN games g ON g.id = m.game_id WHERE m.user_id = ?')
    .all(req.user.id);
  res.json(rows.map(r => {
    const U = JSON.parse(r.state);
    const e = U.players[r.slot];
    return {
      id: r.id, code: r.code, tick: U.tick, tickMode: U.tickMode, roundOver: U.roundOver,
      roundTicks: G.roundTicks(U), difficulty: U.difficulty || 'normal', format: U.format || 'standard',
      players: Object.keys(U.players).length,
      planet: e ? e.planet : '?', slot: r.slot
    };
  }));
});
app.post('/api/games/:id/leave', auth, (req, res) => {
  const id = +req.params.id;
  const slot = memberSlot(id, req.user.id);
  if (slot === null) return res.status(403).json({ err: 'not a member of that round' });
  const g = loadGame(id);
  if (g){
    G.leaveRound(g.U, slot);
    saveGame(id, g.U);
  }
  db.prepare('DELETE FROM members WHERE game_id = ? AND user_id = ?').run(id, req.user.id);
  // an abandoned universe serves nobody — last one out turns off the stars
  const left = db.prepare('SELECT COUNT(*) n FROM members WHERE game_id = ?').get(id).n;
  if (left === 0){
    db.prepare('DELETE FROM games WHERE id = ?').run(id);
  }
  res.json({ ok: true });
});
app.post('/api/games/:id/delete', auth, (req, res) => {
  const id = +req.params.id;
  const slot = memberSlot(id, req.user.id);
  if (slot === null) return res.status(403).json({ err: 'not a member of that round' });
  const founder = db.prepare('SELECT user_id FROM members WHERE game_id = ? ORDER BY rowid ASC LIMIT 1').get(id);
  if (!founder || founder.user_id !== req.user.id) return res.status(403).json({ err: 'only the founder can delete a round for everyone' });
  db.prepare('DELETE FROM members WHERE game_id = ?').run(id);
  db.prepare('DELETE FROM games WHERE id = ?').run(id);
  res.json({ ok: true });
});
app.get('/api/games/:id/state', auth, (req, res) => {
  const slot = memberSlot(+req.params.id, req.user.id);
  if (slot === null) return res.status(403).json({ err: 'not a member of that round' });
  const g = loadGame(+req.params.id);
  if (!g) return res.status(404).json({ err: 'no such round' });
  res.json(gameView(g, slot));
});
app.post('/api/games/:id/action', auth, (req, res) => {
  const slot = memberSlot(+req.params.id, req.user.id);
  if (slot === null) return res.status(403).json({ err: 'not a member of that round' });
  const g = loadGame(+req.params.id);
  if (!g) return res.status(404).json({ err: 'no such round' });
  const err = G.applyAction(g.U, g.U.players[slot], req.body);
  saveGame(+req.params.id, g.U);
  if (err) return res.status(400).json({ err });
  res.json(gameView(g, slot));
  notifyGame(+req.params.id); // push the change to everyone watching this round
});
/* live stream — EventSource can't send headers, so the token rides the query string */
app.get('/api/games/:id/stream', (req, res) => {
  const user = userFromToken(String(req.query.token || ''));
  const id = +req.params.id;
  if (!user || memberSlot(id, user.id) === null){ res.status(403).end(); return; }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write('data: hello\n\n');
  let subs = gameSubs.get(id);
  if (!subs){ subs = new Set(); gameSubs.set(id, subs); }
  subs.add(res);
  const ka = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch (e){} }, 25000);
  req.on('close', () => { clearInterval(ka); subs.delete(res); if (!subs.size) gameSubs.delete(id); });
});

/* dev-only: advance ticks on demand (DEV_TICK=1) */
if (DEV){
  app.post('/api/dev/tick', (req, res) => {
    const g = loadGame(+req.body.id);
    if (!g) return res.status(404).json({ err: 'no such round' });
    const n = Math.min(2000, Math.max(1, Math.floor(+req.body.n || 1)));
    for (let i = 0; i < n && !g.U.roundOver; i++) G.tickUniverse(g.U);
    g.U.lastTickAt = Date.now();
    saveGame(+req.body.id, g.U);
    res.json({ tick: g.U.tick });
  });
}

/* background pump: keep every universe ticking */
setInterval(() => {
  const rows = db.prepare('SELECT id, state FROM games').all();
  const now = Date.now();
  for (const r of rows){
    try {
      const U = JSON.parse(r.state);
      if (!U.roundOver && G.nextTickAt(U) <= now){
        G.catchUp(U, now);
        saveGame(r.id, U);
        notifyGame(r.id); // push the new tick to everyone watching
      }
    } catch (e){ console.error('tick pump, game ' + r.id + ':', e.message); }
  }
}, 5000);

app.listen(PORT, () => {
  console.log('STARSPHERE ONLINE listening on http://localhost:' + PORT + (DEV ? ' (dev ticks enabled)' : ''));
});
