/* Utilitários de interface: template seguro (html``), ícones, formatação e máscaras. NP.U */
(function () {
  const NP = (window.NP = window.NP || {});
  const V = NP.Validators;

  /* ---------- Template com escape automático ---------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Safe(String(s));
  const render = (v) => {
    if (v == null || v === false) return '';
    if (v instanceof Safe) return v.s;
    if (Array.isArray(v)) return v.map(render).join('');
    return esc(v);
  };
  /** html`<p>${valor}</p>` — valores são escapados, a menos que venham de outro html`` ou raw(). */
  const html = (strings, ...vals) => new Safe(strings.reduce((out, s, i) => out + s + (i < vals.length ? render(vals[i]) : ''), ''));
  const attrs = (o) => raw(Object.entries(o).filter(([, v]) => v !== false && v != null).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join(''));
  const mount = (el, safe) => { el.innerHTML = render(safe); return el; };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- Ícones (traço, 24x24) ---------- */
  const ICONS = {
    painel: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    bed: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    settings: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
    cash: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    right: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    left: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    log: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  };
  const icon = (name, size = 18) => raw(`<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);

  /* ---------- Formatação ---------- */
  const brl = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);
  const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const longDate = (d = new Date()) => d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const maskCPF = (v) => { const d = V.digits(v).slice(0, 11); return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'); };
  const maskCNPJ = (v) => V.digits(v).slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  const maskPhone = (v) => { const d = V.digits(v).slice(0, 11); return d.length > 10 ? d.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3') : d.length > 6 ? d.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3') : d.length > 2 ? d.replace(/^(\d{2})(\d*)/, '($1) $2') : d; };
  const maskCard = (v) => {
    const d = V.digits(v).slice(0, 19);
    if (V.cardBrand(d)?.id === 'amex') return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
    return d.replace(/(\d{4})(?=\d)/g, '$1 ');
  };
  const maskExpiry = (v) => { const d = V.digits(v).slice(0, 4); return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; };
  const maskMoney = (v) => { const d = V.digits(v).slice(0, 11); return d ? (Number(d) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; };
  const MASKS = {
    cpf: maskCPF, cnpj: maskCNPJ, phone: maskPhone, card: maskCard, expiry: maskExpiry, money: maskMoney,
    name: (v) => v.replace(/[^A-Za-zÀ-ÿ'.\- ]/g, ''),
    cvv: (v) => V.digits(v).slice(0, 4), pin: (v) => V.digits(v).slice(0, 6), upper: (v) => v.toUpperCase().replace(/[^A-ZÀ-Ý' .\-]/g, ''),
    plate: (v) => v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8),
  };
  /** "1.234,56" -> 1234.56 */
  const parseMoney = (s) => { const n = Number(String(s || '').replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  const moneyStr = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Fase de captura: a máscara precisa rodar ANTES de qualquer outro ouvinte ler o valor (parcelas, troco…).
  document.addEventListener('input', (e) => {
    const m = e.target && e.target.dataset && e.target.dataset.mask;
    if (m && MASKS[m]) { const v = MASKS[m](e.target.value); if (v !== e.target.value) e.target.value = v; }
  }, true);

  /* ---------- Campos de formulário ---------- */
  /** <label> + <input|select> + espaço de erro. opts: {type,value,hint,cls,options,mask,...atributos} */
  function field(label, name, opts = {}) {
    const { type = 'text', value = '', hint = '', cls = '', options = null, mask = null, ...rest } = opts;
    const common = { name, id: 'f-' + name, ...rest };
    let control;
    if (options) {
      control = html`<select${attrs(common)}>${options.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return html`<option value="${v}"${attrs({ selected: String(v) === String(value) })}>${t}</option>`; })}</select>`;
    } else if (type === 'textarea') {
      control = html`<textarea${attrs({ ...common, rows: rest.rows || 2 })}>${value}</textarea>`;
    } else {
      control = html`<input${attrs({ type, value, 'data-mask': mask, autocomplete: 'off', ...common })}>`;
    }
    return html`<label class="field ${cls}" for="f-${name}"><span class="lbl">${label}</span>${control}${hint ? html`<small class="hint">${hint}</small>` : ''}<small class="err" data-err="${name}" role="alert"></small></label>`;
  }

  /** Mostra { campo: 'mensagem' } nos espaços de erro e foca o primeiro campo com problema. */
  function showErrors(root, errors) {
    $$('[data-err]', root).forEach((el) => { el.textContent = ''; });
    $$('[aria-invalid]', root).forEach((el) => el.removeAttribute('aria-invalid'));
    let first = null;
    for (const [name, msg] of Object.entries(errors)) {
      const slot = $(`[data-err="${name}"]`, root);
      if (slot) slot.textContent = msg;
      const input = $(`[name="${name}"]`, root);
      if (input) { input.setAttribute('aria-invalid', 'true'); first = first || input; }
    }
    if (first) first.focus();
    return Object.keys(errors).length === 0;
  }
  document.addEventListener('input', (e) => {
    const name = e.target && e.target.name;
    if (!name || !e.target.closest) return;
    const slot = e.target.closest('form, .form-scope')?.querySelector(`[data-err="${name}"]`);
    if (slot && slot.textContent) { slot.textContent = ''; e.target.removeAttribute('aria-invalid'); }
  });

  const formData = (root) => {
    const out = {};
    $$('[name]', root).forEach((el) => { if (el.type === 'checkbox') out[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; } else out[el.name] = el.value.trim(); });
    return out;
  };

  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

  NP.U = { esc, Safe, raw, render, html, attrs, mount, $, $$, uid, icon, brl, fmtDate, fmtDateTime, fmtTime, longDate, plural, maskCPF, maskCNPJ, maskPhone, maskCard, parseMoney, moneyStr, field, showErrors, formData, UFS };
})();
