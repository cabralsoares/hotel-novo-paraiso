'use strict';
const crypto = require('node:crypto');

/** Erro com status HTTP e código estável (o navegador decide o que fazer pelo código). */
class HttpError extends Error {
  constructor(status, codigo, mensagem, extra = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

const bad = (mensagem, campos) => new HttpError(400, 'DADOS_INVALIDOS', mensagem, campos ? { campos } : {});
const forbidden = (mensagem) => new HttpError(403, 'PROIBIDO', mensagem);
const notFound = (mensagem = 'Registro não encontrado.') => new HttpError(404, 'NAO_ENCONTRADO', mensagem);
const conflict = (mensagem, codigo = 'CONFLITO') => new HttpError(409, codigo, mensagem);

/** Acumula erros por campo e lança de uma vez. */
function validator() {
  const errors = {};
  return {
    err(campo, msg) { if (!errors[campo]) errors[campo] = msg; },
    has: (campo) => !!errors[campo],
    check() { if (Object.keys(errors).length) throw bad('Confira os campos destacados.', errors); },
  };
}

const uid = () => crypto.randomBytes(9).toString('base64url');
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowISO = () => new Date().toISOString();
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const toCents = (reais) => Math.round(Number(reais) * 100);
const toReais = (cents) => cents / 100;

/** Data de hoje (AAAA-MM-DD) no fuso do hotel — o servidor pode estar em UTC. */
function todayIn(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const int = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN);
/** Valor em reais com no máximo 2 casas. NaN se inválido. */
function money(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return NaN;
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? round2(n) : NaN;
}

module.exports = { HttpError, bad, forbidden, notFound, conflict, validator, uid, sha256hex, nowISO, round2, toCents, toReais, todayIn, str, int, money };
