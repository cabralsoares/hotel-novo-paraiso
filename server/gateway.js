/* Autorizador de pagamentos — MODO SIMULAÇÃO.
 * Não fala com nenhum banco/adquirente. Serve para treinar a equipe e validar o fluxo.
 * Para operar de verdade, troque authorize()/voidPayment() por chamadas ao seu gateway
 * (Mercado Pago, Stone, Cielo, Pagar.me, Efí...) mantendo o mesmo formato de retorno. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.NP = root.NP || {}; root.NP.Gateway = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (n, alphabet) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

  /** Finais de cartão que provocam recusa no modo simulação. */
  const DECLINES = {
    '0002': { codigo: '05', mensagem: 'Transação não autorizada pelo emissor.' },
    '9995': { codigo: '51', mensagem: 'Saldo ou limite insuficiente.' },
    '9979': { codigo: '41', mensagem: 'Cartão bloqueado (perda/roubo). Retenha o cartão e contate o emissor.' },
  };

  const DEBIT_LIMIT = 5000;

  /** @returns {Promise<{aprovada:boolean, codigo:string, mensagem:string, nsu?:string, autorizacao?:string, final4:string}>} */
  async function authorize({ tipo, valor, numero, parcelas = 1 }, { latency = 1100 } = {}) {
    if (latency) await wait(latency + Math.random() * 600);
    const final4 = digits(numero).slice(-4);
    if (!(valor > 0)) return { aprovada: false, codigo: '13', mensagem: 'Valor inválido.', final4 };
    if (tipo === 'debito' && parcelas !== 1) return { aprovada: false, codigo: '12', mensagem: 'Débito não permite parcelamento.', final4 };
    if (tipo === 'debito' && valor > DEBIT_LIMIT) return { aprovada: false, codigo: '61', mensagem: 'Valor excede o limite de débito.', final4 };
    const decline = DECLINES[final4];
    if (decline) return { aprovada: false, ...decline, final4 };
    return {
      aprovada: true,
      codigo: '00',
      mensagem: 'Transação autorizada.',
      nsu: rand(6, '0123456789'),
      autorizacao: rand(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'),
      final4,
    };
  }

  async function voidPayment(payment, { latency = 700 } = {}) {
    if (latency) await wait(latency);
    return { ok: true, codigo: '00', mensagem: payment.metodo === 'pix' ? 'Devolução PIX solicitada.' : 'Estorno solicitado ao adquirente.' };
  }

  /** ID fim-a-fim sintaticamente válido, só para testes em modo simulação. */
  function fakeE2E(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const ts = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
    return `E00000000${ts}${rand(11, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
  }

  return { mode: 'simulacao', DECLINES, DEBIT_LIMIT, authorize, voidPayment, fakeE2E };
});
