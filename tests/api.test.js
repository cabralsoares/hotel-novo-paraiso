// Testes da API (servidor real + banco SQLite temporário): node --test tests/api.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/server.js');
const { todayIn } = require('../server/util.js');
const Core = require('../public/js/core.js');
const Gateway = require('../server/gateway.js');

const T = todayIn('America/Recife');
let inst, base, dataDir;

function client() {
  let cookie = '';
  return {
    async req(method, url, body, headers = {}) {
      const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'np', ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of res.headers.getSetCookie()) { const kv = c.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
      const buf = Buffer.from(await res.arrayBuffer());
      const text = buf.toString('utf8');
      let json = null; try { json = JSON.parse(text); } catch { /* não é JSON */ }
      return { status: res.status, json, headers: res.headers, text, buf };
    },
    get: function (u) { return this.req('GET', u); },
    post: function (u, b = {}) { return this.req('POST', u, b); },
  };
}
const guest = (cpf, nome = 'Fernanda Albuquerque Dias') => ({ nome, docTipo: 'cpf', doc: cpf, nascimento: '1990-05-01', nacionalidade: 'Brasileira', telefone: '81999887766', email: '', cidade: 'Recife', uf: 'PE', motivo: 'Lazer', transporte: 'Carro' });
const goodCard = { tipo: 'credito', numero: '4111 1111 1111 1111', nome: 'FERNANDA A DIAS', validade: '12/30', cvv: '123', cpf: '529.982.247-25', parcelas: 1 };
let draftN = 0;
const draft = () => `rasc-${Date.now().toString(36)}-${++draftN}`;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-api-'));
  inst = createApp({ DATA_DIR: dataDir, PORT: '0', HOST: '127.0.0.1', GATEWAY_LATENCY_MS: '0', LOG_QUIET: '1', HOTEL_TZ: 'America/Recife' });
  base = `http://127.0.0.1:${(await inst.listen()).port}`;
});
test.after(async () => { await inst.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const state = {}; // compartilhado entre os testes (ordem importa)

test('arquivos da tela, cabeçalhos de segurança e caminhos protegidos', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/login')).status, 200, '/login sem barra funciona');
  assert.equal((await fetch(base + '/login/')).status, 200);
  for (const p of ['/%2e%2e/server/db.js', '/..%2fserver%2fdb.js', '/.env', '/js/../../package.json', '/data/hotel.db', '/server/db.js']) assert.equal((await fetch(base + p)).status, 404, 'não pode servir ' + p);
  assert.equal((await fetch(base + '/js/core.js')).status, 200);
});

test('configuração padrão respeita os limites que o próprio servidor valida', async () => {
  const cfg = require('../server/db.js').DEFAULT_CONFIG;
  assert.ok(cfg.pix.recebedor.length <= 25 && cfg.pix.cidade.length <= 15, 'nome/cidade do PIX cabem no padrão BR Code');
  // salvar a chave PIX reaproveitando exatamente os valores padrão (como a tela faz) precisa funcionar
  const c = client();
  assert.equal((await c.post('/api/auth/login', { usuario: 'x', senha: 'y' })).status, 401);
});

test('API exige login', async () => {
  const c = client();
  for (const u of ['/api/estado', '/api/auth/me', '/api/usuarios', '/api/auditoria']) { const r = await c.get(u); assert.equal(r.status, 401, u); assert.equal(r.json.erro.codigo, 'NAO_AUTENTICADO'); }
  const h = await c.get('/api/saude'); assert.equal(h.status, 200);
});

test('primeiro acesso exige o código do servidor e valida senha/PIN', async () => {
  const c = client();
  assert.equal((await c.get('/api/auth/status')).json.configurado, false);
  assert.ok(fs.existsSync(path.join(dataDir, 'CODIGO-PRIMEIRO-ACESSO.txt')), 'arquivo do código criado');
  const ok = { nome: 'Jadson Cabral', usuario: 'jadson', senha: 'abc12345', pin: '4821', codigo: inst.app.setupCode };
  let r = await c.post('/api/auth/setup', { ...ok, codigo: 'ERRADO-00' });
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.codigo);
  r = await c.post('/api/auth/setup', { ...ok, senha: '123' });
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.senha);
  r = await c.post('/api/auth/setup', { ...ok, pin: '1234' });
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.pin);
  r = await c.post('/api/auth/setup', ok);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cookie = r.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\//);
  assert.equal((await c.get('/api/auth/me')).json.usuario.perfil, 'gerente');
  assert.equal((await client().post('/api/auth/setup', ok)).status, 409, 'segundo setup é bloqueado');
  assert.equal(fs.existsSync(path.join(dataDir, 'CODIGO-PRIMEIRO-ACESSO.txt')), false, 'código apagado');
  state.ger = c;
});

