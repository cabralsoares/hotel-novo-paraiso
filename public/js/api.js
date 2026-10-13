/* Comunicação com o servidor do hotel. NP.Api */
(function () {
  const NP = (window.NP = window.NP || {});

  class ApiError extends Error {
    constructor(status, codigo, mensagem, extra = {}) { super(mensagem); this.status = status; this.codigo = codigo; this.extra = extra; }
    /** Erros por campo ({ campo: 'mensagem' }), quando o servidor os devolve. */
    get campos() { return this.extra.campos || null; }
  }

  async function request(method, url, body, { raw = false } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'np', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch { throw new ApiError(0, 'REDE', 'Sem conexão com o servidor. Verifique a internet e tente de novo.'); }
    const isJson = (res.headers.get('content-type') || '').includes('json');
    if (!res.ok) {
      let e = {};
      if (isJson) { try { e = (await res.json()).erro || {}; } catch { /* corpo inválido */ } }
      const err = new ApiError(res.status, e.codigo || 'ERRO', e.mensagem || 'Erro inesperado. Tente novamente.', e);
      if (res.status === 401 && e.codigo === 'NAO_AUTENTICADO' && NP.Auth) NP.Auth.sessionLost();
      throw err;
    }
    return raw || !isJson ? res : res.json();
  }

  const get = (u) => request('GET', u);
  const post = (u, b = {}) => request('POST', u, b);
  const put = (u, b = {}) => request('PUT', u, b);

  /**
   * Executa `fn(token, need)` e, se o servidor disser que precisa do PIN do gerente,
   * pede o PIN e tenta de novo (até 3 pedidos). `need` traz { escopo, valor, motivo, detalhe } do pedido anterior.
   */
  async function withAuth(fn) {
    let token = null, need = null;
    for (let i = 0; i < 4; i++) {
      try { return await fn(token, need); }
      catch (e) {
        if (!(e instanceof ApiError) || e.codigo !== 'AUTORIZACAO_NECESSARIA' || i === 3) throw e;
        need = e.extra;
        const m = await NP.UI.requireManager({ motivo: need.motivo, detalhe: need.detalhe, escopo: need.escopo, valor: need.valor });
        if (!m) throw new ApiError(0, 'CANCELADO', 'Autorização do gerente não concedida.');
        token = m.token;
      }
    }
  }

  /** Mostra o erro: se vier por campo, marca os campos; senão, avisa com uma mensagem. */
  function showError(err, root) {
    if (err instanceof ApiError && err.codigo === 'CANCELADO') return;
    if (err instanceof ApiError && err.campos && root && NP.U.showErrors(root, err.campos) === false) { NP.UI.toast(err.message, 'error'); return; }
    NP.UI.toast(err.message || 'Algo deu errado.', 'error', 7000);
  }

  NP.Api = { ApiError, request, get, post, put, withAuth, showError };
})();
