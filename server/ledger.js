'use strict';
// Conta do hóspede e lançamento de pagamentos (regras de dinheiro ficam todas aqui, no servidor).
const Core = require('../public/js/core.js');
const { uid, nowISO, toCents, toReais, str, money, bad, notFound, conflict, validator, HttpError } = require('./util');
const { mapPayment } = require('./db');
const { consumeAuth } = require('./security');

const MAX_PAYMENT = 100000;
const DRAFT_RE = /^[A-Za-z0-9_-]{8,40}$/;

const reservationRow = (db, id) => db.prepare('SELECT * FROM reservas WHERE id = ?').get(id);

function totalsOf(db, row, checkoutOverride) {
  const consumos = db.prepare('SELECT qtd, valor_c FROM consumos WHERE reserva_id = ?').all(row.id).map((c) => ({ qtd: c.qtd, valor: toReais(c.valor_c) }));
  const pays = db.prepare("SELECT valor_c, status FROM pagamentos WHERE reserva_id = ? AND status IN ('autorizado','faturado')").all(row.id).map((p) => ({ reservaId: row.id, valor: toReais(p.valor_c), status: p.status }));
  return Core.stayTotals({ id: row.id, checkin: row.checkin, checkout: checkoutOverride || row.checkout, diaria: toReais(row.diaria_c), descontoPct: row.desconto_pct, consumos }, pays);
}

/** Há reserva/hospedagem que ocupa o quarto no período? (intervalo semiaberto; quem está hospedado ocupa até o fim de hoje) */
function roomConflicts(db, roomId, checkin, checkout, ignoreId, today) {
  const reservations = db.prepare("SELECT id, status, checkin, checkout FROM reservas WHERE quarto_id = ? AND status IN ('reservada','hospedado')").all(roomId)
    .map((r) => ({ id: r.id, roomId, status: r.status, checkin: r.checkin, checkout: r.checkout }));
  return Core.roomConflicts({ reservations }, roomId, checkin, checkout, ignoreId || null, today).length > 0;
}

/** Data de saída efetiva no check-out: hoje se antecipou (e não quis manter), hoje se passou do previsto. */
function outDateFor(row, today, manter) {
  if (today < row.checkout) return manter ? row.checkout : today;
  if (today > row.checkout) return today;
  return row.checkout;
}

/**
 * Descobre a quem o pagamento pertence e quanto ainda pode ser cobrado.
 * - com reservaId: hospedagem em andamento (saldo calculado aqui, no servidor);
 * - com rascunho: check-in ainda não concluído (pagamento fica "solto" até o check-in terminar).
 */
function paymentContext(c, body, valor) {
  const v = validator();
  if (!(valor >= 0.01 && valor <= MAX_PAYMENT)) v.err('valor', 'Informe um valor entre R$ 0,01 e R$ 100.000,00.');
  v.check();
  if (body.reservaId) {
    const row = reservationRow(c.db, str(body.reservaId));
    if (!row) throw notFound('Hospedagem não encontrada.');
    if (row.status !== 'hospedado') throw conflict('Só é possível receber pagamento de hospedagens em andamento.');
    const dataSaida = str(body.dataSaida) || null;
    if (dataSaida && dataSaida !== row.checkout && dataSaida !== c.today()) throw bad('Data de saída inválida.');
    const saldo = totalsOf(c.db, row, dataSaida).saldo;
    if (valor > saldo + 0.004) throw bad(`O valor passa do saldo da conta (R$ ${saldo.toFixed(2).replace('.', ',')}).`, { valor: 'O valor passa do saldo da conta.' });
    const g = c.db.prepare('SELECT nome FROM hospedes WHERE id = ?').get(row.hospede_id);
    return { reservaId: row.id, rascunho: null, hospede: g ? g.nome : '', dataSaida };
  }
  const rascunho = str(body.rascunho);
  if (!DRAFT_RE.test(rascunho)) throw bad('Identificador do check-in inválido.');
  return { reservaId: null, rascunho, hospede: str(body.hospede).slice(0, 80), dataSaida: null };
}

/** Exige a ficha do gerente quando o valor passa do limite do operador. Retorna o nome de quem autorizou ('' se não precisou). */
function requireLimitAuth(c, valor, token) {
  const lim = c.regras().limiteGerente;
  if (!(lim > 0) || valor <= lim) return '';
  const g = consumeAuth(c.db, c.session, token, { escopo: 'valor_alto', valorC: toCents(valor), motivo: 'Pagamento acima do limite do operador', detalhe: `R$ ${valor.toFixed(2).replace('.', ',')} — limite R$ ${lim.toFixed(2).replace('.', ',')}` });
  return g.nome;
}

function insertPayment(c, ctx, p) {
  const id = uid();
  c.db.prepare(`INSERT INTO pagamentos(id, reserva_id, rascunho, usuario_id, hospede, metodo, valor_c, status, tipo, criado_em, operador, autorizado_por, detalhes, e2e)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ctx.reservaId, ctx.rascunho, c.user.id, ctx.hospede, p.metodo, toCents(p.valor), p.status, p.tipo || 'recebimento', nowISO(), c.user.nome, p.autorizadoPor || '', JSON.stringify(p.detalhes || {}), p.e2e || null);
  return mapPayment(c.db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(id));
}

module.exports = { MAX_PAYMENT, DRAFT_RE, reservationRow, totalsOf, roomConflicts, outDateFor, paymentContext, requireLimitAuth, insertPayment };