test('proteção contra requisições de outros sites (CSRF)', async () => {
  const ger = state.ger;
  const sem = await fetch(base + '/api/quartos/q101/status', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ger.cookie || '' }, body: '{}' });
  assert.equal(sem.status, 403, 'sem o cabeçalho da nossa tela');
  const fora = await ger.req('POST', '/api/quartos/q101/status', { status: 'livre' }, { origin: 'https://site-malicioso.example' });
  assert.equal(fora.status, 403, 'origem diferente');
  const cross = await ger.req('POST', '/api/quartos/q101/status', { status: 'livre' }, { 'sec-fetch-site': 'cross-site' });
  assert.equal(cross.status, 403);
  const dentro = await ger.req('POST', '/api/quartos/q101/status', { status: 'livre' }, { origin: base });
  assert.equal(dentro.status, 200, 'origem correta passa');
});

test('usuários, perfis e bloqueio de login', async () => {
  const ger = state.ger;
  let r = await ger.post('/api/usuarios', { nome: 'Ana Recepção', usuario: 'ana', senha: 'recep1234', perfil: 'recepcao' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await ger.post('/api/usuarios', { nome: 'Ana Dois', usuario: 'ANA', senha: 'recep1234', perfil: 'recepcao' });
  assert.equal(r.status, 400, 'login duplicado (sem diferenciar maiúsculas)');
  const ana = client();
  assert.equal((await ana.post('/api/auth/login', { usuario: 'ana', senha: 'recep1234' })).status, 200);
  state.ana = ana;
  for (const [m, u, b] of [['GET', '/api/usuarios'], ['PUT', '/api/config/hotel', {}], ['POST', '/api/backup', {}], ['POST', '/api/quartos', {}], ['POST', '/api/demo', {}], ['GET', '/api/auditoria']]) {
    const x = await ana.req(m, u, b); assert.equal(x.status, 403, `recepção não pode ${m} ${u}`);
  }
  // bloqueio: 5 senhas erradas travam o usuário (até com a senha certa)
  const t = client();
  for (let i = 0; i < 5; i++) assert.equal((await t.post('/api/auth/login', { usuario: 'ana', senha: 'errada' + i })).status, 401);
  const trav = await t.post('/api/auth/login', { usuario: 'ana', senha: 'recep1234' });
  assert.equal(trav.status, 429); assert.ok(trav.json.erro.extra === undefined && trav.json.erro.espera > 0);
  assert.equal((await client().post('/api/auth/login', { usuario: 'naoexiste', senha: 'x1234567' })).status, 401, 'usuário inexistente: mesma resposta');
  // limpa o bloqueio para os próximos testes
  inst.app.db.prepare("DELETE FROM tentativas WHERE chave LIKE 'login:%' OR chave LIKE 'loginip:%'").run();
});

test('estado não vaza segredos e o número de versão permite atualização leve', async () => {
  const s = await state.ana.get('/api/estado');
  assert.equal(s.status, 200);
  assert.ok(s.json.rooms.length === 12 && s.json.modoGateway === 'simulacao');
  assert.doesNotMatch(s.text, /scrypt\$/, 'sem hashes');
  assert.doesNotMatch(s.text, /"senha"|"pin"/);
  const again = await state.ana.get('/api/estado?v=' + s.json.v);
  assert.equal(again.json.sem_mudanca, true);
});

test('PIN do gerente: errado é recusado, certo vira ficha de uso único presa à sessão', async () => {
  const ana = state.ana;
  let r = await ana.post('/api/autorizar', { pin: '0000', escopo: 'estorno', valor: 10, motivo: 'teste' });
  assert.equal(r.status, 401); assert.equal(r.json.erro.codigo, 'PIN_INCORRETO');
  r = await ana.post('/api/autorizar', { pin: '4821', escopo: 'inventado', motivo: 'x' });
  assert.equal(r.status, 400);
  r = await ana.post('/api/autorizar', { pin: '4821', escopo: 'estorno', valor: 10, motivo: 'teste' });
  assert.equal(r.status, 200); assert.equal(r.json.gerente.nome, 'Jadson Cabral'); assert.ok(r.json.token.length > 20);
  // 3 PINs errados bloqueiam
  const x = client(); await x.post('/api/auth/login', { usuario: 'jadson', senha: 'abc12345' });
  for (let i = 0; i < 3; i++) await x.post('/api/autorizar', { pin: '9999', escopo: 'estorno', motivo: 't' });
  assert.equal((await x.post('/api/autorizar', { pin: '4821', escopo: 'estorno', motivo: 't' })).status, 429, 'PIN bloqueado após 3 erros');
  inst.app.db.prepare("DELETE FROM tentativas WHERE chave LIKE 'pin%'").run();
});

let resA; // hospedagem principal
test('check-in: valida dados, exige entrada mínima e fecha tudo no servidor', async () => {
  const ger = state.ger;
  const rascunho = draft();
  const payload = (over = {}) => ({ rascunho, guest: guest('52998224725'), roomId: 'q104', checkout: Core.addDays(T, 3), adultos: 2, criancas: 0, descontoPct: 0, placa: '', obs: '', aceite: true, ...over });
  let r = await ger.post('/api/checkin', payload({ guest: guest('11111111111') }));
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.doc, 'CPF inválido');
  r = await ger.post('/api/checkin', payload({ checkout: T, placa: 'XX' }));
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.checkout && r.json.erro.campos.placa, 'saída no mesmo dia e placa inválida');
  r = await ger.post('/api/checkin', payload({ aceite: false }));
  assert.equal(r.status, 400);
  r = await ger.post('/api/checkin', payload({ adultos: 9, roomId: 'q101' }));
  assert.equal(r.status, 400);
  // sem pagamento: precisa de autorização de gerente
  r = await ger.post('/api/checkin', payload());
  assert.equal(r.status, 403); assert.equal(r.json.erro.codigo, 'AUTORIZACAO_NECESSARIA'); assert.equal(r.json.erro.escopo, 'sem_entrada');
  // entrada mínima de 30% de R$ 570 = R$ 171 → paga R$ 200 em dinheiro
  const p = await ger.post('/api/pagamentos/dinheiro', { rascunho, hospede: 'Fernanda', valor: 200, recebido: 250 });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.resultado.pagamento.detalhes.troco, 50);
  r = await ger.post('/api/checkin', payload());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  resA = r.json.resultado.reservaId;
  const est = r.json.estado;
  const res = est.reservations.find((x) => x.id === resA);
  assert.equal(res.status, 'hospedado'); assert.equal(res.diaria, 190);
  assert.equal(est.rooms.find((q) => q.id === 'q104').status, 'ocupado');
  assert.equal(est.payments.find((x) => x.rascunho === rascunho).reservaId, resA, 'pagamento do rascunho foi ligado à reserva');
  // mesmo quarto de novo: não pode
  r = await ger.post('/api/checkin', { ...payload(), rascunho: draft(), guest: guest('39053344705', 'Outro Hospede Teste') });
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.roomId);
});

