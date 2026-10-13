// Testes do núcleo (sem dependências): node tests/run.js
const assert = require('assert');
const V = require('../public/js/validators.js');
const Pix = require('../server/pix.js');
const Core = require('../public/js/core.js');
const Gateway = require('../server/gateway.js');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('Regras de senha e PIN (iguais no navegador e no servidor)', () => {
  assert(V.passwordError('curta1', 'ana')); assert(V.passwordError('somenteletras', 'ana')); assert(V.passwordError('12345678', 'ana'));
  assert(V.passwordError('ana12345x', 'ana'), 'não pode conter o usuário');
  assert.strictEqual(V.passwordError('Hotel2026ok', 'ana'), null);
  assert(V.pinError('123')); assert(V.pinError('1234')); assert(V.pinError('1111')); assert(V.pinError('9876'));
  assert.strictEqual(V.pinError('4821'), null);
});

test('CPF', () => {
  for (const ok of ['529.982.247-25', '11144477735', '168.995.350-09', '390.533.447-05']) assert(V.isCPF(ok), ok);
  for (const bad of ['111.111.111-11', '529.982.247-24', '123', '', '000.000.000-00']) assert(!V.isCPF(bad), bad);
});

test('CNPJ', () => {
  assert(V.isCNPJ('11.222.333/0001-81'));
  assert(!V.isCNPJ('11.222.333/0001-82'));
  assert(!V.isCNPJ('00000000000000'));
});

test('Luhn e bandeiras', () => {
  const cases = [
    ['4111 1111 1111 1111', 'visa'], ['5555 5555 5555 4444', 'mastercard'], ['3782 822463 10005', 'amex'],
    ['4000 0000 0000 0002', 'visa'], ['4000 0000 0000 9995', 'visa'], ['4000 0000 0000 9979', 'visa'],
  ];
  for (const [n, b] of cases) { assert(V.luhn(n), n); assert.strictEqual(V.cardBrand(n).id, b, n); }
  assert(!V.luhn('4111 1111 1111 1112'));
  assert.strictEqual(V.cardBrand('6362 9700 0000 0000').id, 'elo');
});

test('validateCard: aceita válido e aponta cada erro', () => {
  const now = new Date(2026, 9, 13);
  const ok = { numero: '4111 1111 1111 1111', nome: 'JADSON CABRAL', validade: '10/26', cvv: '123' };
  assert.deepStrictEqual(V.validateCard(ok, now), {}, 'validade no mês corrente ainda vale');
  assert(V.validateCard({ ...ok, validade: '09/26' }, now).validade, 'vencido');
  assert(V.validateCard({ ...ok, validade: '13/27' }, now).validade, 'mês inválido');
  assert(V.validateCard({ ...ok, numero: '4111 1111 1111 1112' }, now).numero, 'luhn');
  assert(V.validateCard({ ...ok, numero: '4111 1111' }, now).numero, 'incompleto');
  assert(V.validateCard({ ...ok, cvv: '12' }, now).cvv, 'cvv curto');
  assert(V.validateCard({ ...ok, nome: 'JADSON' }, now).nome, 'nome completo');
  const amex = { numero: '3782 822463 10005', nome: 'ANA LIMA', validade: '12/28', cvv: '1234' };
  assert.deepStrictEqual(V.validateCard(amex, now), {});
  assert(V.validateCard({ ...amex, cvv: '123' }, now).cvv, 'amex exige 4 dígitos');
});

test('Telefone, e-mail, data, idade, placa', () => {
  assert(V.isPhone('(83) 99999-1234') && V.isPhone('83 3234-1234') && V.isPhone('+55 83 99999-1234'));
  assert(!V.isPhone('(83) 89999-1234') && !V.isPhone('1234') && !V.isPhone('(05) 99999-1234'));
  assert(V.isEmail('a@b.com') && !V.isEmail('a@b') && !V.isEmail('a b@c.com'));
  assert(V.isDateISO('2024-02-29') && !V.isDateISO('2025-02-29') && !V.isDateISO('29/02/2024'));
  assert.strictEqual(V.ageOn('2008-10-14', '2026-10-13'), 17);
  assert.strictEqual(V.ageOn('2008-10-13', '2026-10-13'), 18);
  assert(V.isPlate('ABC1D23') && V.isPlate('ABC-1234') && !V.isPlate('AB123'));
});

