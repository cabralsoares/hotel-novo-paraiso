/* Componentes de interface: janelas, avisos, confirmações, autorização do gerente e impressão. NP.UI */
(function () {
  const NP = (window.NP = window.NP || {});
  const { html, render, $, $$, icon } = NP.U;
  const stack = [];

  /* ---------- Janelas (modal) ---------- */
  /** modal({title, body, footer, size}) -> { el, body, foot, close, setBody }  (body/footer: html`` ou Element) */
  function modal({ title, body, footer, size = 'md', dismissable = true, onClose, cls = '' }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = render(html`
      <div class="modal modal-${size} ${cls}" role="dialog" aria-modal="true" aria-label="${title}">
        <header class="modal-head"><h2>${title}</h2>${dismissable ? html`<button type="button" class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button>` : ''}</header>
        <div class="modal-body form-scope"></div>
        <footer class="modal-foot"></footer>
      </div>`);
    const bodyEl = $('.modal-body', backdrop), footEl = $('.modal-foot', backdrop);
    const fill = (el, c) => { if (c instanceof Node) { el.replaceChildren(c); } else el.innerHTML = render(c); };
    fill(bodyEl, body || '');
    if (footer) fill(footEl, footer); else footEl.remove();
    const opener = document.activeElement;
    const ctl = {
      el: backdrop, body: bodyEl, foot: footEl, dismissable,
      setBody: (c) => fill(bodyEl, c),
      close(result) {
        if (!backdrop.isConnected) return;
        const i = stack.indexOf(ctl); if (i >= 0) stack.splice(i, 1);
        backdrop.remove();
        if (!stack.length) document.body.classList.remove('modal-open');
        if (opener && opener.focus && opener.isConnected) opener.focus();
        if (onClose) onClose(result);
      },
    };
    backdrop.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) ctl.close(); });
    $('#modals').appendChild(backdrop);
    stack.push(ctl);
    document.body.classList.add('modal-open');
    const first = $('input:not([type=hidden]):not([readonly]), select, textarea', bodyEl) || $('button', footEl || bodyEl);
    if (first) setTimeout(() => first.focus(), 30);
    return ctl;
  }

  document.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape' && top.dismissable) { e.stopPropagation(); top.close(); }
    if (e.key === 'Tab') {
      const items = $$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', top.el).filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  });

  /* ---------- Avisos ---------- */
  function toast(msg, type = 'ok', ms = 4500) {
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.innerHTML = render(html`${icon(type === 'error' ? 'alert' : 'check', 18)}<span>${msg}</span>`);
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  }

  /* ---------- Confirmação ---------- */
  /** Retorna true/false; com `reason`, retorna o texto do motivo (string) ou null se cancelar. */
  function confirmDialog({ title = 'Confirmar', message = '', confirmText = 'Confirmar', danger = false, reason = false, reasonLabel = 'Motivo' }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = modal({
        title, size: 'sm', onClose: () => finish(reason ? null : false),
        body: html`<form class="stack" novalidate><p>${message}</p>${reason ? html`<label class="field"><span class="lbl">${reasonLabel}</span><input name="motivo" autocomplete="off" maxlength="120"><small class="err" data-err="motivo"></small></label>` : ''}</form>`,
        footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirmText}</button>`,
      });
      const go = () => {
        if (reason) {
          const v = $('[name=motivo]', m.body).value.trim();
          if (v.length < 5) return NP.U.showErrors(m.body, { motivo: 'Descreva o motivo (mínimo 5 letras).' });
          finish(v); m.close();
        } else { finish(true); m.close(); }
      };
      $('[data-ok]', m.foot).addEventListener('click', go);
      $('form', m.body).addEventListener('submit', (e) => { e.preventDefault(); go(); });
    });
  }

  /* ---------- Autorização do gerente (PIN) ---------- */
  /**
   * Pede o PIN do gerente e confere NO SERVIDOR. Resolve com { nome, token } (token de uso único,
   * que a operação seguinte envia ao servidor), ou null se cancelado.
   * escopo/valor dizem ao servidor para que serve a autorização (desconto, estorno, valor_alto…).
   */
  function requireManager({ motivo, detalhe = '', escopo, valor = 0 }) {
    return new Promise((resolve) => {
      let done = false, working = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = modal({
        title: 'Autorização do gerente', size: 'sm', onClose: () => finish(null),
        body: html`<form class="stack" novalidate autocomplete="off">
          <div class="auth-note">${icon('lock', 20)}<div><strong>${motivo}</strong>${detalhe ? html`<br><span class="muted">${detalhe}</span>` : ''}</div></div>
          <label class="field"><span class="lbl">PIN do gerente</span><input name="pin" type="password" inputmode="numeric" data-mask="pin" autocomplete="new-password" placeholder="••••" maxlength="6"><small class="err" data-err="pin"></small></label>
        </form>`,
        footer: html`<button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-ok>${icon('shield')} Autorizar</button>`,
      });
      const go = async () => {
        if (working) return;
        const input = $('[name=pin]', m.body), pin = input.value;
        if (!pin) return NP.U.showErrors(m.body, { pin: 'Digite o PIN.' });
        working = true;
        try {
          const r = await NP.Api.post('/api/autorizar', { pin, escopo, valor, motivo, detalhe });
          finish({ nome: r.gerente.nome, token: r.token }); m.close();
        } catch (e) {
          input.value = '';
          NP.U.showErrors(m.body, { pin: e.codigo === 'PIN_INCORRETO' || e.codigo === 'MUITAS_TENTATIVAS' ? e.message : 'Não foi possível conferir o PIN: ' + e.message });
        } finally { working = false; }
      };
      $('[data-ok]', m.foot).addEventListener('click', go);
      $('form', m.body).addEventListener('submit', (e) => { e.preventDefault(); go(); });
    });
  }

  /* ---------- Botão ocupado ---------- */
  async function busy(btn, fn) {
    const html0 = btn.innerHTML;
    btn.disabled = true; btn.classList.add('is-busy'); btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Processando…';
    try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = html0; } }
  }

  /* ---------- Impressão ---------- */
  function print(safe) {
    const r = $('#print-root');
    r.innerHTML = render(safe);
    window.print();
  }
  /** Pré-visualização na tela com botão de imprimir. */
  function printPreview(title, safe) {
    const m = modal({
      title, size: 'lg', cls: 'modal-preview',
      body: html`<div class="sheet">${safe}</div>`,
      footer: html`<button type="button" class="btn" data-close>Fechar</button><button type="button" class="btn btn-primary" data-print>${icon('printer')} Imprimir</button>`,
    });
    $('[data-print]', m.foot).addEventListener('click', () => print(safe));
    return m;
  }

  NP.UI = { modal, toast, confirmDialog, requireManager, busy, print, printPreview };
})();