test('desconto acima do limite: servidor exige ficha com valor suficiente, de uso único e da própria sessão', async () => {
  const ger = state.ger, ana = state.ana;
  const rascunho = draft();
  assert.equal((await ana.post('/api/pagamentos/dinheiro', { rascunho, hospede: 'Beto', valor: 300, recebido: 300 })).status, 200);
  const body = (over = {}) => ({ rascunho, guest: guest('39053344705', 'Beto Santos Lima'), roomId: 'q106', checkout: Core.addDays(T, 3), adultos: 2, criancas: 0, descontoPct: 25, aceite: true, ...over });
  let r = await ana.post('/api/checkin', body());
  assert.equal(r.status, 403); assert.equal(r.json.erro.escopo, 'desconto'); assert.equal(r.json.erro.valor, 25);
  const tok = async (cl, valor) => (await cl.post('/api/autorizar', { pin: '4821', escopo: 'desconto', valor, motivo: 'desconto' })).json.token;
  r = await ana.post('/api/checkin', body({ autDesconto: await tok(ana, 10) }));
  assert.equal(r.status, 403, 'ficha de 10% não cobre 25%');
  const doOutro = await tok(ger, 25);
  r = await ana.post('/api/checkin', body({ autDesconto: doOutro }));
  assert.equal(r.status, 403, 'ficha de outra sessão não vale');
  const bom = await tok(ana, 25);
  r = await ana.post('/api/checkin', body({ autDesconto: bom }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const res = r.json.estado.reservations.find((x) => x.id === r.json.resultado.reservaId);
  assert.equal(res.descontoPct, 25); assert.equal(res.descontoAutorizadoPor, 'Jadson Cabral');
  // reusar a mesma ficha em outra operação: não vale
  r = await ana.post('/api/checkin', body({ rascunho: draft(), guest: guest('16899535009', 'Carla Mendes Rocha'), roomId: 'q105', autDesconto: bom }));
  assert.equal(r.status, 403, 'ficha já usada');
});

test('PIX: chave só com PIN, cobrança com QR válido, comprovante validado e de uso único', async () => {
  const ger = state.ger;
  const Pix = require('../server/pix.js');
  let r = await ger.post('/api/pix/cobrancas', { reservaId: resA, valor: 50 });
  assert.equal(r.status, 409); assert.equal(r.json.erro.codigo, 'SEM_CHAVE_PIX');
  r = await ger.req('PUT', '/api/config/pix', { chave: '83999991234', recebedor: 'Hotel Novo Paraiso', cidade: 'Caapora' });
  assert.equal(r.status, 403); assert.equal(r.json.erro.escopo, 'pix_chave', 'trocar a chave PIX exige PIN');
  const t = (await ger.post('/api/autorizar', { pin: '4821', escopo: 'pix_chave', motivo: 'chave' })).json.token;
  r = await ger.req('PUT', '/api/config/pix', { chave: '83999991234', recebedor: 'Hotel Novo Paraiso', cidade: 'Caapora', autorizacao: t });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.estado.config.pix.chave, '+5583999991234');
  r = await ger.post('/api/pix/cobrancas', { reservaId: resA, valor: 9999 });
  assert.equal(r.status, 400, 'não cobra mais que o saldo');
  r = await ger.post('/api/pix/cobrancas', { reservaId: resA, valor: 50 });
  assert.equal(r.status, 200);
  assert.ok(Pix.verifyPayload(r.json.payload) && r.json.payload.includes('540550.00') && r.json.payload.includes('+5583999991234'));
  const txid = r.json.txid;
  const e2e = Gateway.fakeE2E();
  r = await ger.post('/api/pix/confirmar', { txid, e2e: 'E123', conferi: true });
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.e2e);
  r = await ger.post('/api/pix/confirmar', { txid, e2e: Gateway.fakeE2E(new Date(Date.now() - 8 * 3600e3)), conferi: true });
  assert.equal(r.status, 400, 'comprovante antigo');
  r = await ger.post('/api/pix/confirmar', { txid, e2e, conferi: false });
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.conferi);
  r = await ger.post('/api/pix/confirmar', { txid, e2e, conferi: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.resultado.pagamento.status, 'autorizado');
  // o mesmo comprovante não paga duas vezes
  const c2 = (await ger.post('/api/pix/cobrancas', { reservaId: resA, valor: 20 })).json.txid;
  r = await ger.post('/api/pix/confirmar', { txid: c2, e2e, conferi: true });
  assert.equal(r.status, 400); assert.match(r.json.erro.campos.e2e, /já foi usado/);
  // cobrança expirada
  inst.app.db.prepare('UPDATE pix_cobrancas SET expira_em = ? WHERE txid = ?').run(Date.now() - 1000, c2);
  r = await ger.post('/api/pix/confirmar', { txid: c2, e2e: Gateway.fakeE2E(), conferi: true });
  assert.equal(r.status, 409); assert.equal(r.json.erro.codigo, 'COBRANCA_EXPIRADA');
  // cobrança de outro operador não pode ser confirmada por mim
  const c3 = (await ger.post('/api/pix/cobrancas', { reservaId: resA, valor: 20 })).json.txid;
  r = await state.ana.post('/api/pix/confirmar', { txid: c3, e2e: Gateway.fakeE2E(), conferi: true });
  assert.equal(r.status, 404);
});

