/* Dados do hotel: cópia local do que está no servidor + operações (todas gravam no servidor). NP.Store
 * O banco de dados fica no SERVIDOR do hotel; aqui só guardamos uma cópia para desenhar as telas. */
(function () {
  const NP = (window.NP = window.NP || {});
  const Core = NP.Core, Api = NP.Api;
  const listeners = new Set(), statusListeners = new Set();
  const localToday = Core.today;
  let skew = 0, tz = null, online = true, timer = null;

  let state = {
    v: 0, hoje: null, modoGateway: 'simulacao', usuario: null,
    config: { hotel: { nome: 'Hotel e Pousada Novo Paraíso', cidade: 'Caaporã', uf: 'PB' }, pix: {}, regras: {} },
    rooms: [], guests: [], reservations: [], payments: [],
  };

  // "hoje" vem do relógio do servidor, no fuso do hotel (não depende do relógio do computador)
  Core.today = () => (tz ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + skew)) : localToday());

  const emit = (origin) => listeners.forEach((fn) => { try { fn(state, origin); } catch (e) { console.error(e); } });
  function apply(estado, origin = 'local') {
    if (estado.agora) skew = estado.agora - Date.now();
    if (estado.fuso) tz = estado.fuso;
    state = estado;
    emit(origin);
  }
  function setOnline(v) { if (v !== online) { online = v; statusListeners.forEach((fn) => fn(v)); } }

  async function load() { apply(await Api.get('/api/estado')); }

  async function poll() {
    if (document.hidden) return;
    try {
      const r = await Api.get(`/api/estado?v=${state.v}&passivo=1`);
      setOnline(true);
      if (!r.sem_mudanca) apply(r, 'remote');
    } catch (e) { if (e.codigo === 'REDE') setOnline(false); }
  }
  function startPolling() {
    if (timer) return;
    timer = setInterval(poll, 8000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  }

  /** Envia uma operação; o servidor devolve o estado novo, que passa a valer na hora. */
  async function act(promise) {
    const r = await promise;
    if (r.estado) apply(r.estado);
    return r.resultado;
  }

  /* ---------- Consultas (sobre a cópia local) ---------- */
  const find = (list) => (id) => list().find((x) => x.id === id) || null;
  const guest = find(() => state.guests), room = find(() => state.rooms), reservation = find(() => state.reservations);
  const paymentsOf = (resId) => state.payments.filter((p) => p.reservaId === resId);
  const totals = (res) => Core.stayTotals(res, state.payments);

  /* ---------- Operações ---------- */
  const saveGuest = async (g) => (await act(g.id ? Api.put('/api/hospedes/' + g.id, g) : Api.post('/api/hospedes', g))).id;
  const saveRoom = async (r) => (await act(r.id ? Api.put('/api/quartos/' + r.id, r) : Api.post('/api/quartos', r))).id;
  const deleteRoom = (id) => act(Api.request('DELETE', '/api/quartos/' + id));
  const setRoomStatus = (id, status) => act(Api.post(`/api/quartos/${id}/status`, { status }));
  const createReservation = (data) => act(Api.post('/api/reservas', data));
  const cancelReservation = (id, motivo) => act(Api.post(`/api/reservas/${id}/cancelar`, { motivo }));
  const checkIn = async (payload) => (await act(Api.post('/api/checkin', payload))).reservaId;
  const cancelCheckin = (rascunho) => act(Api.post('/api/checkin/cancelar', { rascunho }));
  const addConsumo = (resId, c) => act(Api.post(`/api/reservas/${resId}/consumos`, c));
  const removeConsumo = (resId, cid, autorizacao) => act(Api.post(`/api/reservas/${resId}/consumos/${cid}/remover`, { autorizacao }));
  const changeCheckout = (resId, checkout) => act(Api.post(`/api/reservas/${resId}/saida`, { checkout }));
  const finishCheckout = (resId, manter) => act(Api.post(`/api/reservas/${resId}/checkout`, { manter: !!manter }));
  const refundCredit = (resId, data, autorizacao) => act(Api.post(`/api/reservas/${resId}/devolucao`, { ...data, autorizacao }));
  const voidPayment = (id, motivo, autorizacao) => act(Api.post(`/api/pagamentos/${id}/estornar`, { motivo, autorizacao }));
  const saveConfig = (secao, data, autorizacao) => act(Api.put('/api/config/' + secao, { ...data, ...(autorizacao ? { autorizacao } : {}) }));
  const loadDemo = () => act(Api.post('/api/demo'));
  const clearData = (autorizacao) => act(Api.post('/api/limpar', { confirmacao: 'APAGAR', autorizacao }));

  /** Backup do banco (arquivo .db) — exige o PIN do gerente. */
  async function downloadBackup(autorizacao) {
    const res = await Api.request('POST', '/api/backup', { autorizacao }, { raw: true });
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = name ? name[1] : 'backup-novo-paraiso.db';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  NP.Store = {
    get state() { return state; }, get online() { return online; },
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    onStatus: (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    load, startPolling, apply, guest, room, reservation, paymentsOf, totals,
    saveGuest, saveRoom, deleteRoom, setRoomStatus, createReservation, cancelReservation, checkIn, cancelCheckin,
    addConsumo, removeConsumo, changeCheckout, finishCheckout, refundCredit, voidPayment, saveConfig, loadDemo, clearData, downloadBackup,
  };
})();
