/* Validações brasileiras e de cartão. Roda no navegador (NP.Validators) e no Node (testes). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.NP = root.NP || {}; root.NP.Validators = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');

  function isCPF(v) {
    const c = digits(v);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    for (let t = 9; t < 11; t++) {
      let sum = 0;
      for (let i = 0; i < t; i++) sum += Number(c[i]) * (t + 1 - i);
      if (((sum * 10) % 11) % 10 !== Number(c[t])) return false;
    }
    return true;
  }

  function isCNPJ(v) {
    const c = digits(v);
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
    const dv = (n) => {
      const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(c[i]) * w[i];
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
  }

  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());

  function isPhone(v) {
    let d = digits(v);
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    if (d.length !== 10 && d.length !== 11) return false;
    if (Number(d.slice(0, 2)) < 11) return false;
    if (d.length === 11 && d[2] !== '9') return false;
    return true;
  }

  function isDateISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
  }

  function ageOn(birthISO, todayISO) {
    const [by, bm, bd] = birthISO.split('-').map(Number);
    const [ty, tm, td] = todayISO.split('-').map(Number);
    let age = ty - by;
    if (tm < bm || (tm === bm && td < bd)) age--;
    return age;
  }

  const isPlate = (v) => /^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/i.test(String(v || '').trim());

  /* ---------- Cartões ---------- */
  const BRANDS = [
    { id: 'elo', name: 'Elo', cvv: 3, lengths: [16],
      re: /^(401178|401179|431274|438935|451416|457393|457631|457632|504175|50(6699|67[0-6]\d|677[0-8])|509\d{3}|627780|636297|636368|65003[1-3]|65003[5-9]|65004\d|65005[01]|65040[5-9]|6504[1-3]\d|65048[5-9]|65049\d|6505[0-2]\d|65053[0-8]|65054[1-9]|6505[5-8]\d|65059[0-8]|65070\d|65071[0-8]|65072[0-7]|65090[1-9]|6509[1-6]\d|65097[0-8]|65165[2-9]|6516[67]\d|65500\d|65501\d|65502[1-9]|6550[34]\d|65505[0-8])/ },
    { id: 'amex', name: 'American Express', cvv: 4, lengths: [15], re: /^3[47]/ },
    { id: 'hipercard', name: 'Hipercard', cvv: 3, lengths: [16, 19], re: /^(606282|3841)/ },
    { id: 'diners', name: 'Diners Club', cvv: 3, lengths: [14, 16], re: /^3(0[0-5]|[68])/ },
    { id: 'visa', name: 'Visa', cvv: 3, lengths: [16, 19], re: /^4/ },
    { id: 'mastercard', name: 'Mastercard', cvv: 3, lengths: [16], re: /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/ },
  ];

  function cardBrand(num) {
    const c = digits(num);
    return BRANDS.find((b) => b.re.test(c)) || null;
  }

  function luhn(num) {
    const c = digits(num);
    if (c.length < 12) return false;
    let sum = 0, alt = false;
    for (let i = c.length - 1; i >= 0; i--) {
      let n = Number(c[i]);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function parseExpiry(v) {
    const m = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(String(v || '').trim());
    if (!m) return null;
    const month = Number(m[1]);
    let year = Number(m[2]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12) return null;
    return { month, year };
  }

  /** Retorna { campo: 'mensagem' } — objeto vazio quando tudo é válido. */
  function validateCard({ numero, nome, validade, cvv }, now = new Date()) {
    const e = {};
    const brand = cardBrand(numero);
    const n = digits(numero);
    if (!n) e.numero = 'Informe o número do cartão.';
    else if (!brand) e.numero = 'Bandeira não reconhecida.';
    else if (!brand.lengths.includes(n.length)) e.numero = `Número incompleto para ${brand.name}.`;
    else if (!luhn(n)) e.numero = 'Número de cartão inválido (verifique os dígitos).';

    const nm = String(nome || '').trim();
    if (!nm) e.nome = 'Informe o nome impresso no cartão.';
    else if (!/^[A-Za-zÀ-ÿ'.\- ]+$/.test(nm) || nm.split(/\s+/).filter(Boolean).length < 2) e.nome = 'Informe o nome completo como está no cartão.';

    const ex = parseExpiry(validade);
    if (!String(validade || '').trim()) e.validade = 'Informe a validade (MM/AA).';
    else if (!ex) e.validade = 'Validade inválida. Use MM/AA.';
    else {
      const curY = now.getFullYear(), curM = now.getMonth() + 1;
      if (ex.year < curY || (ex.year === curY && ex.month < curM)) e.validade = 'Cartão vencido.';
      else if (ex.year > curY + 20) e.validade = 'Validade fora do intervalo esperado.';
    }

    const cv = digits(cvv);
    const need = brand ? brand.cvv : null;
    if (!cv) e.cvv = 'Informe o código de segurança.';
    else if (need ? cv.length !== need : cv.length < 3 || cv.length > 4) e.cvv = need ? `O CVV da ${brand.name} tem ${need} dígitos.` : 'CVV inválido.';
    return e;
  }

  /* ---------- PIX ---------- */
  /** Normaliza a chave PIX. Retorna { tipo, valor } ou null se inválida. */
  function parsePixKey(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (isEmail(s) && s.length <= 77) return { tipo: 'email', valor: s.toLowerCase() };
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { tipo: 'aleatoria', valor: s.toLowerCase() };
    const d = digits(s);
    if (s.startsWith('+')) return /^55\d{10,11}$/.test(d) && isPhone(d) ? { tipo: 'telefone', valor: '+' + d } : null;
    if (d.length === 14 && isCNPJ(d)) return { tipo: 'cnpj', valor: d };
    if (d.length === 11 && isCPF(d)) return { tipo: 'cpf', valor: d };
    if ((d.length === 10 || d.length === 11) && isPhone(d)) return { tipo: 'telefone', valor: '+55' + d };
    return null;
  }

  /** ID fim-a-fim do PIX: E + ISPB(8) + AAAAMMDDHHmm (UTC, 12) + 11 alfanuméricos = 32 caracteres. */
  function parseE2E(id) {
    const m = /^E(\d{8})(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})[A-Za-z0-9]{11}$/.exec(String(id || '').trim());
    if (!m) return null;
    const [, ispb, y, mo, d, h, mi] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
    if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d || +h > 23 || +mi > 59) return null;
    return { ispb, date };
  }

  /** Erro (string) ou null. O comprovante precisa ser recente: nas últimas 6 h e não do futuro. */
  function checkE2E(id, nowMs = Date.now()) {
    const info = parseE2E(id);
    if (!info) return 'ID da transação inválido. O ID do comprovante PIX tem 32 caracteres e começa com "E".';
    const diff = nowMs - info.date.getTime();
    if (diff < -5 * 60000) return 'A data do comprovante está no futuro.';
    if (diff > 6 * 3600000) return 'Comprovante antigo (mais de 6 horas). Confira se é o pagamento correto.';
    return null;
  }

  /* ---------- Senha e PIN (mesmas regras no navegador e no servidor) ---------- */
  function passwordError(senha, usuario) {
    if (!senha || senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
    if (senha.length > 128) return 'A senha é longa demais (máximo 128 caracteres).';
    if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'Use letras e números na senha.';
    if (usuario && senha.toLowerCase().includes(String(usuario).toLowerCase())) return 'A senha não pode conter o nome de usuário.';
    if (/^(12345678|123456789|senha123|password1|11111111)$/i.test(senha)) return 'Senha muito comum. Escolha outra.';
    return null;
  }
  function pinError(pin) {
    if (!/^\d{4,6}$/.test(pin || '')) return 'O PIN deve ter de 4 a 6 números.';
    if (/^(\d)\1+$/.test(pin)) return 'PIN muito simples (números repetidos).';
    if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'PIN muito simples (sequência).';
    return null;
  }

  return { digits, isCPF, isCNPJ, isEmail, isPhone, isDateISO, ageOn, isPlate, BRANDS, cardBrand, luhn, parseExpiry, validateCard, parsePixKey, parseE2E, checkE2E, passwordError, pinError };
});
