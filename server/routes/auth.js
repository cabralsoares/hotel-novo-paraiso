'use strict';
// Login, sessão, autorização do gerente (PIN), usuários, configurações e auditoria.
const crypto = require('node:crypto');
const V = require('../../public/js/validators.js');
const S = require('../security');
const { tx, audit, setConfigSection, getConfig, setMeta, bump } = require('../db');
const { HttpError, bad, notFound, conflict, validator, uid, nowISO, str, int, money, toCents } = require('../util');
const { UFS } = require('../validate');

const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const publicUser = (u) => ({ id: u.id, nome: u.nome, usuario: u.usuario, perfil: u.perfil });
const userRow = (u) => ({ id: u.id, nome: u.nome, usuario: u.usuario, perfil: u.perfil, ativo: !!u.ativo, criadoEm: u.criado_em });

module.exports = function register(add, app) {
  const { db } = app;

  /* ---------- Estado da instalação e login ---------- */
  add('GET', '/api/auth/status', { auth: 'public' }, async () => ({ configurado: db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0 }));

  add('POST', '/api/auth/setup', { auth: 'public' }, async (c) => {
    const b = c.body;
    if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0) throw conflict('O sistema já foi configurado.', 'JA_CONFIGURADO');
    S.assertNotLocked(db, 'setup:' + c.ip, 'tentativas');
    if (!app.setupCode || !safeEq(normCode(b.codigo), normCode(app.setupCode))) {
      S.registerFailure(db, 'setup:' + c.ip, 5, 60);
      throw bad('Código de primeiro acesso incorreto.', { codigo: 'Código incorreto. Ele aparece no registro do servidor (veja o LEIA-ME).' });
    }
    const v = validator();
    const nome = str(b.nome), usuario = str(b.usuario), senha = typeof b.senha === 'string' ? b.senha : '', pin = str(b.pin);
    if (nome.length < 3 || nome.length > 60) v.err('nome', 'Informe seu nome.');
    if (!/^[a-z0-9._-]{3,20}$/i.test(usuario)) v.err('usuario', 'Use 3 a 20 letras, números, ponto, hífen ou _.');
    const pw = V.passwordError(senha, usuario); if (pw) v.err('senha', pw);
    const pn = V.pinError(pin); if (pn) v.err('pin', pn);
    v.check();
    const [senhaHash, pinHash] = [await S.hashSecret(senha), await S.hashSecret(pin)];
    const user = tx(db, () => {
      if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0) throw conflict('O sistema já foi configurado.', 'JA_CONFIGURADO');
      const id = uid();
      db.prepare("INSERT INTO usuarios(id, nome, usuario, perfil, ativo, senha, pin, criado_em) VALUES (?, ?, ?, 'gerente', 1, ?, ?, ?)").run(id, nome, usuario, senhaHash, pinHash, nowISO());
      setMeta(db, 'setup_code', '');
      audit(db, nome, 'Sistema configurado', 'Primeiro gerente criado');
      return { id, nome, usuario, perfil: 'gerente' };
    });
    app.clearSetupCode();
    const sess = S.createSession(db, user.id, c.ip, c.req.headers['user-agent']);
    c.setSession(sess.token, sess.maxAgeSec);
    return { usuario: user };
  });

  add('POST', '/api/auth/login', { auth: 'public' }, async (c) => {
    const usuario = str(c.body.usuario), senha = typeof c.body.senha === 'string' ? c.body.senha : '';
    if (!usuario || !senha || usuario.length > 40 || senha.length > 200) throw bad('Informe usuário e senha.');
    const kU = 'login:' + usuario.toLowerCase(), kI = 'loginip:' + c.ip;
    S.assertNotLocked(db, kU, 'tentativas de login');
    S.assertNotLocked(db, kI, 'tentativas de login');
    const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);
    const ok = u ? await S.verifySecret(senha, u.senha) : (await S.burnTime(senha), false);
    if (!u || !ok) {
      S.registerFailure(db, kU, 5, 30);
      S.registerFailure(db, kI, 20, 60);
      audit(db, 'sistema', 'Login recusado', `usuário "${usuario.slice(0, 40)}"`);
      throw new HttpError(401, 'CREDENCIAIS', 'Usuário ou senha incorretos.');
    }
    if (!u.ativo) throw new HttpError(403, 'USUARIO_INATIVO', 'Usuário desativado. Fale com o gerente.');
    S.clearFailures(db, kU);
    const sess = S.createSession(db, u.id, c.ip, c.req.headers['user-agent']);
    c.setSession(sess.token, sess.maxAgeSec);
    audit(db, u.nome, 'Login');
    return { usuario: publicUser(u) };
  });

  add('POST', '/api/auth/logout', { auth: 'user' }, async (c) => {
    audit(db, c.user.nome, 'Logout');
    S.destroySession(db, c.session.id);
    c.clearSession();
    return { ok: true };
  });

  add('GET', '/api/auth/me', { auth: 'user' }, async (c) => ({ usuario: c.user }));

  /* ---------- Autorização do gerente ---------- */
  add('POST', '/api/autorizar', { auth: 'user' }, async (c) => {
    const pin = str(c.body.pin), escopo = str(c.body.escopo);
    if (!S.SCOPES.has(escopo)) throw bad('Tipo de autorização inválido.');
    if (!/^\d{4,6}$/.test(pin)) throw bad('Digite o PIN do gerente.', { pin: 'Digite o PIN do gerente.' });
    const valor = money(c.body.valor === undefined ? 0 : c.body.valor);
    if (!Number.isFinite(valor) || valor < 0 || valor > 1000000) throw bad('Valor inválido.');
    const kU = 'pin:' + c.user.id, kI = 'pinip:' + c.ip;
    S.assertNotLocked(db, kU, 'tentativas de PIN');
    S.assertNotLocked(db, kI, 'tentativas de PIN');
    const g = await S.verifyManagerPin(db, pin);
    if (!g) {
      S.registerFailure(db, kU, 3, 30);
      S.registerFailure(db, kI, 12, 60);
      audit(db, c.user.nome, 'PIN de gerente incorreto', str(c.body.motivo).slice(0, 100));
      throw new HttpError(401, 'PIN_INCORRETO', 'PIN incorreto.');
    }
    S.clearFailures(db, kU);
    const motivo = str(c.body.motivo).slice(0, 200), detalhe = str(c.body.detalhe).slice(0, 300);
    const token = S.issueAuth(db, { sessaoId: c.session.id, gerenteId: g.id, escopo, valorC: toCents(valor), motivo, detalhe });
    audit(db, c.user.nome, 'Autorização do gerente', `${motivo}${detalhe ? ' — ' + detalhe : ''}`, g.nome);
    return { token, gerente: { nome: g.nome } };
  });

  /* ---------- Usuários ---------- */
  add('GET', '/api/usuarios', { auth: 'gerente' }, async () => ({ usuarios: db.prepare('SELECT * FROM usuarios ORDER BY nome').all().map(userRow) }));

  add('POST', '/api/usuarios', { auth: 'gerente' }, async (c) => {
    const b = c.body, v = validator();
    const nome = str(b.nome), usuario = str(b.usuario), senha = typeof b.senha === 'string' ? b.senha : '', perfil = b.perfil === 'gerente' ? 'gerente' : 'recepcao', pin = str(b.pin);
    if (nome.length < 3 || nome.length > 60) v.err('nome', 'Informe o nome.');
    if (!/^[a-z0-9._-]{3,20}$/i.test(usuario)) v.err('usuario', 'Use 3 a 20 letras, números, ponto, hífen ou _.');
    else if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(usuario)) v.err('usuario', 'Já existe um usuário com esse login.');
    const pw = V.passwordError(senha, usuario); if (pw) v.err('senha', pw);
    if (perfil === 'gerente') { const pn = V.pinError(pin); if (pn) v.err('pin', pn); }
    v.check();
    const [senhaHash, pinHash] = [await S.hashSecret(senha), perfil === 'gerente' ? await S.hashSecret(pin) : null];
    const id = uid();
    tx(db, () => {
      db.prepare('INSERT INTO usuarios(id, nome, usuario, perfil, ativo, senha, pin, criado_em) VALUES (?, ?, ?, ?, 1, ?, ?, ?)').run(id, nome, usuario, perfil, senhaHash, pinHash, nowISO());
      audit(db, c.user.nome, 'Usuário criado', `${nome} (${perfil})`);
    });
    return { id };
  });

  add('POST', '/api/usuarios/:id/senha', { auth: 'gerente' }, async (c) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(c.params.id);
    if (!u) throw notFound('Usuário não encontrado.');
    const senha = typeof c.body.senha === 'string' ? c.body.senha : '';
    const pw = V.passwordError(senha, u.usuario);
    if (pw) throw bad(pw, { senha: pw });
    const h = await S.hashSecret(senha);
    tx(db, () => {
      db.prepare('UPDATE usuarios SET senha = ? WHERE id = ?').run(h, u.id);
      S.destroyUserSessions(db, u.id, u.id === c.user.id ? c.session.id : '');
      audit(db, c.user.nome, 'Senha redefinida', u.nome);
    });
    return { ok: true };
  });

  add('POST', '/api/usuarios/:id/ativo', { auth: 'gerente' }, async (c) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(c.params.id);
    if (!u) throw notFound('Usuário não encontrado.');
    const ativo = c.body.ativo === true;
    if (!ativo && u.id === c.user.id) throw conflict('Você não pode desativar o próprio usuário.');
    if (!ativo && u.perfil === 'gerente' && db.prepare("SELECT COUNT(*) n FROM usuarios WHERE perfil = 'gerente' AND ativo = 1").get().n < 2) throw conflict('Mantenha ao menos um gerente ativo.');
    tx(db, () => {
      db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, u.id);
      if (!ativo) S.destroyUserSessions(db, u.id);
      audit(db, c.user.nome, ativo ? 'Usuário reativado' : 'Usuário desativado', u.nome);
    });
    return { ok: true };
  });

  add('POST', '/api/eu/senha', { auth: 'user' }, async (c) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(c.user.id);
    const atual = typeof c.body.atual === 'string' ? c.body.atual : '', nova = typeof c.body.nova === 'string' ? c.body.nova : '';
    S.assertNotLocked(db, 'senha:' + u.id, 'tentativas');
    if (!(await S.verifySecret(atual, u.senha))) { S.registerFailure(db, 'senha:' + u.id, 5, 30); throw bad('Senha atual incorreta.', { atual: 'Senha atual incorreta.' }); }
    const pw = V.passwordError(nova, u.usuario);
    if (pw) throw bad(pw, { nova: pw });
    const h = await S.hashSecret(nova);
    tx(db, () => {
      db.prepare('UPDATE usuarios SET senha = ? WHERE id = ?').run(h, u.id);
      S.destroyUserSessions(db, u.id, c.session.id);
      audit(db, u.nome, 'Senha alterada', u.nome);
    });
    return { ok: true };
  });

  add('POST', '/api/eu/pin', { auth: 'gerente' }, async (c) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(c.user.id);
    const senha = typeof c.body.senha === 'string' ? c.body.senha : '', pin = str(c.body.pin);
    S.assertNotLocked(db, 'senha:' + u.id, 'tentativas');
    if (!(await S.verifySecret(senha, u.senha))) { S.registerFailure(db, 'senha:' + u.id, 5, 30); throw bad('Senha incorreta.', { senha: 'Senha incorreta.' }); }
    const pn = V.pinError(pin);
    if (pn) throw bad(pn, { pin: pn });
    const h = await S.hashSecret(pin);
    tx(db, () => { db.prepare('UPDATE usuarios SET pin = ? WHERE id = ?').run(h, u.id); audit(db, u.nome, 'PIN alterado', u.nome); });
    return { ok: true };
  });

  /* ---------- Configurações (gerente) ---------- */
  add('PUT', '/api/config/:secao', { auth: 'gerente' }, async (c) => {
    const secao = c.params.secao, b = c.body, v = validator();
    let novo, descricao;
    if (secao === 'hotel') {
      const nome = str(b.nome), cidade = str(b.cidade), uf = str(b.uf).toUpperCase(), cnpj = V.digits(b.cnpj), telefone = V.digits(b.telefone), email = str(b.email), endereco = str(b.endereco);
      if (nome.length < 3 || nome.length > 80) v.err('nome', 'Informe o nome do hotel.');
      if (cidade.length < 2 || cidade.length > 60) v.err('cidade', 'Informe a cidade.');
      if (!UFS.includes(uf) || uf === 'EX') v.err('uf', 'Selecione o estado.');
      if (cnpj && !V.isCNPJ(cnpj)) v.err('cnpj', 'CNPJ inválido.');
      if (telefone && !V.isPhone(telefone)) v.err('telefone', 'Telefone inválido.');
      if (email && !V.isEmail(email)) v.err('email', 'E-mail inválido.');
      if (endereco.length > 120) v.err('endereco', 'Endereço longo demais.');
      novo = { nome, cidade, uf, cnpj, telefone, email, endereco }; descricao = 'Dados do hotel';
    } else if (secao === 'pix') {
      const chaveIn = str(b.chave), recebedor = str(b.recebedor), cidade = str(b.cidade);
      const k = chaveIn ? V.parsePixKey(chaveIn) : null;
      if (chaveIn && !k) v.err('chave', 'Chave PIX inválida. Confira o CPF/CNPJ, e-mail, celular com DDD ou chave aleatória.');
      if (recebedor.length < 2 || recebedor.length > 25) v.err('recebedor', 'Informe o nome do recebedor (até 25 letras).');
      if (cidade.length < 2 || cidade.length > 15) v.err('cidade', 'Informe a cidade (até 15 letras).');
      v.check();
      const atual = getConfig(db).pix;
      const novaChave = k ? k.valor : '';
      if (novaChave !== atual.chave) {
        // trocar a chave redireciona o dinheiro do hotel: sempre exige o PIN do gerente
        const g = S.consumeAuth(db, c.session, b.autorizacao, { escopo: 'pix_chave', motivo: 'Alterar a chave PIX do hotel', detalhe: k ? `${k.tipo}: ${k.valor}` : 'remover a chave' });
        audit(db, c.user.nome, 'Chave PIX alterada', `${atual.chave ? atual.chaveTipo + ' ' + atual.chave.slice(0, 4) + '…' : '(nenhuma)'} → ${k ? k.tipo + ' ' + k.valor.slice(0, 4) + '…' : '(nenhuma)'}`, g.nome);
      }
      novo = { chave: novaChave, chaveTipo: k ? k.tipo : '', recebedor, cidade }; descricao = 'PIX do hotel';
    } else if (secao === 'regras') {
      const hhmm = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
      const r = { entradaMinimaPct: int(b.entradaMinimaPct), descontoMaxPct: int(b.descontoMaxPct), maxParcelas: int(b.maxParcelas), limiteGerente: money(b.limiteGerente), parcelaMinima: money(b.parcelaMinima), checkinHora: str(b.checkinHora), checkoutHora: str(b.checkoutHora) };
      if (!(r.entradaMinimaPct >= 0 && r.entradaMinimaPct <= 100)) v.err('entradaMinimaPct', 'De 0 a 100.');
      if (!(r.descontoMaxPct >= 0 && r.descontoMaxPct <= 100)) v.err('descontoMaxPct', 'De 0 a 100.');
      if (!(r.maxParcelas >= 1 && r.maxParcelas <= 12)) v.err('maxParcelas', 'De 1 a 12.');
      if (!(r.parcelaMinima >= 1 && r.parcelaMinima <= 100000)) v.err('parcelaMinima', 'Mínimo R$ 1,00.');
      if (!(r.limiteGerente >= 0 && r.limiteGerente <= 1000000)) v.err('limiteGerente', 'Valor inválido.');
      if (!hhmm(r.checkinHora)) v.err('checkinHora', 'Informe o horário.');
      if (!hhmm(r.checkoutHora)) v.err('checkoutHora', 'Informe o horário.');
      novo = r; descricao = 'Regras de cobrança';
    } else throw notFound('Configuração desconhecida.');
    v.check();
    const resultado = tx(db, () => { setConfigSection(db, secao, novo); audit(db, c.user.nome, 'Configuração alterada', descricao); bump(db); return { ok: true }; });
    return { resultado, estado: c.snapshot() };
  });

  add('GET', '/api/auditoria', { auth: 'gerente' }, async (c) => {
    const limite = Math.min(1000, Math.max(1, int(c.query.limite) || 300));
    return { eventos: db.prepare('SELECT em, operador, acao, detalhe, por FROM auditoria ORDER BY id DESC LIMIT ?').all(limite) };
  });
};