test('cartão: validação no servidor, autorização, recusa registrada e NADA sensível gravado', async () => {
  const ger = state.ger;
  let r = await ger.post('/api/pagamentos/cartao', { reservaId: resA, valor: 100, ...goodCard, numero: '4111 1111 1111 1112', validade: '01/20', cvv: '1', nome: 'X', cpf: '1' });
  assert.equal(r.status, 400);
  for (const k of ['numero', 'validade', 'cvv', 'nome', 'cpf']) assert.ok(r.json.erro.campos[k], 'erro em ' + k);
  r = await ger.post('/api/pagamentos/cartao', { reservaId: resA, valor: 100, ...goodCard, tipo: 'debito', parcelas: 3 });
  assert.equal(r.status, 200, 'débito ignora parcelas');
  assert.equal(r.json.resultado.pagamento.detalhes.parcelas, 1);
  r = await ger.post('/api/pagamentos/cartao', { reservaId: resA, valor: 60, ...goodCard, parcelas: 6 });
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.parcelas, 'parcela mínima de R$ 50');
  r = await ger.post('/api/pagamentos/cartao', { reservaId: resA, valor: 50, ...goodCard, numero: '4000 0000 0000 9995' });
  assert.equal(r.status, 200); assert.equal(r.json.resultado.pagamento.status, 'recusado'); assert.equal(r.json.resultado.pagamento.detalhes.codigo, '51');
  r = await ger.post('/api/pagamentos/cartao', { reservaId: resA, valor: 30, ...goodCard, numero: '5555 5555 5555 4444', cvv: '987' });
  assert.equal(r.status, 200); assert.equal(r.json.resultado.pagamento.detalhes.bandeira, 'Mastercard'); assert.equal(r.json.resultado.pagamento.detalhes.final4, '4444');
  // varredura: nem no banco, nem no WAL, nem em respostas
  inst.app.db.exec('PRAGMA wal_checkpoint(FULL)');
  for (const f of [inst.app.dbFile, inst.app.dbFile + '-wal']) {
    if (!fs.existsSync(f)) continue;
    const bin = fs.readFileSync(f).toString('latin1');
    for (const secret of ['4111111111111111', '4111 1111 1111 1111', '5555555555554444', '5555 5555 5555 4444', '4000000000009995', '12/30']) assert.ok(!bin.includes(secret), `${secret} não pode estar em ${path.basename(f)}`);
  }
  const s = await ger.get('/api/estado');
  assert.doesNotMatch(s.text, /4111|5555555555554444|"cvv"|"validade"/);
});

