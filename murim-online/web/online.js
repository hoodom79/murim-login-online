/* ============================================================
   MURIM LOGIN — ONLINE LAYER v16 (client)
   Adds: accounts, cloud saves, leaderboards, guilds, global chat,
   LIVE PvP matchmaking + battles, co-op raid rooms.
   Hooks into the game's globals (S, playerPower, gainExp...).
   Server URL is editable in-game so no rebuild is needed.
   ============================================================ */
(function () {
  if (window.__murimOnline) return;
  window.__murimOnline = true;

  // ---------- tiny helpers ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const has = n => { try { return typeof eval(n) !== 'undefined'; } catch (e) { return false; } };
  const G = n => { try { return eval(n); } catch (e) { return undefined; } };
  const sys = t => { try { if (has('sys')) G('sys')(t); else console.log(t); } catch (e) { console.log(t); } };
  const myLevel = () => (has('S') && G('S').level) || 11;
  const myPower = () => { try { return has('playerPower') ? G('playerPower')() : 100; } catch (e) { return 100; } };
  const myBests = () => {
    const S = has('S') ? G('S') : {};
    return { power: myPower(), tower: (S.tower && S.tower.best) || 0, survival: (S.surv && S.surv.best) || 0, pvp: S.pvpWins || 0 };
  };
  const reward = (coins, exp, why) => {
    try {
      if (has('S')) { G('S').coins = (G('S').coins || 0) + coins; }
      if (has('gainExp')) G('gainExp')(exp);
      if (has('updateUI')) G('updateUI')();
      if (has('saveGame')) G('saveGame')();
      sys('🌐 ' + why + ': +' + coins + 'c +' + exp + 'exp!');
    } catch (e) { console.log('reward fail', e); }
  };

  // ---------- config / session ----------
  let SRV = localStorage.getItem('murimServerUrl') || 'https://murim-server.onrender.com';
  let TOKEN = localStorage.getItem('murimToken') || '';
  let USER = localStorage.getItem('murimUser') || '';
  let ws = null, wsReady = false, wsTag = '';
  const chatLog = [];
  let unread = 0, activeTab = 'account';

  async function api(path, method, body) {
    try {
      const r = await fetch(SRV + path, {
        method: method || 'GET',
        headers: { 'Content-Type': 'application/json', 'x-token': TOKEN },
        body: body ? JSON.stringify(body) : undefined
      });
      return await r.json();
    } catch (e) { return { ok: false, err: 'no server (' + e.message + ')' }; }
  }
  function ensureWs() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try { if (ws) ws.close(); } catch (e) {}
    wsReady = false;
    const url = SRV.replace(/^http/, 'ws');
    try { ws = new WebSocket(url); } catch (e) { sys('🌐 WS blocked: ' + e.message); return; }
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: TOKEN }));
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      onWs(m);
    };
    ws.onclose = () => { wsReady = false; };
    ws.onerror = () => { /* offline: panels show errors on demand */ };
  }
  const wsend = o => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; };

  // ---------- UI shell ----------
  const css = document.createElement('style');
  css.textContent = '.onTabs{display:flex;gap:4px;flex-wrap:wrap;justify-content:center;margin:8px 0}'
    + '.onTabs button{padding:6px 8px;font-size:12px;border-radius:8px;border:1px solid #4da6ff;background:#16233a;color:#cfe6ff;cursor:pointer}'
    + '.onTabs button.on{background:#4da6ff;color:#06121f;font-weight:bold}'
    + '.onRow{display:flex;gap:6px;justify-content:center;margin:6px 0;flex-wrap:wrap}'
    + '.onRow input,.onRow select{background:#0a1424;color:#fff;border:1px solid #4da6ff;border-radius:8px;padding:7px;min-width:0}'
    + '.onBtn{background:#1c3d63;color:#fff;border:1px solid #4da6ff;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:13px}'
    + '.onBtn:disabled{opacity:.4;cursor:default}'
    + '.onBtn.hot{background:#7a2e00;border-color:#ff9a3d}'
    + '.onBox{background:#0a1424;border:1px solid #274a75;border-radius:10px;padding:8px;margin:6px 0;text-align:left;font-size:13px;max-height:220px;overflow-y:auto}'
    + '.onBar{height:14px;background:#301014;border-radius:7px;overflow:hidden;margin:3px 0}'
    + '.onBar>i{display:block;height:100%;background:linear-gradient(90deg,#ff5a5a,#ffb35a);transition:width .3s}'
    + '.onBar.blue>i{background:linear-gradient(90deg,#4da6ff,#9adcff)}'
    + '.onBar.green>i{background:linear-gradient(90deg,#3ddc68,#b8ff9a)}'
    + '#onFloat{position:fixed;right:12px;bottom:12px;z-index:300;width:52px;height:52px;border-radius:50%;background:#12325c;border:2px solid #4da6ff;color:#fff;font-size:24px;cursor:pointer;box-shadow:0 0 14px rgba(77,166,255,.5)}'
    + '#onFloat .dot{position:absolute;top:-2px;right:-2px;background:#ff4040;border-radius:50%;min-width:20px;height:20px;font-size:12px;line-height:20px;display:none}';
  document.head.appendChild(css);

  const float = document.createElement('button');
  float.id = 'onFloat';
  float.innerHTML = '🌐<span class="dot" id="onDot"></span>';
  float.title = 'Online play';
  float.onclick = () => { $('onlineOverlay').classList.remove('hidden'); renderTab(); };
  document.body.appendChild(float);

  const ov = document.createElement('div');
  ov.className = 'overlay hidden';
  ov.id = 'onlineOverlay';
  ov.innerHTML = '<div class="card"><h2>🌐 MURIM ONLINE</h2><div style="font-size:12px" id="onStatus">…</div>'
    + '<div class="onTabs" id="onTabs"></div><div id="onBody"></div>'
    + '<div class="onRow"><button class="onBtn" id="onClose">Close</button></div></div>';
  document.body.appendChild(ov);
  $('onClose').onclick = () => { pvpCleanup(); coopCleanup(true); ov.classList.add('hidden'); };

  const TABS = [['account', '👤'], ['ranks', '🏆'], ['guild', '🛡️'], ['chat', '💬'], ['pvp', '⚔️ Live PvP'], ['coop', '👹 Co-op'], ['cloud', '☁️']];
  function statusLine() {
    $('onStatus').innerHTML = (USER ? 'Logged in as <b>' + esc(USER) + '</b> ' + esc(wsTag) : 'Not logged in')
      + '<br><small>' + esc(SRV) + (wsReady ? ' · <span style="color:#7dff9a">● live</span>' : ' · <span style="color:#888">○ offline</span>') + '</small>';
  }
  function renderTab() {
    statusLine();
    $('onTabs').innerHTML = TABS.map(t =>
      '<button data-t="' + t[0] + '" class="' + (activeTab === t[0] ? 'on' : '') + '">' + t[1] + (t[0] === 'chat' && unread ? ' (' + unread + ')' : '') + '</button>').join('');
    Array.prototype.forEach.call($('onTabs').children, b => { b.onclick = () => { activeTab = b.dataset.t; if (activeTab === 'chat') { unread = 0; $('onDot').style.display = 'none'; } renderTab(); }; });
    ({ account: vAccount, ranks: vRanks, guild: vGuild, chat: vChat, pvp: vPvp, coop: vCoop, cloud: vCloud })[activeTab]();
  }

  // ---------- Account ----------
  function vAccount() {
    const b = $('onBody');
    if (!TOKEN) {
      b.innerHTML = '<div class="onRow"><input id="onU" placeholder="username" maxlength="16" style="width:130px">'
        + '<input id="onP" type="password" placeholder="password" style="width:130px"></div>'
        + '<div class="onRow"><button class="onBtn hot" id="onReg">Register</button><button class="onBtn" id="onLog">Login</button></div>'
        + '<div class="onBox">First time? Pick a name + password and hit <b>Register</b>. Same account works on every device via cloud save.</div>'
        + srvRow();
      $('onReg').onclick = () => doAuth('register');
      $('onLog').onclick = () => doAuth('login');
      wireSrv();
    } else {
      b.innerHTML = '<div class="onBox">👤 <b>' + esc(USER) + '</b><br>Level ' + myLevel() + ' · Power ' + myPower()
        + '<br><small>Token saved on this device. Log out to switch accounts.</small></div>'
        + '<div class="onRow"><button class="onBtn" id="onOut">Log out</button></div>' + srvRow();
      $('onOut').onclick = () => { TOKEN = ''; USER = ''; localStorage.removeItem('murimToken'); localStorage.removeItem('murimUser'); try { ws.close(); } catch (e) {} renderTab(); };
      wireSrv();
    }
  }
  function srvRow() {
    return '<div class="onRow"><input id="onSrv" value="' + esc(SRV) + '" style="width:260px;font-size:11px"><button class="onBtn" id="onSrvGo">Set</button></div>'
      + '<div style="font-size:11px;color:#8aa">⬆ server URL — paste your Render URL here, no rebuild needed.</div>';
  }
  function wireSrv() {
    $('onSrvGo').onclick = () => {
      SRV = $('onSrv').value.trim().replace(/\/$/, '') || SRV;
      localStorage.setItem('murimServerUrl', SRV);
      try { ws.close(); } catch (e) {}
      sys('🌐 Server set to ' + SRV);
      renderTab();
    };
  }
  async function doAuth(kind) {
    const u = $('onU').value.trim(), p = $('onP').value;
    const r = await api('/api/' + kind, 'POST', { u, p });
    if (!r.ok) { sys('🌐 ' + (r.err || 'auth failed')); return; }
    TOKEN = r.token; USER = r.user;
    localStorage.setItem('murimToken', TOKEN); localStorage.setItem('murimUser', USER);
    sys('🌐 Welcome, ' + USER + '!');
    ensureWs(); renderTab();
  }

  // ---------- Ranks ----------
  let rankBy = 'power';
  async function vRanks() {
    const b = $('onBody');
    b.innerHTML = '<div class="onRow">' + ['power', 'tower', 'survival', 'pvp', 'coop'].map(k =>
      '<button class="onBtn' + (rankBy === k ? ' hot' : '') + '" data-k="' + k + '">' + k + '</button>').join('') + '</div>'
      + '<div class="onRow"><button class="onBtn" id="onSub">📤 Submit my score</button></div><div class="onBox" id="onRankList">loading…</div>';
    Array.prototype.forEach.call(b.querySelectorAll('[data-k]'), x => { x.onclick = () => { rankBy = x.dataset.k; vRanks(); }; });
    $('onSub').onclick = submitScore;
    if (TOKEN) await submitScore(true);
    const r = await api('/api/scores?by=' + rankBy);
    $('onRankList').innerHTML = !r.ok ? esc(r.err || 'offline') :
      (r.top.length ? r.top.map((e, i) => (i + 1) + '. <b>' + esc(e.u) + '</b> — ' + e.v.toLocaleString()).join('<br>') : 'No scores yet. Be the first!');
  }
  async function submitScore(silent) {
    if (!TOKEN) { if (!silent) sys('🌐 Log in first!'); return; }
    const r = await api('/api/score', 'POST', myBests());
    if (!silent) sys(r.ok ? '🌐 Score submitted!' : '🌐 ' + (r.err || 'submit failed'));
  }

  // ---------- Guilds ----------
  async function vGuild() {
    const b = $('onBody');
    const me = TOKEN ? await api('/api/me') : { ok: false };
    const g = await api('/api/guilds');
    let h = '';
    if (!TOKEN) h += '<div class="onBox">Log in to join a guild.</div>';
    else if (me.ok && me.guild) h += '<div class="onBox">🛡️ You are in a guild. Fight with honor!</div><div class="onRow"><button class="onBtn" id="onGLeave">Leave guild</button></div>';
    else h += '<div class="onRow"><input id="onGName" placeholder="Guild name" maxlength="24" style="width:140px"><input id="onGTag" placeholder="TAG" maxlength="5" style="width:70px"></div>'
      + '<div class="onRow"><button class="onBtn hot" id="onGMake">Create guild</button></div>';
    h += '<div class="onBox" id="onGList">' + (!g.ok ? esc(g.err || 'offline') : (g.guilds.length ? g.guilds.map(x =>
      '🛡️ <b>[' + esc(x.tag) + '] ' + esc(x.name) + '</b> (' + x.members + '/20) ' + (TOKEN && !(me.ok && me.guild) ? '<button class="onBtn" data-j="' + x.id + '">Join</button>' : '')
    ).join('<br>') : 'No guilds yet. Found the first!')) + '</div>';
    b.innerHTML = h;
    const lv = $('onGLeave'); if (lv) lv.onclick = async () => { await api('/api/guilds/leave', 'POST', {}); vGuild(); statusLine(); };
    const mk = $('onGMake'); if (mk) mk.onclick = async () => {
      const r = await api('/api/guilds', 'POST', { name: $('onGName').value, tag: $('onGTag').value });
      sys(r.ok ? '🌐 Guild founded!' : '🌐 ' + (r.err || 'failed')); vGuild(); statusLine();
    };
    Array.prototype.forEach.call(b.querySelectorAll('[data-j]'), x => { x.onclick = async () => {
      const r = await api('/api/guilds/' + x.dataset.j + '/join', 'POST', {});
      sys(r.ok ? '🌐 Joined guild!' : '🌐 ' + (r.err || 'failed')); vGuild(); statusLine();
    }; });
  }

  // ---------- Chat ----------
  function vChat() {
    ensureWs();
    const b = $('onBody');
    b.innerHTML = '<div class="onBox" id="onChat" style="min-height:150px"></div>'
      + '<div class="onRow"><input id="onChatIn" placeholder="say hi to the murim…" maxlength="200" style="flex:1;min-width:140px"><button class="onBtn" id="onChatGo">Send</button></div>';
    drawChat();
    const go = () => {
      if (!TOKEN) { sys('🌐 Log in to chat!'); return; }
      const t = $('onChatIn').value.trim();
      if (!t) return;
      if (!wsend({ t: 'chat', text: t })) { sys('🌐 Not connected — check server URL.'); return; }
      $('onChatIn').value = '';
    };
    $('onChatGo').onclick = go;
    $('onChatIn').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  function drawChat() {
    const c = $('onChat'); if (!c) return;
    c.innerHTML = chatLog.length ? chatLog.map(l => '<b>' + esc(l.user) + ':</b> ' + esc(l.text)).join('<br>') : '…silence in the murim…';
    c.scrollTop = c.scrollHeight;
  }

  // ---------- Live PvP ----------
  let pvp = null; // {room,foe,first,myHp,myMax,foeHp,foeMax,turn,heavy,heal,over}
  function vPvp() {
    ensureWs();
    const b = $('onBody');
    if (!TOKEN) { b.innerHTML = '<div class="onBox">Log in to fight real players!</div>'; return; }
    if (!pvp) {
      b.innerHTML = '<div class="onBox">⚔️ <b>Live PvP</b> — matched by queue, turn-based, best fighter wins.<br>Win: +300c +200exp + leaderboard glory.</div>'
        + '<div class="onRow"><button class="onBtn hot" id="onQ">🔍 Find opponent (Lv' + myLevel() + ' · ' + myPower() + ')</button></div><div class="onBox" id="onPvpMsg">…</div>';
      $('onQ').onclick = () => {
        if (!wsend({ t: 'pvpJoin', level: myLevel(), power: myPower() })) { $('onPvpMsg').textContent = 'Not connected — check server URL.'; return; }
        $('onPvpMsg').textContent = 'Searching…';
        $('onQ').disabled = true; $('onQ').textContent = 'Searching… (tap Close to cancel)';
      };
      return;
    }
    const foePct = Math.max(0, pvp.foeHp / pvp.foeMax * 100), myPct = Math.max(0, pvp.myHp / pvp.myMax * 100);
    b.innerHTML = '<div class="onBox">⚔️ <b>' + esc(pvp.foe.name) + '</b> (Lv' + pvp.foe.level + ' · ' + pvp.foe.power + ' power)'
      + '<div class="onBar"><i style="width:' + foePct + '%"></i></div><small>' + Math.max(0, Math.ceil(pvp.foeHp)) + '/' + pvp.foeMax + '</small></div>'
      + '<div class="onBox">🛡️ <b>You</b><div class="onBar green"><i style="width:' + myPct + '%"></i></div><small>' + Math.max(0, Math.ceil(pvp.myHp)) + '/' + pvp.myMax + '</small></div>'
      + '<div class="onBox" id="onPvpLog" style="max-height:110px">' + pvp.log.slice(-6).join('<br>') + '</div>'
      + '<div class="onRow"><button class="onBtn hot" id="mAtk">⚔️ Attack</button>'
      + '<button class="onBtn" id="mHeavy">💥 Heavy (' + pvp.heavy + ')</button>'
      + '<button class="onBtn" id="mHeal">💚 Heal (' + pvp.heal + ')</button></div>'
      + '<div class="onRow"><button class="onBtn" id="mFlee">🏳️ Flee</button></div>';
    const can = pvp.turn && !pvp.over;
    $('mAtk').disabled = $('mHeavy').disabled = $('mHeal').disabled = !can;
    if (pvp.heavy <= 0) $('mHeavy').disabled = true;
    if (pvp.heal <= 0) $('mHeal').disabled = true;
    $('mAtk').onclick = () => pvpMove('atk');
    $('mHeavy').onclick = () => pvpMove('heavy');
    $('mHeal').onclick = () => pvpMove('heal');
    $('mFlee').onclick = () => { wsend({ t: 'pvpLeave' }); pvp = null; vPvp(); };
  }
  const pvpDmg = p => Math.round(p * 0.08 + Math.random() * p * 0.04);
  function pvpMove(kind) {
    if (!pvp || !pvp.turn || pvp.over) return;
    if (kind === 'heavy' && pvp.heavy <= 0) return;
    if (kind === 'heal' && pvp.heal <= 0) return;
    let val = 0;
    if (kind === 'atk') { val = pvpDmg(myPower()); pvp.foeHp -= val; pvp.log.push('⚔️ You strike for ' + val + '!'); }
    if (kind === 'heavy') { pvp.heavy--; val = Math.round(pvpDmg(myPower()) * 1.8); pvp.foeHp -= val; pvp.log.push('💥 HEAVY slam for ' + val + '!'); }
    if (kind === 'heal') { pvp.heavy = pvp.heavy; pvp.heal--; val = Math.round(pvp.myMax * 0.4); pvp.myHp = Math.min(pvp.myMax, pvp.myHp + val); pvp.log.push('💚 You heal ' + val + ' HP!'); }
    pvp.turn = false;
    wsend({ t: 'pvpMove', room: pvp.room, move: kind, val });
    if (pvp.foeHp <= 0 && !pvp.over) { pvp.over = true; pvp.log.push('🏆 Opponent down! Waiting for result…'); wsend({ t: 'pvpOver', room: pvp.room, won: true }); }
    if (activeTab === 'pvp') vPvp();
  }
  function pvpCleanup() { if (pvp && !pvp.over) wsend({ t: 'pvpLeave' }); pvp = null; }

  // ---------- Co-op raids ----------
  let coop = null; // {room,log[]}
  let coopCd = 0;
  function vCoop() {
    ensureWs();
    const b = $('onBody');
    if (!TOKEN) { b.innerHTML = '<div class="onBox">Log in to raid with real players!</div>'; return; }
    if (!coop) {
      b.innerHTML = '<div class="onBox">👹 <b>Co-op Raid</b> — up to 4 players vs one big boss. Share the room code with friends!<br>Win: bonus coins + EXP for everyone + MVP glory.</div>'
        + '<div class="onRow"><button class="onBtn hot" id="cMake">Create room</button></div>'
        + '<div class="onRow"><input id="cCode" placeholder="CODE" maxlength="4" style="width:80px;text-transform:uppercase"><button class="onBtn" id="cJoin">Join room</button></div>';
      $('cMake').onclick = () => { if (!wsend({ t: 'coopCreate', level: myLevel(), power: myPower() })) sys('🌐 Not connected — check server URL.'); };
      $('cJoin').onclick = () => { const c = $('cCode').value.trim().toUpperCase(); if (c) wsend({ t: 'coopJoin', code: c, level: myLevel(), power: myPower() }); };
      return;
    }
    const r = coop.room;
    let h = '<div class="onBox">🚪 Room <b>' + esc(r.code) + '</b> · ' + r.state.toUpperCase() + ' · ' + r.players.length + '/4</div>';
    if (r.state !== 'lobby') {
      const pct = Math.max(0, r.boss / r.bossMax * 100);
      h += '<div class="onBox">👹 <b>RAID BOSS</b><div class="onBar"><i style="width:' + pct + '%"></i></div><small>' + r.boss.toLocaleString() + ' / ' + r.bossMax.toLocaleString() + '</small></div>';
    }
    h += '<div class="onBox">' + r.players.map(p => {
      const pct = p.maxhp ? Math.max(0, p.hp / p.maxhp * 100) : 100;
      return (p.alive ? '🟢' : '💀') + ' <b>' + esc(p.name) + '</b>' + (r.state !== 'lobby' ? ' <small>' + p.hp + '/' + p.maxhp + '</small><div class="onBar blue"><i style="width:' + pct + '%"></i></div>' : '');
    }).join('') + '</div>';
    h += '<div class="onBox" style="max-height:100px">' + coop.log.slice(-6).map(esc).join('<br>') + '</div>';
    h += '<div class="onRow">';
    if (r.state === 'lobby') h += '<button class="onBtn hot" id="cStart">⚔️ START RAID</button>';
    else if (r.state === 'fight') h += '<button class="onBtn hot" id="cAtk">⚔️ ATTACK</button>';
    h += '<button class="onBtn" id="cLeave">Leave</button></div>';
    b.innerHTML = h;
    const st = $('cStart'); if (st) st.onclick = () => wsend({ t: 'coopStart' });
    const at = $('cAtk'); if (at) at.onclick = () => {
      const now = Date.now();
      if (now - coopCd < 1500) return;
      coopCd = now;
      const dmg = Math.round(myPower() * 0.06 + Math.random() * myPower() * 0.03);
      wsend({ t: 'coopHit', dmg });
    };
    $('cLeave').onclick = () => coopCleanup(false);
  }
  function coopCleanup(silentClose) {
    if (coop && coop.room.state !== 'won' && coop.room.state !== 'lost') wsend({ t: 'coopLeave' });
    coop = null;
    if (!silentClose && activeTab === 'coop') vCoop();
  }

  // ---------- Cloud saves ----------
  function vCloud() {
    const b = $('onBody');
    if (!TOKEN) { b.innerHTML = '<div class="onBox">Log in to use cloud saves — one account, every device.</div>'; return; }
    b.innerHTML = '<div class="onBox">☁️ <b>Cloud save</b><br>Upload from this device, download on another. Download <b>replaces</b> the local save — upload first if unsure!</div>'
      + '<div class="onRow"><button class="onBtn" id="cUp">📤 Upload</button><button class="onBtn hot" id="cDown">📥 Download</button></div><div class="onBox" id="cMsg">…</div>';
    $('cUp').onclick = async () => {
      const d = localStorage.getItem('murimSaveV2');
      if (!d) { $('cMsg').textContent = 'No local save found.'; return; }
      const r = await api('/api/save', 'POST', { data: d });
      $('cMsg').textContent = r.ok ? 'Uploaded ' + r.bytes + ' bytes! ☁️' : ('Failed: ' + (r.err || 'offline'));
      if (r.ok) sys('☁️ Save uploaded!');
    };
    $('cDown').onclick = async () => {
      if (!confirm('Replace local save with cloud save?')) return;
      const r = await api('/api/save');
      if (!r.ok || !r.data) { $('cMsg').textContent = 'No cloud save yet — upload first!'; return; }
      try {
        localStorage.setItem('murimSaveV2', r.data);
        const d = JSON.parse(r.data);
        if (has('S') && has('defaultState')) {
          window.__cloudSave = d;
          eval('S = Object.assign(defaultState(), window.__cloudSave)');
          window.__cloudSave = null;
          const S = G('S');
          S.inCombat = false; S.enemy = null; S.started = true; S.seen = S.seen || {};
          const so = $('startOverlay'); if (so) so.classList.add('hidden');
        }
        if (has('updateUI')) G('updateUI')();
        $('cMsg').textContent = 'Downloaded! Welcome back, traveler. ☁️';
        sys('☁️ Cloud save downloaded!');
      } catch (e) { $('cMsg').textContent = 'Save corrupt?! ' + e.message; }
    };
  }

  // ---------- WS router ----------
  function onWs(m) {
    if (m.t === 'authed') { wsReady = true; wsTag = m.tag || ''; (m.hist || []).forEach(l => chatLog.push(l)); statusLine(); if (activeTab === 'chat') drawChat(); return; }
    if (m.t === 'error') { sys('🌐 ' + (m.msg || 'error')); return; }
    if (m.t === 'chat') {
      chatLog.push(m); while (chatLog.length > 60) chatLog.shift();
      if (activeTab === 'chat' && !$('onlineOverlay').classList.contains('hidden')) drawChat();
      else { unread++; const d = $('onDot'); d.textContent = unread > 9 ? '9+' : unread; d.style.display = 'block'; if (!$('onlineOverlay').classList.contains('hidden')) renderTab(); }
      return;
    }
    if (m.t === 'pvpQueued') { const e = $('onPvpMsg'); if (e) e.textContent = 'In queue… waiting for a worthy foe…'; return; }
    if (m.t === 'pvpStart') {
      const myMax = 200 + myLevel() * 30, foeMax = 200 + m.foe.level * 30;
      pvp = { room: m.room, foe: m.foe, myHp: myMax, myMax, foeHp: foeMax, foeMax, turn: !!m.first, heavy: 2, heal: 1, over: false, log: ['⚔️ Matched vs <b>' + esc(m.foe.name) + '</b>! ' + (m.first ? 'You strike first!' : 'Foe strikes first…')] };
      sys('🌐 PvP matched vs ' + m.foe.name + '!');
      if (activeTab === 'pvp') vPvp();
      return;
    }
    if (m.t === 'pvpFoeMove') {
      if (!pvp || pvp.over) return;
      if (m.move === 'heal') { pvp.foeHp = Math.min(pvp.foeMax, pvp.foeHp + m.val); pvp.log.push('💚 Foe heals ' + m.val + '!'); }
      else { pvp.myHp -= m.val; pvp.log.push((m.move === 'heavy' ? '💥 Foe HEAVY hits ' : '⚔️ Foe hits ') + m.val + '!'); }
      if (pvp.myHp <= 0) { pvp.myHp = 0; pvp.over = true; pvp.log.push('💀 You fall! Waiting for result…'); wsend({ t: 'pvpOver', room: pvp.room, won: false }); }
      else pvp.turn = true;
      if (activeTab === 'pvp') vPvp();
      return;
    }
    if (m.t === 'pvpEnd') {
      if (!pvp) return;
      const won = m.winner === USER;
      if (m.reason === 'fled' && won) sys('🌐 Foe fled! Victory!');
      else if (m.reason === 'draw' || !m.winner) sys('🌐 PvP draw!');
      else sys(won ? '🌐 PvP VICTORY!' : '🌐 PvP defeat… train harder!');
      if (won) { try { if (has('S')) G('S').pvpWins = (G('S').pvpWins || 0) + 1; } catch (e) {} reward(300, 200, 'Live PvP win'); submitScore(true); }
      pvp = null;
      if (activeTab === 'pvp') vPvp(); else renderTab();
      return;
    }
    if (m.t === 'coopRoom' || m.t === 'coopUpdate') {
      if (!coop) coop = { room: m.room, log: [] };
      coop.room = m.room;
      if (m.log) coop.log = m.log.slice();
      if (activeTab === 'coop') vCoop();
      return;
    }
    if (m.t === 'coopEnd') {
      coop = { room: m.room, log: ['🏆 RAID ' + (m.won ? 'WON' : 'LOST') + (m.mvp ? '! MVP: ' + m.mvp : '!')] };
      if (m.won) { reward(m.rewards.coins, m.rewards.exp, 'Co-op raid win' + (m.mvp === USER ? ' (MVP!)' : '')); submitScore(true); }
      else sys('🌐 Raid failed… the boss stands victorious.');
      if (activeTab === 'coop') vCoop();
      return;
    }
    if (m.t === 'coopLeft') { coop = null; if (activeTab === 'coop') vCoop(); return; }
  }

  if (TOKEN) ensureWs();
  sys('🌐 Online layer loaded — tap 🌐 (bottom-right) to play together!');
})();
