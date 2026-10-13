/* Painel de pagamento: PIX, crédito, débito, dinheiro e faturado.
 * A tela confere os dados para ajudar quem digita, mas QUEM VALIDA E AUTORIZA DE VERDADE é o servidor. NP.Payments.mount(...) */
(function () {
  const NP = (window.NP = window.NP || {});
  const { html, raw, render, $, $$, icon, brl, field, showErrors, formData, parseMoney, moneyStr, fmtDate, maskCNPJ } = NP.U;
  const V = NP.Validators, Core = NP.Core, Store = NP.Store, UI = NP.UI, Api = NP.Api;

  const METHODS = [
    { id: 'pix', label: 'PIX', icon: 'qr' },
    { id: 'credito', label: 'Crédito', icon: 'card' },
    { id: 'debito', label: 'Débito', icon: 'card' },
    { id: 'dinheiro', label: 'Dinheiro', icon: 'cash' },
    { id: 'faturado', label: 'Faturado', icon: 'building' },
  ];
  const METHOD_NAME = { pix: 'PIX', credito: 'Cartão de crédito', debito: 'Cartão de débito', dinheiro: 'Dinheiro', faturado: 'Faturado (empresa)' };

  /** Texto de detalhe de um pagamento (listas e recibos). */
  function describe(p) {
    const d = p.detalhes || {};
    if (p.tipo === 'devolucao') return d.motivo || '';
    if (p.metodo === 'credito' || p.metodo === 'debito') {
      const parc = p.metodo === 'credito' ? (d.parcelas > 1 ? `${d.parcelas}x` : 'à vista') : '';
      return [`${d.bandeira || 'Cartão'} •••• ${d.final4 || ''}`, parc, d.nsu && `NSU ${d.nsu}`, d.autorizacao && `Aut. ${d.autorizacao}`, p.status === 'recusado' && `${d.codigo} — ${d.mensagem}`].filter(Boolean).join(' · ');
    }
    if (p.metodo === 'pix') return d.e2e ? `ID ${d.e2e}` : '';
    if (p.metodo === 'dinheiro') return d.troco > 0 ? `Recebido ${brl(d.recebido)} · troco ${brl(d.troco)}` : '';
    if (p.metodo === 'faturado') return `${d.razao} · CNPJ ${maskCNPJ(d.cnpj)} · venc. ${fmtDate(d.vencimento)}`;
    return '';
  }

  /**
   * opts: {
   *   getBalance(): number          saldo máximo que pode ser cobrado
   *   suggestions(): [{label,value}]
   *   context(): {reservaId | rascunho, hospede, dataSaida?}   a quem o pagamento pertence
   *   onPayment(pagamento)          chamado em toda tentativa (autorizada, faturada ou recusada) — já gravada no servidor
   * }
   */
  function mount(root, opts) {
    const ac = new AbortController();
    const on = (type, fn) => root.addEventListener(type, fn, { signal: ac.signal });
    const S = { method: 'pix', pix: null, result: null, timer: null, cashTouched: false };
    const regras = () => Store.state.config.regras;
    const balance = () => Math.max(0, Core.round2(opts.getBalance()));
    const amountInput = () => $('[name=valor]', root);
    const readAmount = () => parseMoney(amountInput() ? amountInput().value : 0);
    const stopTimer = () => { if (S.timer) { clearInterval(S.timer); S.timer = null; } };
    const ctxBody = () => { const c = opts.context(); return { reservaId: c.reservaId || undefined, rascunho: c.rascunho || undefined, hospede: c.hospede || '', dataSaida: c.dataSaida || undefined }; };

    function amountError(a) {
      if (!(a > 0)) return 'Informe um valor maior que zero.';
      if (a > balance() + 0.004) return `O valor passa do saldo da conta (${brl(balance())}).`;
      return null;
    }

    function setResult(r) { S.result = r; renderResult(); }
    function renderResult() {
      const el = $('[data-result]', root);
      if (!el) return;
      const r = S.result;
      el.innerHTML = r ? render(html`<div class="result ${r.ok ? 'result-ok' : 'result-err'}" role="${r.ok ? 'status' : 'alert'}">${icon(r.ok ? 'check' : 'alert', 20)}<div><strong>${r.title}</strong>${r.text ? html`<br><span>${r.text}</span>` : ''}</div></div>`) : '';
    }

    /** Roda uma chamada ao servidor: erros por campo aparecem nos campos; os demais, em aviso. */
    async function call(fn) {
      try { return await fn(); }
      catch (e) {
        if (e.codigo === 'CANCELADO') { setResult({ ok: false, title: 'Autorização negada', text: 'Sem o PIN do gerente esta operação não pode continuar.' }); return null; }
        if (e.campos) { const f = { ...e.campos }; showErrors(root, f); setResult({ ok: false, title: 'Confira os dados', text: e.message }); return null; }
        setResult({ ok: false, title: 'Não foi possível concluir', text: e.message });
        return null;
      }
    }
    function accept(r) { if (r.estado) Store.apply(r.estado); return r.resultado.pagamento; }

    /* ---------- Desenho ---------- */
    function draw() {
      stopTimer();
      const bal = balance();
      if (bal <= 0.004) {
        root.innerHTML = render(html`<div class="pay-done">${icon('check', 24)}<div><strong>Conta quitada</strong><p class="muted">Não há saldo a cobrar.</p></div></div>`);
        return;
      }
      const sugg = (opts.suggestions ? opts.suggestions() : []).filter((s) => s.value > 0.004 && s.value <= bal + 0.004);
      const first = Math.min(sugg[0] ? sugg[0].value : bal, bal);
      root.innerHTML = render(html`<div class="pay-panel form-scope">
        <div class="pay-amount">
          ${field('Valor a cobrar agora (R$)', 'valor', { value: moneyStr(first), mask: 'money', inputmode: 'numeric', cls: 'amount-field' })}
          <div class="chips" aria-label="Valores sugeridos">${sugg.map((s) => html`<button type="button" class="chip" data-chip="${s.value}">${s.label} · ${brl(s.value)}</button>`)}</div>
        </div>
        <div class="method-tabs" role="tablist" aria-label="Forma de pagamento">${METHODS.map((m) => html`<button type="button" role="tab" class="method-tab" data-method="${m.id}" aria-selected="${m.id === S.method}">${icon(m.icon, 20)}<span>${m.label}</span></button>`)}</div>
        <div class="pay-form" data-form></div>
        <div class="pay-result" data-result aria-live="polite"></div>
      </div>`);
      drawForm();
      renderResult();
    }

    function drawTabs() { $$('[data-method]', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.method === S.method))); }

    function drawForm() {
      const box = $('[data-form]', root);
      if (!box) return;
      stopTimer();
      const m = S.method;
      box.innerHTML = render(m === 'pix' ? formPix() : m === 'credito' || m === 'debito' ? formCard(m) : m === 'dinheiro' ? formCash() : formFaturado());
      if (m === 'pix' && S.pix) startTimer();
      if (m === 'credito') refreshInstallments();
    }

    /* ---------- PIX ---------- */
    function formPix() {
      const cfg = Store.state.config.pix;
      const key = V.parsePixKey(cfg.chave);
      if (!key) {
        if (!NP.Auth.isManager()) return html`<div class="notice notice-warn">${icon('alert', 20)}<div><strong>A chave PIX do hotel ainda não foi cadastrada.</strong><br>Peça ao gerente para cadastrar em Configurações → Recebimentos.</div></div>`;
        return html`<div class="pix-setup"><p><strong>Cadastre a chave PIX do hotel</strong> para gerar cobranças com QR Code. O PIN do gerente será pedido.</p>
          <div class="row-end">${field('Chave PIX (CPF, CNPJ, e-mail, celular ou aleatória)', 'pixkey', { cls: 'grow' })}<button type="button" class="btn btn-primary" data-save-key>Salvar chave</button></div></div>`;
      }
      if (!S.pix) {
        return html`<div class="pix-start"><p class="muted">Chave do hotel: <strong>${key.valor}</strong> (${key.tipo}) · Recebedor: ${cfg.recebedor}</p>
          <button type="button" class="btn btn-primary btn-lg" data-pix-generate>${icon('qr', 20)} Gerar QR Code PIX</button></div>`;
      }
      let qr = '';
      if (typeof qrcode === 'function') {
        try { const q = qrcode(0, 'M'); q.addData(S.pix.payload); q.make(); qr = raw(q.createSvgTag({ cellSize: 4, margin: 8, scalable: true, title: 'QR Code PIX' })); } catch { qr = ''; }
      }
      return html`<div class="pix-live">
        <div class="pix-box">
          <div class="qr">${qr || html`<p class="muted small">QR indisponível — use o código ao lado.</p>`}</div>
          <div class="pix-code">
            <p><strong>${brl(S.pix.valor)}</strong> · expira em <span data-countdown class="mono">10:00</span></p>
            <label class="field"><span class="lbl">PIX copia e cola</span><textarea readonly rows="4" class="mono small" data-payload>${S.pix.payload}</textarea></label>
            <button type="button" class="btn btn-sm" data-copy>${icon('copy', 16)} Copiar código</button>
          </div>
        </div>
        <form class="stack" novalidate data-pixform>
          <div class="field-row">
            ${field('ID da transação do comprovante (E2E)', 'e2e', { cls: 'grow', placeholder: 'E' + '0'.repeat(31), maxlength: 32, hint: 'Aparece no comprovante do pagamento, no app do banco.' })}
            ${Store.state.modoGateway === 'simulacao' ? html`<button type="button" class="btn btn-sm btn-ghost self-center" data-pix-fake title="Só no modo simulação">Gerar ID de teste</button>` : ''}
          </div>
          <label class="check"><input type="checkbox" name="conferi"><span>Conferi no aplicativo do banco que o valor de <strong>${brl(S.pix.valor)}</strong> foi recebido.</span></label>
          <small class="err" data-err="conferi" role="alert"></small>
          <div class="actions"><button type="button" class="btn" data-pix-cancel>Cancelar cobrança</button><button type="button" class="btn btn-success" data-pix-confirm>${icon('check')} Confirmar recebimento</button></div>
        </form></div>`;
    }

    function startTimer() {
      const tick = () => {
        if (!root.isConnected) return stopTimer();
        const left = S.pix ? Math.max(0, S.pix.expiraEm - Date.now()) : 0;
        const el = $('[data-countdown]', root);
        if (el) { el.textContent = left ? `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : 'expirado'; el.classList.toggle('danger-text', !left); }
        if (!left) stopTimer();
      };
      tick();
      S.timer = setInterval(tick, 1000);
    }

    async function generatePix(btn) {
      const amount = readAmount();
      const err = amountError(amount);
      if (err) return showErrors(root, { valor: err });
      showErrors(root, {});
      const r = await UI.busy(btn, () => call(() => Api.post('/api/pix/cobrancas', { valor: amount, ...ctxBody() })));
      if (!r) return;
      S.pix = { txid: r.txid, payload: r.payload, valor: r.valor, expiraEm: r.expiraEm };
      amountInput().readOnly = true;
      setResult(null);
      drawForm();
    }

    function cancelPix() { S.pix = null; stopTimer(); if (amountInput()) amountInput().readOnly = false; drawForm(); }

    async function confirmPix(btn) {
      const d = formData($('[data-pixform]', root));
      const errors = {};
      const msg = V.checkE2E(d.e2e.trim());
      if (msg) errors.e2e = msg;
      if (!d.conferi) errors.conferi = 'Confirme que conferiu o recebimento no banco.';
      if (!showErrors(root, errors)) return;
      const r = await UI.busy(btn, () => call(() => Api.withAuth((tok) => Api.post('/api/pix/confirmar', { txid: S.pix.txid, e2e: d.e2e.trim(), conferi: true, autorizacao: tok }))));
      if (!r) return;
      const p = accept(r);
      S.pix = null;
      opts.onPayment(p);
      S.result = { ok: true, title: `PIX de ${brl(p.valor)} confirmado`, text: 'Pagamento registrado na conta.' };
      draw();
    }

    /* ---------- Cartão ---------- */
    function formCard(tipo) {
      return html`<form class="grid-2" novalidate autocomplete="off" data-card="${tipo}">
        ${field(html`Número do cartão <span class="brand-badge" data-brand>—</span>`, 'numero', { mask: 'card', inputmode: 'numeric', placeholder: '0000 0000 0000 0000', cls: 'span-2' })}
        ${field('Nome impresso no cartão', 'nome', { mask: 'upper', placeholder: 'COMO ESTÁ NO CARTÃO', cls: 'span-2' })}
        ${field('Validade', 'validade', { mask: 'expiry', inputmode: 'numeric', placeholder: 'MM/AA' })}
        ${field('CVV', 'cvv', { type: 'password', mask: 'cvv', inputmode: 'numeric', placeholder: '•••', autocomplete: 'new-password' })}
        ${field('CPF do titular', 'cpf', { mask: 'cpf', inputmode: 'numeric', placeholder: '000.000.000-00' })}
        ${tipo === 'credito' ? field('Parcelas', 'parcelas', { options: [['1', '1x']] }) : html`<div class="field"><span class="lbl">Parcelas</span><div class="static-value">À vista (débito)</div></div>`}
        <div class="span-2 secure-note">${icon('lock', 16)}<span>Número, validade e CVV são enviados ao servidor só para esta autorização e <strong>não são gravados</strong>. Fica registrado apenas bandeira, final e códigos.</span></div>
        ${Store.state.modoGateway === 'simulacao' ? html`<details class="span-2 test-cards"><summary>Modo simulação — cartões de teste</summary>
          <ul><li><code>4111 1111 1111 1111</code> Visa — <b>aprova</b></li><li><code>5555 5555 5555 4444</code> Mastercard — <b>aprova</b></li><li><code>3782 822463 10005</code> Amex (CVV de 4 dígitos) — <b>aprova</b></li>
          <li><code>4000 0000 0000 0002</code> — recusa (não autorizada)</li><li><code>4000 0000 0000 9995</code> — recusa (saldo insuficiente)</li><li><code>4000 0000 0000 9979</code> — recusa (cartão bloqueado)</li></ul>
          <p class="muted small">Use qualquer nome, validade futura e CVV. O número precisa passar na validação (Luhn).</p></details>` : ''}
        <div class="span-2 actions"><button type="submit" class="btn btn-primary btn-lg" data-card-submit>${icon('shield', 20)} Autorizar pagamento</button></div>
      </form>`;
    }

    function refreshInstallments() {
      const sel = $('[name=parcelas]', root);
      if (!sel) return;
      const prev = sel.value;
      const opt = Core.installmentOptions(readAmount(), regras());
      sel.innerHTML = opt.map((o) => `<option value="${o.n}">${o.n}x de ${brl(o.cada)}${o.n === 1 ? ' (à vista)' : ' sem juros'}</option>`).join('');
      if (opt.some((o) => String(o.n) === prev)) sel.value = prev;
    }

    async function submitCard(form) {
      const tipo = form.dataset.card;
      const d = formData(form);
      const brand = V.cardBrand(d.numero);
      const errors = V.validateCard(d);
      if (!V.isCPF(d.cpf)) errors.cpf = 'CPF do titular inválido.';
      const amount = readAmount();
      const aerr = amountError(amount);
      if (aerr) errors.valor = aerr;
      if (!showErrors(root, errors)) return;
      const parcelas = tipo === 'credito' ? Number(d.parcelas || 1) : 1;
      setResult(null);
      const btn = $('[data-card-submit]', form);
      const r = await UI.busy(btn, () => call(() => Api.withAuth((tok) => Api.post('/api/pagamentos/cartao', { tipo, valor: amount, numero: d.numero, nome: d.nome, validade: d.validade, cvv: d.cvv, cpf: d.cpf, parcelas, ...ctxBody(), autorizacao: tok }))));
      if (!r) return;
      const p = accept(r);
      opts.onPayment(p);
      if (p.status === 'autorizado') {
        S.result = { ok: true, title: `${tipo === 'credito' ? 'Crédito' : 'Débito'} autorizado — ${brl(p.valor)}`, text: `${brand.name} •••• ${p.detalhes.final4}${parcelas > 1 ? ` · ${parcelas}x` : ''} · NSU ${p.detalhes.nsu} · Aut. ${p.detalhes.autorizacao}` };
        draw();
      } else {
        const cv = $('[name=cvv]', form); if (cv) cv.value = '';
        setResult({ ok: false, title: 'Pagamento recusado', text: `${p.detalhes.mensagem} (código ${p.detalhes.codigo}). Tente outro cartão ou outra forma de pagamento.` });
      }
    }

    /* ---------- Dinheiro ---------- */
    function formCash() {
      const a = readAmount();
      return html`<form class="stack" novalidate data-cash>
        ${field('Valor recebido do hóspede (R$)', 'recebido', { value: moneyStr(a), mask: 'money', inputmode: 'numeric' })}
        <div class="chips">${[['Valor exato', a], ['R$ 50', 50], ['R$ 100', 100], ['R$ 200', 200]].map(([l, v]) => html`<button type="button" class="chip" data-cash-chip="${v}">${l}</button>`)}</div>
        <div class="troco" data-troco></div>
        <div class="actions"><button type="submit" class="btn btn-primary btn-lg" data-cash-submit>${icon('cash', 20)} Registrar pagamento em dinheiro</button></div>
      </form>`;
    }

    function updateCash() {
      const form = $('[data-cash]', root);
      if (!form) return;
      const input = $('[name=recebido]', form);
      if (!S.cashTouched) input.value = moneyStr(readAmount());
      const troco = Core.round2(parseMoney(input.value) - readAmount());
      $('[data-troco]', form).innerHTML = render(troco > 0.004 ? html`Troco a devolver: <strong>${brl(troco)}</strong>` : html`<span class="muted">Sem troco</span>`);
    }

    async function submitCash(form) {
      const amount = readAmount();
      const recebido = parseMoney($('[name=recebido]', form).value);
      const errors = {};
      const aerr = amountError(amount);
      if (aerr) errors.valor = aerr;
      if (!(recebido > 0)) errors.recebido = 'Informe o valor recebido.';
      else if (recebido + 0.004 < amount) errors.recebido = 'O valor recebido é menor que o valor a cobrar.';
      else if (recebido - amount > 1000) errors.recebido = 'Troco acima de R$ 1.000,00. Confira o valor digitado.';
      if (!showErrors(root, errors)) return;
      const r = await UI.busy($('[data-cash-submit]', form), () => call(() => Api.withAuth((tok) => Api.post('/api/pagamentos/dinheiro', { valor: amount, recebido, ...ctxBody(), autorizacao: tok }))));
      if (!r) return;
      const p = accept(r);
      S.cashTouched = false;
      opts.onPayment(p);
      S.result = { ok: true, title: `Dinheiro registrado — ${brl(amount)}`, text: p.detalhes.troco > 0 ? `Devolva ${brl(p.detalhes.troco)} de troco ao hóspede.` : 'Sem troco.' };
      draw();
    }

    /* ---------- Faturado (empresa) ---------- */
    function formFaturado() {
      const T = Core.today();
      return html`<form class="grid-2" novalidate autocomplete="off" data-fat>
        ${field('CNPJ da empresa', 'cnpj', { mask: 'cnpj', inputmode: 'numeric', placeholder: '00.000.000/0000-00' })}
        ${field('Razão social', 'razao')}
        ${field('E-mail financeiro (opcional)', 'email', { type: 'email' })}
        ${field('Vencimento', 'vencimento', { type: 'date', min: T, max: Core.addDays(T, 60), value: Core.addDays(T, 15) })}
        ${field('Nº do pedido / autorização (opcional)', 'ordem', { cls: 'span-2' })}
        <div class="span-2 secure-note">${icon('shield', 16)}<span>Faturamento sempre exige o <strong>PIN do gerente</strong>. O valor entra na conta do hóspede, mas fica como <em>a receber</em> no financeiro.</span></div>
        <div class="span-2 actions"><button type="submit" class="btn btn-primary btn-lg" data-fat-submit>${icon('building', 20)} Faturar para a empresa</button></div>
      </form>`;
    }

    async function submitFat(form) {
      const d = formData(form);
      const amount = readAmount();
      const T = Core.today();
      const errors = {};
      const aerr = amountError(amount);
      if (aerr) errors.valor = aerr;
      if (!V.isCNPJ(d.cnpj)) errors.cnpj = 'CNPJ inválido.';
      if (d.razao.length < 3) errors.razao = 'Informe a razão social.';
      if (d.email && !V.isEmail(d.email)) errors.email = 'E-mail inválido.';
      if (!V.isDateISO(d.vencimento) || d.vencimento < T) errors.vencimento = 'Informe um vencimento a partir de hoje.';
      else if (d.vencimento > Core.addDays(T, 60)) errors.vencimento = 'Vencimento máximo: 60 dias.';
      if (!showErrors(root, errors)) return;
      const r = await UI.busy($('[data-fat-submit]', form), () => call(() => Api.withAuth((tok) => Api.post('/api/pagamentos/faturado', { valor: amount, cnpj: d.cnpj, razao: d.razao, email: d.email, vencimento: d.vencimento, ordem: d.ordem, ...ctxBody(), autorizacao: tok }))));
      if (!r) return;
      const p = accept(r);
      opts.onPayment(p);
      S.result = { ok: true, title: `Faturado — ${brl(amount)}`, text: `${d.razao} · vencimento ${fmtDate(d.vencimento)} · autorizado por ${p.autorizadoPor}` };
      draw();
    }

    /* ---------- Eventos ---------- */
    on('click', async (e) => {
      const t = e.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.method) {
        if (S.method === 'pix' && S.pix && t.dataset.method !== 'pix') cancelPix();
        S.method = t.dataset.method; S.result = null; renderResult(); drawTabs(); drawForm();
      } else if (t.dataset.chip != null) {
        if (amountInput().readOnly) return;
        amountInput().value = moneyStr(Number(t.dataset.chip)); S.cashTouched = false; refreshInstallments(); updateCash();
      } else if (t.dataset.cashChip != null) {
        S.cashTouched = true; $('[name=recebido]', root).value = moneyStr(Number(t.dataset.cashChip)); updateCash();
      } else if (t.hasAttribute('data-pix-generate')) await generatePix(t);
      else if (t.hasAttribute('data-pix-cancel')) cancelPix();
      else if (t.hasAttribute('data-pix-confirm')) await confirmPix(t);
      else if (t.hasAttribute('data-pix-fake')) { try { const inp = $('[name=e2e]', root); inp.value = (await Api.get('/api/pix/id-teste')).e2e; inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) { Api.showError(err); } }
      else if (t.hasAttribute('data-copy')) {
        try { await navigator.clipboard.writeText(S.pix.payload); UI.toast('Código PIX copiado.'); }
        catch { const ta = $('[data-payload]', root); ta.select(); document.execCommand('copy'); UI.toast('Código PIX copiado.'); }
      } else if (t.hasAttribute('data-save-key')) {
        const k = V.parsePixKey($('[name=pixkey]', root).value);
        if (!k) return showErrors(root, { pixkey: 'Chave PIX inválida. Confira o CPF/CNPJ, e-mail, celular com DDD ou chave aleatória.' });
        try {
          const cur = Store.state.config.pix;
          await UI.busy(t, () => Api.withAuth((tok) => Store.saveConfig('pix', { chave: k.valor, recebedor: cur.recebedor, cidade: cur.cidade }, tok)));
          drawForm();
        } catch (err) { Api.showError(err, root); }
      }
    });
    on('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.matches('[data-card]')) await submitCard(f);
      else if (f.matches('[data-cash]')) await submitCash(f);
      else if (f.matches('[data-fat]')) await submitFat(f);
    });
    on('input', (e) => {
      if (e.target.name === 'valor') { refreshInstallments(); updateCash(); }
      else if (e.target.name === 'recebido') { S.cashTouched = true; updateCash(); }
      else if (e.target.name === 'numero') { const b = V.cardBrand(e.target.value); const el = $('[data-brand]', root); if (el) el.textContent = b ? b.name : '—'; }
    });
    on('focusout', (e) => {
      const n = e.target.name;
      if (!['numero', 'validade', 'cvv', 'nome'].includes(n) || !e.target.value) return;
      const form = e.target.closest('[data-card]');
      if (!form) return;
      const errs = V.validateCard(formData(form));
      const slot = $(`[data-err="${n}"]`, form);
      if (slot) { slot.textContent = errs[n] || ''; e.target.toggleAttribute('aria-invalid', !!errs[n]); }
    });

    draw();
    return { refresh: draw, destroy() { stopTimer(); ac.abort(); } };
  }

  NP.Payments = { mount, describe, METHODS, METHOD_NAME };
})();