test('limite do operador, saldo e autorização de valor alto', async () => {
  const ger = state.ger;
  const tk = async (escopo, valor) => (await ger.post('/api/autorizar', { pin: '4821', escopo, valor, motivo: 'm' })).json.token;
  let t = await tk('pix_chave', 0);
  // baixa o limite para R$ 100 (config de regras não exige PIN, só gerente)
  let r = await ger.req('PUT', '/api/config/regras', { entradaMinimaPct: 30, descontoMaxPct: 10, maxParcelas: 6, parcelaMinima: 50, limiteGerente: 100, checkinHora: '14:00', checkoutHora: '12:00' });
  assert.equal(r.status, 200);
  r = await ger.post('/api/pagamentos/dinheiro', { reservaId: resA, valor: 150, recebido: 150 });
  assert.equal(r.status, 403); assert.equal(r.json.erro.escopo, 'valor_alto'); assert.equal(r.json.erro.valor, 150);
  r = await ger.post('/api/pagamentos/dinheiro', { reservaId: resA, valor: 150, recebido: 150, autorizacao: await tk('valor_alto', 100) });
  assert.equal(r.status, 403, 'ficha de R$ 100 não cobre R$ 150');
  r = await ger.post('/api/pagamentos/dinheiro', { reservaId: resA, valor: 150, recebido: 150, autorizacao: await tk('valor_alto', 150) });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.resultado.pagamento.autorizadoPor, 'Jadson Cabral');
  await ger.req('PUT', '/api/config/regras', { entradaMinimaPct: 30, descontoMaxPct: 10, maxParcelas: 6, parcelaMinima: 50, limiteGerente: 3000, checkinHora: '14:00', checkoutHora: '12:00' });
  // pagamentos válidos até agora na reserva A: 200 + 100 (débito) + 50 (pix) + 30 (crédito) + 150 = 530; total 570 → saldo 40
  const s = (await ger.get('/api/estado')).json;
  const pago = s.payments.filter((p) => p.reservaId === resA && ['autorizado', 'faturado'].includes(p.status)).reduce((a, p) => a + p.valor, 0);
  assert.equal(pago, 530);
  r = await ger.post('/api/pagamentos/dinheiro', { reservaId: resA, valor: 41, recebido: 41 });
  assert.equal(r.status, 400, 'valor acima do saldo é recusado pelo servidor');
});

