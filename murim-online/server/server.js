// ============================================================
// MURIM LOGIN — multiplayer test server (v16, Node 18+, no native deps)
// REST: accounts / cloud saves / leaderboards / guilds
// WS:   global chat / live PvP matchmaking+relay / co-op raid rooms
// ============================================================
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const { load, save } = require('./storage');
const path = require('path'), fs = require('fs');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-token');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---------- storage ----------
let users = load('users.json', {});   // lower -> {name,salt,pass,token,save,scores,guild,created}
let guilds = load('guilds.json', []); // [{id,name,tag,owner,members[],created}]
const persist = () => { save('users.json', users); save('guilds.json', guilds); };
const tok = () => crypto.randomBytes(24).toString('hex');
const hash = (p, s) => crypto.pbkdf2Sync(p, s, 20000, 32, 'sha256').toString('hex');
const blankScores = () => ({ power: 0, tower: 0, survival: 0, pvp: 0, coop: 0 });
const byToken = t => Object.values(users).find(u => u.token === t) || null;
const auth = req => byToken(req.get('x-token') || '');
const gtag = u => { const g = guilds.find(g => g.id === u.guild); return g ? '[' + g.tag + '] ' : ''; };

// ---------- live state ----------
const online = new Set();       // authed sockets
const chatHist = [];            // last 30 {user,text,ts}
let pvpWait = null;             // {ws,name,level,power}
const pvpRooms = new Map();     // id -> {a,b,claims,timer}
const coopRooms = new Map();    // code -> {code,state,boss,bossMax,players[],timer,log[]}
const send = (ws, o) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (e) {} };

// ---------- REST ----------
app.get('/api/health', (req, res) => res.json({ ok: true, game: 'murim-login', online: online.size, users: Object.keys(users).length }));

// ---------- preview: playable game + apk download ----------
app.get('/online.js', (req, res) => {
  const f = path.join(__dirname, '..', 'web', 'online.js');
  if (!fs.existsSync(f)) return res.status(404).send('online.js missing');
  res.type('application/javascript').sendFile(f);
});
app.get('/apk', (req, res) => {
  const f = path.join(__dirname, '..', 'murim-login-v16-debug.apk');
  if (!fs.existsSync(f)) return res.status(404).send('APK not built yet');
  res.download(f, 'murim-login-v16-debug.apk');
});
app.get('/', (req, res) => {
  try {
    let html = fs.readFileSync(path.join(__dirname, '..', '..', 'murim-login-game.html'), 'utf8');
    html = html.replace('</body>', '<script>try{localStorage.setItem("murimServerUrl",location.origin)}catch(e){}</script><script src="/online.js"></script>\n</body>');
    res.type('text/html').send(html);
  } catch (e) { res.send('<h2>🐉 Murim Login server</h2><p>Game file not found next to server.</p><p>API: <a href="/api/health">/api/health</a></p>'); }
});

app.post('/api/register', (req, res) => {
  const u = String(req.body.u || '').trim(), p = String(req.body.p || '');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(u)) return res.json({ ok: false, err: 'Name: 3-16 letters/numbers/_' });
  if (p.length < 4) return res.json({ ok: false, err: 'Password: 4+ chars' });
  const k = u.toLowerCase();
  if (users[k]) return res.json({ ok: false, err: 'Name taken' });
  const s = crypto.randomBytes(8).toString('hex');
  users[k] = { name: u, salt: s, pass: hash(p, s), token: tok(), save: null, scores: blankScores(), guild: null, created: Date.now() };
  persist();
  res.json({ ok: true, token: users[k].token, user: u });
});

app.post('/api/login', (req, res) => {
  const k = String(req.body.u || '').trim().toLowerCase(), p = String(req.body.p || '');
  const u = users[k];
  if (!u || u.pass !== hash(p, u.salt)) return res.json({ ok: false, err: 'Bad name/password' });
  u.token = tok(); persist();
  res.json({ ok: true, token: u.token, user: u.name });
});

app.get('/api/me', (req, res) => {
  const u = auth(req);
  if (!u) return res.json({ ok: false });
  res.json({ ok: true, user: u.name, scores: u.scores, guild: u.guild });
});

app.post('/api/save', (req, res) => {
  const u = auth(req);
  if (!u) return res.json({ ok: false });
  const d = String(req.body.data || '').slice(0, 1500000);
  if (!d) return res.json({ ok: false });
  u.save = d; persist();
  res.json({ ok: true, bytes: d.length });
});

app.get('/api/save', (req, res) => {
  const u = auth(req);
  if (!u || !u.save) return res.json({ ok: false });
  res.json({ ok: true, data: u.save });
});

