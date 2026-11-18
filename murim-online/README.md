# 🐉 Murim Login — Online Edition (v16)

Play the full game on Android **together**: accounts, cloud saves, leaderboards,
guilds, global chat, **live PvP battles** and **co-op raid rooms**.

## What's inside

| Folder | What it is |
|---|---|
| `server/` | Multiplayer server (Node 18+, zero native deps). REST + WebSockets. Tested 16/16 ✅ |
| `web/online.js` | In-game online layer — injected into the game at build time, no game edits needed |
| `app/` | Native Android app (WebView wrapper, fullscreen, offline single-player works too) |
| `tools/build-web.py` | Packs game HTML + online.js into the app's assets |
| `.github/workflows/` | Free cloud APK builder (GitHub Actions) |
| `murim-login-v16-debug.apk` | Ready-to-install test APK (built from this exact code) |

## Part 1 — Put the server online (free, ~10 min)

The app works offline for single-player, but multiplayer needs this server running 24/7.

1. Create a free account at **render.com** (GitHub login is easiest).
2. Push this `murim-online` folder to a GitHub repo (name it e.g. `murim-login-online`).
3. In Render: **New → Blueprint** → pick your repo. Render reads `server/render.yaml` and deploys.
   - Or manual: **New → Web Service** → repo → Root Directory `server` → Build `npm install` → Start `node server.js` → plan **Free**.
4. Wait ~3 min. You'll get a URL like `https://murim-server.onrender.com`.
5. Check it: open `https://YOUR-URL/api/health` — you should see `{"ok":true,...}`.

> ⚠️ Free-tier notes: first connection after idle takes ~50s (server wakes up);
> accounts/scores **reset if you redeploy** (JSON storage). Fine for testing —
> upgrade to Postgres ($7/mo) before a real launch. See “Roadmap” below.

## Part 2 — Get the app on phones

**Option A — install the test APK (fastest):**
1. Copy `murim-login-v16-debug.apk` to your Android phone (USB / Drive / Telegram…).
2. Tap it → allow “install unknown apps” → Install → open **Murim Login**.

**Option B — cloud build (every update, no PC needed):**
1. Your repo already has the workflow. Any push under `app/` triggers it.
2. GitHub repo → **Actions** tab → latest run → **Artifacts** → download `murim-login-apk`.
3. Send that APK to friends — same install steps.
- 🔑 All cloud APKs share one pinned test signature, so updates install over the old app (no uninstall). Release builds will use a separate private key.

## Part 3 — Play together 🎮

1. Open the app, tap **🌐** (bottom-right) → **👤 tab**.
2. Paste your server URL, hit **Set** (one time — it's saved).
3. **Register** a name + password (or Login). Status dot turns green ●.
4. Now:
   - 🏆 **Ranks** — submit power, see who's strongest across all players
   - 🛡️ **Guild** — found `[TAG]` guilds, friends join, tags show in chat
   - 💬 **Chat** — global lobby, live
   - ⚔️ **Live PvP** — queue up, get matched, turn-based duel (Attack/Heavy/Heal). Winner gets +300c +200exp + leaderboard wins
   - 👹 **Co-op** — one player Creates a room, friends Join with the 4-letter code, START RAID, everyone taps ATTACK against the shared boss. Winners split bonus coins/EXP, top damage = MVP
   - ☁️ **Cloud** — upload your save, download it on another device

## Updating after new game versions

```bash
python3 tools/build-web.py   # re-packs latest murim-login-game.html + online.js
```
Then rebuild the APK (Option B, or `gradle assembleDebug` in `app/`).

## Honest test-grade warnings ⚠️

- Passwords are hashed (PBKDF2) but there's no email/reset — don't reuse real passwords.
- No anti-cheat: PvP damage is computed client-side. Fine for friends, not for prize tournaments.
- Free-tier data is ephemeral across redeploys (accounts + scores can reset).
- Debug APK signature = for testing/sharing, **not** for the Play Store (see below).

## Roadmap to Google Play Store 🏪

When testing feels good, here's the real launch path:
1. **Developer account** — pay Google $25 once (play.google.com/console), verify identity.
2. **Release build** — generate an upload key, switch build to `assembleRelease` → `.aab` bundle (I'll wire this up when you're ready).
3. **Server hardening** — Postgres for accounts/scores, rate limits, basic anti-cheat checks.
4. **Store listing** — I can generate: feature graphic, screenshots text, description, privacy-policy page (required), content-rating answers (violence: cartoon/fantasy).
5. Upload AAB → internal testing → production. Review usually takes 1–7 days.

## Server API cheatsheet (for tinkerers)

- `POST /api/register|/login {u,p}` → `{token}`
- `GET/POST /api/save` (header `x-token`) — cloud save blob
- `POST /api/score {power,tower,survival,pvp}` · `GET /api/scores?by=power|tower|survival|pvp|coop`
- `GET/POST /api/guilds` · `POST /api/guilds/:id/join|/leave`
- WS same host: `auth → chat / pvpJoin→pvpStart→pvpMove→pvpOver→pvpEnd / coopCreate→coopJoin→coopStart→coopHit→coopEnd`
- Local test: `PORT=8765 node server.js` + `node test-live.js http://localhost:8765`