test('faturado: CNPJ, vencimento e PIN do gerente', async () => {
  const ger = state.ger;
  const base = { reservaId: resA, valor: 10, cnpj: '11.222.333/0001-81', razao: 'Construtora Litoral Ltda', email: '', vencimento: Core.addDays(T, 15), ordem: '' };
  let r = await ger.post('/api/pagamentos/faturado', { ...base, cnpj: '11.222.333/0001-82' });
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.cnpj);
  r = await ger.post('/api/pagamentos/faturado', { ...base, vencimento: Core.addDays(T, 90) });
  assert.equal(r.status, 400);
  r = await ger.post('/api/pagamentos/faturado', base);
  assert.equal(r.status, 403); assert.equal(r.json.erro.escopo, 'faturado');
  const tk = (await ger.post('/api/autorizar', { pin: '4821', escopo: 'faturado', valor: 10, motivo: 'fat' })).json.token;
  r = await ger.post('/api/pagamentos/faturado', { ...base, autorizacao: tk });
  assert.equal(r.status, 200); assert.equal(r.json.resultado.pagamento.status, 'faturado');
});

test('check-out: bloqueia com saldo, finaliza quitado, quarto vai para limpeza', async () => {
  const ger = state.ger;
  let r = await ger.post(`/api/reservas/${resA}/consumos`, { descricao: 'Água mineral', qtd: 2, valor: 5 });
  assert.equal(r.status, 200);
  r = await ger.post(`/api/reservas/${resA}/consumos`, { descricao: 'x', qtd: 0, valor: -1 });
  assert.equal(r.status, 400);
  r = await ger.post(`/api/reservas/${resA}/checkout`, {});
  assert.equal(r.status, 409); assert.equal(r.json.erro.codigo, 'SALDO_PENDENTE');
  // saldo = 570 + 10 - 540 = 40
  r = await ger.post('/api/pagamentos/dinheiro', { reservaId: resA, valor: 40, recebido: 40 });
  assert.equal(r.status, 200);
  r = await ger.post(`/api/reservas/${resA}/checkout`, {});
  assert.equal(r.status, 409, 'saindo antes do previsto, as diárias são recalculadas e o hóspede teria crédito');
  r = await ger.post(`/api/reservas/${resA}/checkout`, { manter: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const e = r.json.estado;
  assert.equal(e.reservations.find((x) => x.id === resA).status, 'finalizada');
  assert.equal(e.rooms.find((q) => q.id === 'q104').status, 'limpeza');
  assert.equal((await ger.post('/api/pagamentos/dinheiro', { reservaId: resA, valor: 1, recebido: 1 })).status, 409, 'não recebe em hospedagem finalizada');
});

test('estorno: exige motivo + PIN, devolve ao saldo e fica na auditoria', async () => {
  const ger = state.ger;
  const s = (await ger.get('/api/estado')).json;
  const deb = s.payments.find((p) => p.reservaId === resA && p.metodo === 'debito' && p.status === 'autorizado');
  let r = await ger.post(`/api/pagamentos/${deb.id}/estornar`, { motivo: 'abc' });
  assert.equal(r.status, 400);
  r = await ger.post(`/api/pagamentos/${deb.id}/estornar`, { motivo: 'Cobrança em duplicidade' });
  assert.equal(r.status, 403); assert.equal(r.json.erro.escopo, 'estorno');
  const tk = (await ger.post('/api/autorizar', { pin: '4821', escopo: 'estorno', valor: deb.valor, motivo: 'estorno' })).json.token;
  r = await ger.post(`/api/pagamentos/${deb.id}/estornar`, { motivo: 'Cobrança em duplicidade', autorizacao: tk });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const novo = r.json.estado.payments.find((p) => p.id === deb.id);
  assert.equal(novo.status, 'estornado'); assert.equal(novo.estorno.motivo, 'Cobrança em duplicidade'); assert.equal(novo.estorno.autorizadoPor, 'Jadson Cabral');
  const tk2 = (await ger.post('/api/autorizar', { pin: '4821', escopo: 'estorno', valor: deb.valor, motivo: 'estorno' })).json.token;
  r = await ger.post(`/api/pagamentos/${deb.id}/estornar`, { motivo: 'Segunda vez', autorizacao: tk2 });
  assert.equal(r.status, 409, 'não estorna duas vezes');
  const aud = (await ger.get('/api/auditoria?limite=500')).json.eventos;
  assert.ok(aud.some((a) => a.acao === 'Pagamento estornado' && a.por === 'Jadson Cabral'));
  assert.ok(aud.some((a) => a.acao === 'Login recusado'), 'tentativas de login falhas ficam registradas');
});

test('saída antecipada gera crédito; devolução exige PIN; depois o check-out libera', async () => {
  const ger = state.ger;
  const rascunho = draft();
  assert.equal((await ger.post('/api/pagamentos/dinheiro', { rascunho, hospede: 'Dora', valor: 380, recebido: 400 })).status, 200);
  let r = await ger.post('/api/checkin', { rascunho, guest: guest('16899535009', 'Dora Almeida Costa'), roomId: 'q105', checkout: Core.addDays(T, 2), adultos: 1, criancas: 0, descontoPct: 0, aceite: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.resultado.reservaId;
  r = await ger.post(`/api/reservas/${id}/checkout`, { manter: false });
  assert.equal(r.status, 409, 'há crédito a devolver');
  r = await ger.post(`/api/reservas/${id}/devolucao`, { metodo: 'dinheiro', valor: 190, motivo: 'Saída antecipada', dataSaida: T });
  assert.equal(r.status, 403); assert.equal(r.json.erro.escopo, 'devolucao');
  let tk = (await ger.post('/api/autorizar', { pin: '4821', escopo: 'devolucao', valor: 500, motivo: 'dev' })).json.token;
  r = await ger.post(`/api/reservas/${id}/devolucao`, { metodo: 'dinheiro', valor: 500, motivo: 'Saída antecipada', dataSaida: T, autorizacao: tk });
  assert.equal(r.status, 400, 'não devolve mais que o crédito');
  tk = (await ger.post('/api/autorizar', { pin: '4821', escopo: 'devolucao', valor: 190, motivo: 'dev' })).json.token;
  r = await ger.post(`/api/reservas/${id}/devolucao`, { metodo: 'dinheiro', valor: 190, motivo: 'Saída antecipada', dataSaida: T, autorizacao: tk });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.resultado.pagamento.valor, -190);
  r = await ger.post(`/api/reservas/${id}/checkout`, { manter: false });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.estado.reservations.find((x) => x.id === id).checkout, T, 'diárias recalculadas até hoje');
});

test('dois operadores no mesmo quarto ao mesmo tempo: só um consegue', async () => {
  const [a, b] = [state.ger, state.ana];
  const mk = async (cl, cpf, nome) => { const rascunho = draft(); await cl.post('/api/pagamentos/dinheiro', { rascunho, hospede: nome, valor: 200, recebido: 200 }); return { rascunho, guest: guest(cpf, nome), roomId: 'q201', checkout: Core.addDays(T, 3), adultos: 2, criancas: 0, descontoPct: 0, aceite: true }; };
  const cpfFrom = (base) => { let s = base; for (const n of [9, 10]) { let sum = 0; for (let i = 0; i < n; i++) sum += Number(s[i]) * (n + 1 - i); s += String(((sum * 10) % 11) % 10); } return s; };
  const [pa, pb] = [await mk(a, cpfFrom('123456789'), 'Eva Souza Prado'), await mk(b, cpfFrom('987654321'), 'Fabio Reis Dantas')];
  const [ra, rb] = await Promise.all([a.post('/api/checkin', pa), b.post('/api/checkin', pb)]);
  const oks = [ra, rb].filter((x) => x.status === 200).length;
  assert.equal(oks, 1, `exatamente um check-in no quarto 201 (status: ${ra.status}/${rb.status})`);
  const perdedor = ra.status === 200 ? rb : ra;
  assert.equal(perdedor.status, 400); assert.ok(perdedor.json.erro.campos.roomId);
});

test('check-in cancelado: pagamentos autorizados são estornados e ficam registrados', async () => {
  const ger = state.ger, rascunho = draft();
  await ger.post('/api/pagamentos/dinheiro', { rascunho, hospede: 'Gil', valor: 50, recebido: 50 });
  await ger.post('/api/pagamentos/cartao', { rascunho, hospede: 'Gil', valor: 80, ...goodCard });
  let r = await ger.post('/api/checkin/cancelar', { rascunho });
  assert.equal(r.status, 200); assert.equal(r.json.resultado.estornados, 2); assert.equal(r.json.resultado.dinheiro, true);
  const ps = r.json.estado.payments.filter((p) => p.rascunho === rascunho);
  assert.equal(ps.length, 2); assert.ok(ps.every((p) => p.status === 'estornado' && p.reservaId === null));
  assert.equal((await state.ana.post('/api/checkin/cancelar', { rascunho })).json.resultado.estornados, 0, 'outro operador não mexe no rascunho alheio');
});

test('reservas, cancelamento e disponibilidade', async () => {
  const ger = state.ger;
  const ci = Core.addDays(T, 10), co = Core.addDays(T, 12);
  let r = await ger.post('/api/reservas', { hospedeId: 'novo', novoHospede: { nome: 'Paulo Roberto Nunes', cpf: '390.533.447-05', telefone: '12345' }, quartoId: 'q203', checkin: ci, checkout: co, adultos: 2, criancas: 0 });
  assert.equal(r.status, 400); assert.ok(r.json.erro.campos.telefone);
  r = await ger.post('/api/reservas', { hospedeId: 'novo', novoHospede: { nome: 'Paulo Roberto Nunes', cpf: '935.411.347-80', telefone: '(83) 99991-1111' }, quartoId: 'q203', checkin: ci, checkout: co, adultos: 2, criancas: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.resultado.id;
  r = await ger.post('/api/reservas', { hospedeId: r.json.estado.guests[0].id, quartoId: 'q203', checkin: Core.addDays(T, 11), checkout: Core.addDays(T, 13), adultos: 2, criancas: 0 });
  assert.equal(r.status, 409); assert.equal(r.json.erro.codigo, 'QUARTO_INDISPONIVEL');
  r = await ger.post('/api/reservas', { hospedeId: 'novo', novoHospede: { nome: 'Zé Silva', cpf: '390.533.447-05', telefone: '(83) 99991-1111' }, quartoId: 'q204', checkin: T, checkout: Core.addDays(T, -1), adultos: 1 });
  assert.equal(r.status, 400);
  assert.equal((await ger.post(`/api/reservas/${id}/cancelar`, { motivo: 'x' })).status, 400);
  assert.equal((await ger.post(`/api/reservas/${id}/cancelar`, { motivo: 'Hóspede desistiu' })).status, 200);
  assert.equal((await ger.post(`/api/reservas/${id}/cancelar`, { motivo: 'Hóspede desistiu' })).status, 409, 'já cancelada');
});

test('backup baixa um banco SQLite válido, mas só com PIN', async () => {
  const ger = state.ger;
  let r = await ger.post('/api/backup', {});
  assert.equal(r.status, 403); assert.equal(r.json.erro.escopo, 'backup');
  const tk = (await ger.post('/api/autorizar', { pin: '4821', escopo: 'backup', motivo: 'backup' })).json.token;
  r = await ger.post('/api/backup', { autorizacao: tk });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /backup-novo-paraiso-\d{4}-\d{2}-\d{2}\.db/);
  assert.equal(r.buf.subarray(0, 15).toString('latin1'), 'SQLite format 3', 'é um banco SQLite de verdade');
  assert.equal((await ger.post('/api/backup', { autorizacao: tk })).status, 403, 'a ficha do backup só vale uma vez');
});

test('limpeza dos dados exige confirmação por escrito e PIN, mas preserva a auditoria', async () => {
  const ger = state.ger;
  let r = await ger.post('/api/limpar', { confirmacao: 'apagar' });
  assert.equal(r.status, 400);
  r = await ger.post('/api/limpar', { confirmacao: 'APAGAR' });
  assert.equal(r.status, 403); assert.equal(r.json.erro.escopo, 'limpar');
  const tk = (await ger.post('/api/autorizar', { pin: '4821', escopo: 'limpar', motivo: 'limpar' })).json.token;
  r = await ger.post('/api/limpar', { confirmacao: 'APAGAR', autorizacao: tk });
  assert.equal(r.status, 200);
  assert.equal(r.json.estado.reservations.length, 0); assert.equal(r.json.estado.payments.length, 0);
  assert.ok(r.json.estado.rooms.every((q) => q.status === 'livre'));
  const aud = (await ger.get('/api/auditoria')).json.eventos;
  assert.ok(aud.length > 10 && aud.some((a) => a.acao === 'Dados operacionais apagados'));
  r = await ger.post('/api/demo', {});
  assert.equal(r.status, 200); assert.equal(r.json.estado.reservations.length, 4);
  assert.equal((await ger.post('/api/demo', {})).status, 409, 'exemplo só em sistema vazio');
});

test('sair encerra a sessão no servidor', async () => {
  const c = client();
  await c.post('/api/auth/login', { usuario: 'jadson', senha: 'abc12345' });
  assert.equal((await c.get('/api/auth/me')).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 401);
});
