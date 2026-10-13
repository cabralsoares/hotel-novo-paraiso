'use strict';
// Servidor do Hotel e Pousada Novo Paraíso: API + arquivos da tela, com banco SQLite próprio.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DB = require('./db');
const S = require('./security');
const { dailyBackup } = require('./backup');
const { HttpError, todayIn, uid } = require('./util');
const Gateway = require('./gateway.js');

const MAX_BODY = 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const COOKIE = 'np_sid';

/** Lê um arquivo .env simples (CHAVE=valor), sem sobrescrever o que já veio do ambiente. */
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function readConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3100),
    host: env.HOST || '127.0.0.1',
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
    publicDir: path.resolve(__dirname, '..', 'public'),
    tz: env.HOTEL_TZ || 'America/Recife',
    trustProxy: env.TRUST_PROXY === '1',
    cookieSecure: env.COOKIE_SECURE === '1',
    gatewayLatency: env.GATEWAY_LATENCY_MS !== undefined ? Number(env.GATEWAY_LATENCY_MS) : 1100,
    log: env.LOG_QUIET === '1' ? () => {} : (...a) => console.log(new Date().toISOString(), ...a),
  };
}

function createApp(envOverrides = {}) {
  const config = readConfig({ ...process.env, ...envOverrides });
  const { db, file } = DB.open(config.dataDir);
  const app = { db, config, dbFile: file, setupCode: null };

  /* ---------- Código de primeiro acesso (impede que um estranho crie o gerente num servidor novo) ---------- */
  const codeFile = path.join(config.dataDir, 'CODIGO-PRIMEIRO-ACESSO.txt');
  app.clearSetupCode = () => { app.setupCode = null; fs.rmSync(codeFile, { force: true }); };
  if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n === 0) {
    let code = DB.getMeta(db, 'setup_code');
    if (!code) {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const pick = () => Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
      code = `${pick()}-${pick()}`;
      DB.setMeta(db, 'setup_code', code);
    }
    app.setupCode = code;
    fs.writeFileSync(codeFile, `Código de primeiro acesso: ${code}\n\nDigite este código na tela de login para criar o usuário gerente.\nEste arquivo é apagado automaticamente depois do primeiro acesso.\n`, { mode: 0o600 });
    config.log(`PRIMEIRO ACESSO — código para criar o gerente: ${code}  (também em ${codeFile})`);
  }

  /* ---------- Rotas ---------- */
  const routes = [];
  const add = (method, pattern, opts, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, opts, handler });
  };
  add('GET', '/api/saude', { auth: 'public' }, async () => { app.db.prepare('SELECT 1').get(); return { ok: true }; });
  require('./routes/auth')(add, app);
  require('./routes/hotel')(add, app);
  require('./routes/pay')(add, app);
  require('./routes/admin')(add, app);

  /* ---------- Utilidades da requisição ---------- */
  const clientIp = (req) => {
    if (config.trustProxy) {
      const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (h) return h.slice(0, 64);
    }
    return req.socket.remoteAddress || '';
  };
  const isSecure = (req) => config.cookieSecure || !!req.socket.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https');
  const parseCookies = (h) => Object.fromEntries(String(h || '').split(';').map((p) => p.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));

  function baseHeaders(req) {
    const h = {
      'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Cross-Origin-Opener-Policy': 'same-origin',
    };
    if (isSecure(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
    return h;
  }

  function send(req, res, status, headers, body) {
    res.writeHead(status, { ...baseHeaders(req), ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  const sendJson = (req, res, status, obj, cookies = []) => send(req, res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) }, JSON.stringify(obj));

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (d) => { size += d.length; if (size > MAX_BODY) { reject(new HttpError(413, 'CORPO_GRANDE', 'Requisição grande demais.')); req.destroy(); } else chunks.push(d); });
      req.on('end', () => {
        if (!size) return resolve({});
        try { const o = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('x'); resolve(o); }
        catch { reject(new HttpError(400, 'JSON_INVALIDO', 'Os dados enviados são inválidos.')); }
      });
      req.on('error', reject);
    });
  }

  /* ---------- API ---------- */
  async function handleApi(req, res, url) {
    const t0 = Date.now();
    let status = 200;
    try {
      const matches = routes.filter((r) => r.re.test(url.pathname));
      if (!matches.length) throw new HttpError(404, 'NAO_ENCONTRADO', 'Endereço não encontrado.');
      const route = matches.find((r) => r.method === req.method);
      if (!route) throw new HttpError(405, 'METODO', 'Método não permitido.');
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      if (mutating) {
        // proteção contra requisições vindas de outros sites (CSRF): só aceitamos o nosso próprio navegador/tela
        const origin = req.headers.origin;
        const host = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
        if (origin) { let oh = ''; try { oh = new URL(origin).host; } catch { /* inválido */ } if (oh !== host) throw new HttpError(403, 'ORIGEM', 'Origem não permitida.'); }
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'ORIGEM', 'Origem não permitida.');
        if (req.headers['x-requested-with'] !== 'np') throw new HttpError(403, 'ORIGEM', 'Requisição não permitida.');
        const ct = String(req.headers['content-type'] || '');
        if (Number(req.headers['content-length'] || 0) > 0 && !ct.includes('application/json')) throw new HttpError(415, 'TIPO', 'Tipo de conteúdo não aceito.');
      }
      const body = mutating ? await readBody(req) : {};
      const query = Object.fromEntries(url.searchParams);
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const found = S.readSession(app.db, token, { touch: query.passivo !== '1' });
      if (route.opts.auth !== 'public' && !found) throw new HttpError(401, 'NAO_AUTENTICADO', 'Sua sessão expirou. Entre novamente.');
      if (route.opts.auth === 'gerente' && found.user.perfil !== 'gerente') throw new HttpError(403, 'PROIBIDO', 'Somente gerentes podem fazer isso.');

      const m = route.re.exec(url.pathname);
      const cookies = [];
      const user = found ? found.user : null;
      const c = {
        app, db: app.db, req, body, query, user, session: found ? found.session : null, ip: clientIp(req),
        params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
        today: () => todayIn(config.tz),
        config: () => DB.getConfig(app.db),
        regras: () => DB.getConfig(app.db).regras,
        snapshot: () => DB.snapshot(app.db, { modoGateway: Gateway.mode, usuario: user, agora: Date.now(), fuso: config.tz }),
        mutate(fn) { const resultado = DB.tx(app.db, () => { const r = fn(); DB.bump(app.db); return r; }); return { resultado, estado: c.snapshot() }; },
        setSession(tk, maxAge) { cookies.push(`${COOKIE}=${tk}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`); },
        clearSession() { cookies.push(`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isSecure(req) ? '; Secure' : ''}`); },
      };
      const out = await route.handler(c);
      if (out && out.__raw) {
        send(req, res, 200, { 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) }, out.__raw);
      } else sendJson(req, res, 200, out, cookies);
    } catch (e) {
      let err = e;
      if (!(e instanceof HttpError)) {
        const sqlite = e && (e.code === 'ERR_SQLITE_ERROR') ? String(e.message) : '';
        if (/UNIQUE constraint failed/.test(sqlite)) err = new HttpError(409, 'DUPLICADO', 'Este registro já existe.');
        else { const id = uid(); config.log(`ERRO ${id} ${req.method} ${url.pathname}`, e && e.stack ? e.stack : e); err = new HttpError(500, 'ERRO_INTERNO', `Erro inesperado no servidor (ref. ${id}). Tente novamente.`); }
      }
      status = err.status;
      sendJson(req, res, err.status, { erro: { codigo: err.codigo, mensagem: err.message, ...err.extra } });
    }
    if (req.method !== 'GET' || status >= 400) config.log(`${clientIp(req)} ${req.method} ${url.pathname} ${status} ${Date.now() - t0}ms`);
  }

  /* ---------- Arquivos da tela ---------- */
  function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' }, 'Método não permitido');
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { return send(req, res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Endereço inválido'); }
    if (p === '/' ) p = '/index.html';
    else if (p === '/login' || p === '/login/') p = '/login/index.html';
    const file = path.resolve(config.publicDir, '.' + p);
    const rel = path.relative(config.publicDir, file);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some((s) => s.startsWith('.'))) return send(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Não encontrado');
    let st;
    try { st = fs.statSync(file); } catch { return send(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Não encontrado'); }
    if (!st.isFile()) return send(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Não encontrado');
    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: etag, 'Cache-Control': ['.png', '.svg', '.ico'].includes(ext) ? 'public, max-age=86400' : 'no-cache' };
    if (req.headers['if-none-match'] === etag) return send(req, res, 304, headers);
    send(req, res, 200, headers, fs.readFileSync(file));
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(req, res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Requisição inválida'); }
    if (url.pathname.startsWith('/api/')) handleApi(req, res, url); else handleStatic(req, res, url);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  /* ---------- Rotinas periódicas ---------- */
  const maintenance = () => {
    try { S.purge(app.db); dailyBackup(app.db, config.dataDir, todayIn(config.tz), 14, config.log); } catch (e) { config.log('manutenção falhou:', e.message); }
  };
  maintenance();
  const timer = setInterval(maintenance, 60 * 60 * 1000);
  timer.unref();

  return {
    app, server, config,
    listen: () => new Promise((resolve) => server.listen(config.port, config.host, () => resolve(server.address()))),
    close: () => new Promise((resolve) => { clearInterval(timer); server.close(() => { try { app.db.close(); } catch { /* */ } resolve(); }); server.closeAllConnections && server.closeAllConnections(); }),
  };
}

if (require.main === module) {
  loadDotEnv(path.join(__dirname, '..', '.env'));
  const inst = createApp();
  inst.listen().then((addr) => {
    inst.config.log(`Hotel Novo Paraíso no ar em http://${addr.address}:${addr.port}  |  banco: ${inst.app.dbFile}  |  fuso: ${inst.config.tz}  |  autorizador de cartão: ${Gateway.mode}`);
    if (inst.config.host === '0.0.0.0' && !inst.config.trustProxy) inst.config.log('AVISO: escutando em todas as interfaces sem TRUST_PROXY. Atrás de Nginx/Cloudflare, use TRUST_PROXY=1.');
  });
  const stop = () => inst.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createApp, readConfig };
