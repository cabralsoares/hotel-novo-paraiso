/* Configurações (somente gerente): hotel, recebimentos, usuários, dados e auditoria */
(function () {
  const NP = window.NP;
  const { html, mount, icon, fmtDateTime, field, showErrors, formData, $, parseMoney, moneyStr, maskCNPJ, maskPhone, UFS } = NP.U;
  const { pageHead, empty, badge } = NP.Common;
  const Store = NP.Store, UI = NP.UI, Auth = NP.Auth, Api = NP.Api, V = NP.Validators;
  const TABS = [['hotel', 'Hotel'], ['receb', 'Recebimentos'], ['usuarios', 'Usuários e segurança'], ['dados', 'Dados e backup'], ['auditoria', 'Auditoria']];

  function userDialog(onDone) {
    const m = UI.modal({
      title: 'Novo usuário', size: 'md',
      body: html`<form class="stack" novalidate autocomplete="off">
        ${field('Nome', 'nome', { mask: 'name' })}
        <div class="grid-2">${field('Usuário (login)', 'usuario', { autocapitalize: 'none' })}${field('Perfil', 'perfil', { options: [['recepcao', 'Recepção'], ['gerente', 'Gerente']] })}</div>
        ${field('Senha', 'senha', { type: 'password', autocomplete: 'new-password', hint: 'Mínimo 8 caracteres, com letras e números.' })}
        <div class="hidden" data-pin>${field('PIN de autorização (4 a 6 números)', 'pin', { type: 'password', mask: 'pin', inputmode: 'numeric', autocomplete: 'new-password' })}</div>
      </form>`,
      footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>Criar usuário</button>`,
    });
    const form = $('form', m.body);
    form.addEventListener('change', (e) => { if (e.target.name === 'perfil') $('[data-pin]', form).classList.toggle('hidden', e.target.value !== 'gerente'); });
    const save = async () => {
      const d = formData(form), errors = {};
      if (d.nome.length < 3) errors.nome = 'Informe o nome.';
      if (!/^[a-z0-9._-]{3,20}$/i.test(d.usuario)) errors.usuario = 'Use 3 a 20 letras, números, ponto, hífen ou _.';
      const pw = Auth.validatePassword(d.senha, d.usuario); if (pw) errors.senha = pw;
      if (d.perfil === 'gerente') { const pn = Auth.validatePin(d.pin); if (pn) errors.pin = pn; }
      if (!showErrors(form, errors)) return;
      try { await Auth.createUser({ nome: d.nome, usuario: d.usuario, senha: d.senha, perfil: d.perfil, pin: d.pin }); UI.toast('Usuário criado.'); m.close(); onDone(); }
      catch (err) { Api.showError(err, form); }
    };
    $('[data-save]', m.foot).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  function resetPasswordDialog(user) {
    const m = UI.modal({
      title: `Redefinir senha — ${user.nome}`, size: 'sm',
      body: html`<form class="stack" novalidate autocomplete="off">${field('Nova senha', 'senha', { type: 'password', autocomplete: 'new-password', hint: 'Mínimo 8 caracteres, com letras e números. A pessoa será desconectada.' })}</form>`,
      footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>Redefinir</button>`,
    });
    const form = $('form', m.body);
    const save = async () => {
      try { await Auth.resetPassword(user.id, $('[name=senha]', form).value); UI.toast('Senha redefinida.'); m.close(); }
      catch (err) { Api.showError(err, form); }
    };
    $('[data-save]', m.foot).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  NP.Views.config = function (root) {
    let tab = 'hotel', users = [], audit = [], loading = false;
    const sections = {
      hotel() {
        const h = Store.state.config.hotel;
        return html`<form class="card form-scope" data-form="hotel" novalidate>
          <h2>Dados do hotel</h2><p class="muted">Aparecem nas fichas, recibos e fechamentos impressos.</p>
          <div class="grid-2">
            ${field('Nome', 'nome', { value: h.nome, cls: 'span-2' })}
            ${field('Cidade', 'cidade', { value: h.cidade })}${field('UF', 'uf', { options: UFS, value: h.uf })}
            ${field('CNPJ (opcional)', 'cnpj', { value: h.cnpj ? maskCNPJ(h.cnpj) : '', mask: 'cnpj', inputmode: 'numeric' })}
            ${field('Telefone', 'telefone', { value: h.telefone ? maskPhone(h.telefone) : '', mask: 'phone', inputmode: 'tel' })}
            ${field('E-mail', 'email', { type: 'email', value: h.email })}${field('Endereço', 'endereco', { value: h.endereco })}
          </div><div class="actions"><button class="btn btn-primary" type="submit">Salvar</button></div></form>`;
      },
      receb() {
        const c = Store.state.config, r = c.regras, k = V.parsePixKey(c.pix.chave);
        return html`<form class="card form-scope" data-form="pix" novalidate>
            <h2>PIX</h2><p class="muted">Chave que recebe os pagamentos. O QR Code do check-in usa estes dados. <strong>Trocar a chave exige o PIN do gerente</strong>, porque ela define para onde vai o dinheiro do hotel.</p>
            <div class="grid-2">${field('Chave PIX', 'chave', { value: c.pix.chave, cls: 'span-2', hint: k ? `Chave reconhecida: ${k.tipo}` : 'CPF, CNPJ, e-mail, celular com DDD ou chave aleatória.' })}
              ${field('Nome do recebedor (até 25)', 'recebedor', { value: c.pix.recebedor, maxlength: 25 })}${field('Cidade (até 15)', 'cidade', { value: c.pix.cidade, maxlength: 15 })}</div>
            <div class="actions"><button class="btn btn-primary" type="submit">Salvar PIX</button></div></form>
          <form class="card form-scope" data-form="regras" novalidate>
            <h2>Regras de cobrança</h2>
            <div class="grid-3">
              ${field('Entrada mínima no check-in (%)', 'entradaMinimaPct', { type: 'number', min: 0, max: 100, value: r.entradaMinimaPct })}
              ${field('Desconto máximo sem gerente (%)', 'descontoMaxPct', { type: 'number', min: 0, max: 100, value: r.descontoMaxPct })}
              ${field('Pagamento acima de (R$) exige gerente', 'limiteGerente', { value: moneyStr(r.limiteGerente), mask: 'money', inputmode: 'numeric' })}
              ${field('Máximo de parcelas (crédito)', 'maxParcelas', { type: 'number', min: 1, max: 12, value: r.maxParcelas })}
              ${field('Parcela mínima (R$)', 'parcelaMinima', { value: moneyStr(r.parcelaMinima), mask: 'money', inputmode: 'numeric' })}
              <div></div>
              ${field('Horário de check-in', 'checkinHora', { type: 'time', value: r.checkinHora })}${field('Horário de check-out', 'checkoutHora', { type: 'time', value: r.checkoutHora })}
            </div><div class="actions"><button class="btn btn-primary" type="submit">Salvar regras</button></div></form>
          <section class="card"><h2>Autorizador de cartão</h2>
            ${Store.state.modoGateway === 'simulacao'
              ? html`<div class="notice notice-warn">${icon('alert', 20)}<div><strong>Modo simulação.</strong> As autorizações de crédito/débito são simuladas: nenhum cartão é cobrado de verdade. Para cobrar de verdade é preciso integrar uma maquininha ou gateway de pagamento (Mercado Pago, Stone, Cielo, Pagar.me, Efí…). O ponto de troca é o arquivo <code>public/js/gateway.js</code>, usado pelo servidor.</div></div>`
              : html`<p>Autorizador: <strong>${Store.state.modoGateway}</strong></p>`}</section>`;
      },
      usuarios() {
        const me = Auth.current();
        return html`<section class="card flush"><div class="card-head"><h2>Usuários</h2><button class="btn btn-primary btn-sm" data-new-user>${icon('plus', 16)} Novo usuário</button></div>
          ${loading ? html`<p class="muted" style="padding:18px 20px">Carregando…</p>` : html`<div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th></th></tr></thead><tbody>
          ${users.map((u) => html`<tr><td><strong>${u.nome}</strong>${u.id === me.id ? html` <small class="muted">(você)</small>` : ''}</td><td class="mono">${u.usuario}</td><td>${u.perfil === 'gerente' ? 'Gerente' : 'Recepção'}</td><td>${u.ativo ? badge('ok', 'Ativo') : badge('muted', 'Desativado')}</td>
            <td class="actions-cell"><button class="btn btn-sm" data-reset="${u.id}">Redefinir senha</button>${u.id !== me.id ? html`<button class="btn btn-sm btn-ghost" data-toggle="${u.id}">${u.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}</td></tr>`)}
          </tbody></table></div>`}</section>
          <div class="cols-2">
            <form class="card form-scope" data-form="senha" novalidate autocomplete="off"><h2>Minha senha</h2>
              ${field('Senha atual', 'atual', { type: 'password', autocomplete: 'current-password' })}${field('Nova senha', 'nova', { type: 'password', autocomplete: 'new-password' })}
              <div class="actions"><button class="btn btn-primary" type="submit">Alterar senha</button></div></form>
            <form class="card form-scope" data-form="pin" novalidate autocomplete="off"><h2>Meu PIN de autorização</h2>
              <p class="muted">Usado para autorizar descontos, estornos, faturamentos e valores altos.</p>
              ${field('Senha de login', 'senha', { type: 'password', autocomplete: 'current-password' })}${field('Novo PIN (4 a 6 números)', 'pin', { type: 'password', mask: 'pin', inputmode: 'numeric', autocomplete: 'new-password' })}
              <div class="actions"><button class="btn btn-primary" type="submit">Alterar PIN</button></div></form>
          </div>`;
      },
      dados() {
        const s = Store.state;
        return html`<section class="card"><h2>Banco de dados do hotel</h2>
            <p>Os dados ficam no <strong>banco de dados próprio do hotel, no servidor</strong> (separado de qualquer outro sistema). Hoje: ${s.guests.length} hóspedes · ${s.reservations.length} reservas · ${s.payments.length} pagamentos.</p>
            <p class="muted">O servidor guarda um backup automático por dia (últimos 14) na pasta <code>backups</code> dos dados. Você também pode baixar uma cópia a qualquer momento — o arquivo contém hóspedes e usuários, guarde em local seguro. Números de cartão nunca são gravados.</p>
            <div class="actions left"><button class="btn btn-primary" data-export>${icon('download')} Baixar backup do banco (.db)</button></div>
            <p class="muted small">Para restaurar um backup, use o comando de restauração no servidor (veja o LEIA-ME).</p></section>
          <section class="card"><h2>Dados de exemplo e limpeza</h2>
            <div class="actions left"><button class="btn" data-demo ${s.guests.length || s.reservations.length ? 'disabled' : ''}>Carregar dados de exemplo</button><button class="btn btn-danger-ghost" data-clear>Apagar hóspedes, reservas e pagamentos</button></div>
            <p class="muted small">"Carregar exemplo" só funciona com o sistema vazio. Apagar mantém quartos, configurações, usuários e a auditoria, e exige PIN e confirmação por escrito.</p></section>`;
      },
      auditoria() {
        return html`<section class="card flush"><div class="card-head"><h2>Auditoria</h2><span class="muted small">últimos ${audit.length} eventos</span></div>${loading ? html`<p class="muted" style="padding:18px 20px">Carregando…</p>` : audit.length ? html`<div class="table-wrap"><table class="table tight"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th><th>Autorizado por</th></tr></thead><tbody>
          ${audit.map((a) => html`<tr><td>${fmtDateTime(a.em)}</td><td>${a.operador}</td><td><strong>${a.acao}</strong></td><td>${a.detalhe}</td><td>${a.por || '—'}</td></tr>`)}</tbody></table></div>` : empty('Sem eventos ainda.', 'log')}</section>`;
      },
    };

    function draw() {
      mount(root, html`${pageHead('Configurações', 'Somente gerentes têm acesso')}
        <div class="seg tabs" role="tablist">${TABS.map(([k, l]) => html`<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`)}</div>${sections[tab]()}`);
    }

    async function loadTab() {
      if (tab !== 'usuarios' && tab !== 'auditoria') return draw();
      loading = true; draw();
      try {
        if (tab === 'usuarios') users = await Auth.listUsers(); else audit = (await Api.get('/api/auditoria?limite=300')).eventos;
      } catch (err) { Api.showError(err); }
      loading = false; draw();
    }

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.dataset.tab) { tab = b.dataset.tab; await loadTab(); }
        else if (b.hasAttribute('data-new-user')) userDialog(loadTab);
        else if (b.dataset.reset) resetPasswordDialog(users.find((u) => u.id === b.dataset.reset));
        else if (b.dataset.toggle) { const u = users.find((x) => x.id === b.dataset.toggle); await Auth.setActive(u.id, !u.ativo); await loadTab(); }
        else if (b.hasAttribute('data-export')) { await UI.busy(b, () => Api.withAuth((tok) => Store.downloadBackup(tok))); UI.toast('Backup baixado.'); }
        else if (b.hasAttribute('data-demo')) { await Store.loadDemo(); UI.toast('Dados de exemplo carregados.'); }
        else if (b.hasAttribute('data-clear')) {
          const ok = await UI.confirmDialog({ title: 'Apagar dados?', message: 'Todos os hóspedes, reservas e pagamentos serão apagados (a auditoria é mantida). Baixe um backup antes. O PIN do gerente será pedido.', confirmText: 'Continuar', danger: true });
          if (ok) { await Api.withAuth((tok) => Store.clearData(tok)); UI.toast('Dados apagados.'); }
        }
      } catch (err) { Api.showError(err); }
    });

    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, kind = f.dataset.form, d = formData(f), errors = {};
      try {
        if (kind === 'hotel') {
          if (d.nome.length < 3) errors.nome = 'Informe o nome do hotel.';
          if (d.cidade.length < 2) errors.cidade = 'Informe a cidade.';
          if (V.digits(d.cnpj) && !V.isCNPJ(d.cnpj)) errors.cnpj = 'CNPJ inválido.';
          if (d.telefone && !V.isPhone(d.telefone)) errors.telefone = 'Telefone inválido.';
          if (d.email && !V.isEmail(d.email)) errors.email = 'E-mail inválido.';
          if (!showErrors(f, errors)) return;
          await Store.saveConfig('hotel', { nome: d.nome, cidade: d.cidade, uf: d.uf, cnpj: V.digits(d.cnpj), telefone: V.digits(d.telefone), email: d.email, endereco: d.endereco });
          UI.toast('Dados do hotel salvos.');
        } else if (kind === 'pix') {
          const k = V.parsePixKey(d.chave);
          if (d.chave && !k) errors.chave = 'Chave PIX inválida. Confira o CPF/CNPJ, e-mail, celular com DDD ou chave aleatória.';
          if (d.recebedor.length < 2) errors.recebedor = 'Informe o nome do recebedor.';
          if (d.cidade.length < 2) errors.cidade = 'Informe a cidade.';
          if (!showErrors(f, errors)) return;
          await Api.withAuth((tok) => Store.saveConfig('pix', { chave: d.chave, recebedor: d.recebedor, cidade: d.cidade }, tok));
          UI.toast('PIX salvo.');
        } else if (kind === 'regras') {
          const n = (x) => Number(x);
          const lim = parseMoney(d.limiteGerente), pm = parseMoney(d.parcelaMinima);
          if (!(n(d.entradaMinimaPct) >= 0 && n(d.entradaMinimaPct) <= 100)) errors.entradaMinimaPct = 'De 0 a 100.';
          if (!(n(d.descontoMaxPct) >= 0 && n(d.descontoMaxPct) <= 100)) errors.descontoMaxPct = 'De 0 a 100.';
          if (!Number.isInteger(n(d.maxParcelas)) || n(d.maxParcelas) < 1 || n(d.maxParcelas) > 12) errors.maxParcelas = 'De 1 a 12.';
          if (!(pm >= 1)) errors.parcelaMinima = 'Mínimo R$ 1,00.';
          if (!(lim >= 0)) errors.limiteGerente = 'Valor inválido.';
          if (!d.checkinHora) errors.checkinHora = 'Informe o horário.';
          if (!d.checkoutHora) errors.checkoutHora = 'Informe o horário.';
          if (!showErrors(f, errors)) return;
          await Store.saveConfig('regras', { entradaMinimaPct: n(d.entradaMinimaPct), descontoMaxPct: n(d.descontoMaxPct), limiteGerente: lim, maxParcelas: n(d.maxParcelas), parcelaMinima: pm, checkinHora: d.checkinHora, checkoutHora: d.checkoutHora });
          UI.toast('Regras salvas.');
        } else if (kind === 'senha') {
          await Auth.changePassword(d.atual, d.nova);
          UI.toast('Senha alterada.'); f.reset(); showErrors(f, {});
        } else if (kind === 'pin') {
          const pn = Auth.validatePin(d.pin);
          if (pn) return showErrors(f, { pin: pn });
          await Auth.changePin(d.senha, d.pin);
          UI.toast('PIN alterado.'); f.reset(); showErrors(f, {});
        }
      } catch (err) { Api.showError(err, f); }
    });

    // atualizações vindas de outro computador não podem apagar o que está sendo digitado
    const off = Store.on((s, origin) => {
      const a = document.activeElement;
      if (origin === 'remote' && root.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
      if (!loading) draw();
    });
    draw();
    return { destroy: off };
  };
})();
