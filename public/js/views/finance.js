/* Financeiro: lançamentos, totais por forma de pagamento, estorno e fechamento */
(function () {
  const NP = window.NP;
  const { html, mount, icon, brl, fmtDate, fmtDateTime, $ } = NP.U;
  const { pageHead, empty, payBadge, dayOf } = NP.Common;
  const Store = NP.Store, UI = NP.UI, Core = NP.Core, Pay = NP.Payments;

  NP.Views.financeiro = function (root) {
    const T = Core.today();
    const F = { from: T, to: T, metodo: 'todos', status: 'todos' };

    const filtered = () => Store.state.payments
      .filter((p) => { const d = dayOf(p.criadoEm); return d >= F.from && d <= F.to; })
      .filter((p) => F.metodo === 'todos' || p.metodo === F.metodo)
      .filter((p) => F.status === 'todos' || p.status === F.status)
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    const label = () => (F.from === F.to ? fmtDate(F.from) : `${fmtDate(F.from)} a ${fmtDate(F.to)}`);

    function draw() {
      const list = filtered();
      const s = Core.summarizePayments(list);
      // pagamentos autorizados de check-ins que não foram concluídos (ex.: o navegador fechou no meio)
      const orphans = Store.state.payments.filter((p) => !p.reservaId && (p.status === 'autorizado' || p.status === 'faturado'));
      mount(root, html`
        ${pageHead('Financeiro', 'Recebimentos, faturados, estornos e tentativas recusadas', html`<button class="btn" data-print ${list.length ? '' : 'disabled'}>${icon('printer')} Fechamento</button>`)}
        <div class="toolbar wrap">
          <label class="inline-field"><span>De</span><input type="date" data-f="from" value="${F.from}" max="${F.to}"></label>
          <label class="inline-field"><span>Até</span><input type="date" data-f="to" value="${F.to}" min="${F.from}"></label>
          <select data-f="metodo" aria-label="Forma de pagamento"><option value="todos">Todas as formas</option>${Pay.METHODS.map((m) => html`<option value="${m.id}" ${F.metodo === m.id ? 'selected' : ''}>${Pay.METHOD_NAME[m.id]}</option>`)}</select>
          <select data-f="status" aria-label="Situação"><option value="todos">Todas as situações</option>${['autorizado', 'faturado', 'recusado', 'estornado'].map((k) => html`<option value="${k}" ${F.status === k ? 'selected' : ''}>${NP.Print.STATUS[k]}</option>`)}</select>
          <button class="btn btn-sm btn-ghost" data-today>Hoje</button>
        </div>
        ${orphans.length ? html`<div class="notice notice-warn">${icon('alert', 20)}<div><strong>${orphans.length} pagamento(s) autorizado(s) sem reserva</strong> (${brl(orphans.reduce((a, p) => a + p.valor, 0))}) — são de check-ins que ainda estão em andamento ou que foram interrompidos antes de terminar. Se não houver ninguém fazendo check-in agora, confira com a recepção e estorne (aparecem na tabela como "sem reserva").</div></div>` : ''}
        <div class="kpis four">
          <div class="kpi kpi-money"><span class="kpi-label">Recebido</span><strong>${brl(s.caixa)}</strong><small>dinheiro, PIX e cartões</small></div>
          <div class="kpi"><span class="kpi-label">Faturado (a receber)</span><strong>${brl(s.faturado)}</strong><small>empresas</small></div>
          <div class="kpi"><span class="kpi-label">Estornado</span><strong>${brl(s.estornado)}</strong><small>${list.filter((p) => p.status === 'estornado').length} lançamento(s)</small></div>
          <div class="kpi"><span class="kpi-label">Recusados</span><strong>${s.recusados}</strong><small>tentativas</small></div>
        </div>
        ${Object.keys(s.porMetodo).length ? html`<section class="card"><h2>Por forma de pagamento</h2><div class="method-totals">${Object.entries(s.porMetodo).map(([m, v]) => html`<div><span>${Pay.METHOD_NAME[m]}</span><strong>${brl(v.total)}</strong><small>${v.qtd} lançamento(s)</small></div>`)}</div></section>` : ''}
        <div class="card flush">${list.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Hóspede</th><th>Forma</th><th>Detalhes</th><th>Operador</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
          ${list.map((p) => { const r = p.reservaId ? Store.reservation(p.reservaId) : null; return html`<tr class="${p.status === 'recusado' || p.status === 'estornado' ? 'is-void' : ''}"><td>${fmtDateTime(p.criadoEm)}</td><td>${p.hospede || '—'}${r ? html`<small class="muted block mono">${r.codigo}</small>` : html`<small class="muted block">sem reserva</small>`}</td>
            <td>${p.tipo === 'devolucao' ? 'Devolução · ' : ''}${Pay.METHOD_NAME[p.metodo]}</td><td class="detail-cell">${Pay.describe(p)}${p.autorizadoPor ? html`<small class="muted block">Autorizado por ${p.autorizadoPor}</small>` : ''}${p.estorno ? html`<small class="muted block">Estorno: ${p.estorno.motivo} (${p.estorno.autorizadoPor || p.estorno.por})</small>` : ''}</td>
            <td>${p.operador || '—'}</td><td class="num">${brl(p.valor)}</td><td>${payBadge(p.status)}</td>
            <td class="actions-cell">${(p.status === 'autorizado' || p.status === 'faturado') && p.tipo !== 'devolucao' ? html`<button class="btn btn-sm btn-danger-ghost" data-void="${p.id}">Estornar</button>` : ''}</td></tr>`; })}
        </tbody></table></div>` : empty('Nenhum lançamento neste período.', 'wallet')}</div>`);
    }

    root.addEventListener('change', (e) => {
      const f = e.target.dataset && e.target.dataset.f;
      if (!f) return;
      if ((f === 'from' || f === 'to') && !NP.Validators.isDateISO(e.target.value)) return;
      F[f] = e.target.value;
      draw();
    });
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-today]')) { Object.assign(F, { from: T, to: T }); return draw(); }
      if (e.target.closest('[data-print]')) return UI.printPreview('Fechamento financeiro', NP.Print.closing(filtered(), label()));
      const b = e.target.closest('[data-void]');
      if (!b) return;
      const p = Store.state.payments.find((x) => x.id === b.dataset.void);
      const motivo = await UI.confirmDialog({ title: 'Estornar pagamento', message: `${Pay.METHOD_NAME[p.metodo]} de ${brl(p.valor)} — ${p.hospede || 'sem hóspede'}. O valor volta para o saldo da conta.`, confirmText: 'Continuar', danger: true, reason: true });
      if (!motivo) return;
      try {
        await UI.busy(b, () => NP.Api.withAuth((tok) => Store.voidPayment(p.id, motivo, tok)));
        UI.toast(p.metodo === 'dinheiro' ? 'Estornado. Devolva o dinheiro ao hóspede.' : 'Pagamento estornado.', p.metodo === 'dinheiro' ? 'info' : 'ok', 7000);
      } catch (err) { NP.Api.showError(err); }
    });
    const off = NP.Common.onStore(root, draw);
    draw();
    return { destroy: off };
  };
})();