test('Chave PIX', () => {
  assert.deepStrictEqual(V.parsePixKey('529.982.247-25'), { tipo: 'cpf', valor: '52998224725' });
  assert.deepStrictEqual(V.parsePixKey('11.222.333/0001-81'), { tipo: 'cnpj', valor: '11222333000181' });
  assert.deepStrictEqual(V.parsePixKey('Contato@Hotel.com.br'), { tipo: 'email', valor: 'contato@hotel.com.br' });
  assert.deepStrictEqual(V.parsePixKey('(83) 99999-1234'), { tipo: 'telefone', valor: '+5583999991234' });
  assert.strictEqual(V.parsePixKey('123e4567-e89b-12d3-a456-426614174000').tipo, 'aleatoria');
  assert.strictEqual(V.parsePixKey('123'), null);
  assert.strictEqual(V.parsePixKey('111.111.111-11'), null);
});

test('E2E do PIX', () => {
  const now = Date.UTC(2026, 9, 13, 15, 30);
  const mk = (min) => Gateway.fakeE2E(new Date(now - min * 60000));
  assert.strictEqual(V.checkE2E(mk(5), now), null);
  assert(V.checkE2E(mk(60 * 7), now), 'antigo');
  assert(V.checkE2E(mk(-30), now), 'futuro');
  assert(V.checkE2E('ABC', now), 'formato');
  assert(V.checkE2E('E00000000202613321500abcdefghijk1', now) !== undefined);
  assert.strictEqual(mk(0).length, 32);
});

test('PIX: CRC16 (vetor padrão) e payload', () => {
  assert.strictEqual(Pix.crc16('123456789'), '29B1');
  const p = Pix.buildPayload({ chave: '+5583999991234', recebedor: 'Hotel e Pousada Novo Paraíso', cidade: 'Caaporã', valor: 123.4, txid: 'NP123' });
  assert(Pix.verifyPayload(p));
  assert(p.startsWith('000201010211'));
  assert(p.includes('0014br.gov.bcb.pix0114+5583999991234'));
  assert(p.includes('5406123.40'));
  assert(p.includes('5925HOTEL E POUSADA NOVO PARA'), 'nome sem acento, limitado a 25');
  assert(p.includes('6007CAAPORA'));
  assert(p.includes('62090505NP123'), 'txid dentro do campo 62');
  assert(!Pix.verifyPayload(p.slice(0, -1) + '0'), 'CRC adulterado deve falhar');
  const tx = Pix.newTxid();
  assert(/^[A-Z0-9]{1,25}$/.test(tx));
});

