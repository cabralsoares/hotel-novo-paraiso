/* Hospedagem: lista, conta do hóspede, consumos, recebimentos e check-out */
(function () {
  const NP = window.NP;
  const { html, mount, icon, brl, fmtDate, fmtDateTime, field, showErrors, formData, $, parseMoney, moneyStr, plural, maskPhone, maskCPF } = NP.U;
  const { pageHead, empty, resBadge, payBadge, norm } = NP.Common;
  const Store = NP.Store, UI = NP.UI, Core = NP.Core, Pay = NP.Payments;

  const PRESETS = [['Água mineral 500 ml', 5], ['Refrigerante lata', 6], ['Cerveja long neck', 10], ['Suco natural', 8], ['Lavanderia (peça)', 15], ['Café da manhã extra', 25], ['Almoço', 45], ['Jantar', 55], ['Estacionamento (diária)', 20], ['Cama extra (diária)', 60]];

  /* ---------- Janelas ---------- */
  function consumoDialog(resId) {
    const m = UI.modal({
      title: 'Lançar consumo', size: 'md',
      body: html`<form class="stack" novalidate>
        <div class="chips" aria-label="Itens frequentes">${PRESETS.map(([d, v]) => html`<button type="button" class="chip" data-preset="${d}|${v}">${d}</button>`)}</div>
        ${field('Descrição', 'descricao', { maxlength: 60 })}
        <div class="grid-2">${field('Quantidade', 'qtd', { type: 'number', min: 1, max: 99, value: 1 })}${field('Valor unitário (R$)', 'valor', { mask: 'money', inputmode: 'numeric' })}</div>
      </form>`,
      footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>Lançar na conta</button>`,
    });
    const form = $('form', m.body);
    m.body.addEventListener('click', (e) => {
      const p = e.target.closest('[data-preset]');
      if (!p) return;
      const [d, v] = p.dataset.preset.split('|');
      $('[name=descricao]', form).value = d; $('[name=valor]', form).value = moneyStr(Number(v));
    });
    const save = async () => {
      const d = formData(form), valor = parseMoney(d.valor), qtd = Number(d.qtd);
      const errors = {};
      if (d.descricao.length < 3) errors.descricao = 'Descreva o item (mínimo 3 letras).';
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 99) errors.qtd = 'Quantidade de 1 a 99.';
      if (!(valor > 0) || valor > 5000) errors.valor = 'Informe um valor entre R$ 0,01 e R$ 5.000,00.';
      if (!showErrors(form, errors)) return;
      try { await Store.addConsumo(resId, { descricao: d.descricao, qtd, valor }); UI.toast('Consumo lançado.'); m.close(); }
      catch (err) { NP.Api.showError(err, form); }
    };
    $('[data-save]', m.foot).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  function receiveDialog(resId) {
    const r0 = Store.reservation(resId);
    const m = UI.modal({ title: 'Receber pagamento', size: 'lg', body: html`<div data-panel></div>`, footer: html`<button type="button" class="btn" data-close>Fechar</button>` });
    const panel = Pay.mount($('[data-panel]', m.body), {
      getBalance: () => Store.totals(Store.reservation(resId)).saldo,
      suggestions: () => [{ label: 'Saldo da conta', value: Store.totals(Store.reservation(resId)).saldo }],
      context: () => ({ reservaId: resId, hospede: Store.guest(r0.guestId).nome }),
      onPayment: () => {}, // o servidor já gravou; a tela se atualiza sozinha
    });
    const prevClose = m.close;
    m.close = (v) => { panel.destroy(); prevClose(v); };
  }

  function changeCheckoutDialog(resId) {
    const r = Store.reservation(resId), T = Core.today();
    const min = Core.addDays(r.checkin, 1) > T ? Core.addDays(r.checkin, 1) : T;
    const m = UI.modal({
      title: 'Alterar data de saída', size: 'sm',
      body: html`<form class="stack" novalidate><p class="muted">Saída atual: <strong>${fmtDate(r.checkout)}</strong>. Para estender, o quarto precisa estar livre no período.</p>${field('Nova data de saída', 'checkout', { type: 'date', value: r.checkout, min })}</form>`,
      footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>Salvar</button>`,
    });
    const form = $('form', m.body);
    const save = async () => {
      const co = $('[name=checkout]', form).value;
      if (!NP.Validators.isDateISO(co) || co < min) return showErrors(form, { checkout: `Escolha uma data a partir de ${fmtDate(min)}.` });
      if (co === r.checkout) return m.close();
      try { await Store.changeCheckout(resId, co); UI.toast('Data de saída alterada.'); m.close(); }
      catch (err) { showErrors(form, { checkout: err.message }); }
    };
    $('[data-save]', m.foot).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  async function refundDialog(resId, valor, motivoPadrao, dataSaida) {
    const mgr = await UI.requireManager({ motivo: 'Devolução de valor ao hóspede', detalhe: brl(valor), escopo: 'devolucao', valor });
    if (!mgr) return false;
    return new Promise((resolve) => {
      const m = UI.modal({
        title: 'Devolver crédito ao hóspede', size: 'sm', onClose: () => resolve(false),
        body: html`<form class="stack" novalidate><p>Valor a devolver: <strong>${brl(valor)}</strong></p>
          ${field('Forma da devolução', 'metodo', { options: [['dinheiro', 'Dinheiro'], ['pix', 'PIX (transferência)'], ['credito', 'Estorno no cartão de crédito'], ['debito', 'Estorno no cartão de débito']] })}
          ${field('Motivo', 'motivo', { value: motivoPadrao || '', maxlength: 120 })}</form>`,
        footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>Registrar devolução</button>`,
      });
      const form = $('form', m.body);
      $('[data-save]', m.foot).addEventListener('click', async () => {
        const d = formData(form);
        if (d.motivo.length < 5) return showErrors(form, { motivo: 'Descreva o motivo (mínimo 5 letras).' });
        try {
          await Store.refundCredit(resId, { metodo: d.metodo, valor, motivo: d.motivo, dataSaida: dataSaida || undefined }, mgr.token);
          resolve(true); m.close(true);
        } catch (err) { NP.Api.showError(err, form); }
      });
    });
  }

  function checkoutDialog(resId) {
    const r = Store.reservation(resId), T = Core.today();
    const g = Store.guest(r.guestId), q = Store.room(r.roomId);
    const early = T < r.checkout, late = T > r.checkout;
    let keep = false, panel = null;
    const outDate = () => (early && !keep ? T : late ? T : r.checkout);
    const tot = () => Core.stayTotals({ ...Store.reservation(resId), checkout: outDate() }, Store.state.payments);

    const m = UI.modal({
      title: `Check-out — Quarto ${q.numero}`, size: 'lg',
      body: html`<div class="stack"><div data-summary></div><div data-panel></div></div>`,
      footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn btn-success btn-lg" data-finish>${icon('logout', 20)} Concluir check-out</button>`,
    });
    const closeAll = m.close;
    m.close = (v) => { if (panel) panel.destroy(); closeAll(v); };

    function syncPanel() {
      const box = $('[data-panel]', m.body), s = tot().saldo;
      if (s > 0.004 && !panel) {
        panel = Pay.mount(box, {
          getBalance: () => tot().saldo,
          suggestions: () => [{ label: 'Saldo da conta', value: tot().saldo }],
          context: () => ({ reservaId: resId, hospede: g.nome, dataSaida: outDate() }),
          onPayment: () => drawSummary(),
        });
      } else if (s <= 0.004 && panel) { panel.destroy(); panel = null; box.innerHTML = ''; }
    }

    function paidList() {
      const ps = Store.paymentsOf(resId).filter((p) => p.status !== 'recusado');
      return ps.length ? html`<ul class="pay-list compact">${ps.map((p) => html`<li class="${p.status === 'estornado' ? 'is-void' : ''}"><div><strong>${p.tipo === 'devolucao' ? 'Devolução · ' : ''}${Pay.METHOD_NAME[p.metodo]}</strong><small>${Pay.describe(p)}</small></div><span>${brl(p.valor)}</span></li>`)}</ul>` : '';
    }

    function drawSummary() {
      const t = tot(), s = t.saldo;
      $('[data-summary]', m.body).innerHTML = NP.U.render(html`
        <div class="summary-grid">
          <div><span>Hóspede</span><strong>${g.nome}</strong></div>
          <div><span>Período</span><strong>${fmtDate(r.checkin)} → ${fmtDate(outDate())}</strong></div>
          <div><span>Diárias</span><strong>${plural(t.noites, 'diária', 'diárias')} · ${brl(t.diarias)}</strong></div>
          <div><span>Consumos</span><strong>${brl(t.consumos)}</strong></div>
        </div>
        ${early ? html`<div class="notice notice-warn">${icon('alert', 20)}<div><strong>Saída antecipada</strong> (prevista para ${fmtDate(r.checkout)}).
          <label class="check"><input type="checkbox" data-keep ${keep ? 'checked' : ''}><span>Manter a cobrança das diárias reservadas (não recalcular)</span></label></div></div>` : ''}
        ${late ? html`<div class="notice notice-warn">${icon('alert', 20)}<div><strong>Estadia além do previsto</strong> — diárias calculadas até hoje.</div></div>` : ''}
        <div class="pay-summary"><div><span>Total da conta</span><strong>${brl(t.total)}</strong></div><div><span>Já pago</span><strong class="ok-text">${brl(t.pago)}</strong></div>
          <div><span>${s < -0.004 ? 'Crédito do hóspede' : 'Saldo a pagar'}</span><strong class="${s > 0.004 ? 'danger-text' : 'ok-text'}">${brl(Math.abs(s))}</strong></div></div>
        ${paidList()}
        ${s < -0.004 ? html`<div class="notice notice-warn">${icon('alert', 20)}<div>O hóspede pagou mais do que o total. <button type="button" class="btn btn-sm" data-refund>${icon('shield', 14)} Devolver ${brl(-s)} (gerente)</button></div></div>` : ''}
        ${Math.abs(s) <= 0.004 ? html`<div class="notice notice-ok">${icon('check', 20)}<div>Conta quitada. Pode concluir o check-out.</div></div>` : ''}`);
      $('[data-finish]', m.foot).disabled = Math.abs(s) > 0.004;
      syncPanel();
    }

    m.body.addEventListener('change', (e) => { if (e.target.matches('[data-keep]')) { keep = e.target.checked; drawSummary(); if (panel) panel.refresh(); } });
    m.body.addEventListener('click', async (e) => {
      if (e.target.closest('[data-refund]')) {
        const ok = await refundDialog(resId, -tot().saldo, `Crédito na saída — ${g.nome}`, outDate());
        if (ok) drawSummary();
      }
    });
    $('[data-finish]', m.foot).addEventListener('click', async (e) => {
      try {
        await UI.busy(e.currentTarget, () => Store.finishCheckout(resId, keep));
        m.close();
        UI.toast(`Check-out concluído. Quarto ${q.numero} enviado para limpeza.`);
        UI.printPreview('Recibo de hospedagem', NP.Print.statement(resId));
      } catch (err) { NP.Api.showError(err); drawSummary(); }
    });
    drawSummary();
  }

  /* ---------- Telas ---------- */
  function list(root) {
    let q = '', tab = 'casa';
    function draw(keepFocus) {
      const st = Store.state, term = norm(q);
      const rows = st.reservations.filter((r) => (tab === 'casa' ? r.status === 'hospedado' : r.status === 'finalizada'))
        .filter((r) => !term || norm(Store.guest(r.guestId).nome).includes(term) || norm(r.codigo).includes(term) || (Store.room(r.roomId) || {}).numero === q.trim())
        .sort((a, b) => (tab === 'casa' ? a.checkout.localeCompare(b.checkout) : (b.checkoutReal || '').localeCompare(a.checkoutReal || ''))).slice(0, 200);
      mount(root, html`
        ${pageHead('Hospedagem', 'Contas dos hóspedes, consumos, recebimentos e check-out', html`<a class="btn btn-primary" href="#/checkin">${icon('login')} Novo check-in</a>`)}
        <div class="toolbar"><div class="seg"><button data-tab="casa" aria-selected="${tab === 'casa'}">Na casa</button><button data-tab="fim" aria-selected="${tab === 'fim'}">Finalizadas</button></div>
          <label class="search">${icon('search', 18)}<input type="search" placeholder="Buscar por hóspede, código ou quarto" value="${q}" data-q aria-label="Buscar"></label></div>
        <div class="card flush">${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Quarto</th><th>Hóspede</th><th>Entrada</th><th>Saída</th><th class="num">Total</th><th class="num">Saldo</th><th></th></tr></thead><tbody>
          ${rows.map((r) => { const t = Store.totals(r), T = Core.today(); return html`<tr><td><strong>${Store.room(r.roomId).numero}</strong></td><td>${Store.guest(r.guestId).nome}</td><td>${fmtDate(r.checkin)}</td><td>${fmtDate(r.checkout)} ${tab === 'casa' && r.checkout <= T ? NP.Common.badge(r.checkout < T ? 'danger' : 'warn', r.checkout < T ? 'Vencida' : 'Hoje') : ''}</td><td class="num">${brl(t.total)}</td><td class="num ${t.saldo > 0.004 ? 'danger-text' : ''}">${brl(t.saldo)}</td><td class="actions-cell"><a class="btn btn-sm ${tab === 'casa' ? 'btn-primary' : ''}" href="#/hospedagem/${r.id}">Abrir</a></td></tr>`; })}
        </tbody></table></div>` : empty(tab === 'casa' ? 'Nenhum hóspede na casa no momento.' : 'Nenhuma hospedagem finalizada.', 'home')}</div>`);
      if (keepFocus) { const i = $('[data-q]', root); i.focus(); i.setSelectionRange(q.length, q.length); }
    }
    root.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { q = e.target.value; draw(true); } });
    root.addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; draw(); } });
    const off = NP.Common.onStore(root, () => draw(false));
    draw();
    return { destroy: off };
  }

  function detail(root, id) {
    function draw() {
      const r = Store.reservation(id);
      if (!r) return mount(root, html`${pageHead('Hospedagem', '')}${empty('Hospedagem não encontrada.', 'home')}<a class="btn" href="#/hospedagem">Voltar</a>`);
      const g = Store.guest(r.guestId), q = Store.room(r.roomId), t = Store.totals(r);
      const pays = Store.paymentsOf(id).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
      const open = r.status === 'hospedado';
      const mgr = NP.Auth.isManager();
      mount(root, html`
        <a class="back-link" href="#/hospedagem">${icon('left', 16)} Hospedagem</a>
        ${pageHead(`Quarto ${q.numero} · ${g.nome}`, html`${r.codigo} · ${q.tipo} ${resBadge(r.status)}`, html`
          ${open ? html`<button class="btn" data-act="consumo">${icon('plus')} Consumo</button><button class="btn" data-act="receber" ${t.saldo > 0.004 ? '' : 'disabled'}>${icon('wallet')} Receber</button><button class="btn" data-act="saida">${icon('calendar')} Alterar saída</button>` : ''}
          <button class="btn" data-act="extrato">${icon('printer')} Extrato</button>
          ${open ? html`<button class="btn btn-primary" data-act="checkout">${icon('logout')} Check-out</button>` : ''}`)}
        <div class="cols-2 wide-left">
          <section class="card"><h2>Conta</h2>
            <table class="table tight"><thead><tr><th>Item</th><th class="num">Qtd.</th><th class="num">Unit.</th><th class="num">Total</th><th></th></tr></thead><tbody>
              <tr><td>Diárias (${fmtDate(r.checkin)} → ${fmtDate(r.checkout)})</td><td class="num">${t.noites}</td><td class="num">${brl(r.diaria)}</td><td class="num">${brl(t.diarias)}</td><td></td></tr>
              ${r.consumos.map((c) => html`<tr><td>${c.descricao}<small class="muted block">${fmtDateTime(c.em)}</small></td><td class="num">${c.qtd}</td><td class="num">${brl(c.valor)}</td><td class="num">${brl(c.qtd * c.valor)}</td><td class="actions-cell">${open ? html`<button class="icon-btn" data-rm="${c.id}" aria-label="Remover ${c.descricao}" title="Remover (exige gerente)">${icon('x', 16)}</button>` : ''}</td></tr>`)}
              ${t.desconto ? html`<tr><td colspan="3">Desconto (${r.descontoPct}% nas diárias)${r.descontoAutorizadoPor ? html`<small class="muted block">Autorizado por ${r.descontoAutorizadoPor}</small>` : ''}</td><td class="num">− ${brl(t.desconto)}</td><td></td></tr>` : ''}
              <tr class="strong"><td colspan="3">Total</td><td class="num">${brl(t.total)}</td><td></td></tr>
              <tr><td colspan="3">Pago</td><td class="num ok-text">${brl(t.pago)}</td><td></td></tr>
              <tr class="strong"><td colspan="3">${t.saldo < -0.004 ? 'Crédito do hóspede' : 'Saldo a pagar'}</td><td class="num ${t.saldo > 0.004 ? 'danger-text' : 'ok-text'}">${brl(Math.abs(t.saldo))}</td><td></td></tr>
            </tbody></table>
          </section>
          <section class="card"><h2>Hóspede e estadia</h2>
            <dl class="dl"><dt>Nome</dt><dd>${g.nome}</dd><dt>Documento</dt><dd>${g.docTipo === 'cpf' ? maskCPF(g.doc) : g.doc}</dd><dt>Telefone</dt><dd>${maskPhone(g.telefone)}</dd>
              <dt>Residência</dt><dd>${g.cidade}/${g.uf}</dd><dt>Pessoas</dt><dd>${r.adultos} adulto(s)${r.criancas ? `, ${r.criancas} criança(s)` : ''}</dd>
              <dt>Entrada</dt><dd>${r.checkinReal ? fmtDateTime(r.checkinReal) : fmtDate(r.checkin)}</dd><dt>Saída ${r.checkoutReal ? '' : 'prevista'}</dt><dd>${r.checkoutReal ? fmtDateTime(r.checkoutReal) : fmtDate(r.checkout)}</dd>
              ${r.placa ? html`<dt>Placa</dt><dd>${r.placa}</dd>` : ''}${r.obs ? html`<dt>Observações</dt><dd>${r.obs}</dd>` : ''}</dl>
          </section>
        </div>
        <section class="card"><h2>Pagamentos</h2>
          ${pays.length ? html`<ul class="pay-list">${pays.map((p) => html`<li class="${p.status === 'recusado' || p.status === 'estornado' ? 'is-void' : ''}"><div><strong>${p.tipo === 'devolucao' ? 'Devolução · ' : ''}${Pay.METHOD_NAME[p.metodo]}</strong><small>${fmtDateTime(p.criadoEm)} · ${p.operador || '—'}${p.autorizadoPor ? ` · autorizado por ${p.autorizadoPor}` : ''}${Pay.describe(p) ? ' · ' + Pay.describe(p) : ''}</small></div><div class="pay-list-end"><span>${brl(p.valor)}</span>${payBadge(p.status)}</div></li>`)}</ul>` : html`<p class="muted">Nenhum pagamento registrado.</p>`}
        </section>`);
    }
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act], [data-rm]');
      if (!b) return;
      if (b.dataset.rm) {
        const r = Store.reservation(id), c = r.consumos.find((x) => x.id === b.dataset.rm);
        try { await NP.Api.withAuth((tok) => Store.removeConsumo(id, c.id, tok)); UI.toast('Consumo removido.'); }
        catch (err) { NP.Api.showError(err); }
        return;
      }
      const a = b.dataset.act;
      if (a === 'consumo') consumoDialog(id);
      else if (a === 'receber') receiveDialog(id);
      else if (a === 'saida') changeCheckoutDialog(id);
      else if (a === 'checkout') checkoutDialog(id);
      else if (a === 'extrato') UI.printPreview('Extrato da conta', NP.Print.statement(id));
    });
    const off = NP.Common.onStore(root, draw);
    draw();
    return { destroy: off };
  }

  NP.Views.hospedagem = (root, params) => (params && params[0] ? detail(root, params[0]) : list(root));
})();
