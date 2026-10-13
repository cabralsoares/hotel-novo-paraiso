/* Hóspedes */
(function () {
  const NP = window.NP;
  const { html, mount, icon, fmtDate, maskPhone, maskCPF, $ } = NP.U;
  const { pageHead, empty, norm } = NP.Common;
  const Store = NP.Store, UI = NP.UI, GF = NP.GuestForm, V = NP.Validators;

  const docText = (g) => (g.docTipo === 'cpf' ? maskCPF(g.doc) : `${g.docTipo === 'rg' ? 'RG' : 'Pass.'} ${g.doc}`);

  /** Abre o cadastro/edição de hóspede. onSaved(id) é opcional. */
  function openGuest(id, onSaved) {
    const g = id ? Store.guest(id) : {};
    const m = UI.modal({
      title: id ? 'Editar hóspede' : 'Novo hóspede', size: 'lg',
      body: html`<form novalidate>${GF.render(g)}</form>`,
      footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>Salvar</button>`,
    });
    const form = $('form', m.body);
    GF.bind(form);
    const save = async () => {
      const data = GF.read(form);
      if (!NP.U.showErrors(form, GF.validate(data, { ignoreId: id }))) return;
      try {
        const newId = await Store.saveGuest(id ? { ...data, id } : data);
        UI.toast('Hóspede salvo.');
        m.close();
        if (onSaved) onSaved(newId);
      } catch (err) { NP.Api.showError(err, form); }
    };
    $('[data-save]', m.foot).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  NP.Views.hospedes = function (root) {
    let q = '';
    function draw(keepFocus) {
      const st = Store.state;
      const term = norm(q), digits = V.digits(q);
      const list = [...st.guests].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).filter((g) => !term || norm(g.nome).includes(term) || (digits && (g.doc.includes(digits) || g.telefone.includes(digits))));
      mount(root, html`
        ${pageHead('Hóspedes', `${st.guests.length} cadastrados`, html`<button class="btn btn-primary" data-new>${icon('plus')} Novo hóspede</button>`)}
        <div class="toolbar"><label class="search">${icon('search', 18)}<input type="search" placeholder="Buscar por nome, CPF ou telefone" value="${q}" data-q aria-label="Buscar hóspede"></label></div>
        <div class="card flush">${list.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th>Documento</th><th>Telefone</th><th>Cidade</th><th class="num">Estadias</th><th></th></tr></thead><tbody>
          ${list.map((g) => { const n = st.reservations.filter((r) => r.guestId === g.id && r.status !== 'cancelada').length; return html`<tr><td><strong>${g.nome}</strong></td><td>${docText(g)}</td><td>${maskPhone(g.telefone)}</td><td>${g.cidade}/${g.uf}</td><td class="num">${n}</td><td class="actions-cell"><button class="btn btn-sm" data-edit="${g.id}">${icon('edit', 15)} Editar</button></td></tr>`; })}
        </tbody></table></div>` : empty(q ? 'Nenhum hóspede encontrado.' : 'Nenhum hóspede cadastrado ainda.', 'users')}</div>`);
      if (keepFocus) { const i = $('[data-q]', root); i.focus(); i.setSelectionRange(q.length, q.length); }
    }
    root.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { q = e.target.value; draw(true); } });
    root.addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) openGuest(ed.dataset.edit);
      else if (e.target.closest('[data-new]')) openGuest(null);
    });
    const off = NP.Common.onStore(root, () => draw(false));
    draw();
    return { destroy: off };
  };

  NP.openGuest = openGuest;
})();
