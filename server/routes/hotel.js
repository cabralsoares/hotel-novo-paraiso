'use strict';
// Hóspedes, quartos, reservas, check-in, consumos e check-out.
const V = require('../../public/js/validators.js');
const Core = require('../../public/js/core.js');
const Gateway = require('../gateway.js');
const S = require('../security');
const DB = require('../db');
const L = require('../ledger');
const { cleanGuest, validateGuest, ROOM_TYPES } = require('../validate');
const { bad, notFound, conflict, validator, uid, nowISO, round2, toCents, toReais, str, int, money } = require('../util');

const brl = (n) => 'R$ ' + Number(n).toFixed(2).replace('.', ',');

module.exports = function register(add, app) {
  const { db } = app;
  const { tx, audit, nextCode } = DB;
  const room = (id) => db.prepare('SELECT * FROM quartos WHERE id = ?').get(id);

  add('GET', '/api/estado', { auth: 'user' }, async (c) => {
    const v = int(c.query.v);
    if (v === DB.version(db)) return { sem_mudanca: true, v };
    return c.snapshot();
  });

  /* ---------- Hóspedes ---------- */
  const guestCols = (g) => [g.nome, g.docTipo, g.doc, g.nascimento, g.nacionalidade, g.telefone, g.email, g.cidade, g.uf, g.motivo, g.transporte];
  const insertGuest = (id, g) => db.prepare('INSERT INTO hospedes(id, nome, doc_tipo, doc, nascimento, nacionalidade, telefone, email, cidade, uf, motivo, transporte, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, ...guestCols(g), nowISO());
  const updateGuest = (id, g) => db.prepare('UPDATE hospedes SET nome=?, doc_tipo=?, doc=?, nascimento=?, nacionalidade=?, telefone=?, email=?, cidade=?, uf=?, motivo=?, transporte=? WHERE id = ?').run(...guestCols(g), id);

  add('POST', '/api/hospedes', { auth: 'user' }, async (c) => {
    const g = cleanGuest(c.body);
    validateGuest(db, g, { today: c.today() });
    const id = uid();
    return c.mutate(() => { insertGuest(id, g); audit(db, c.user.nome, 'Hóspede cadastrado', g.nome); return { id }; });
  });

  add('PUT', '/api/hospedes/:id', { auth: 'user' }, async (c) => {
    const cur = db.prepare('SELECT * FROM hospedes WHERE id = ?').get(c.params.id);
    if (!cur) throw notFound('Hóspede não encontrado.');
    const g = cleanGuest(c.body);
    validateGuest(db, g, { ignoreId: cur.id, today: c.today() });
    return c.mutate(() => { updateGuest(cur.id, g); audit(db, c.user.nome, 'Hóspede atualizado', g.nome); return { id: cur.id }; });
  });

  /* ---------- Quartos ---------- */
  function cleanRoom(b, ignoreId) {
    const v = validator();
    const r = { numero: str(b.numero), tipo: str(b.tipo), capacidade: int(b.capacidade), diaria: money(b.diaria), andar: int(b.andar === undefined || b.andar === '' ? 0 : b.andar), descricao: str(b.descricao).slice(0, 120) };
    if (!/^[A-Za-z0-9-]{1,6}$/.test(r.numero)) v.err('numero', 'Informe o número (letras/números, até 6).');
    else if (db.prepare('SELECT 1 FROM quartos WHERE numero = ? AND id <> ?').get(r.numero, ignoreId || '')) v.err('numero', 'Já existe um quarto com este número.');
    if (!ROOM_TYPES.includes(r.tipo)) v.err('tipo', 'Escolha o tipo do quarto.');
    if (!(r.capacidade >= 1 && r.capacidade <= 10)) v.err('capacidade', 'Capacidade de 1 a 10.');
    if (!(r.diaria > 0 && r.diaria <= 100000)) v.err('diaria', 'Informe a diária.');
    if (!(r.andar >= 0 && r.andar <= 20)) v.err('andar', 'Andar de 0 a 20.');
    v.check();
    return r;
  }

  add('POST', '/api/quartos', { auth: 'gerente' }, async (c) => {
    const r = cleanRoom(c.body);
    const id = 'q' + uid();
    return c.mutate(() => {
      db.prepare("INSERT INTO quartos(id, numero, tipo, capacidade, diaria_c, andar, status, descricao) VALUES (?, ?, ?, ?, ?, ?, 'livre', ?)").run(id, r.numero, r.tipo, r.capacidade, toCents(r.diaria), r.andar, r.descricao);
      audit(db, c.user.nome, 'Quarto criado', 'Quarto ' + r.numero);
      return { id };
    });
  });

  add('PUT', '/api/quartos/:id', { auth: 'gerente' }, async (c) => {
    const cur = room(c.params.id);
    if (!cur) throw notFound('Quarto não encontrado.');
    const r = cleanRoom(c.body, cur.id);
    return c.mutate(() => {
      db.prepare('UPDATE quartos SET numero=?, tipo=?, capacidade=?, diaria_c=?, andar=?, descricao=? WHERE id = ?').run(r.numero, r.tipo, r.capacidade, toCents(r.diaria), r.andar, r.descricao, cur.id);
      audit(db, c.user.nome, 'Quarto atualizado', 'Quarto ' + r.numero);
      return { id: cur.id };
    });
  });

  add('DELETE', '/api/quartos/:id', { auth: 'gerente' }, async (c) => {
    const cur = room(c.params.id);
    if (!cur) throw notFound('Quarto não encontrado.');
    if (cur.status === 'ocupado') throw conflict('O quarto está ocupado.');
    if (db.prepare('SELECT 1 FROM reservas WHERE quarto_id = ?').get(cur.id)) throw conflict('Este quarto tem histórico de reservas e não pode ser excluído.');
    return c.mutate(() => { db.prepare('DELETE FROM quartos WHERE id = ?').run(cur.id); audit(db, c.user.nome, 'Quarto excluído', 'Quarto ' + cur.numero); return { ok: true }; });
  });

  add('POST', '/api/quartos/:id/status', { auth: 'user' }, async (c) => {
    const cur = room(c.params.id);
    if (!cur) throw notFound('Quarto não encontrado.');
    const status = str(c.body.status);
    if (!['livre', 'manutencao'].includes(status)) throw bad('Situação inválida.');
    if (cur.status === 'ocupado') throw conflict('O quarto está ocupado. Faça o check-out primeiro.');
    return c.mutate(() => { db.prepare('UPDATE quartos SET status = ? WHERE id = ?').run(status, cur.id); audit(db, c.user.nome, 'Status do quarto', `Quarto ${cur.numero} → ${status}`); return { ok: true }; });
  });

  /* ---------- Reservas ---------- */
  add('POST', '/api/reservas', { auth: 'user' }, async (c) => {
    const b = c.body, T = c.today(), v = validator();
    const checkin = str(b.checkin), checkout = str(b.checkout), adultos = int(b.adultos), criancas = int(b.criancas === undefined ? 0 : b.criancas);
    if (!V.isDateISO(checkin) || checkin < T) v.err('checkin', 'Entrada deve ser hoje ou depois.');
    if (!V.isDateISO(checkout) || checkout <= checkin) v.err('checkout', 'A saída deve ser depois da entrada.');
    if (!(adultos >= 1 && adultos <= 8)) v.err('adultos', 'Mínimo 1 adulto.');
    if (!(criancas >= 0 && criancas <= 8)) v.err('criancas', 'Valor inválido.');
    const q = room(str(b.quartoId));
    if (!q) v.err('roomId', 'Escolha um quarto disponível.');
    else if (q.status === 'manutencao') v.err('roomId', 'Este quarto está em manutenção.');
    else if (q.capacidade < adultos + criancas) v.err('roomId', `Este quarto comporta até ${q.capacidade} pessoas.`);
    let guestId = str(b.hospedeId), novo = null;
    if (guestId === 'novo' || (!guestId && b.novoHospede)) {
      const nh = b.novoHospede || {};
      novo = { ...cleanGuest({ nome: nh.nome, doc: nh.cpf, docTipo: 'cpf', telefone: nh.telefone }), nascimento: '', cidade: '', uf: '' };
      try { validateGuest(db, novo, { today: T, quick: true }); } catch (e) { const f = (e.extra && e.extra.campos) || {}; if (f.doc) v.err('cpf', f.doc); if (f.nome) v.err('nome', f.nome); if (f.telefone) v.err('telefone', f.telefone); }
    } else if (!guestId || !db.prepare('SELECT 1 FROM hospedes WHERE id = ?').get(guestId)) v.err('guestId', 'Escolha o hóspede.');
    v.check();
    if (L.roomConflicts(db, q.id, checkin, checkout, null, T)) throw conflict('Este quarto já está reservado/ocupado no período escolhido.', 'QUARTO_INDISPONIVEL');
    return c.mutate(() => {
      if (novo) { guestId = uid(); insertGuest(guestId, novo); audit(db, c.user.nome, 'Hóspede cadastrado', novo.nome); }
      const id = uid(), codigo = nextCode(db);
      db.prepare(`INSERT INTO reservas(id, codigo, hospede_id, quarto_id, checkin, checkout, adultos, criancas, diaria_c, obs, origem, status, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserva', 'reservada', ?)`).run(id, codigo, guestId, q.id, checkin, checkout, adultos, criancas, q.diaria_c, str(b.obs).slice(0, 200), nowISO());
      audit(db, c.user.nome, 'Reserva criada', `${codigo} — ${db.prepare('SELECT nome FROM hospedes WHERE id = ?').get(guestId).nome}`);
      return { id, codigo };
    });
  });

  add('POST', '/api/reservas/:id/cancelar', { auth: 'user' }, async (c) => {
    const r = L.reservationRow(db, c.params.id);
    if (!r) throw notFound('Reserva não encontrada.');
    if (r.status !== 'reservada') throw conflict('Só é possível cancelar reservas que ainda não tiveram check-in.');
    const motivo = str(c.body.motivo);
    if (motivo.length < 5 || motivo.length > 120) throw bad('Descreva o motivo (mínimo 5 letras).', { motivo: 'Descreva o motivo (mínimo 5 letras).' });
    return c.mutate(() => {
      db.prepare("UPDATE reservas SET status = 'cancelada', motivo_cancelamento = ?, cancelada_em = ? WHERE id = ?").run(motivo, nowISO(), r.id);
      audit(db, c.user.nome, 'Reserva cancelada', `${r.codigo} — ${motivo}`);
      return { ok: true };
    });
  });

  /* ---------- Check-in ---------- */
  add('POST', '/api/checkin', { auth: 'user' }, async (c) => {
    const b = c.body, T = c.today(), regras = c.regras(), v = validator();
    const rascunho = str(b.rascunho);
    if (!L.DRAFT_RE.test(rascunho)) throw bad('Identificador do check-in inválido.');
    if (b.aceite !== true) throw bad('Confirme os dados com o hóspede para concluir.', { aceite: 'Marque a confirmação para concluir.' });
    const res = b.reservaId ? L.reservationRow(db, str(b.reservaId)) : null;
    if (b.reservaId && !res) throw notFound('Reserva não encontrada.');
    if (res && res.status !== 'reservada') throw conflict('Esta reserva não está mais pendente de check-in.');
    const q = room(str(b.roomId));
    const guestId = res ? res.hospede_id : str(b.guestId) || null;
    if (guestId && !db.prepare('SELECT 1 FROM hospedes WHERE id = ?').get(guestId)) throw notFound('Hóspede não encontrado.');
    const g = cleanGuest(b.guest);
    validateGuest(db, g, { ignoreId: guestId, today: T });
    const checkout = str(b.checkout), adultos = int(b.adultos), criancas = int(b.criancas), desc = int(b.descontoPct), placa = str(b.placa).toUpperCase(), obs = str(b.obs).slice(0, 200);
    if (!V.isDateISO(checkout) || checkout <= T) v.err('checkout', 'A saída deve ser a partir de amanhã.');
    if (!(adultos >= 1 && adultos <= 8)) v.err('adultos', 'Mínimo 1 adulto.');
    if (!(criancas >= 0 && criancas <= 8)) v.err('criancas', 'Valor inválido.');
    if (!(desc >= 0 && desc <= 100)) v.err('descontoPct', 'Use um número de 0 a 100.');
    if (placa && !V.isPlate(placa)) v.err('placa', 'Placa inválida (ex.: ABC1D23).');
    if (!q) v.err('roomId', 'Escolha um quarto.');
    else if (q.capacidade < adultos + criancas) v.err('roomId', `Este quarto comporta até ${q.capacidade} pessoas.`);
    else if (q.status !== 'livre') v.err('roomId', `O quarto ${q.numero} não está livre (${q.status}).`);
    else if (!v.has('checkout') && L.roomConflicts(db, q.id, T, checkout, res && res.id, T)) v.err('roomId', `O quarto ${q.numero} está reservado por outra pessoa neste período.`);
    v.check();

    const diariaC = res && res.quarto_id === q.id ? res.diaria_c : q.diaria_c;
    const total = Core.stayTotals({ id: 'x', checkin: T, checkout, diaria: toReais(diariaC), descontoPct: desc, consumos: [] }, []).total;
    const drafts = db.prepare("SELECT valor_c, status, tipo FROM pagamentos WHERE rascunho = ? AND reserva_id IS NULL AND usuario_id = ?").all(rascunho, c.user.id);
    const pago = round2(drafts.filter((p) => (p.status === 'autorizado' || p.status === 'faturado') && p.tipo === 'recebimento').reduce((s, p) => s + toReais(p.valor_c), 0));
    if (pago > total + 0.004) throw bad(`Os pagamentos (${brl(pago)}) passam do total da hospedagem (${brl(total)}). Estorne a diferença.`);

    return c.mutate(() => {
      const descPor = desc > regras.descontoMaxPct
        ? S.consumeAuth(db, c.session, b.autDesconto, { escopo: 'desconto', valorC: desc * 100, motivo: 'Desconto acima do limite', detalhe: `${desc}% na diária (limite do operador: ${regras.descontoMaxPct}%)` }).nome : '';
      const min = Core.entradaMinima(total, regras.entradaMinimaPct);
      const semPor = pago + 0.004 < min
        ? S.consumeAuth(db, c.session, b.autSemEntrada, { escopo: 'sem_entrada', valorC: 0, motivo: 'Check-in sem a entrada mínima', detalhe: `Exigido: ${brl(min)} (${regras.entradaMinimaPct}%)` }).nome : '';
      const now = nowISO();
      let gid = guestId;
      if (gid) updateGuest(gid, g); else { gid = uid(); insertGuest(gid, g); }
      let rid, codigo;
      if (res) {
        rid = res.id; codigo = res.codigo;
        db.prepare(`UPDATE reservas SET hospede_id=?, quarto_id=?, checkin=?, checkout=?, adultos=?, criancas=?, diaria_c=?, desconto_pct=?, desconto_autorizado_por=?, sem_entrada_autorizada_por=?, placa=?, obs=?, status='hospedado', checkin_real=? WHERE id = ?`)
          .run(gid, q.id, T, checkout, adultos, criancas, diariaC, desc, descPor, semPor, placa, obs, now, rid);
      } else {
        rid = uid(); codigo = nextCode(db);
        db.prepare(`INSERT INTO reservas(id, codigo, hospede_id, quarto_id, checkin, checkout, adultos, criancas, diaria_c, desconto_pct, desconto_autorizado_por, sem_entrada_autorizada_por, placa, obs, origem, status, criado_em, checkin_real)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'balcao', 'hospedado', ?, ?)`).run(rid, codigo, gid, q.id, T, checkout, adultos, criancas, diariaC, desc, descPor, semPor, placa, obs, now, now);
      }
      db.prepare("UPDATE quartos SET status = 'ocupado' WHERE id = ?").run(q.id);
      db.prepare('UPDATE pagamentos SET reserva_id = ?, hospede = ? WHERE rascunho = ? AND reserva_id IS NULL AND usuario_id = ?').run(rid, g.nome, rascunho, c.user.id);
      audit(db, c.user.nome, 'Check-in', `${codigo} — ${g.nome} — Quarto ${q.numero}`, descPor || semPor);
      return { reservaId: rid };
    });
  });

  /** Cancela um check-in que já recebeu pagamentos: tudo é estornado e fica registrado. */
  add('POST', '/api/checkin/cancelar', { auth: 'user' }, async (c) => {
    const rascunho = str(c.body.rascunho);
    if (!L.DRAFT_RE.test(rascunho)) throw bad('Identificador do check-in inválido.');
    const rows = db.prepare("SELECT * FROM pagamentos WHERE rascunho = ? AND reserva_id IS NULL AND usuario_id = ? AND status IN ('autorizado','faturado')").all(rascunho, c.user.id);
    await Promise.all(rows.filter((p) => ['pix', 'credito', 'debito'].includes(p.metodo)).map((p) => Gateway.voidPayment({ metodo: p.metodo }, { latency: app.config.gatewayLatency })));
    return c.mutate(() => {
      const est = JSON.stringify({ em: nowISO(), por: c.user.nome, motivo: 'Check-in cancelado antes da conclusão' });
      let n = 0;
      for (const p of rows) n += db.prepare("UPDATE pagamentos SET status = 'estornado', estorno = ? WHERE id = ? AND status IN ('autorizado','faturado')").run(est, p.id).changes;
      if (rows.length) audit(db, c.user.nome, 'Check-in cancelado', `${n} pagamento(s) estornado(s)`);
      return { estornados: n, dinheiro: rows.some((p) => p.metodo === 'dinheiro') };
    });
  });

  /* ---------- Hospedagem em andamento ---------- */
  const openStay = (id) => {
    const r = L.reservationRow(db, id);
    if (!r) throw notFound('Hospedagem não encontrada.');
    if (r.status !== 'hospedado') throw conflict('Esta hospedagem não está em andamento.');
    return r;
  };

  add('POST', '/api/reservas/:id/consumos', { auth: 'user' }, async (c) => {
    const r = openStay(c.params.id), b = c.body, v = validator();
    const descricao = str(b.descricao), qtd = int(b.qtd), valor = money(b.valor);
    if (descricao.length < 3 || descricao.length > 60) v.err('descricao', 'Descreva o item (de 3 a 60 letras).');
    if (!(qtd >= 1 && qtd <= 99)) v.err('qtd', 'Quantidade de 1 a 99.');
    if (!(valor > 0 && valor <= 5000)) v.err('valor', 'Informe um valor entre R$ 0,01 e R$ 5.000,00.');
    v.check();
    return c.mutate(() => {
      db.prepare('INSERT INTO consumos(id, reserva_id, descricao, qtd, valor_c, em, por) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid(), r.id, descricao, qtd, toCents(valor), nowISO(), c.user.nome);
      audit(db, c.user.nome, 'Consumo lançado', `${r.codigo} — ${qtd}x ${descricao}`);
      return { ok: true };
    });
  });

  add('POST', '/api/reservas/:id/consumos/:cid/remover', { auth: 'user' }, async (c) => {
    const r = openStay(c.params.id);
    const item = db.prepare('SELECT * FROM consumos WHERE id = ? AND reserva_id = ?').get(c.params.cid, r.id);
    if (!item) throw notFound('Consumo não encontrado.');
    return c.mutate(() => {
      const g = S.consumeAuth(db, c.session, c.body.autorizacao, { escopo: 'remover_consumo', motivo: 'Remover consumo da conta', detalhe: `${item.qtd}x ${item.descricao} — ${brl(item.qtd * toReais(item.valor_c))}` });
      db.prepare('DELETE FROM consumos WHERE id = ?').run(item.id);
      audit(db, c.user.nome, 'Consumo removido', `${r.codigo} — ${item.qtd}x ${item.descricao}`, g.nome);
      return { ok: true };
    });
  });

  add('POST', '/api/reservas/:id/saida', { auth: 'user' }, async (c) => {
    const r = openStay(c.params.id), T = c.today();
    const checkout = str(c.body.checkout);
    const min = Core.addDays(r.checkin, 1) > T ? Core.addDays(r.checkin, 1) : T;
    if (!V.isDateISO(checkout) || checkout < min) throw bad(`Escolha uma data a partir de ${min.split('-').reverse().join('/')}.`, { checkout: `Escolha uma data a partir de ${min.split('-').reverse().join('/')}.` });
    if (L.roomConflicts(db, r.quarto_id, r.checkin, checkout, r.id, T)) throw conflict('Quarto reservado por outra pessoa no período solicitado.', 'QUARTO_INDISPONIVEL');
    return c.mutate(() => {
      db.prepare('UPDATE reservas SET checkout = ? WHERE id = ?').run(checkout, r.id);
      audit(db, c.user.nome, 'Saída alterada', `${r.codigo}: ${r.checkout} → ${checkout}`);
      return { ok: true };
    });
  });

  add('POST', '/api/reservas/:id/checkout', { auth: 'user' }, async (c) => {
    const r = openStay(c.params.id), T = c.today();
    const out = L.outDateFor(r, T, c.body.manter === true);
    const t = L.totalsOf(db, r, out);
    if (Math.abs(t.saldo) > 0.004) throw conflict(t.saldo > 0 ? `A conta ainda tem saldo em aberto (${brl(t.saldo)}).` : `A conta tem crédito a devolver ao hóspede (${brl(-t.saldo)}).`, 'SALDO_PENDENTE');
    return c.mutate(() => {
      db.prepare("UPDATE reservas SET checkout = ?, status = 'finalizada', checkout_real = ? WHERE id = ?").run(out, nowISO(), r.id);
      db.prepare("UPDATE quartos SET status = 'limpeza' WHERE id = ?").run(r.quarto_id);
      audit(db, c.user.nome, 'Check-out', `${r.codigo} — ${db.prepare('SELECT nome FROM hospedes WHERE id = ?').get(r.hospede_id).nome}`);
      return { ok: true };
    });
  });
};
