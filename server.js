// Turbo Trails online server: serves the game and runs race rooms over WebSockets.
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const RELAY = new Set(['s', 'box', 'goo', 'goohit', 'bolt', 'bolthit', 'fin', 'set', 'gpscore', 'gpend']);
const HOST_ONLY = new Set(['set', 'gpscore', 'gpend']);

const app = express();
app.use('/lib', express.static(path.join(__dirname, 'node_modules/three/build'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });
const rooms = new Map(); // code -> { players: Map<id, {ws,name,cfg}>, host, state }
let nextId = 1;

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
function broadcast(room, o, except) {
  const s = JSON.stringify(o);
  for (const p of room.players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(s);
}
const lobbyMsg = (room) => ({
  t: 'lobby', host: room.host, state: room.state,
  players: [...room.players].map(([id, p]) => ({ id, name: p.name, cfg: p.cfg }))
});
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c; do { c = ''; for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0]; } while (rooms.has(c));
  return c;
}
const cleanName = (n) => String(n || 'Player').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12) || 'Player';
function uniqueName(room, name, id) {
  const taken = new Set([...room.players].filter(([pid]) => pid !== id).map(([, p]) => p.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) { const c = name.slice(0, 9) + ' ' + n; if (!taken.has(c)) return c; }
}
const cleanCfg = (c) => (c && typeof c === 'object' && JSON.stringify(c).length < 600) ? c : {};

wss.on('connection', (ws) => {
  const id = nextId++;
  let room = null, code = null, msgCount = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const rate = setInterval(() => { msgCount = 0; }, 1000);

  ws.on('message', (buf) => {
    if (++msgCount > 120) return; // simple flood guard
    let m; try { m = JSON.parse(buf); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'create' || m.t === 'join') {
      if (room) return;
      const c = m.t === 'create' ? newCode() : String(m.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (m.t === 'create') rooms.set(c, { players: new Map(), host: id, state: 'lobby' });
      const r = rooms.get(c);
      if (!r) return send(ws, { t: 'err', msg: 'Room ' + c + ' not found. Check the code, or ask your friend for a fresh link.' });
      if (r.players.size >= MAX_PLAYERS) return send(ws, { t: 'err', msg: 'That room is full (6 players).' });
      if (r.state !== 'lobby') return send(ws, { t: 'err', msg: 'A race is in progress in that room. Try again when it finishes.' });
      room = r; code = c;
      r.players.set(id, { ws, name: uniqueName(r, cleanName(m.name), id), cfg: cleanCfg(m.cfg) });
      send(ws, { t: 'joined', id, room: c });
      broadcast(r, lobbyMsg(r));
      return;
    }
    if (!room) return;
    const me = room.players.get(id);
    if (m.t === 'cfg') { me.name = uniqueName(room, cleanName(m.name), id); me.cfg = cleanCfg(m.cfg); broadcast(room, lobbyMsg(room)); return; }
    if (m.t === 'start' && id === room.host) { room.state = 'race'; m.from = id; broadcast(room, m); broadcast(room, lobbyMsg(room)); return; }
    if (m.t === 'tolobby' && id === room.host) { room.state = 'lobby'; broadcast(room, { t: 'tolobby' }); broadcast(room, lobbyMsg(room)); return; }
    if (HOST_ONLY.has(m.t) && id !== room.host) return;
    if (RELAY.has(m.t)) { m.from = id; broadcast(room, m, ws); }
  });

  ws.on('close', () => {
    clearInterval(rate);
    if (!room) return;
    room.players.delete(id);
    if (room.players.size === 0) { rooms.delete(code); return; }
    if (room.host === id) room.host = room.players.keys().next().value;
    broadcast(room, { t: 'left', id });
    broadcast(room, lobbyMsg(room));
  });
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 20000);

server.listen(PORT, () => console.log('Turbo Trails running on port ' + PORT));
