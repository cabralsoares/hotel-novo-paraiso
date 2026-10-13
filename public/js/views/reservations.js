/* Reservas */
(function () {
  const NP = window.NP;
  const { html, mount, icon, brl, fmtDate, field, showErrors, formData, $, $$ } = NP.U;
  const { pageHead, empty, resBadge, RES_STATUS, norm } = NP.Common;
  const Store = NP.Store, UI = NP.UI, Core = NP.Core, V = NP.Validators;

  function newReservation() {
    const T = Core.today();
    const guests = [...Store.state.guests].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    const m = UI.modal({
      title: 'Nova reserva', size: 'lg',
      body: html`<form class="stack" novalidate>
        <div class="grid-2">
          ${field('Hóspede', 'guestId', { options: [['', 'Selecione…'], ...guests.map((g) => [g.id, g.nome]), ['novo', '＋ Cadastrar novo hóspede']], cls: 'span-2' })}
          <div class="span-2 grid-2 hidden" data-newguest>
            ${field('Nome completo', 'nome', { mask: 'name', cls: 'span-2' })}
            ${field('CPF', 'cpf', { mask: 'cpf', inputmode: 'numeric' })}
            ${field('Telefone / WhatsApp', 'telefone', { mask: 'phone', inputmode: 'tel' })}
            <p class="muted small span-2">Os demais dados do hóspede são completados no check-in.</p>
          </div>
          ${field('Entrada', 'checkin', { type: 'date', value: T, min: T })}
          ${field('Saída', 'checkout', { type: 'date', value: Core.addDays(T, 1), min: Core.addDays(T, 1) })}
          ${field('Adultos', 'adultos', { type: 'number', min: 1, max: 8, value: 2 })}
          ${field('Crianças', 'criancas', { type: 'number', min: 0, max: 8, value: 0 })}
          ${field('Quarto disponível', 'roomId', { options: [['', 'Escolha as datas…']], cls: 'span-2' })}
          ${field('Observações (opcional)', 'obs', { cls: 'span-2', maxlength: 200 })}
        </div>
        <div class="summary" data-sum></div>
      </form>`,
      footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>Criar reserva</button>`,
    });
    const form = $('form', m.body);
    const $f = (n) => $(`[name=${n}]`, form);

    function refreshRooms() {
      const ci = $f('checkin').value, co = $f('checkout').value;
      const need = (Number($f('adultos').value) || 0) + (Number($f('criancas').value) || 0);
      const sel = $f('roomId'), prev = sel.value;
      if (!V.isDateISO(ci) || !V.isDateISO(co) || co <= ci) { sel.innerHTML = '<option value="">Datas inválidas</option>'; refreshSum(); return; }
      const rooms = Core.availableRooms(Store.state, ci, co).filter((r) => r.capacidade >= need).sort((a, b) => a.numero.localeCompare(b.numero, 'pt', { numeric: true }));
      sel.innerHTML = '<option value="">Selecione…</option>' + rooms.map((r) => `<option value="${r.id}">${r.numero} · ${r.tipo} · até ${r.capacidade} · ${brl(r.diaria)}</option>`).join('');
      if (!rooms.length) sel.innerHTML = '<option value="">Nenhum quarto disponível neste período</option>';
      if (rooms.some((r) => r.id === prev)) sel.value = prev;
      refreshSum();
    }
    function refreshSum() {
      const q = Store.room($f('roomId').value);
      const ci = $f('checkin').value, co = $f('checkout').value;
      $('[data-sum]', form).innerHTML = NP.U.render(q && co > ci ? html`<strong>${Core.nights(ci, co)} diária(s)</strong> × ${brl(q.diaria)} = <strong>${brl(Core.nights(ci, co) * q.diaria)}</strong>` : '');
    }
    form.addEventListener('change', (e) => {
      if (e.target.name === 'guestId') $('[data-newguest]', form).classList.toggle('hidden', e.target.value !== 'novo');
      if (e.target.name === 'checkin') { const c = $f('checkout'); c.min = Core.addDays(e.target.value || T, 1); if (c.value <= e.target.value) c.value = c.min; }
      if (['checkin', 'checkout', 'adultos', 'criancas'].includes(e.target.name)) refreshRooms();
      if (e.target.name === 'roomId') refreshSum();
    });
    refreshRooms();

    const save = async () => {
      const d = formData(form);
      const errors = {};
      let guestId = d.guestId;
      if (!guestId) errors.guestId = 'Escolha o hóspede.';
      if (guestId === 'novo') {
        if (d.nome.split(/\s+/).filter(Boolean).length < 2) errors.nome = 'Informe nome e sobrenome.';
        if (!V.isCPF(d.cpf)) errors.cpf = 'CPF inválido.';
        else { const dup = Store.state.guests.find((g) => g.docTipo === 'cpf' && g.doc === V.digits(d.cpf)); if (dup) errors.cpf = `CPF já cadastrado: ${dup.nome}.`; }
        if (!V.isPhone(d.telefone)) errors.telefone = 'Telefone inválido.';
      }
      if (!V.isDateISO(d.checkin) || d.checkin < T) errors.checkin = 'Entrada deve ser hoje ou depois.';
      if (!V.isDateISO(d.checkout) || d.checkout <= d.checkin) errors.checkout = 'A saída deve ser depois da entrada.';
      const ad = Number(d.adultos), cr = Number(d.criancas);
      if (!(ad >= 1 && ad <= 8)) errors.adultos = 'Mínimo 1 adulto.';
      if (!(cr >= 0 && cr <= 8)) errors.criancas = 'Valor inválido.';
      const room = Store.room(d.roomId);
      if (!room) errors.roomId = 'Escolha um quarto disponível.';
      else if (room.capacidade < ad + cr) errors.roomId = `Este quarto comporta até ${room.capacidade} pessoas.`;
      if (!showErrors(form, errors)) return;
      try {
        const r = await Store.createReservation({
          ...(guestId === 'novo' ? { hospedeId: 'novo', novoHospede: { nome: d.nome.replace(/\s+/g, ' '), cpf: V.digits(d.cpf), telefone: V.digits(d.telefone) } } : { hospedeId: guestId }),
          quartoId: room.id, checkin: d.checkin, checkout: d.checkout, adultos: ad, criancas: cr, obs: d.obs,
        });
        UI.toast(`Reserva ${r.codigo} criada.`);
        m.close();
      } catch (err) { NP.Api.showError(err, form); refreshRooms(); }
    };
    $('[data-save]', m.foot).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  NP.Views.reservas = function (root) {
    let q = '', status = 'ativas';
    function draw(keepFocus) {
      const st = Store.state, term = norm(q);
      const list = st.reservations.filter((r) => (status === 'todas' ? true : status === 'ativas' ? r.status === 'reservada' || r.status === 'hospedado' : r.status === status))
        .filter((r) => !term || norm(Store.guest(r.guestId).nome).includes(term) || norm(r.codigo).includes(term))
        .sort((a, b) => b.checkin.localeCompare(a.checkin));
      mount(root, html`
        ${pageHead('Reservas', 'Reservas futuras, hospedagens em andamento e histórico', html`<button class="btn btn-primary" data-new>${icon('plus')} Nova reserva</button>`)}
        <div class="toolbar">
          <label class="search">${icon('search', 18)}<input type="search" placeholder="Buscar por hóspede ou código" value="${q}" data-q aria-label="Buscar reserva"></label>
          <select data-status aria-label="Filtrar situação"><option value="ativas" ${status === 'ativas' ? 'selected' : ''}>Ativas</option><option value="todas" ${status === 'todas' ? 'selected' : ''}>Todas</option>${Object.entries(RES_STATUS).map(([k, v]) => html`<option value="${k}" ${status === k ? 'selected' : ''}>${v[0]}</option>`)}</select>
        </div>
        <div class="card flush">${list.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Código</th><th>Hóspede</th><th>Quarto</th><th>Entrada</th><th>Saída</th><th class="num">Total</th><th>Situação</th><th></th></tr></thead><tbody>
          ${list.map((r) => { const g = Store.guest(r.guestId), room = Store.room(r.roomId), t = Store.totals(r); return html`<tr><td class="mono">${r.codigo}</td><td><strong>${g.nome}</strong></td><td>${room ? room.numero : '—'}</td><td>${fmtDate(r.checkin)}</td><td>${fmtDate(r.checkout)}</td><td class="num">${brl(t.total)}</td><td>${resBadge(r.status)}</td>
            <td class="actions-cell">${r.status === 'reservada' ? html`<a class="btn btn-sm btn-primary" href="#/checkin/${r.id}">Check-in</a><button class="btn btn-sm btn-danger-ghost" data-cancel="${r.id}">Cancelar</button>` : r.status === 'cancelada' ? '' : html`<a class="btn btn-sm" href="#/hospedagem/${r.id}">Abrir</a>`}</td></tr>`; })}
        </tbody></table></div>` : empty('Nenhuma reserva encontrada.', 'calendar')}</div>`);
      if (keepFocus) { const i = $('[data-q]', root); i.focus(); i.setSelectionRange(q.length, q.length); }
    }
    root.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { q = e.target.value; draw(true); } });
    root.addEventListener('change', (e) => { if (e.target.matches('[data-status]')) { status = e.target.value; draw(); } });
    root.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-cancel]');
      if (c) {
        const r = Store.reservation(c.dataset.cancel);
        const motivo = await UI.confirmDialog({ title: 'Cancelar reserva', message: `Cancelar a reserva ${r.codigo} de ${Store.guest(r.guestId).nome}?`, confirmText: 'Cancelar reserva', danger: true, reason: true });
        if (motivo) { try { await Store.cancelReservation(r.id, motivo); UI.toast('Reserva cancelada.'); } catch (err) { NP.Api.showError(err); } }
      } else if (e.target.closest('[data-new]')) newReservation();
    });
    const off = NP.Common.onStore(root, () => draw(false));
    draw();
    return { destroy: off };
  };
})();