app.post('/api/score', (req, res) => {
  const u = auth(req);
  if (!u) return res.json({ ok: false });
  for (const k of ['power', 'tower', 'survival', 'pvp']) {
    const v = Math.max(0, Math.floor(Number(req.body[k]) || 0));
    if (v > (u.scores[k] || 0)) u.scores[k] = v;
  }
  persist();
  res.json({ ok: true, scores: u.scores });
});

app.get('/api/scores', (req, res) => {
  const by = ['power', 'tower', 'survival', 'pvp', 'coop'].includes(req.query.by) ? req.query.by : 'power';
  const top = Object.values(users).map(u => ({ u: u.name, v: (u.scores && u.scores[by]) || 0 }))
    .filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 20);
  res.json({ ok: true, by, top });
});

app.get('/api/guilds', (req, res) =>
  res.json({ ok: true, guilds: guilds.map(g => ({ id: g.id, name: g.name, tag: g.tag, members: g.members.length })) }));

app.post('/api/guilds', (req, res) => {
  const u = auth(req);
  if (!u) return res.json({ ok: false });
  const name = String(req.body.name || '').trim().slice(0, 24);
  const tag = String(req.body.tag || '').trim().slice(0, 5).toUpperCase();
  if (name.length < 3 || !tag) return res.json({ ok: false, err: 'Guild name 3+ chars + TAG' });
  if (u.guild) return res.json({ ok: false, err: 'Already in a guild' });
  const g = { id: tok().slice(0, 8), name, tag, owner: u.name, members: [u.name], created: Date.now() };
  guilds.push(g); u.guild = g.id; persist();
  res.json({ ok: true, guild: { id: g.id, name, tag } });
});

app.post('/api/guilds/leave', (req, res) => {
  const u = auth(req);
  if (!u || !u.guild) return res.json({ ok: false });
  const g = guilds.find(g => g.id === u.guild);
  if (g) { g.members = g.members.filter(m => m !== u.name); if (!g.members.length) guilds = guilds.filter(x => x !== g); }
  u.guild = null; persist();
  res.json({ ok: true });
});

app.post('/api/guilds/:id/join', (req, res) => {
  const u = auth(req);
  const g = guilds.find(g => g.id === req.params.id);
  if (!u || !g) return res.json({ ok: false });
  if (u.guild) return res.json({ ok: false, err: 'Already in a guild' });
  if (g.members.length >= 20) return res.json({ ok: false, err: 'Guild full (20)' });
  g.members.push(u.name); u.guild = g.id; persist();
  res.json({ ok: true });
});

// ---------- WS helpers ----------
function roomOf(ws, map) {
  for (const [id, r] of map) {
    if (map === pvpRooms && (r.a.ws === ws || r.b.ws === ws)) return id;
    if (map === coopRooms && r.players.some(p => p.ws === ws)) return id;
  }
  return null;
}
function coopPublic(r) {
  return { code: r.code, state: r.state, boss: Math.max(0, Math.ceil(r.boss)), bossMax: r.bossMax,
    players: r.players.map(p => ({ name: p.name, hp: Math.max(0, Math.ceil(p.hp)), maxhp: p.maxhp, alive: p.alive })) };
}
function coopBcast(r, extra) {
  for (const p of r.players) send(p.ws, Object.assign({ t: 'coopUpdate', room: coopPublic(r) }, extra || {}));
}
function coopEnd(r, won, mvp) {
  r.state = won ? 'won' : 'lost';
  if (r.timer) { clearInterval(r.timer); r.timer = null; }
  const rewards = { coins: 400 * r.players.length + Math.floor(r.bossMax / 10), exp: 300 * r.players.length + Math.floor(r.bossMax / 12) };
  if (won) for (const p of r.players) { const u = users[p.name.toLowerCase()]; if (u) u.scores.coop = (u.scores.coop || 0) + 1; }
  persist();
  for (const p of r.players) send(p.ws, { t: 'coopEnd', won, mvp: mvp || null, rewards, room: coopPublic(r) });
  setTimeout(() => coopRooms.delete(r.code), 30000);
}
function bossTick(r) {
  if (r.state !== 'fight') return;
  const alive = r.players.filter(p => p.alive);
  if (!alive.length) { coopEnd(r, false); return; }
  const t = alive[Math.floor(Math.random() * alive.length)];
  const dmg = Math.round(t.maxhp * (0.08 + Math.random() * 0.07));
  t.hp -= dmg;
  let line = '👹 Boss slams ' + t.name + ' for ' + dmg + '!';
  if (t.hp <= 0) { t.hp = 0; t.alive = false; line += ' 💀 ' + t.name + ' is down!'; }
  r.log.push(line); r.log = r.log.slice(-12);
  coopBcast(r, { log: r.log });
  if (!r.players.some(p => p.alive)) coopEnd(r, false);
}
function pvpEndRoom(id, winner, reason) {
  const r = pvpRooms.get(id);
  if (!r) return;
  if (r.timer) { clearTimeout(r.timer); }
  pvpRooms.delete(id);
  if (winner) { const u = users[winner.toLowerCase()]; if (u) { u.scores.pvp = (u.scores.pvp || 0) + 1; persist(); } }
  send(r.a.ws, { t: 'pvpEnd', winner, reason: reason || 'done' });
  send(r.b.ws, { t: 'pvpEnd', winner, reason: reason || 'done' });
}
function pvpSettle(id) {
  const r = pvpRooms.get(id);
  if (!r) return;
  const wins = Object.keys(r.claims).filter(n => r.claims[n]);
  pvpEndRoom(id, wins.length === 1 ? wins[0] : null, wins.length === 1 ? 'done' : 'draw');
}

