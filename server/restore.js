'use strict';
// Restaura um backup do banco do hotel. Uso (com o servidor PARADO):
//   node server/restore.js caminho/do/backup.db
const fs = require('node:fs');
const path = require('node:path');
const { isHotelDb } = require('./backup');

const src = process.argv[2];
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
if (!src || !fs.existsSync(src)) { console.error('Uso: node server/restore.js caminho/do/backup.db'); process.exit(1); }
if (!isHotelDb(src)) { console.error('Esse arquivo não parece um banco do hotel (faltam tabelas). Nada foi alterado.'); process.exit(1); }

fs.mkdirSync(dataDir, { recursive: true });
const dest = path.join(dataDir, 'hotel.db');
if (fs.existsSync(dest)) {
  const safe = path.join(dataDir, `hotel.antes-da-restauracao-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  fs.copyFileSync(dest, safe);
  console.log('Banco atual guardado em:', safe);
}
for (const ext of ['-wal', '-shm']) fs.rmSync(dest + ext, { force: true });
fs.copyFileSync(src, dest);
console.log('Backup restaurado em', dest, '— agora é só iniciar o servidor.');
