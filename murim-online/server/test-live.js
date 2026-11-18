// Live protocol test: registers 2 bot users, then exercises chat, PvP match,
// and a co-op raid over real WebSockets. Usage: node test-live.js [baseUrl]
const WS = require('ws');
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
let pass = 0, fail = 0;
const ok = (c, name) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + name); };
async function api(path, method, body, token) {
  const r = await fetch(BASE + path, { method: method || 'GET',
    headers: { 'Content-Type': 'application/json', 'x-token': token || '' },
    body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const waitFor = (ws, pred, ms) => new Promise(res => {
  const t = setTimeout(() => { ws.removeListener('message', h); res(null); }, ms || 5000);
  const h = raw => { let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (pred(m)) { clearTimeout(t); ws.removeListener('message', h); res(m); } };
  ws.on('message', h);
});
(async () => {
  const tag = Date.now().toString(36);
  const A = 'botA' + tag, B = 'botB' + tag;
  const ra = await api('/api/register', 'POST', { u: A, p: 'pw1234' });
  const rb = await api('/api/register', 'POST', { u: B, p: 'pw1234' });
  ok(ra.ok && rb.ok, 'register x2');
  const bad = await api('/api/login', 'POST', { u: A, p: 'wrong' });
  ok(!bad.ok, 'bad password rejected');
  const me = await api('/api/me', 'GET', null, ra.token);
  ok(me.ok && me.user === A, 'token auth');
  const sv = await api('/api/save', 'POST', { data: '{"level":42}' }, ra.token);
  const gd = await api('/api/save', 'GET', null, ra.token);
  ok(sv.ok && gd.data === '{"level":42}', 'cloud save up/down');
  const sc = await api('/api/score', 'POST', { power: 5000, tower: 30, survival: 12, pvp: 0 }, ra.token);
  const lb = await api('/api/scores?by=power');
  ok(sc.ok && lb.top.some(e => e.u === A && e.v === 5000), 'leaderboard submit/read');
  const g = await api('/api/guilds', 'POST', { name: 'TestGuild' + tag, tag: 'TG' + tag.slice(-2) }, ra.token);
  const j = await api('/api/guilds/' + (g.guild && g.guild.id) + '/join', 'POST', {}, rb.token);
  const gl = await api('/api/guilds');
  ok(g.ok && j.ok && gl.guilds.some(x => x.members === 2), 'guild create/join/list');

  const w = url => new Promise((res, rej) => { const s = new WS(url); s.on('open', () => res(s)); s.on('error', rej); });
  const wurl = BASE.replace(/^http/, 'ws');
  const wa = await w(wurl), wb = await w(wurl);
  const pa0 = waitFor(wa, m => m.t === 'authed'), pb0 = waitFor(wb, m => m.t === 'authed');
  wa.send(JSON.stringify({ t: 'auth', token: ra.token }));
  wb.send(JSON.stringify({ t: 'auth', token: rb.token }));
  ok(!!(await pa0) && !!(await pb0), 'ws auth x2');
  wa.send(JSON.stringify({ t: 'chat', text: 'hello murim' }));
  ok(!!(await waitFor(wb, m => m.t === 'chat' && m.text === 'hello murim')), 'global chat relay');

  const pa1 = waitFor(wa, m => m.t === 'pvpStart'), pb1 = waitFor(wb, m => m.t === 'pvpStart');
  wa.send(JSON.stringify({ t: 'pvpJoin', level: 20, power: 3000 }));
  wb.send(JSON.stringify({ t: 'pvpJoin', level: 20, power: 3000 }));
  const sa = await pa1, sb = await pb1;
  ok(!!sa && !!sb && sa.room === sb.room && sa.foe.name === B && sb.foe.name === A && sa.first !== sb.first, 'pvp matchmaking');
  wa.send(JSON.stringify({ t: 'pvpMove', room: sa.room, move: 'atk', val: 250 }));
  ok(!!(await waitFor(wb, m => m.t === 'pvpFoeMove' && m.val === 250)), 'pvp move relay');
  const pa2 = waitFor(wa, m => m.t === 'pvpEnd'), pb2 = waitFor(wb, m => m.t === 'pvpEnd');
  wa.send(JSON.stringify({ t: 'pvpOver', room: sa.room, won: true }));
  wb.send(JSON.stringify({ t: 'pvpOver', room: sa.room, won: false }));
  const ea = await pa2, eb = await pb2;
  ok(!!ea && !!eb && ea.winner === A && eb.winner === A, 'pvp result agree+settle');
  const me2 = await api('/api/me', 'GET', null, ra.token);
  ok(me2.scores.pvp === 1, 'pvp win recorded');

  wa.send(JSON.stringify({ t: 'coopCreate', level: 20, power: 3000 }));
  const cr = await waitFor(wa, m => m.t === 'coopRoom');
  wb.send(JSON.stringify({ t: 'coopJoin', code: cr.room.code, level: 20, power: 3000 }));
  const uj = await waitFor(wb, m => m.t === 'coopUpdate' && m.room.players.length === 2);
  ok(!!cr && !!uj, 'coop create/join (room ' + (cr && cr.room.code) + ')');
  wa.send(JSON.stringify({ t: 'coopStart' }));
  ok(!!(await waitFor(wb, m => m.t === 'coopUpdate' && m.room.state === 'fight')), 'coop raid start');
  wa.send(JSON.stringify({ t: 'coopHit', dmg: 99999 }));
  const ce = await waitFor(wb, m => m.t === 'coopEnd' && m.won === true);
  ok(!!ce && ce.mvp === A && ce.rewards.coins > 0, 'coop boss kill + MVP + rewards');
  const me3 = await api('/api/me', 'GET', null, rb.token);
  ok(me3.scores.coop === 1, 'coop win recorded');

  wa.close(); wb.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