// ---------- WS ----------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
  ws._user = null; ws._lastChat = 0;
  const authTimer = setTimeout(() => { if (!ws._user) try { ws.close(); } catch (e) {} }, 15000);
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(String(raw).slice(0, 4000)); } catch (e) { return; }
    if (m.t === 'auth') {
      const u = byToken(String(m.token || ''));
      if (!u) return send(ws, { t: 'error', msg: 'bad token' });
      ws._user = u.name; online.add(ws);
      clearTimeout(authTimer);
      send(ws, { t: 'authed', user: u.name, tag: gtag(u), hist: chatHist.slice(-15) });
      return;
    }
    if (!ws._user) return;
    const me = users[ws._user.toLowerCase()];
    if (!me) return;
    switch (m.t) {
      case 'chat': {
        const now = Date.now();
        if (now - ws._lastChat < 800) return;
        const text = String(m.text || '').trim().slice(0, 200);
        if (!text) return;
        ws._lastChat = now;
        const line = { user: gtag(me) + me.name, text, ts: now };
        chatHist.push(line);
        while (chatHist.length > 30) chatHist.shift();
        const s = JSON.stringify(Object.assign({ t: 'chat' }, line));
        for (const c of online) try { if (c.readyState === 1) c.send(s); } catch (e) {}
        break;
      }
      case 'pvpJoin': {
        if (roomOf(ws, pvpRooms)) return;
        const level = Math.max(1, Math.min(999, Math.floor(Number(m.level) || 11)));
        const power = Math.max(1, Math.min(99999999, Math.floor(Number(m.power) || 1)));
        if (pvpWait && pvpWait.ws !== ws && pvpWait.ws.readyState === 1) {
          const foe = pvpWait; pvpWait = null;
          const id = tok().slice(0, 8);
          const aFirst = Math.random() < 0.5;
          pvpRooms.set(id, { a: { ws, name: me.name }, b: { ws: foe.ws, name: foe.name }, claims: {}, timer: null });
          send(ws, { t: 'pvpStart', room: id, foe: { name: foe.name, level: foe.level, power: foe.power }, first: aFirst });
          send(foe.ws, { t: 'pvpStart', room: id, foe: { name: me.name, level, power }, first: !aFirst });
        } else {
          pvpWait = { ws, name: me.name, level, power };
          send(ws, { t: 'pvpQueued' });
        }
        break;
      }
      case 'pvpLeave': {
        if (pvpWait && pvpWait.ws === ws) { pvpWait = null; send(ws, { t: 'pvpEnd', winner: null, reason: 'left' }); break; }
        const id = roomOf(ws, pvpRooms);
        if (id) {
          const r = pvpRooms.get(id);
          const foe = r.a.ws === ws ? r.b.name : r.a.name;
          pvpEndRoom(id, foe, 'fled');
        }
        break;
      }
      case 'pvpMove': {
        const r = pvpRooms.get(String(m.room || ''));
        if (!r) return;
        const foeWs = r.a.ws === ws ? r.b.ws : (r.b.ws === ws ? r.a.ws : null);
        if (!foeWs) return;
        const move = ['atk', 'heavy', 'heal'].includes(m.move) ? m.move : 'atk';
        const val = Math.max(0, Math.min(9999999, Math.floor(Number(m.val) || 0)));
        send(foeWs, { t: 'pvpFoeMove', move, val });
        break;
      }
      case 'pvpOver': {
        const id = String(m.room || '');
        const r = pvpRooms.get(id);
        if (!r) return;
        r.claims[me.name] = !!m.won;
        const names = [r.a.name, r.b.name];
        if (names.every(n => n in r.claims)) pvpSettle(id);
        else if (!r.timer) r.timer = setTimeout(() => pvpSettle(id), 8000);
        break;
      }
      case 'coopCreate': {
        if (roomOf(ws, coopRooms)) return;
        let code;
        do { code = Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); }
        while (coopRooms.has(code));
        const r = { code, state: 'lobby', boss: 0, bossMax: 0, players: [], timer: null, log: ['Room ' + code + ' opened by ' + me.name] };
        coopRooms.set(code, r);
        r.players.push({ ws, name: me.name, level: Math.max(1, Math.floor(Number(m.level) || 11)),
          power: Math.max(1, Math.floor(Number(m.power) || 1)), hp: 0, maxhp: 0, alive: true });
        send(ws, { t: 'coopRoom', room: coopPublic(r), log: r.log });
        break;
      }
      case 'coopJoin': {
        if (roomOf(ws, coopRooms)) return;
        const r = coopRooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) return send(ws, { t: 'error', msg: 'room not found' });
        if (r.state !== 'lobby') return send(ws, { t: 'error', msg: 'fight already started' });
        if (r.players.length >= 4) return send(ws, { t: 'error', msg: 'room full (4)' });
        r.players.push({ ws, name: me.name, level: Math.max(1, Math.floor(Number(m.level) || 11)),
          power: Math.max(1, Math.floor(Number(m.power) || 1)), hp: 0, maxhp: 0, alive: true });
        r.log.push(me.name + ' joined! (' + r.players.length + '/4)'); r.log = r.log.slice(-12);
        coopBcast(r, { log: r.log });
        break;
      }
      case 'coopLeave': {
        const id = roomOf(ws, coopRooms);
        if (!id) return;
        const r = coopRooms.get(id);
        r.players = r.players.filter(p => p.ws !== ws);
        r.log.push(me.name + ' left.'); r.log = r.log.slice(-12);
        if (!r.players.length) { if (r.timer) clearInterval(r.timer); coopRooms.delete(id); }
        else coopBcast(r, { log: r.log });
        send(ws, { t: 'coopLeft' });
        break;
      }
      case 'coopStart': {
        const id = roomOf(ws, coopRooms);
        if (!id) return;
        const r = coopRooms.get(id);
        if (r.state !== 'lobby' || r.timer) return;
        r.bossMax = 4000 * r.players.length;
        r.boss = r.bossMax;
        for (const p of r.players) { p.maxhp = 500 + p.level * 50; p.hp = p.maxhp; p.alive = true; }
        r.state = 'fight';
        r.log.push('👹 RAID BOSS awakens! ' + r.bossMax + ' HP!'); r.log = r.log.slice(-12);
        coopBcast(r, { log: r.log });
        r.timer = setInterval(() => bossTick(r), 4000);
        break;
      }
      case 'coopHit': {
        const id = roomOf(ws, coopRooms);
        if (!id) return;
        const r = coopRooms.get(id);
        if (r.state !== 'fight') return;
        const p = r.players.find(p => p.ws === ws);
        if (!p || !p.alive) return;
        const dmg = Math.max(0, Math.min(100000, Math.floor(Number(m.dmg) || 0)));
        if (!dmg) return;
        r.boss -= dmg;
        p.dealt = (p.dealt || 0) + dmg;
        r.log.push('⚔️ ' + p.name + ' hits ' + dmg + ' (' + Math.max(0, Math.ceil(r.boss)) + ' left)');
        r.log = r.log.slice(-12);
        if (r.boss <= 0) {
          r.boss = 0;
          const mvp = r.players.slice().sort((a, b) => (b.dealt || 0) - (a.dealt || 0))[0];
          coopBcast(r, { log: r.log });
          coopEnd(r, true, mvp ? mvp.name : null);
        } else coopBcast(r, { log: r.log });
        break;
      }
    }
  });
  ws.on('close', () => {
    online.delete(ws);
    if (pvpWait && pvpWait.ws === ws) pvpWait = null;
    const pid = roomOf(ws, pvpRooms);
    if (pid) { const r = pvpRooms.get(pid); const foe = r.a.ws === ws ? r.b.name : r.a.name; pvpEndRoom(pid, foe, 'fled'); }
    const cid = roomOf(ws, coopRooms);
    if (cid) {
      const r = coopRooms.get(cid);
      r.players = r.players.filter(p => p.ws !== ws);
      if (!r.players.length) { if (r.timer) clearInterval(r.timer); coopRooms.delete(cid); }
      else { r.log.push((ws._user || '?') + ' disconnected.'); r.log = r.log.slice(-12); coopBcast(r, { log: r.log }); }
    }
  });
});

server.listen(PORT, () => console.log('🐉 Murim Login server live on port ' + PORT));
