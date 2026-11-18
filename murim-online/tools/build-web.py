#!/usr/bin/env python3
"""Build the app's web assets: game HTML + online.js -> app www/ folder.
Run from repo root:  python3 tools/build-web.py
(Run again after every game update, then rebuild the APK.)"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT.parent / "murim-login-game.html"   # workspace layout
if not GAME.exists():                           # repo-only layout fallback
    GAME = ROOT / "web" / "murim-login-game.html"
ONLINE = ROOT / "web" / "online.js"
WWW = ROOT / "app" / "app" / "src" / "main" / "assets" / "www"

assert GAME.exists(), f"game file not found: {GAME}"
assert ONLINE.exists(), f"online.js not found: {ONLINE}"
WWW.mkdir(parents=True, exist_ok=True)

html = GAME.read_text(encoding="utf-8")
inject = '<script src="online.js"></script>\n</body>'
assert "</body>" in html, "no </body> in game html?!"
html = html.replace("</body>", inject, 1)
(WWW / "index.html").write_text(html, encoding="utf-8")
shutil.copy2(ONLINE, WWW / "online.js")
print(f"built {WWW}/index.html ({len(html)} bytes) + online.js")
