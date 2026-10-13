/* Regras de negócio puras (datas, diárias, conta do hóspede, disponibilidade, parcelas). NP.Core / Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.NP = root.NP || {}; root.NP.Core = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  /* ---------- Datas (sempre 'AAAA-MM-DD' no horário local) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => toISO(new Date());
  const addDays = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
  /** Diárias cobradas: mínimo de 1 (entrada e saída no mesmo dia cobram 1 diária). */
  const nights = (checkin, checkout) => Math.max(1, daysBetween(checkin, checkout));

  /* ---------- Conta do hóspede ---------- */
  const isEffective = (p) => p.status === 'autorizado' || p.status === 'faturado';

  function stayTotals(res, payments) {
    const noites = nights(res.checkin, res.checkout);
    const diarias = round2(noites * res.diaria);
    const desconto = round2((diarias * (res.descontoPct || 0)) / 100);
    const consumos = round2((res.consumos || []).reduce((s, c) => s + c.qtd * c.valor, 0));
    const total = round2(diarias - desconto + consumos);
    const mine = payments.filter((p) => p.reservaId === res.id && isEffective(p));
    const pago = round2(mine.reduce((s, p) => s + p.valor, 0));
    return { noites, diarias, desconto, consumos, total, pago, saldo: round2(total - pago) };
  }

  const entradaMinima = (total, pct) => round2((total * pct) / 100);

  /* ---------- Disponibilidade ---------- */
  const ACTIVE = ['reservada', 'hospedado'];

  function roomConflicts(state, roomId, checkin, checkout, ignoreResId, todayISO = today()) {
    return state.reservations.filter((r) => {
      if (r.roomId !== roomId || r.id === ignoreResId || !ACTIVE.includes(r.status)) return false;
      // quem ainda está hospedado ocupa o quarto pelo menos até o fim de hoje
      const end = r.status === 'hospedado' && r.checkout <= todayISO ? addDays(todayISO, 1) : r.checkout;
      return r.checkin < checkout && checkin < end;
    });
  }

  /** Quartos livres no período. `onlyClean` exige status "livre" (usado no check-in imediato). */
  function availableRooms(state, checkin, checkout, { ignoreResId = null, onlyClean = false, todayISO = today() } = {}) {
    return state.rooms.filter((room) => {
      if (room.status === 'manutencao') return false;
      if (onlyClean && room.status !== 'livre') return false;
      return roomConflicts(state, room.id, checkin, checkout, ignoreResId, todayISO).length === 0;
    });
  }

  /* ---------- Parcelamento ---------- */
  function installmentOptions(valor, { maxParcelas = 6, parcelaMinima = 50 } = {}) {
    const out = [{ n: 1, cada: round2(valor), total: round2(valor) }];
    for (let n = 2; n <= maxParcelas; n++) {
      const cada = Math.floor((valor / n) * 100) / 100;
      if (cada < parcelaMinima) break;
      out.push({ n, cada, total: round2(valor) });
    }
    return out;
  }

  /* ---------- Resumo financeiro ---------- */
  function summarizePayments(list) {
    const porMetodo = {};
    let caixa = 0, faturado = 0, estornado = 0, recusados = 0;
    for (const p of list) {
      if (p.status === 'recusado') { recusados++; continue; }
      if (p.status === 'estornado') { estornado = round2(estornado + p.valor); continue; }
      if (p.status === 'faturado') { faturado = round2(faturado + p.valor); }
      else caixa = round2(caixa + p.valor);
      const m = (porMetodo[p.metodo] = porMetodo[p.metodo] || { qtd: 0, total: 0 });
      m.qtd++;
      m.total = round2(m.total + p.valor);
    }
    return { caixa, faturado, estornado, recusados, porMetodo };
  }

  return { round2, toISO, parseDate, today, addDays, daysBetween, nights, isEffective, stayTotals, entradaMinima, roomConflicts, availableRooms, installmentOptions, summarizePayments };
});
