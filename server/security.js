'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError, sha256hex } = require('./util');

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 32;

/* ---------- Senhas e PIN: scrypt com sal individual ---------- */
async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(secret, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifySecret(secret, stored) {
  if (!stored || typeof secret !== 'string') return false;
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(secret, Buffer.from(salt, 'base64'), KEYLEN, { N: +n, r: +r, p: +p });
  const expected = Buffer.from(hash, 'base64');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

let dummyHash = null;
/** Gasta o mesmo tempo de uma verificação real (não revela se o usuário existe). */
async function burnTime(secret) {
  dummyHash = dummyHash || (await hashSecret('x-dummy'));
  await verifySecret(secret, dummyHash);
}

/* ---------- Sessões (o navegador guarda só o token; o banco guarda o hash dele) ---------- */
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;

function createSession(db, userId, ip, agente) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessoes(id, usuario_id, criada_em, ultimo_uso, expira_em, ip, agente) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha256hex(token), userId, now, now, now + ABSOLUTE_MS, ip || '', String(agente || '').slice(0, 200));
  return { token, maxAgeSec: Math.floor(ABSOLUTE_MS / 1000) };
}

/** `touch:false` não renova a inatividade (usado na atualização automática da tela). */
function readSession(db, token, { touch = true } = {}) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const id = sha256hex(token);
  const s = db.prepare('SELECT s.*, u.nome, u.usuario, u.perfil, u.ativo FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.id = ?').get(id);
  if (!s) return null;
  const now = Date.now();
  if (!s.ativo || s.expira_em < now || now - s.ultimo_uso > IDLE_MS) { db.prepare('DELETE FROM sessoes WHERE id = ?').run(id); return null; }
  if (touch && now - s.ultimo_uso > 15000) db.prepare('UPDATE sessoes SET ultimo_uso = ? WHERE id = ?').run(now, id);
  return { session: { id, userId: s.usuario_id }, user: { id: s.usuario_id, nome: s.nome, usuario: s.usuario, perfil: s.perfil } };
}
const destroySession = (db, id) => db.prepare('DELETE FROM sessoes WHERE id = ?').run(id);
const destroyUserSessions = (db, userId, exceptId = '') => db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND id <> ?').run(userId, exceptId);

/* ---------- Bloqueio por tentativas (login, PIN, cartão) ---------- */
function lockedFor(db, key) {
  const r = db.prepare('SELECT bloqueado_ate FROM tentativas WHERE chave = ?').get(key);
  return r ? Math.max(0, Math.ceil((r.bloqueado_ate - Date.now()) / 1000)) : 0;
}
function registerFailure(db, key, max, baseSeconds) {
  const r = db.prepare('SELECT falhas FROM tentativas WHERE chave = ?').get(key);
  const falhas = (r ? r.falhas : 0) + 1;
  const ate = falhas >= max ? Date.now() + baseSeconds * 1000 * Math.min(8, falhas - max + 1) : 0;
  db.prepare('INSERT INTO tentativas(chave, falhas, bloqueado_ate, atualizado_em) VALUES (?, ?, ?, ?) ON CONFLICT(chave) DO UPDATE SET falhas = excluded.falhas, bloqueado_ate = excluded.bloqueado_ate, atualizado_em = excluded.atualizado_em').run(key, falhas, ate, Date.now());
}
const clearFailures = (db, key) => db.prepare('DELETE FROM tentativas WHERE chave = ?').run(key);

/** Lança 429 se a chave estiver bloqueada. */
function assertNotLocked(db, key, what = 'tentativas') {
  const wait = lockedFor(db, key);
  if (wait) throw new HttpError(429, 'MUITAS_TENTATIVAS', `Muitas ${what}. Aguarde ${wait}s para tentar de novo.`, { espera: wait });
}

/* ---------- Autorização do gerente (PIN → ficha de uso único) ---------- */
const AUTH_TTL_MS = 15 * 60 * 1000;
const SCOPES = new Set(['desconto', 'valor_alto', 'sem_entrada', 'faturado', 'estorno', 'devolucao', 'remover_consumo', 'backup', 'limpar', 'pix_chave']);

function issueAuth(db, { sessaoId, gerenteId, escopo, valorC = 0, motivo = '', detalhe = '' }) {
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO autorizacoes(id, sessao_id, gerente_id, escopo, valor_c, motivo, detalhe, criada_em, expira_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sha256hex(token), sessaoId, gerenteId, escopo, valorC, String(motivo).slice(0, 200), String(detalhe).slice(0, 300), now, now + AUTH_TTL_MS);
  return token;
}

/** Erro que o navegador entende como "peça o PIN do gerente e tente de novo". */
const needAuth = (escopo, valor, motivo, detalhe = '') => new HttpError(403, 'AUTORIZACAO_NECESSARIA', 'Esta ação precisa da autorização de um gerente.', { escopo, valor, motivo, detalhe });

/** Consome a ficha (uma vez só). Deve rodar dentro da mesma transação da operação. */
function consumeAuth(db, session, token, { escopo, valorC = 0, motivo, detalhe }) {
  const need = () => needAuth(escopo, valorC / 100, motivo, detalhe);
  if (typeof token !== 'string' || token.length < 10 || token.length > 100) throw need();
  const id = sha256hex(token);
  const row = db.prepare('SELECT a.*, u.nome, u.ativo FROM autorizacoes a JOIN usuarios u ON u.id = a.gerente_id WHERE a.id = ?').get(id);
  if (!row || row.usada || row.expira_em < Date.now() || row.sessao_id !== session.id || row.escopo !== escopo || row.valor_c < valorC || !row.ativo) throw need();
  db.prepare('UPDATE autorizacoes SET usada = 1 WHERE id = ?').run(id);
  return { id: row.gerente_id, nome: row.nome };
}

async function verifyManagerPin(db, pin) {
  const managers = db.prepare("SELECT id, nome, pin FROM usuarios WHERE perfil = 'gerente' AND ativo = 1 AND pin IS NOT NULL").all();
  for (const m of managers) if (await verifySecret(pin, m.pin)) return { id: m.id, nome: m.nome };
  return null;
}

/** Limpeza periódica de registros vencidos. */
function purge(db) {
  const now = Date.now();
  db.prepare('DELETE FROM sessoes WHERE expira_em < ? OR ultimo_uso < ?').run(now, now - IDLE_MS);
  db.prepare('DELETE FROM autorizacoes WHERE expira_em < ?').run(now - 3600000);
  db.prepare('DELETE FROM pix_cobrancas WHERE expira_em < ?').run(now - 24 * 3600000);
  db.prepare('DELETE FROM tentativas WHERE bloqueado_ate < ? AND atualizado_em < ?').run(now, now - 24 * 3600000);
}

module.exports = {
  hashSecret, verifySecret, burnTime, createSession, readSession, destroySession, destroyUserSessions,
  lockedFor, registerFailure, clearFailures, assertNotLocked, SCOPES, issueAuth, needAuth, consumeAuth, verifyManagerPin, purge, IDLE_MS,
};
