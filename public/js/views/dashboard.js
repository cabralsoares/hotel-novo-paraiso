/* Painel */
(function () {
  const NP = window.NP;
  const { html, mount, icon, brl, fmtDate, plural } = NP.U;
  const { pageHead, empty, resBadge, dayOf, ROOM_STATUS } = NP.Common;
  const Store = NP.Store, Core = NP.Core;

  NP.Views.painel = function (root) {
    function draw() {
      const st = Store.state, T = Core.today();
      const inHouse = st.reservations.filter((r) => r.status === 'hospedado');
      const arrivals = st.reservations.filter((r) => r.status === 'reservada' && r.checkin <= T).sort((a, b) => a.checkin.localeCompare(b.checkin));
      const departures = inHouse.filter((r) => r.checkout <= T);
      const usable = st.rooms.filter((r) => r.status !== 'manutencao');
      const occupied = st.rooms.filter((r) => r.status === 'ocupado').length;
      const occ = usable.length ? Math.round((occupied / usable.length) * 100) : 0;
      const guests = inHouse.reduce((s, r) => s + r.adultos + r.criancas, 0);
      const today = Core.summarizePayments(st.payments.filter((p) => dayOf(p.criadoEm) === T));
      const me = NP.Auth.current();
      const hr = new Date().getHours();
      const greet = hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
      const isEmpty = !st.guests.length && !st.reservations.length;

      mount(root, html`
        ${pageHead(`${greet}, ${me.nome.split(' ')[0]}`, NP.U.longDate(), html`<a class="btn btn-primary" href="#/checkin">${icon('login')} Novo check-in</a><a class="btn" href="#/reservas">${icon('calendar')} Reservas</a>`)}
        ${isEmpty ? html`<div class="callout"><div>${icon('sun', 24)}</div><div><strong>Sistema pronto para começar.</strong><p class="muted">Faça seu primeiro check-in${NP.Auth.isManager() ? ' ou carregue dados de exemplo para conhecer as telas e testar os pagamentos' : ''}.</p></div>${NP.Auth.isManager() ? html`<button class="btn" data-demo>Carregar dados de exemplo</button>` : ''}</div>` : ''}
        <div class="kpis">
          <div class="kpi"><span class="kpi-label">Ocupação</span><strong>${occ}%</strong><small>${occupied} de ${usable.length} quartos</small><div class="meter"><i style="width:${occ}%"></i></div></div>
          <div class="kpi"><span class="kpi-label">Hóspedes na casa</span><strong>${guests}</strong><small>${plural(inHouse.length, 'hospedagem', 'hospedagens')}</small></div>
          <div class="kpi"><span class="kpi-label">Chegadas hoje</span><strong>${arrivals.length}</strong><small>aguardando check-in</small></div>
          <div class="kpi"><span class="kpi-label">Saídas hoje</span><strong>${departures.length}</strong><small>aguardando check-out</small></div>
          <div class="kpi kpi-money"><span class="kpi-label">Recebido hoje</span><strong>${brl(today.caixa)}</strong><small>${today.faturado ? brl(today.faturado) + ' faturado' : 'sem faturados'}</small></div>
        </div>
        <div class="cols-2">
          <section class="card"><h2>Chegadas</h2>
            ${arrivals.length ? html`<ul class="list">${arrivals.map((r) => { const g = Store.guest(r.guestId), q = Store.room(r.roomId); return html`<li><div><strong>${g.nome}</strong><small>Quarto ${q.numero} · ${fmtDate(r.checkin)} → ${fmtDate(r.checkout)}${r.checkin < T ? ' · atrasada' : ''}</small></div><a class="btn btn-sm btn-primary" href="#/checkin/${r.id}">Check-in</a></li>`; })}</ul>` : empty('Nenhuma chegada pendente hoje.', 'login')}
          </section>
          <section class="card"><h2>Saídas</h2>
            ${departures.length ? html`<ul class="list">${departures.map((r) => { const g = Store.guest(r.guestId), q = Store.room(r.roomId), t = Store.totals(r); return html`<li><div><strong>${g.nome}</strong><small>Quarto ${q.numero} · saldo ${brl(t.saldo)}${r.checkout < T ? ' · estadia vencida' : ''}</small></div><a class="btn btn-sm" href="#/hospedagem/${r.id}">Check-out</a></li>`; })}</ul>` : empty('Nenhuma saída pendente hoje.', 'logout')}
          </section>
        </div>
        <section class="card"><h2>Mapa de quartos</h2>
          <div class="room-map">${[...st.rooms].sort((a, b) => a.numero.localeCompare(b.numero, 'pt', { numeric: true })).map((q) => {
            const stay = q.status === 'ocupado' ? inHouse.find((r) => r.roomId === q.id) : null;
            const href = stay ? `#/hospedagem/${stay.id}` : '#/quartos';
            return html`<a class="room-tile st-${q.status}" href="${href}" title="${ROOM_STATUS[q.status][0]}${stay ? ' — ' + Store.guest(stay.guestId).nome : ''}"><strong>${q.numero}</strong><small>${stay ? Store.guest(stay.guestId).nome.split(' ')[0] : ROOM_STATUS[q.status][0]}</small></a>`;
          })}</div>
          <div class="legend">${Object.entries(ROOM_STATUS).map(([k, v]) => html`<span><i class="dot st-${k}"></i>${v[0]}</span>`)}</div>
        </section>`);
    }

    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-demo]')) {
        try { await Store.loadDemo(); NP.UI.toast('Dados de exemplo carregados.'); } catch (err) { NP.Api.showError(err); }
      }
    });
    const off = NP.Common.onStore(root, draw);
    draw();
    return { destroy: off };
  };
})();
