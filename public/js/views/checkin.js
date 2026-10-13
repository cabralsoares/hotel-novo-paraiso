/* Check-in: hóspede → estadia → pagamento (validação + autorização) → confirmação */
(function () {
  const NP = window.NP;
  const { html, mount, icon, brl, fmtDate, field, showErrors, formData, $, $$, moneyStr, plural } = NP.U;
  const { pageHead, empty, norm, roomBadge, payBadge } = NP.Common;
  const Store = NP.Store, UI = NP.UI, Core = NP.Core, GF = NP.GuestForm, Pay = NP.Payments, V = NP.Validators;
  const STEPS = ['Hóspede', 'Estadia', 'Pagamento', 'Confirmação'];
  const live = (p) => p.status === 'autorizado' || p.status === 'faturado';

  NP.Views.checkin = function (root, params) {
    const T = Core.today();
    const regras = () => Store.state.config.regras;
    // "rascunho" identifica este check-in no servidor: os pagamentos recebidos antes da reserva existir ficam presos a ele
    const newDraft = () => 'rc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const blank = () => ({ step: 1, mode: 'reserva', rascunho: newDraft(), reservaId: null, guestId: null, guest: {}, roomId: '', checkout: Core.addDays(T, 1), adultos: 2, criancas: 0, descontoPct: 0, descontoAutorizadoPct: 0, descontoAutorizadoPor: '', descontoToken: '', placa: '', obs: '', payments: [], semEntradaAutorizadaPor: '', semEntradaToken: '', aceite: false, done: null, qr: '', gq: '' });
    let D = blank();
    let panel = null;

    /* ---------- Cálculos ---------- */
    const room = () => Store.room(D.roomId);
    const baseRes = () => D.reservaId ? Store.reservation(D.reservaId) : null;
    const diariaOf = () => { const r = baseRes(); return r && r.roomId === D.roomId ? r.diaria : (room() ? room().diaria : 0); };
    const draftRes = () => ({ id: '__draft', checkin: T, checkout: D.checkout, diaria: diariaOf(), descontoPct: D.descontoPct, consumos: [] });
    const draftTotals = () => Core.stayTotals(draftRes(), D.payments.map((p) => ({ ...p, reservaId: '__draft' })));
    const minEntry = () => Core.entradaMinima(draftTotals().total, regras().entradaMinimaPct);
    const entryMet = () => !!D.semEntradaAutorizadaPor || draftTotals().pago + 0.004 >= minEntry();

    function pickReservation(id) {
      const r = Store.reservation(id);
      Object.assign(D, { mode: 'reserva', reservaId: id, guestId: r.guestId, guest: { ...Store.guest(r.guestId) }, roomId: r.roomId, checkout: r.checkout > T ? r.checkout : Core.addDays(T, 1), adultos: r.adultos, criancas: r.criancas, descontoPct: r.descontoPct || 0, placa: r.placa || '', obs: r.obs || '' });
      draw();
    }
    function pickGuest(id) { D.guestId = id; D.guest = { ...Store.guest(id) }; draw(); }

    /* ---------- Coleta de cada etapa ---------- */
    function collect1() { const f = $('[data-guestform]', root); if (f) D.guest = GF.read(f); }
    function collect2() {
      const g = (n) => { const el = $(`[name=${n}]`, root); return el ? el.value.trim() : null; };
      if (g('checkout') != null) D.checkout = g('checkout');
      if (g('adultos') != null) D.adultos = Number(g('adultos'));
      if (g('criancas') != null) D.criancas = Number(g('criancas'));
      if (g('descontoPct') != null) D.descontoPct = Number(g('descontoPct'));
      if (g('placa') != null) D.placa = g('placa').toUpperCase();
      if (g('obs') != null) D.obs = g('obs');
      const rid = $('[name=roomId]:checked', root); if (rid) D.roomId = rid.value;
    }

    /* ---------- Desenho ---------- */
    function stepper() {
      return html`<ol class="stepper" aria-label="Etapas do check-in">${STEPS.map((s, i) => html`<li class="${D.step === i + 1 ? 'is-current' : D.step > i + 1 || D.done ? 'is-done' : ''}"${NP.U.attrs({ 'aria-current': D.step === i + 1 ? 'step' : null })}><span class="step-n">${D.step > i + 1 || D.done ? icon('check', 14) : i + 1}</span><span class="step-t">${s}</span></li>`)}</ol>`;
    }

    function draw() {
      if (panel) { panel.destroy(); panel = null; }
      if (D.done) return drawDone();
      const body = [step1, step2, step3, step4][D.step - 1]();
      mount(root, html`${pageHead('Check-in', 'Registro de entrada, pagamento e liberação do quarto')}${stepper()}${body}`);
      afterDraw();
    }

    /* --- Etapa 1: hóspede --- */
    function step1() {
      const showForm = D.mode === 'balcao' || D.reservaId;
      return html`<section class="card step-card">
        <div class="seg" role="tablist"><button type="button" role="tab" data-mode="reserva" aria-selected="${D.mode === 'reserva'}">${icon('calendar', 16)} Tenho reserva</button><button type="button" role="tab" data-mode="balcao" aria-selected="${D.mode === 'balcao'}">${icon('user', 16)} Hóspede sem reserva</button></div>
        ${D.mode === 'reserva' ? html`
          <label class="search">${icon('search', 18)}<input type="search" data-qr placeholder="Buscar reserva por hóspede ou código" value="${D.qr}" aria-label="Buscar reserva"></label>
          <div class="pick-list" data-res-list>${reservationResults()}</div>`
        : html`
          <label class="search">${icon('search', 18)}<input type="search" data-gq placeholder="Buscar hóspede já cadastrado (nome, CPF ou telefone)" value="${D.gq}" aria-label="Buscar hóspede"></label>
          <div class="pick-list" data-guest-list>${guestResults()}</div>`}
        ${showForm ? html`<h2 class="sub">Dados do hóspede responsável ${D.guestId ? NP.Common.badge('info', 'Cadastro existente') : NP.Common.badge('muted', 'Novo cadastro')}</h2>${GF.render(D.guest)}` : ''}
        <div class="step-nav"><a class="btn" href="#/painel" data-cancel>Cancelar</a><button type="button" class="btn btn-primary" data-next ${showForm ? '' : 'disabled'}>Continuar ${icon('right', 16)}</button></div>
      </section>`;
    }
    function reservationResults() {
      const term = norm(D.qr);
      const pending = Store.state.reservations.filter((r) => r.status === 'reservada').sort((a, b) => a.checkin.localeCompare(b.checkin))
        .filter((r) => !term || norm(Store.guest(r.guestId).nome).includes(term) || norm(r.codigo).includes(term));
      if (!pending.length) return empty(term ? 'Nenhuma reserva encontrada.' : 'Não há reservas pendentes. Use "Hóspede sem reserva".', 'calendar');
      return pending.map((r) => { const g = Store.guest(r.guestId), q = Store.room(r.roomId); return html`<button type="button" class="pick ${D.reservaId === r.id ? 'is-picked' : ''}" data-pick-res="${r.id}"><div><strong>${g.nome}</strong><small>${r.codigo} · Quarto ${q.numero} · ${fmtDate(r.checkin)} → ${fmtDate(r.checkout)}</small></div>${r.checkin === T ? NP.Common.badge('ok', 'Hoje') : r.checkin < T ? NP.Common.badge('warn', 'Atrasada') : NP.Common.badge('muted', fmtDate(r.checkin))}</button>`; });
    }
    function guestResults() {
      const term = norm(D.gq), dig = V.digits(D.gq);
      if (!term) return html`<p class="muted small">Digite para buscar. Se for a primeira visita, preencha os dados abaixo.</p>`;
      const list = Store.state.guests.filter((g) => norm(g.nome).includes(term) || (dig && (g.doc.includes(dig) || g.telefone.includes(dig)))).slice(0, 5);
      return list.length ? list.map((g) => html`<button type="button" class="pick ${D.guestId === g.id ? 'is-picked' : ''}" data-pick-guest="${g.id}"><div><strong>${g.nome}</strong><small>${g.docTipo === 'cpf' ? NP.U.maskCPF(g.doc) : g.doc} · ${g.cidade}/${g.uf}</small></div></button>`) : html`<p class="muted small">Ninguém encontrado — preencha o cadastro abaixo.</p>`;
    }

    /* --- Etapa 2: estadia --- */
    function step2() {
      const avail = Core.availableRooms(Store.state, T, D.checkout, { ignoreResId: D.reservaId, onlyClean: true }).filter((q) => q.capacidade >= D.adultos + D.criancas).sort((a, b) => a.numero.localeCompare(b.numero, 'pt', { numeric: true }));
      const reserved = baseRes() ? Store.room(baseRes().roomId) : null;
      const blocked = reserved && !avail.some((q) => q.id === reserved.id) ? reserved : null;
      const t = Core.stayTotals(draftRes(), []);
      return html`<section class="card step-card">
        <div class="grid-3">
          <div class="field"><span class="lbl">Check-in</span><div class="static-value">Hoje, ${fmtDate(T)} · a partir das ${regras().checkinHora}</div></div>
          ${field('Check-out', 'checkout', { type: 'date', value: D.checkout, min: Core.addDays(T, 1) })}
          ${field('Adultos', 'adultos', { type: 'number', min: 1, max: 8, value: D.adultos })}
          ${field('Crianças', 'criancas', { type: 'number', min: 0, max: 8, value: D.criancas })}
        </div>
        ${blocked ? html`<div class="notice notice-warn">${icon('alert', 20)}<div><strong>O quarto reservado (${blocked.numero}) não pode receber o hóspede agora</strong> — ${blocked.status === 'limpeza' ? 'está em limpeza.' : blocked.status === 'ocupado' ? 'ainda está ocupado.' : blocked.status === 'manutencao' ? 'está em manutenção.' : 'tem conflito de datas.'}
          ${blocked.status === 'limpeza' ? html`<br><button type="button" class="btn btn-sm" data-free-room="${blocked.id}">${icon('check', 14)} Marcar como limpo e liberar</button>` : html`<br>Escolha outro quarto abaixo.`}</div></div>` : ''}
        <h2 class="sub">Quarto <small class="muted">${plural(avail.length, 'disponível', 'disponíveis')} agora</small></h2>
        <div class="room-pick" role="radiogroup" aria-label="Quarto">${avail.length ? avail.map((q) => html`<label class="room-option"><input type="radio" name="roomId" value="${q.id}" ${D.roomId === q.id ? 'checked' : ''}><span><strong>${q.numero}</strong> ${q.tipo}<small>até ${q.capacidade} pessoas</small><em>${brl(baseRes() && baseRes().roomId === q.id ? baseRes().diaria : q.diaria)}</em></span></label>`) : empty('Nenhum quarto livre para este período e número de pessoas.', 'bed')}</div>
        <small class="err" data-err="roomId" role="alert"></small>
        <div class="grid-3">
          ${field('Desconto na diária (%)', 'descontoPct', { type: 'number', min: 0, max: 100, step: 1, value: D.descontoPct, hint: `Acima de ${regras().descontoMaxPct}% precisa do PIN do gerente.` })}
          ${field('Placa do veículo (opcional)', 'placa', { value: D.placa, mask: 'plate', placeholder: 'ABC1D23' })}
          ${field('Observações', 'obs', { value: D.obs, maxlength: 200 })}
        </div>
        <div class="summary">${room() ? html`<span>${plural(t.noites, 'diária', 'diárias')} × ${brl(diariaOf())}${t.desconto ? ` − ${brl(t.desconto)} de desconto` : ''}</span><strong>Total: ${brl(t.total)}</strong>` : html`<span class="muted">Escolha um quarto para ver o total.</span>`}</div>
        <div class="step-nav"><button type="button" class="btn" data-back>${icon('left', 16)} Voltar</button><button type="button" class="btn btn-primary" data-next>Continuar ${icon('right', 16)}</button></div>
      </section>`;
    }

    /* --- Etapa 3: pagamento --- */
    function paymentList() {
      return D.payments.length ? html`<ul class="pay-list">${D.payments.map((p) => html`<li class="${p.status === 'recusado' || p.status === 'estornado' ? 'is-void' : ''}"><div><strong>${Pay.METHOD_NAME[p.metodo]}</strong><small>${Pay.describe(p)}${p.autorizadoPor ? ` · autorizado por ${p.autorizadoPor}` : ''}</small></div><div class="pay-list-end"><span>${brl(p.valor)}</span>${payBadge(p.status)}${live(p) ? html`<button type="button" class="btn btn-sm btn-ghost" data-void="${p.id}">Estornar</button>` : ''}</div></li>`)}</ul>` : html`<p class="muted small">Nenhum pagamento lançado ainda.</p>`;
    }
    function paySummary() {
      const t = draftTotals(), min = minEntry(), faltaMin = Math.max(0, Core.round2(min - t.pago));
      return html`<div class="pay-summary">
        <div><span>Total da hospedagem</span><strong>${brl(t.total)}</strong></div>
        <div><span>Entrada mínima (${regras().entradaMinimaPct}%)</span><strong>${brl(min)}</strong></div>
        <div><span>Pago até agora</span><strong class="ok-text">${brl(t.pago)}</strong></div>
        <div><span>Saldo (pagar até o check-out)</span><strong>${brl(Math.max(0, t.saldo))}</strong></div>
      </div>
      <div class="notice ${entryMet() ? 'notice-ok' : 'notice-warn'}">${icon(entryMet() ? 'check' : 'alert', 20)}<div>${D.semEntradaAutorizadaPor && t.pago + 0.004 < min ? html`Check-in <strong>sem entrada</strong> autorizado por <strong>${D.semEntradaAutorizadaPor}</strong>.` : entryMet() ? 'Entrada mínima atendida. Você pode concluir o check-in ou receber mais agora.' : html`Faltam <strong>${brl(faltaMin)}</strong> para a entrada mínima.`}
        ${!entryMet() ? html`<br><button type="button" class="btn btn-sm" data-no-entry>${icon('shield', 14)} Prosseguir sem entrada (gerente)</button>` : ''}</div></div>`;
    }
    function step3() {
      return html`<section class="card step-card">
        <div data-paysummary>${paySummary()}</div>
        <div data-paylist-wrap><h2 class="sub">Pagamentos deste check-in</h2><div data-paylist>${paymentList()}</div></div>
        <h2 class="sub">Receber pagamento</h2>
        <div data-panel></div>
        <div class="step-nav"><button type="button" class="btn" data-back>${icon('left', 16)} Voltar</button><button type="button" class="btn btn-primary" data-next ${entryMet() ? '' : 'disabled'}>Continuar ${icon('right', 16)}</button></div>
      </section>`;
    }
    function refreshPaymentArea() {
      const s = $('[data-paysummary]', root), l = $('[data-paylist]', root);
      if (s) s.innerHTML = NP.U.render(paySummary());
      if (l) l.innerHTML = NP.U.render(paymentList());
      const next = $('[data-next]', root);
      if (next) next.disabled = !entryMet();
    }
    function mountPanel() {
      const box = $('[data-panel]', root);
      if (!box) return;
      panel = Pay.mount(box, {
        getBalance: () => draftTotals().saldo,
        suggestions: () => {
          const t = draftTotals(), falta = Math.max(0, Core.round2(minEntry() - t.pago));
          const out = [];
          if (falta > 0.004) out.push({ label: 'Entrada mínima', value: falta });
          out.push({ label: 'Valor total', value: t.saldo });
          return out.filter((s, i, a) => a.findIndex((x) => x.value === s.value) === i);
        },
        context: () => ({ rascunho: D.rascunho, hospede: D.guest.nome }),
        onPayment: (rec) => { D.payments.push(rec); refreshPaymentArea(); },
      });
    }

    /* --- Etapa 4: confirmação --- */
    function step4() {
      const g = D.guest, q = room(), t = draftTotals();
      return html`<section class="card step-card">
        <div class="confirm-grid">
          <div><h3>Hóspede</h3><p><strong>${g.nome}</strong><br>${g.docTipo === 'cpf' ? 'CPF ' + NP.U.maskCPF(g.doc) : g.doc}<br>${NP.U.maskPhone(g.telefone)} · ${g.cidade}/${g.uf}</p></div>
          <div><h3>Estadia</h3><p><strong>Quarto ${q.numero}</strong> · ${q.tipo}<br>${fmtDate(T)} → ${fmtDate(D.checkout)} (${plural(t.noites, 'diária', 'diárias')})<br>${D.adultos} adulto(s)${D.criancas ? `, ${D.criancas} criança(s)` : ''}${D.placa ? ` · placa ${D.placa}` : ''}</p></div>
          <div><h3>Valores</h3><p>Total <strong>${brl(t.total)}</strong>${t.desconto ? ` (desconto ${D.descontoPct}%)` : ''}<br>Pago <strong class="ok-text">${brl(t.pago)}</strong><br>Saldo no check-out <strong>${brl(Math.max(0, t.saldo))}</strong></p></div>
        </div>
        ${D.payments.length ? html`<h3 class="sub">Pagamentos</h3>${paymentList2()}` : ''}
        <label class="check big"><input type="checkbox" name="aceite" ${D.aceite ? 'checked' : ''}><span>Conferi os dados com o hóspede, que está de acordo com as regras da casa (check-out até ${regras().checkoutHora}).</span></label>
        <small class="err" data-err="aceite" role="alert"></small>
        <div class="step-nav"><button type="button" class="btn" data-back>${icon('left', 16)} Voltar</button><button type="button" class="btn btn-success btn-lg" data-finish>${icon('check', 20)} Concluir check-in</button></div>
      </section>`;
    }
    const paymentList2 = () => html`<ul class="pay-list compact">${D.payments.filter(live).map((p) => html`<li><div><strong>${Pay.METHOD_NAME[p.metodo]}</strong><small>${Pay.describe(p)}</small></div><span>${brl(p.valor)}</span></li>`)}</ul>`;

    function drawDone() {
      const r = Store.reservation(D.done), g = Store.guest(r.guestId), q = Store.room(r.roomId), t = Store.totals(r);
      mount(root, html`${pageHead('Check-in', '')}${stepper()}
        <section class="card done-card"><div class="done-icon">${icon('check', 34)}</div>
          <h2>Check-in concluído</h2>
          <p><strong>${g.nome}</strong> está no quarto <strong>${q.numero}</strong> · reserva <span class="mono">${r.codigo}</span></p>
          <p class="muted">Saída prevista em ${fmtDate(r.checkout)} · pago ${brl(t.pago)} · saldo ${brl(Math.max(0, t.saldo))}</p>
          <div class="actions center"><button class="btn btn-primary" data-print="${r.id}">${icon('printer')} Imprimir ficha de hospedagem</button><a class="btn" href="#/hospedagem/${r.id}">Abrir hospedagem</a><button class="btn" data-restart>Novo check-in</button></div>
        </section>`);
    }

    function afterDraw() {
      if (D.step === 1) { const f = $('[data-guestform]', root); if (f) GF.bind(f); }
      if (D.step === 3) { mountPanel(); }
    }

    /* ---------- Navegação entre etapas ---------- */
    async function next() {
      if (D.step === 1) {
        collect1();
        if (D.mode === 'reserva' && !D.reservaId) return UI.toast('Escolha uma reserva na lista.', 'error');
        if (!showErrors(root, GF.validate(D.guest, { ignoreId: D.guestId }))) return UI.toast('Corrija os campos destacados.', 'error');
        D.step = 2;
      } else if (D.step === 2) {
        collect2();
        const errors = {};
        const q = room();
        if (!V.isDateISO(D.checkout) || D.checkout <= T) errors.checkout = 'A saída deve ser a partir de amanhã.';
        if (!(D.adultos >= 1 && D.adultos <= 8)) errors.adultos = 'Mínimo 1 adulto.';
        if (!(D.criancas >= 0 && D.criancas <= 8)) errors.criancas = 'Valor inválido.';
        if (!Number.isInteger(D.descontoPct) || D.descontoPct < 0 || D.descontoPct > 100) errors.descontoPct = 'Use um número de 0 a 100.';
        if (D.placa && !V.isPlate(D.placa)) errors.placa = 'Placa inválida (ex.: ABC1D23).';
        if (!q) errors.roomId = 'Escolha um quarto.';
        else if (q.capacidade < D.adultos + D.criancas) errors.roomId = `Este quarto comporta até ${q.capacidade} pessoas.`;
        else if (!Core.availableRooms(Store.state, T, D.checkout, { ignoreResId: D.reservaId, onlyClean: true }).some((x) => x.id === q.id)) errors.roomId = 'Este quarto não está disponível para o período.';
        if (!showErrors(root, errors)) return;
        if (draftTotals().total + 0.004 < draftTotals().pago) return UI.toast(`O novo total (${brl(draftTotals().total)}) ficaria menor que o já pago (${brl(draftTotals().pago)}). Estorne um pagamento antes.`, 'error');
        const lim = regras().descontoMaxPct;
        if (D.descontoPct > lim && D.descontoAutorizadoPct !== D.descontoPct) {
          const m = await UI.requireManager({ motivo: 'Desconto acima do limite', detalhe: `${D.descontoPct}% na diária (limite do operador: ${lim}%)`, escopo: 'desconto', valor: D.descontoPct });
          if (!m) return UI.toast('Desconto não autorizado.', 'error');
          D.descontoAutorizadoPct = D.descontoPct; D.descontoAutorizadoPor = m.nome; D.descontoToken = m.token;
        }
        if (D.descontoPct <= lim) { D.descontoAutorizadoPct = 0; D.descontoAutorizadoPor = ''; D.descontoToken = ''; }
        D.step = 3;
      } else if (D.step === 3) {
        if (!entryMet()) return;
        D.step = 4;
      }
      draw();
      window.scrollTo({ top: 0 });
    }
    function back() {
      if (D.step === 2) { collect2(); if (D.payments.some(live)) return UI.toast('Já há pagamentos autorizados: não é possível trocar o hóspede. Estorne-os para voltar.', 'error'); }
      if (D.step === 4) { const c = $('[name=aceite]', root); if (c) D.aceite = c.checked; }
      D.step -= 1;
      draw();
    }

    async function finish() {
      const c = $('[name=aceite]', root); D.aceite = c.checked;
      if (!D.aceite) return showErrors(root, { aceite: 'Marque a confirmação para concluir.' });
      const btn = $('[data-finish]', root);
      try {
        // o servidor refaz todas as contas e confere tudo; se faltar autorização de gerente, ele avisa e pedimos o PIN
        const fichas = { desconto: D.descontoToken, sem_entrada: D.semEntradaToken };
        const id = await UI.busy(btn, () => NP.Api.withAuth((token, need) => {
          if (need) fichas[need.escopo] = token;
          return Store.checkIn({
            rascunho: D.rascunho, reservaId: D.reservaId, guestId: D.guestId, guest: D.guest, roomId: D.roomId, checkout: D.checkout, adultos: D.adultos, criancas: D.criancas,
            descontoPct: D.descontoPct, placa: D.placa, obs: D.obs, aceite: true, autDesconto: fichas.desconto, autSemEntrada: fichas.sem_entrada,
          });
        }));
        D.done = id;
        window.removeEventListener('beforeunload', warnUnload);
        draw();
        UI.toast('Check-in concluído.');
      } catch (err) {
        if (err.codigo === 'CANCELADO') return UI.toast('Check-in não concluído: faltou a autorização do gerente.', 'error');
        NP.Api.showError(err, root);
        if (err.campos) { D.step = 2; draw(); NP.U.showErrors(root, err.campos); }
      }
    }

    /* ---------- Eventos ---------- */
    root.addEventListener('click', async (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.mode) { if (D.payments.length) return; collect1(); Object.assign(D, { mode: t.dataset.mode, reservaId: null, guestId: null, guest: {}, roomId: '' }); draw(); }
      else if (t.dataset.pickRes) pickReservation(t.dataset.pickRes);
      else if (t.dataset.pickGuest) pickGuest(t.dataset.pickGuest);
      else if (t.hasAttribute('data-next')) next();
      else if (t.hasAttribute('data-back')) back();
      else if (t.hasAttribute('data-finish')) finish();
      else if (t.dataset.freeRoom) {
        try { await Store.setRoomStatus(t.dataset.freeRoom, 'livre'); collect2(); draw(); UI.toast('Quarto liberado.'); } catch (err) { NP.Api.showError(err); }
      } else if (t.hasAttribute('data-no-entry')) {
        const m = await UI.requireManager({ motivo: 'Check-in sem a entrada mínima', detalhe: `Exigido: ${brl(minEntry())} (${regras().entradaMinimaPct}%)`, escopo: 'sem_entrada' });
        if (m) { D.semEntradaAutorizadaPor = m.nome; D.semEntradaToken = m.token; refreshPaymentArea(); }
      } else if (t.dataset.void) {
        const p = D.payments.find((x) => x.id === t.dataset.void);
        try {
          const estado = await UI.busy(t, () => NP.Api.withAuth((tok) => NP.Api.post(`/api/pagamentos/${p.id}/estornar`, { motivo: 'Estornado durante o check-in', autorizacao: tok })));
          Store.apply(estado.estado);
          const novo = estado.estado.payments.find((x) => x.id === p.id);
          if (novo) Object.assign(p, novo);
          refreshPaymentArea(); if (panel) panel.refresh();
          UI.toast(p.metodo === 'dinheiro' ? 'Estornado. Devolva o dinheiro ao hóspede.' : 'Pagamento estornado.');
        } catch (err) { NP.Api.showError(err); }
      } else if (t.dataset.print) UI.printPreview('Ficha de hospedagem', NP.Print.checkinSheet(t.dataset.print));
      else if (t.hasAttribute('data-restart')) { D = blank(); draw(); }
    });
    root.addEventListener('input', (e) => {
      if (e.target.matches('[data-qr]')) { D.qr = e.target.value; const el = $('[data-res-list]', root); if (el) el.innerHTML = NP.U.render(reservationResults()); }
      else if (e.target.matches('[data-gq]')) { D.gq = e.target.value; const el = $('[data-guest-list]', root); if (el) el.innerHTML = NP.U.render(guestResults()); }
    });
    root.addEventListener('change', (e) => {
      if (D.step === 2 && ['checkout', 'adultos', 'criancas', 'descontoPct'].includes(e.target.name)) { collect2(); draw(); }
      else if (D.step === 2 && e.target.name === 'roomId') { collect2(); draw(); }
    });

    /* ---------- Saída da tela com pagamentos pendentes ---------- */
    const warnUnload = (e) => { if (D.payments.length && !D.done) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warnUnload);

    async function leave() {
      if (D.done || !D.payments.length) return true;
      const liveList = D.payments.filter(live);
      if (liveList.length) {
        const total = liveList.reduce((s, p) => s + p.valor, 0);
        const ok = await UI.confirmDialog({ title: 'Cancelar este check-in?', message: `Há ${liveList.length} pagamento(s) autorizado(s) (${brl(total)}) neste check-in. Se sair agora, eles serão estornados.`, confirmText: 'Estornar e sair', danger: true });
        if (!ok) return false;
      }
      try {
        const r = await Store.cancelCheckin(D.rascunho);
        if (r && r.dinheiro) UI.toast('Devolva ao hóspede o dinheiro recebido neste check-in.', 'info', 9000);
      } catch (err) { NP.Api.showError(err); return false; }
      D.payments = [];
      return true;
    }

    if (params && params[0] && Store.reservation(params[0]) && Store.reservation(params[0]).status === 'reservada') pickReservation(params[0]);
    else draw();
    return { leave, destroy() { if (panel) panel.destroy(); window.removeEventListener('beforeunload', warnUnload); } };
  };
})();
