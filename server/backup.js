'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/** Cópia consistente do banco (mesmo com o servidor rodando) em um arquivo .db. */
function backupTo(db, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  return dest;
}

/** Um backup por dia em DATA_DIR/backups, guardando os últimos `keep`. */
function dailyBackup(db, dataDir, today, keep = 14, log = () => {}) {
  const dir = path.join(dataDir, 'backups');
  const file = path.join(dir, `hotel-${today}.db`);
  if (fs.existsSync(file)) return null;
  backupTo(db, file);
  const all = fs.readdirSync(dir).filter((f) => /^hotel-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old));
  log(`backup diário criado: ${path.basename(file)}`);
  return file;
}

/** Confere se um arquivo é um banco do hotel válido. */
function isHotelDb(file) {
  let d;
  try {
    d = new DatabaseSync(file, { readOnly: true });
    const names = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    return ['usuarios', 'quartos', 'reservas', 'pagamentos', 'meta'].every((t) => names.has(t));
  } catch { return false; } finally { try { d && d.close(); } catch { /* */ } }
}

module.exports = { backupTo, dailyBackup, isHotelDb };
