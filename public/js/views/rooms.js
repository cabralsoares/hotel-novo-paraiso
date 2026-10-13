/* Quartos */
(function () {
  const NP = window.NP;
  const { html, mount, icon, brl, fmtDate, field, showErrors, formData, $, parseMoney, moneyStr } = NP.U;
  const { pageHead, roomBadge, ROOM_STATUS } = NP.Common;
  const Store = NP.Store, UI = NP.UI;
  const TIPOS = ['Econômico', 'Standard', 'Luxo', 'Suíte', 'Família'];

  NP.Views.quartos = function (root) {
    let filter = 'todos';
    const sorted = () => [...Store.state.rooms].sort((a, b) => a.numero.localeCompare(b.numero, 'pt', { numeric: true }));

    function draw() {
      const rooms = sorted();
      const count = (s) => rooms.filter((r) => r.status === s).length;
      const shown = filter === 'todos' ? rooms : rooms.filter((r) => r.status === filter);
      const inHouse = Store.state.reservations.filter((r) => r.status === 'hospedado');
      mount(root, html`
        ${pageHead('Quartos', `${rooms.length} quartos cadastrados`, NP.Auth.isManager() ? html`<button class="btn btn-primary" data-new>${icon('plus')} Novo quarto</button>` : '')}
        <div class="chips filter-chips"><button class="chip" data-filter="todos" aria-pressed="${filter === 'todos'}">Todos · ${rooms.length}</button>
          ${Object.entries(ROOM_STATUS).map(([k, v]) => html`<button class="chip" data-filter="${k}" aria-pressed="${filter === k}">${v[0]} · ${count(k)}</button>`)}</div>
        <div class="room-grid">${shown.map((q) => {
          const stay = q.status === 'ocupado' ? inHouse.find((r) => r.roomId === q.id) : null;
          return html`<button class="room-card st-${q.status}" data-room="${q.id}"><div class="room-top"><strong class="room-num">${q.numero}</strong>${roomBadge(q.status)}</div>
            <div class="room-type">${q.tipo}</div><div class="room-meta">${icon('users', 14)} até ${q.capacidade} · ${brl(q.diaria)}/diária</div>
            ${stay ? html`<div class="room-guest">${Store.guest(stay.guestId).nome}<small>até ${fmtDate(stay.checkout)}</small></div>` : ''}</button>`;
        })}</div>`);
    }

    function open(id) {
      const q = id ? Store.room(id) : { tipo: 'Standard', capacidade: 2, diaria: 150, andar: 1, numero: '', descricao: '', status: 'livre' };
      const manager = NP.Auth.isManager();
      const stay = id && q.status === 'ocupado' ? Store.state.reservations.find((r) => r.roomId === id && r.status === 'hospedado') : null;
      const hasHistory = id && Store.state.reservations.some((r) => r.roomId === id);
      const m = UI.modal({
        title: id ? `Quarto ${q.numero}` : 'Novo quarto', size: 'md',
        body: html`<form class="stack" novalidate>
          ${id ? html`<div class="row-between"><span>Situação atual: ${roomBadge(q.status)}</span>${stay ? html`<a class="btn btn-sm" href="#/hospedagem/${stay.id}" data-close>Ver hospedagem</a>` : ''}</div>` : ''}
          <div class="grid-2">
            ${field('Número', 'numero', { value: q.numero, maxlength: 6, disabled: !manager })}
            ${field('Tipo', 'tipo', { options: TIPOS, value: q.tipo, disabled: !manager })}
            ${field('Capacidade (pessoas)', 'capacidade', { type: 'number', min: 1, max: 10, value: q.capacidade, disabled: !manager })}
            ${field('Diária (R$)', 'diaria', { value: moneyStr(q.diaria), mask: 'money', inputmode: 'numeric', disabled: !manager })}
            ${field('Andar', 'andar', { type: 'number', min: 0, max: 20, value: q.andar, disabled: !manager })}
            ${field('Observações', 'descricao', { value: q.descricao || '', disabled: !manager })}
          </div>
          ${id ? html`<div class="status-actions">${q.status === 'limpeza' ? html`<button type="button" class="btn btn-success" data-st="livre">${icon('check')} Marcar como limpo (liberar)</button>` : ''}${q.status === 'manutencao' ? html`<button type="button" class="btn btn-success" data-st="livre">${icon('check')} Liberar da manutenção</button>` : ''}${q.status === 'livre' || q.status === 'limpeza' ? html`<button type="button" class="btn" data-st="manutencao">Enviar para manutenção</button>` : ''}</div>` : ''}
        </form>`,
        footer: html`${id && manager && !hasHistory && q.status !== 'ocupado' ? html`<button type="button" class="btn btn-danger-ghost push-left" data-del>Excluir</button>` : ''}<button type="button" class="btn" data-close>Fechar</button>${manager ? html`<button type="button" class="btn btn-primary" data-save>Salvar</button>` : ''}`,
      });
      const form = $('form', m.body);
      m.el.addEventListener('click', async (e) => {
        const st = e.target.closest('[data-st]');
        try {
          if (st) { await Store.setRoomStatus(id, st.dataset.st); UI.toast(`Quarto ${q.numero}: ${ROOM_STATUS[st.dataset.st][0].toLowerCase()}.`); m.close(); }
          if (e.target.closest('[data-del]') && await UI.confirmDialog({ title: 'Excluir quarto', message: `Excluir o quarto ${q.numero}? Esta ação não pode ser desfeita.`, confirmText: 'Excluir', danger: true })) {
            await Store.deleteRoom(id);
            m.close();
          }
        } catch (err) { NP.Api.showError(err); }
        if (e.target.closest('[data-save]')) save();
      });
      form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
      async function save() {
        const d = formData(form);
        const errors = {};
        if (!/^[A-Za-z0-9-]{1,6}$/.test(d.numero)) errors.numero = 'Informe o número (letras/números, até 6).';
        else if (Store.state.rooms.some((r) => r.numero.toLowerCase() === d.numero.toLowerCase() && r.id !== id)) errors.numero = 'Já existe um quarto com este número.';
        const cap = Number(d.capacidade);
        if (!Number.isInteger(cap) || cap < 1 || cap > 10) errors.capacidade = 'Capacidade de 1 a 10.';
        const diaria = parseMoney(d.diaria);
        if (!(diaria > 0)) errors.diaria = 'Informe a diária.';
        if (!showErrors(form, errors)) return;
        try {
          await Store.saveRoom({ ...(id ? { id } : {}), numero: d.numero, tipo: d.tipo, capacidade: cap, diaria, andar: Number(d.andar) || 0, descricao: d.descricao });
          UI.toast('Quarto salvo.');
          m.close();
        } catch (err) { NP.Api.showError(err, form); }
      }
    }

    root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-filter]'), r = e.target.closest('[data-room]');
      if (f) { filter = f.dataset.filter; draw(); }
      else if (r) open(r.dataset.room);
      else if (e.target.closest('[data-new]')) open(null);
    });
    const off = NP.Common.onStore(root, draw);
    draw();
    return { destroy: off };
  };
})();
