'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const SCHEMA = require('./schema');
const { uid, nowISO, toReais } = require('./util');

const DEFAULT_CONFIG = {
  hotel: { nome: 'Hotel e Pousada Novo Paraíso', cidade: 'Caaporã', uf: 'PB', cnpj: '', telefone: '', email: '', endereco: '' },
  pix: { chave: '', chaveTipo: '', recebedor: 'Hotel Novo Paraiso', cidade: 'Caapora' }, // PIX limita o nome a 25 letras e a cidade a 15
  regras: { checkinHora: '14:00', checkoutHora: '12:00', maxParcelas: 6, parcelaMinima: 50, entradaMinimaPct: 30, descontoMaxPct: 10, limiteGerente: 3000 },
};

const DEFAULT_ROOMS = [
  ['101', 'Standard', 2, 140, 1], ['102', 'Standard', 2, 140, 1], ['103', 'Standard', 2, 140, 1],
  ['104', 'Luxo', 3, 190, 1], ['105', 'Luxo', 3, 190, 1], ['106', 'Família', 5, 330, 1],
  ['201', 'Standard', 2, 150, 2], ['202', 'Standard', 2, 150, 2],
  ['203', 'Luxo', 3, 200, 2], ['204', 'Luxo', 3, 200, 2], ['205', 'Suíte', 3, 260, 2], ['206', 'Suíte', 3, 260, 2],
];

/** Abre (ou cria) o banco do hotel em DATA_DIR/hotel.db. */
function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'hotel.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
  db.exec(SCHEMA);
  if (!getMeta(db, 'esquema')) seed(db);
  return { db, file };
}

function seed(db) {
  tx(db, () => {
    setMeta(db, 'esquema', '1');
    setMeta(db, 'versao', '1');
    setMeta(db, 'seq_reserva', '0');
    for (const [k, v] of Object.entries(DEFAULT_CONFIG)) db.prepare('INSERT INTO config(k, v) VALUES (?, ?)').run(k, JSON.stringify(v));
    const ins = db.prepare('INSERT INTO quartos(id, numero, tipo, capacidade, diaria_c, andar, status, descricao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [numero, tipo, cap, diaria, andar] of DEFAULT_ROOMS) ins.run('q' + numero, numero, tipo, cap, diaria * 100, andar, 'livre', '');
  });
}

/** Transação (sem await dentro!). Aninhamento reaproveita a transação externa. */
let depth = 0;
function tx(db, fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* já encerrada */ }
    throw e;
  } finally { depth--; }
}

const getMeta = (db, k) => { const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k); return r ? r.v : null; };
const setMeta = (db, k, v) => { db.prepare('INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v)); };
const version = (db) => Number(getMeta(db, 'versao'));
const bump = (db) => { db.prepare("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'versao'").run(); };
function nextCode(db) {
  const n = Number(getMeta(db, 'seq_reserva')) + 1;
  setMeta(db, 'seq_reserva', n);
  return 'RS-' + String(n).padStart(4, '0');
}

function getConfig(db) {
  const out = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    const r = db.prepare('SELECT v FROM config WHERE k = ?').get(k);
    out[k] = { ...DEFAULT_CONFIG[k], ...(r ? JSON.parse(r.v) : {}) };
  }
  return out;
}
const setConfigSection = (db, k, obj) => { db.prepare('INSERT INTO config(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(obj)); };

function audit(db, operador, acao, detalhe = '', por = '') {
  db.prepare('INSERT INTO auditoria(em, operador, acao, detalhe, por) VALUES (?, ?, ?, ?, ?)').run(nowISO(), operador, acao, detalhe, por);
}

/* ---------- Linhas do banco -> formato usado pela tela ---------- */
const mapRoom = (r) => ({ id: r.id, numero: r.numero, tipo: r.tipo, capacidade: r.capacidade, diaria: toReais(r.diaria_c), andar: r.andar, status: r.status, descricao: r.descricao });
const mapGuest = (g) => ({ id: g.id, nome: g.nome, docTipo: g.doc_tipo, doc: g.doc, nascimento: g.nascimento, nacionalidade: g.nacionalidade, telefone: g.telefone, email: g.email, cidade: g.cidade, uf: g.uf, motivo: g.motivo, transporte: g.transporte, criadoEm: g.criado_em });
const mapReservation = (r, consumos = []) => ({
  id: r.id, codigo: r.codigo, guestId: r.hospede_id, roomId: r.quarto_id, checkin: r.checkin, checkout: r.checkout, adultos: r.adultos, criancas: r.criancas,
  diaria: toReais(r.diaria_c), descontoPct: r.desconto_pct, descontoAutorizadoPor: r.desconto_autorizado_por, semEntradaAutorizadaPor: r.sem_entrada_autorizada_por,
  placa: r.placa, obs: r.obs, origem: r.origem, status: r.status, motivoCancelamento: r.motivo_cancelamento || undefined, criadoEm: r.criado_em,
  checkinReal: r.checkin_real || undefined, checkoutReal: r.checkout_real || undefined, canceladaEm: r.cancelada_em || undefined, consumos,
});
const mapConsumo = (c) => ({ id: c.id, descricao: c.descricao, qtd: c.qtd, valor: toReais(c.valor_c), em: c.em, por: c.por });
const mapPayment = (p) => ({
  id: p.id, reservaId: p.reserva_id, rascunho: p.rascunho || undefined, hospede: p.hospede, metodo: p.metodo, valor: toReais(p.valor_c), status: p.status, tipo: p.tipo,
  criadoEm: p.criado_em, operador: p.operador, autorizadoPor: p.autorizado_por, detalhes: JSON.parse(p.detalhes || '{}'), estorno: p.estorno ? JSON.parse(p.estorno) : undefined,
});

/** Tudo o que a tela precisa para desenhar (sem segredos). */
function snapshot(db, extra = {}) {
  const consumos = new Map();
  for (const c of db.prepare('SELECT * FROM consumos ORDER BY em').all()) {
    if (!consumos.has(c.reserva_id)) consumos.set(c.reserva_id, []);
    consumos.get(c.reserva_id).push(mapConsumo(c));
  }
  return {
    v: version(db),
    config: getConfig(db),
    rooms: db.prepare('SELECT * FROM quartos ORDER BY numero').all().map(mapRoom),
    guests: db.prepare('SELECT * FROM hospedes ORDER BY nome').all().map(mapGuest),
    reservations: db.prepare('SELECT * FROM reservas ORDER BY criado_em').all().map((r) => mapReservation(r, consumos.get(r.id) || [])),
    payments: db.prepare('SELECT * FROM pagamentos ORDER BY criado_em').all().map(mapPayment),
    ...extra,
  };
}

module.exports = { open, tx, getMeta, setMeta, version, bump, nextCode, getConfig, setConfigSection, audit, snapshot, mapRoom, mapGuest, mapReservation, mapConsumo, mapPayment, DEFAULT_CONFIG, uid };
