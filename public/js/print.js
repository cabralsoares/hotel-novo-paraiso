/* Documentos imprimíveis: ficha de hospedagem, extrato/recibo e fechamento de caixa. NP.Print */
(function () {
  const NP = (window.NP = window.NP || {});
  const { html, raw, brl, fmtDate, fmtDateTime, maskCPF, maskCNPJ, maskPhone } = NP.U;
  const Store = NP.Store, Core = NP.Core, Pay = () => NP.Payments;

  const STATUS = { autorizado: 'Autorizado', faturado: 'Faturado', recusado: 'Recusado', estornado: 'Estornado' };

  function head(title) {
    const h = Store.state.config.hotel;
    return html`<div class="doc-head">
      <img src="/assets/logo.png" alt="" width="64" height="66">
      <div class="doc-hotel"><h1>${h.nome}</h1>
        <p>${h.cidade}${h.uf ? '-' + h.uf : ''}${h.cnpj ? ' · CNPJ ' + maskCNPJ(h.cnpj) : ''}${h.telefone ? ' · ' + maskPhone(h.telefone) : ''}</p>
        ${h.endereco ? html`<p>${h.endereco}</p>` : ''}</div>
      <div class="doc-title"><strong>${title}</strong><br><small>Emitido em ${fmtDateTime(new Date().toISOString())}</small></div>
    </div>`;
  }

  const docNumber = (g) => (g.docTipo === 'cpf' ? 'CPF ' + maskCPF(g.doc) : `${g.docTipo === 'rg' ? 'RG' : 'Passaporte'} ${g.doc}`);

  function paymentsTable(list) {
    if (!list.length) return html`<p class="muted">Nenhum pagamento registrado.</p>`;
    return html`<table class="doc-table"><thead><tr><th>Data</th><th>Forma</th><th>Detalhes</th><th>Situação</th><th class="num">Valor</th></tr></thead><tbody>
      ${list.map((p) => html`<tr><td>${fmtDateTime(p.criadoEm)}</td><td>${p.tipo === 'devolucao' ? 'Devolução · ' : ''}${Pay().METHOD_NAME[p.metodo]}</td><td>${Pay().describe(p)}</td><td>${STATUS[p.status]}</td><td class="num">${brl(p.valor)}</td></tr>`)}
    </tbody></table>`;
  }

  function checkinSheet(resId) {
    const r = Store.reservation(resId), g = Store.guest(r.guestId), q = Store.room(r.roomId);
    const t = Store.totals(r);
    const rules = Store.state.config.regras;
    const pays = Store.paymentsOf(r.id).filter((p) => p.status !== 'recusado');
    return html`<div class="doc">
      ${head('Ficha de hospedagem')}
      <div class="doc-grid">
        <div><span>Reserva</span><strong>${r.codigo}</strong></div>
        <div><span>Quarto</span><strong>${q.numero} · ${q.tipo}</strong></div>
        <div><span>Check-in</span><strong>${fmtDateTime(r.checkinReal || r.criadoEm)}</strong></div>
        <div><span>Saída prevista</span><strong>${fmtDate(r.checkout)} até ${rules.checkoutHora}</strong></div>
        <div><span>Hóspedes</span><strong>${r.adultos} adulto(s)${r.criancas ? ', ' + r.criancas + ' criança(s)' : ''}</strong></div>
        <div><span>Veículo (placa)</span><strong>${r.placa || '—'}</strong></div>
      </div>
      <h2>Hóspede responsável</h2>
      <div class="doc-grid">
        <div class="wide"><span>Nome</span><strong>${g.nome}</strong></div>
        <div><span>Documento</span><strong>${docNumber(g)}</strong></div>
        <div><span>Nascimento</span><strong>${fmtDate(g.nascimento)}</strong></div>
        <div><span>Nacionalidade</span><strong>${g.nacionalidade}</strong></div>
        <div><span>Telefone</span><strong>${maskPhone(g.telefone)}</strong></div>
        <div><span>Residência</span><strong>${g.cidade}/${g.uf}</strong></div>
        <div><span>Motivo · Transporte</span><strong>${g.motivo} · ${g.transporte}</strong></div>
        ${g.email ? html`<div class="wide"><span>E-mail</span><strong>${g.email}</strong></div>` : ''}
      </div>
      <h2>Valores</h2>
      <table class="doc-table"><tbody>
        <tr><td>${t.noites} diária(s) × ${brl(r.diaria)}</td><td class="num">${brl(t.diarias)}</td></tr>
        ${t.desconto ? html`<tr><td>Desconto (${r.descontoPct}%)</td><td class="num">− ${brl(t.desconto)}</td></tr>` : ''}
        <tr class="strong"><td>Total da hospedagem</td><td class="num">${brl(t.total)}</td></tr>
      </tbody></table>
      <h2>Pagamentos no check-in</h2>
      ${paymentsTable(pays)}
      <p class="doc-total">Pago: <strong>${brl(t.pago)}</strong> · Saldo a pagar no check-out: <strong>${brl(Math.max(0, t.saldo))}</strong></p>
      <div class="doc-terms"><strong>Regras da casa:</strong> check-in a partir das ${rules.checkinHora} e check-out até as ${rules.checkoutHora}. Danos ao patrimônio e consumos serão lançados na conta do hóspede. Declaro que as informações acima são verdadeiras e que concordo com as regras da casa.</div>
      <div class="doc-sign"><div><span></span>Hóspede</div><div><span></span>Recepção${NP.Auth.current() ? ' — ' + NP.Auth.current().nome : ''}</div></div>
    </div>`;
  }

  function statement(resId) {
    const r = Store.reservation(resId), g = Store.guest(r.guestId), q = Store.room(r.roomId);
    const t = Store.totals(r);
    const pays = Store.paymentsOf(r.id).filter((p) => p.status !== 'recusado');
    const quitado = Math.abs(t.saldo) < 0.005;
    return html`<div class="doc">
      ${head(r.status === 'finalizada' && quitado ? 'Recibo de hospedagem' : 'Extrato da conta')}
      <div class="doc-grid">
        <div class="wide"><span>Hóspede</span><strong>${g.nome}</strong></div>
        <div><span>Reserva</span><strong>${r.codigo}</strong></div>
        <div><span>Quarto</span><strong>${q.numero} · ${q.tipo}</strong></div>
        <div><span>Entrada</span><strong>${fmtDate(r.checkin)}</strong></div>
        <div><span>Saída</span><strong>${fmtDate(r.checkout)}</strong></div>
      </div>
      <h2>Consumo</h2>
      <table class="doc-table"><thead><tr><th>Descrição</th><th class="num">Qtd.</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead><tbody>
        <tr><td>Diárias</td><td class="num">${t.noites}</td><td class="num">${brl(r.diaria)}</td><td class="num">${brl(t.diarias)}</td></tr>
        ${r.consumos.map((c) => html`<tr><td>${c.descricao}</td><td class="num">${c.qtd}</td><td class="num">${brl(c.valor)}</td><td class="num">${brl(c.qtd * c.valor)}</td></tr>`)}
        ${t.desconto ? html`<tr><td colspan="3">Desconto (${r.descontoPct}% sobre diárias)</td><td class="num">− ${brl(t.desconto)}</td></tr>` : ''}
        <tr class="strong"><td colspan="3">Total</td><td class="num">${brl(t.total)}</td></tr>
      </tbody></table>
      <h2>Pagamentos</h2>
      ${paymentsTable(pays)}
      <p class="doc-total">Total pago: <strong>${brl(t.pago)}</strong> · ${quitado ? html`<strong>Conta quitada</strong>` : t.saldo > 0 ? html`Saldo em aberto: <strong>${brl(t.saldo)}</strong>` : html`Crédito do hóspede: <strong>${brl(-t.saldo)}</strong>`}</p>
      <div class="doc-sign"><div><span></span>Hóspede</div><div><span></span>Recepção${NP.Auth.current() ? ' — ' + NP.Auth.current().nome : ''}</div></div>
    </div>`;
  }

  function closing(list, label) {
    const s = Core.summarizePayments(list);
    const names = Pay().METHOD_NAME;
    return html`<div class="doc">
      ${head('Fechamento financeiro')}
      <p><strong>Período:</strong> ${label}</p>
      <table class="doc-table"><thead><tr><th>Forma de pagamento</th><th class="num">Lançamentos</th><th class="num">Total</th></tr></thead><tbody>
        ${Object.entries(s.porMetodo).map(([m, v]) => html`<tr><td>${names[m]}</td><td class="num">${v.qtd}</td><td class="num">${brl(v.total)}</td></tr>`)}
        <tr class="strong"><td colspan="2">Recebido (sem faturado)</td><td class="num">${brl(s.caixa)}</td></tr>
        <tr><td colspan="2">Faturado (a receber)</td><td class="num">${brl(s.faturado)}</td></tr>
        <tr><td colspan="2">Estornado</td><td class="num">${brl(s.estornado)}</td></tr>
        <tr><td colspan="2">Tentativas recusadas</td><td class="num">${s.recusados}</td></tr>
      </tbody></table>
      <h2>Lançamentos</h2>
      <table class="doc-table"><thead><tr><th>Data</th><th>Hóspede</th><th>Forma</th><th>Situação</th><th class="num">Valor</th></tr></thead><tbody>
        ${list.map((p) => html`<tr><td>${fmtDateTime(p.criadoEm)}</td><td>${p.hospede || '—'}</td><td>${names[p.metodo]}</td><td>${STATUS[p.status]}</td><td class="num">${brl(p.valor)}</td></tr>`)}
      </tbody></table>
      <div class="doc-sign"><div><span></span>Responsável pelo caixa</div><div><span></span>Gerência</div></div>
    </div>`;
  }

  NP.Print = { checkinSheet, statement, closing, STATUS };
})();
