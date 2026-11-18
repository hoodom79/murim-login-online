// Tiny JSON-file storage (test-grade: persists on disk, resets on free-tier redeploys).
// Swap this module for Postgres later without touching server.js logic.
const fs = require('fs'), path = require('path');
const DIR = process.env.DATA_DIR || (__dirname + '/data');
fs.mkdirSync(DIR, { recursive: true });
function load(f, def) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
  catch (e) { return def; }
}
function save(f, obj) {
  const tmp = path.join(DIR, f + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, path.join(DIR, f));
}
module.exports = { load, save };
