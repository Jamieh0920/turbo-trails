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
app.get('/lib/qrcode.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/qrcode-generator/qrcode.js')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });
const rooms = new Map(); // code -> { players: Map<id, {ws,name,cfg}>, host, state }
const tvRooms = new Map(); // code -> { tv: ws, pads: Map<id, {ws,name,cfg}> }  (couch / TV mode)
const towns = new Map(); // code -> { players: Map<id, {ws,name,cfg}> }  (shared free-roam town)
const MAX_TOWN = 8;
const MAX_PADS = 4;
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
  let c; do { c = ''; for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0]; } while (rooms.has(c) || tvRooms.has(c) || towns.has(c));
  return c;
}
const cleanName = (n) => String(n || 'Player').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12) || 'Player';
function uniqueName(room, name, id) {
  const taken = new Set([...room.players].filter(([pid]) => pid !== id).map(([, p]) => p.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) { const c = name.slice(0, 9) + ' ' + n; if (!taken.has(c)) return c; }
}
function townList(t) { const o = { t: 'tlist', players: [...t.players].map(([id, p]) => ({ id, name: p.name, cfg: p.cfg })) }; for (const p of t.players.values()) send(p.ws, o); }
const cleanCfg = (c) => (c && typeof c === 'object' && JSON.stringify(c).length < 600) ? c : {};

wss.on('connection', (ws) => {
  const id = nextId++;
  let room = null, code = null, msgCount = 0, tvRoom = null, tvCode = null, role = null, town = null, townCode = null;
  ws.missed = 0;
  ws.on('pong', () => { ws.missed = 0; });
  const rate = setInterval(() => { msgCount = 0; }, 1000);

  ws.on('message', (buf) => {
    ws.missed = 0;
    if (++msgCount > 200) return; // simple flood guard
    let m; try { m = JSON.parse(buf); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    // ---- shared town: drive around together, invite each other to races ----
    if (m.t === 'tcreate' || m.t === 'tjoin') {
      if (town) return;
      const c = m.t === 'tcreate' ? newCode() : String(m.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (m.t === 'tcreate') towns.set(c, { players: new Map() });
      const t = towns.get(c);
      if (!t) return send(ws, { t: 'terr', msg: 'Town ' + c + ' not found. Ask your friend for a fresh invite.' });
      if (t.players.size >= MAX_TOWN) return send(ws, { t: 'terr', msg: 'That town is full (8 players).' });
      const name = cleanName(m.name), taken = new Set([...t.players.values()].map(p => p.name));
      let nm = name; for (let n = 2; taken.has(nm); n++) nm = name.slice(0, 9) + ' ' + n;
      t.players.set(id, { ws, name: nm, cfg: cleanCfg(m.cfg) }); town = t; townCode = c;
      send(ws, { t: 'tjoined', id, room: c, name: nm });
      return townList(t);
    }
    if (town && (m.t === 'tp' || m.t === 'tinv' || m.t === 'tcfg')) {
      const me = town.players.get(id);
      if (m.t === 'tcfg') { me.cfg = cleanCfg(m.cfg); return townList(town); }
      if (m.t === 'tinv') m.name = me.name;
      m.from = id; const s = JSON.stringify(m);
      for (const [pid, p] of town.players) if (pid !== id && p.ws.readyState === 1) p.ws.send(s);
      return;
    }
    if (m.t === 'tleave') { leaveTown(); return; }
    // ---- couch / TV mode: one screen, phones as controllers ----
    if (m.t === 'tvcreate') {
      if (room || tvRoom) return;
      const c = newCode(); tvRoom = { tv: ws, pads: new Map() }; tvRooms.set(c, tvRoom); tvCode = c; role = 'tv';
      return send(ws, { t: 'tvcreated', room: c });
    }
    if (m.t === 'padjoin') {
      if (room || tvRoom) return;
      const c = String(m.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4), r = tvRooms.get(c);
      if (!r) return send(ws, { t: 'err', msg: 'No TV found with code ' + c + '. Check the code on the TV screen.' });
      if (r.pads.size >= MAX_PADS) return send(ws, { t: 'err', msg: 'That TV already has 4 players.' });
      const name = cleanName(m.name), taken = new Set([...r.pads.values()].map(p => p.name));
      let nm = name; for (let n = 2; taken.has(nm); n++) nm = name.slice(0, 9) + ' ' + n;
      r.pads.set(id, { ws, name: nm, cfg: cleanCfg(m.cfg) }); tvRoom = r; tvCode = c; role = 'pad';
      send(ws, { t: 'padjoined', id, room: c, name: nm });
      return send(r.tv, { t: 'padjoin', id, name: nm, cfg: cleanCfg(m.cfg) });
    }
    if (tvRoom) {
      if (role === 'pad') { if (m.t === 'in' || m.t === 'act') { m.from = id; send(tvRoom.tv, m); } return; }
      if (role === 'tv') {
        if (m.to) { const p = tvRoom.pads.get(m.to); if (p) send(p.ws, m); }
        else for (const p of tvRoom.pads.values()) send(p.ws, m);
      }
      return;
    }
    if (m.t === 'create' || m.t === 'join') {
      if (room) return;
      const c = m.t === 'create' ? newCode() : String(m.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (m.t === 'create') rooms.set(c, { players: new Map(), host: id, state: 'lobby' });
      const r = rooms.get(c);
      if (!r && m.t === 'join' && towns.has(c)) return send(ws, { t: 'err', town: c, msg: 'That is a town code — taking you to the town…' });
      if (!r && m.t === 'join' && tvRooms.has(c)) return send(ws, { t: 'err', tv: c, msg: 'That is a TV code — opening the controller…' });
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

  function leaveTown() {
    if (!town) return;
    town.players.delete(id);
    if (town.players.size === 0) towns.delete(townCode); else { townList(town); for (const p of town.players.values()) send(p.ws, { t: 'tleft', id }); }
    town = null; townCode = null;
  }
  ws.on('close', () => {
    clearInterval(rate);
    leaveTown();
    if (tvRoom) {
      if (role === 'tv') { for (const p of tvRoom.pads.values()) send(p.ws, { t: 'tvgone' }); tvRooms.delete(tvCode); }
      else { tvRoom.pads.delete(id); send(tvRoom.tv, { t: 'padleave', id }); }
      return;
    }
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
  for (const ws of wss.clients) { if (ws.missed >= 3) { ws.terminate(); continue; } ws.missed++; ws.ping(); }
}, 20000);

server.listen(PORT, () => console.log('Turbo Trails running on port ' + PORT));
