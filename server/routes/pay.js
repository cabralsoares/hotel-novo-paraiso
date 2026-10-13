'use strict';
// Pagamentos: PIX, cartão, dinheiro, faturado, estorno e devolução. Toda validação e autorização acontece AQUI.
const V = require('../../public/js/validators.js');
const Core = require('../../public/js/core.js');
const Pix = require('../pix.js');
const Gateway = require('../gateway.js');
const S = require('../security');
const DB = require('../db');
const L = require('../ledger');
const { bad, notFound, conflict, validator, nowISO, toCents, toReais, round2, str, int, money, HttpError } = require('../util');

const brl = (n) => 'R$ ' + Number(n).toFixed(2).replace('.', ',');
const PIX_TTL_MS = 10 * 60 * 1000;
const GATEWAY_METHODS = ['pix', 'credito', 'debito'];

module.exports = function register(add, app) {
  const { db } = app;
  const { tx, audit } = DB;

  /** Reconfere o saldo dentro da transação (outro operador pode ter recebido no meio tempo). */
  function recheckBalance(ctx, valor) {
    if (!ctx.reservaId) return;
    const row = L.reservationRow(db, ctx.reservaId);
    if (!row || row.status !== 'hospedado') throw conflict('A hospedagem não está mais em andamento.');
    const saldo = L.totalsOf(db, row, ctx.dataSaida).saldo;
    if (valor > saldo + 0.004) throw conflict(`O saldo da conta mudou (agora ${brl(saldo)}). Atualize a tela.`, 'SALDO_MUDOU');
  }

  /* ---------- Cartão ---------- */
  add('POST', '/api/pagamentos/cartao', { auth: 'user' }, async (c) => {
    const b = c.body, tipo = str(b.tipo), valor = money(b.valor);
    if (!['credito', 'debito'].includes(tipo)) throw bad('Escolha crédito ou débito.');
    const ctx = L.paymentContext(c, b, valor);
    const card = { numero: str(b.numero), nome: str(b.nome), validade: str(b.validade), cvv: str(b.cvv) };
    const errors = V.validateCard(card, new Date());
    if (!V.isCPF(str(b.cpf))) errors.cpf = 'CPF do titular inválido.';
    const parcelas = tipo === 'credito' ? int(b.parcelas === undefined ? 1 : b.parcelas) : 1;
    if (tipo === 'credito' && !Core.installmentOptions(valor, c.regras()).some((o) => o.n === parcelas)) errors.parcelas = 'Parcelamento não permitido para este valor.';
    if (Object.keys(errors).length) throw bad('Confira os dados do cartão.', errors);

    const key = 'cartao:' + c.user.id;
    S.assertNotLocked(db, key, 'tentativas de cartão');
    const autorizadoPor = tx(db, () => L.requireLimitAuth(c, valor, b.autorizacao));

    const brand = V.cardBrand(card.numero);
    const res = await Gateway.authorize({ tipo, valor, numero: card.numero, parcelas }, { latency: app.config.gatewayLatency });
    if (res.aprovada) S.clearFailures(db, key); else S.registerFailure(db, key, 6, 60);
    // só guardamos bandeira, final, titular, CPF mascarado e códigos — nunca número completo, validade ou CVV
    const detalhes = { bandeira: brand.name, final4: res.final4, titular: card.nome.toUpperCase().slice(0, 40), cpfTitular: '•••.•••.•••-' + V.digits(b.cpf).slice(-2), parcelas, codigo: res.codigo, mensagem: res.mensagem, nsu: res.nsu || '', autorizacao: res.autorizacao || '' };
    try {
      return c.mutate(() => {
        if (res.aprovada) recheckBalance(ctx, valor);
        const p = L.insertPayment(c, ctx, { metodo: tipo, valor, status: res.aprovada ? 'autorizado' : 'recusado', autorizadoPor: res.aprovada ? autorizadoPor : '', detalhes });
        audit(db, c.user.nome, res.aprovada ? 'Pagamento autorizado' : 'Pagamento recusado', `${tipo} ${brl(valor)} — ${ctx.hospede} (${res.codigo})`, res.aprovada ? autorizadoPor : '');
        return { pagamento: p };
      });
    } catch (e) {
      if (res.aprovada) await Gateway.voidPayment({ metodo: tipo }, { latency: 0 }); // não registrou: devolve a autorização
      throw e;
    }
  });

  /* ---------- Dinheiro ---------- */
  add('POST', '/api/pagamentos/dinheiro', { auth: 'user' }, async (c) => {
    const b = c.body, valor = money(b.valor), recebido = money(b.recebido);
    const ctx = L.paymentContext(c, b, valor);
    const v = validator();
    if (!(recebido > 0)) v.err('recebido', 'Informe o valor recebido.');
    else if (recebido + 0.004 < valor) v.err('recebido', 'O valor recebido é menor que o valor a cobrar.');
    else if (recebido - valor > 1000) v.err('recebido', 'Troco acima de R$ 1.000,00. Confira o valor digitado.');
    v.check();
    return c.mutate(() => {
      recheckBalance(ctx, valor);
      const autorizadoPor = L.requireLimitAuth(c, valor, b.autorizacao);
      const p = L.insertPayment(c, ctx, { metodo: 'dinheiro', valor, status: 'autorizado', autorizadoPor, detalhes: { recebido, troco: round2(recebido - valor) } });
      audit(db, c.user.nome, 'Pagamento autorizado', `dinheiro ${brl(valor)} — ${ctx.hospede}`, autorizadoPor);
      return { pagamento: p };
    });
  });

  /* ---------- Faturado (empresa) ---------- */
  add('POST', '/api/pagamentos/faturado', { auth: 'user' }, async (c) => {
    const b = c.body, valor = money(b.valor), T = c.today();
    const ctx = L.paymentContext(c, b, valor);
    const v = validator();
    const cnpj = V.digits(b.cnpj), razao = str(b.razao), email = str(b.email), venc = str(b.vencimento), ordem = str(b.ordem).slice(0, 40);
    if (!V.isCNPJ(cnpj)) v.err('cnpj', 'CNPJ inválido.');
    if (razao.length < 3 || razao.length > 80) v.err('razao', 'Informe a razão social.');
    if (email && !V.isEmail(email)) v.err('email', 'E-mail inválido.');
    if (!V.isDateISO(venc) || venc < T) v.err('vencimento', 'Informe um vencimento a partir de hoje.');
    else if (venc > Core.addDays(T, 60)) v.err('vencimento', 'Vencimento máximo: 60 dias.');
    v.check();
    return c.mutate(() => {
      recheckBalance(ctx, valor);
      const g = S.consumeAuth(db, c.session, b.autorizacao, { escopo: 'faturado', valorC: toCents(valor), motivo: 'Faturamento para empresa', detalhe: `${razao} — ${brl(valor)}` });
      const p = L.insertPayment(c, ctx, { metodo: 'faturado', valor, status: 'faturado', autorizadoPor: g.nome, detalhes: { cnpj, razao, email, vencimento: venc, ordem } });
      audit(db, c.user.nome, 'Pagamento faturado', `${razao} ${brl(valor)} — ${ctx.hospede}`, g.nome);
      return { pagamento: p };
    });
  });

  /* ---------- PIX ---------- */
  add('POST', '/api/pix/cobrancas', { auth: 'user' }, async (c) => {
    const b = c.body, valor = money(b.valor);
    const ctx = L.paymentContext(c, b, valor);
    const cfg = c.config().pix;
    const key = V.parsePixKey(cfg.chave);
    if (!key) throw conflict('A chave PIX do hotel ainda não foi cadastrada. Peça ao gerente (Configurações → Recebimentos).', 'SEM_CHAVE_PIX');
    const txid = Pix.newTxid();
    const payload = Pix.buildPayload({ chave: key.valor, recebedor: cfg.recebedor || c.config().hotel.nome, cidade: cfg.cidade || c.config().hotel.cidade, valor, txid });
    const now = Date.now();
    db.prepare('INSERT INTO pix_cobrancas(txid, usuario_id, reserva_id, rascunho, hospede, data_saida, valor_c, payload, criada_em, expira_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(txid, c.user.id, ctx.reservaId, ctx.rascunho, ctx.hospede, ctx.dataSaida, toCents(valor), payload, now, now + PIX_TTL_MS);
    return { txid, payload, valor, expiraEm: now + PIX_TTL_MS };
  });

  add('POST', '/api/pix/confirmar', { auth: 'user' }, async (c) => {
    const b = c.body, e2e = str(b.e2e);
    const cob = db.prepare('SELECT * FROM pix_cobrancas WHERE txid = ?').get(str(b.txid));
    if (!cob || cob.usuario_id !== c.user.id) throw notFound('Cobrança PIX não encontrada. Gere um novo QR Code.');
    if (cob.usada) throw conflict('Esta cobrança já foi confirmada.');
    if (cob.expira_em < Date.now()) throw new HttpError(409, 'COBRANCA_EXPIRADA', 'Esta cobrança expirou. Cancele e gere um novo QR Code.', { campos: { e2e: 'Esta cobrança expirou. Cancele e gere um novo QR Code.' } });
    const v = validator();
    const msg = V.checkE2E(e2e);
    if (msg) v.err('e2e', msg);
    else if (db.prepare('SELECT 1 FROM pagamentos WHERE e2e = ?').get(e2e)) v.err('e2e', 'Este comprovante já foi usado em outro pagamento.');
    if (b.conferi !== true) v.err('conferi', 'Confirme que conferiu o recebimento no banco.');
    v.check();
    const valor = toReais(cob.valor_c);
    const ctx = { reservaId: cob.reserva_id, rascunho: cob.rascunho, hospede: cob.hospede, dataSaida: cob.data_saida };
    return c.mutate(() => {
      recheckBalance(ctx, valor);
      const autorizadoPor = L.requireLimitAuth(c, valor, b.autorizacao);
      const p = L.insertPayment(c, ctx, { metodo: 'pix', valor, status: 'autorizado', autorizadoPor, detalhes: { txid: cob.txid, e2e }, e2e });
      db.prepare('UPDATE pix_cobrancas SET usada = 1 WHERE txid = ?').run(cob.txid);
      audit(db, c.user.nome, 'Pagamento autorizado', `pix ${brl(valor)} — ${cob.hospede}`, autorizadoPor);
      return { pagamento: p };
    });
  });

  /** Só no modo simulação: ID de comprovante válido para treinar a equipe. */
  add('GET', '/api/pix/id-teste', { auth: 'user' }, async () => {
    if (Gateway.mode !== 'simulacao') throw notFound();
    return { e2e: Gateway.fakeE2E() };
  });

  /* ---------- Estorno e devolução ---------- */
  add('POST', '/api/pagamentos/:id/estornar', { auth: 'user' }, async (c) => {
    const p = db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(c.params.id);
    if (!p) throw notFound('Pagamento não encontrado.');
    if (p.tipo !== 'recebimento' || !['autorizado', 'faturado'].includes(p.status)) throw conflict('Este lançamento não pode ser estornado.');
    // pagamento de check-in não concluído: só o próprio operador ou um gerente (para resolver check-ins abandonados)
    if (!p.reserva_id && p.usuario_id !== c.user.id && c.user.perfil !== 'gerente') throw conflict('Pagamento de um check-in em andamento de outro operador.');
    const motivo = str(c.body.motivo);
    if (motivo.length < 5 || motivo.length > 120) throw bad('Descreva o motivo (mínimo 5 letras).', { motivo: 'Descreva o motivo (mínimo 5 letras).' });
    const valor = toReais(p.valor_c);
    const g = tx(db, () => S.consumeAuth(db, c.session, c.body.autorizacao, { escopo: 'estorno', valorC: p.valor_c, motivo: 'Estorno de pagamento', detalhe: `${p.metodo} ${brl(valor)} — ${p.hospede || ''} — ${motivo}` }));
    if (GATEWAY_METHODS.includes(p.metodo)) await Gateway.voidPayment({ metodo: p.metodo }, { latency: app.config.gatewayLatency });
    return c.mutate(() => {
      const r = db.prepare("UPDATE pagamentos SET status = 'estornado', estorno = ? WHERE id = ? AND status IN ('autorizado','faturado')")
        .run(JSON.stringify({ em: nowISO(), por: c.user.nome, autorizadoPor: g.nome, motivo }), p.id);
      if (!r.changes) throw conflict('Este pagamento já foi estornado.');
      audit(db, c.user.nome, 'Pagamento estornado', `${p.metodo} ${brl(valor)} — ${p.hospede || ''} — ${motivo}`, g.nome);
      return { dinheiro: p.metodo === 'dinheiro' };
    });
  });

  add('POST', '/api/reservas/:id/devolucao', { auth: 'user' }, async (c) => {
    const r = L.reservationRow(db, c.params.id);
    if (!r) throw notFound('Hospedagem não encontrada.');
    if (r.status !== 'hospedado') throw conflict('Só é possível devolver crédito de hospedagens em andamento.');
    const b = c.body, v = validator();
    const valor = money(b.valor), motivo = str(b.motivo), metodo = str(b.metodo);
    const dataSaida = str(b.dataSaida) || null;
    if (dataSaida && dataSaida !== r.checkout && dataSaida !== c.today()) throw bad('Data de saída inválida.');
    if (!['dinheiro', 'pix', 'credito', 'debito'].includes(metodo)) v.err('metodo', 'Escolha a forma da devolução.');
    if (motivo.length < 5 || motivo.length > 120) v.err('motivo', 'Descreva o motivo (mínimo 5 letras).');
    const credito = round2(-L.totalsOf(db, r, dataSaida).saldo);
    if (!(valor > 0) || valor > credito + 0.004) v.err('valor', `O crédito disponível é ${brl(Math.max(0, credito))}.`);
    v.check();
    const guest = db.prepare('SELECT nome FROM hospedes WHERE id = ?').get(r.hospede_id);
    return c.mutate(() => {
      const g = S.consumeAuth(db, c.session, b.autorizacao, { escopo: 'devolucao', valorC: toCents(valor), motivo: 'Devolução de valor ao hóspede', detalhe: brl(valor) });
      const p = L.insertPayment(c, { reservaId: r.id, rascunho: null, hospede: guest.nome }, { metodo, valor: -valor, status: 'autorizado', tipo: 'devolucao', autorizadoPor: g.nome, detalhes: { motivo } });
      audit(db, c.user.nome, 'Devolução ao hóspede', `${r.codigo} — ${brl(valor)} (${metodo}) — ${motivo}`, g.nome);
      return { pagamento: p };
    });
  });
};