test('Datas e diárias', () => {
  assert.strictEqual(Core.addDays('2026-10-31', 1), '2026-11-01');
  assert.strictEqual(Core.addDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(Core.nights('2026-10-13', '2026-10-16'), 3);
  assert.strictEqual(Core.nights('2026-10-13', '2026-10-13'), 1, 'mesmo dia = 1 diária');
});

test('Conta do hóspede (diárias, desconto, consumo, pagamentos)', () => {
  const res = { id: 'r1', checkin: '2026-10-13', checkout: '2026-10-16', diaria: 190, descontoPct: 10, consumos: [{ qtd: 2, valor: 7.5 }, { qtd: 1, valor: 30 }] };
  const pays = [
    { reservaId: 'r1', valor: 200, status: 'autorizado' },
    { reservaId: 'r1', valor: 100, status: 'recusado' },
    { reservaId: 'r1', valor: 50, status: 'estornado' },
    { reservaId: 'r1', valor: 100, status: 'faturado' },
    { reservaId: 'r2', valor: 999, status: 'autorizado' },
  ];
  const t = Core.stayTotals(res, pays);
  assert.deepStrictEqual(t, { noites: 3, diarias: 570, desconto: 57, consumos: 45, total: 558, pago: 300, saldo: 258 });
  assert.strictEqual(Core.stayTotals({ ...res, descontoPct: 0, consumos: [] }, []).saldo, 570);
  // arredondamento: 0,1 + 0,2 não pode virar 0,30000000000000004
  assert.strictEqual(Core.stayTotals({ id: 'x', checkin: '2026-10-13', checkout: '2026-10-14', diaria: 0.1, consumos: [{ qtd: 1, valor: 0.2 }] }, []).total, 0.3);
});

test('Disponibilidade de quartos', () => {
  const state = {
    rooms: [{ id: 'a', status: 'livre' }, { id: 'b', status: 'livre' }, { id: 'c', status: 'manutencao' }, { id: 'd', status: 'limpeza' }],
    reservations: [
      { id: '1', roomId: 'a', status: 'reservada', checkin: '2026-10-15', checkout: '2026-10-18' },
      { id: '2', roomId: 'b', status: 'cancelada', checkin: '2026-10-13', checkout: '2026-10-20' },
      { id: '3', roomId: 'd', status: 'hospedado', checkin: '2026-10-10', checkout: '2026-10-12' }, // atrasado: ainda ocupa hoje
    ],
  };
  const T = '2026-10-13';
  const ids = (r) => r.map((x) => x.id).sort().join();
  // 'a' entra no dia 15: livre até lá (intervalo semiaberto). 'd' tem hóspede atrasado, ainda ocupa hoje.
  assert.strictEqual(ids(Core.availableRooms(state, '2026-10-13', '2026-10-15', { todayISO: T })), 'a,b');
  assert.strictEqual(ids(Core.availableRooms(state, '2026-10-13', '2026-10-16', { todayISO: T })), 'b');
  assert.strictEqual(ids(Core.availableRooms(state, '2026-10-18', '2026-10-19', { todayISO: T })), 'a,b,d');
  assert.strictEqual(ids(Core.availableRooms(state, '2026-10-13', '2026-10-14', { todayISO: T, onlyClean: true })), 'a,b');
  assert.strictEqual(Core.availableRooms(state, '2026-10-16', '2026-10-17', { ignoreResId: '1', todayISO: T }).some((r) => r.id === 'a'), true);
  state.reservations[2].checkout = '2026-10-14';
  assert.strictEqual(Core.roomConflicts(state, 'd', '2026-10-13', '2026-10-14', null, T).length, 1, 'hospedado ocupa até a saída');
});

test('Parcelamento respeita a parcela mínima', () => {
  const o = Core.installmentOptions(300, { maxParcelas: 6, parcelaMinima: 50 });
  assert.deepStrictEqual(o.map((x) => x.n), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(Core.installmentOptions(120, { maxParcelas: 6, parcelaMinima: 50 }).map((x) => x.n), [1, 2]);
  assert.deepStrictEqual(Core.installmentOptions(30).map((x) => x.n), [1]);
});

test('Resumo financeiro', () => {
  const s = Core.summarizePayments([
    { metodo: 'pix', valor: 100, status: 'autorizado' }, { metodo: 'dinheiro', valor: 50, status: 'autorizado' },
    { metodo: 'dinheiro', valor: -20, status: 'autorizado' }, { metodo: 'faturado', valor: 300, status: 'faturado' },
    { metodo: 'credito', valor: 80, status: 'estornado' }, { metodo: 'credito', valor: 80, status: 'recusado' },
  ]);
  assert.strictEqual(s.caixa, 130); assert.strictEqual(s.faturado, 300); assert.strictEqual(s.estornado, 80); assert.strictEqual(s.recusados, 1);
  assert.deepStrictEqual(s.porMetodo.dinheiro, { qtd: 2, total: 30 });
});

(async () => {
  test('Autorizador simulado: aprova e recusa conforme as regras', async () => {});
  const gw = async () => {
    const a = await Gateway.authorize({ tipo: 'credito', valor: 100, numero: '4111111111111111', parcelas: 3 }, { latency: 0 });
    assert(a.aprovada && /^\d{6}$/.test(a.nsu) && /^[A-Z0-9]{6}$/.test(a.autorizacao) && a.final4 === '1111');
    assert.strictEqual((await Gateway.authorize({ tipo: 'credito', valor: 100, numero: '4000000000000002' }, { latency: 0 })).codigo, '05');
    assert.strictEqual((await Gateway.authorize({ tipo: 'credito', valor: 100, numero: '4000000000009995' }, { latency: 0 })).codigo, '51');
    assert.strictEqual((await Gateway.authorize({ tipo: 'credito', valor: 100, numero: '4000000000009979' }, { latency: 0 })).codigo, '41');
    assert.strictEqual((await Gateway.authorize({ tipo: 'debito', valor: 5000.01, numero: '4111111111111111' }, { latency: 0 })).codigo, '61');
    assert.strictEqual((await Gateway.authorize({ tipo: 'debito', valor: 10, numero: '4111111111111111', parcelas: 2 }, { latency: 0 })).codigo, '12');
    assert.strictEqual((await Gateway.authorize({ tipo: 'credito', valor: 0, numero: '4111111111111111' }, { latency: 0 })).aprovada, false);
  };
  tests.pop();
  tests.push(['Autorizador simulado: aprova e recusa conforme as regras', gw]);

  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FALHA ' + name + '\n        ' + (e.message || e).split('\n').join('\n        ')); }
  }
  console.log(`\n${passed}/${tests.length} testes passaram`);
  process.exit(failed ? 1 : 0);
})();
