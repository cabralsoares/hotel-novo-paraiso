/* Peças compartilhadas pelas telas. NP.Views (registro de telas) e NP.Common */
(function () {
  const NP = (window.NP = window.NP || {});
  const { html, icon } = NP.U;
  NP.Views = {};

  const RES_STATUS = { reservada: ['Reservada', 'info'], hospedado: ['Hospedado', 'ok'], finalizada: ['Finalizada', 'muted'], cancelada: ['Cancelada', 'danger'] };
  const ROOM_STATUS = { livre: ['Livre', 'ok'], ocupado: ['Ocupado', 'info'], limpeza: ['Em limpeza', 'warn'], manutencao: ['Manutenção', 'danger'] };
  const PAY_STATUS = { autorizado: ['Autorizado', 'ok'], faturado: ['Faturado', 'info'], recusado: ['Recusado', 'danger'], estornado: ['Estornado', 'muted'] };

  const badge = (kind, text) => html`<span class="badge badge-${kind}">${text}</span>`;
  const resBadge = (s) => badge(RES_STATUS[s][1], RES_STATUS[s][0]);
  const roomBadge = (s) => badge(ROOM_STATUS[s][1], ROOM_STATUS[s][0]);
  const payBadge = (s) => badge(PAY_STATUS[s][1], PAY_STATUS[s][0]);

  const pageHead = (title, sub, actions) => html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</div>`;
  const empty = (msg, ico = 'search') => html`<div class="empty">${icon(ico, 28)}<p>${msg}</p></div>`;
  /** Data local (AAAA-MM-DD) de um instante ISO/UTC — evita virar o dia às 21h no Brasil. */
  const dayOf = (iso) => NP.Core.toISO(new Date(iso));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** Redesenha a tela quando os dados mudam. Mudanças vindas de OUTRO computador não apagam o que está sendo digitado aqui. */
  const onStore = (root, draw) => NP.Store.on((s, origin) => {
    const a = document.activeElement;
    if (origin === 'remote' && root.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
    draw();
  });

  NP.Common = { onStore, RES_STATUS, ROOM_STATUS, PAY_STATUS, badge, resBadge, roomBadge, payBadge, pageHead, empty, dayOf, norm };
})();
