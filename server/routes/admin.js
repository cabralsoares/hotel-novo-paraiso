'use strict';
// Backup, dados de exemplo e limpeza (somente gerente, sempre com PIN).
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../../public/js/core.js');
const S = require('../security');
const DB = require('../db');
const { backupTo } = require('../backup');
const { bad, conflict, uid, nowISO, toCents, str } = require('../util');

module.exports = function register(add, app) {
  const { db } = app;
  const { tx, audit, nextCode, setMeta } = DB;

  add('POST', '/api/backup', { auth: 'gerente' }, async (c) => {
    tx(db, () => S.consumeAuth(db, c.session, c.body.autorizacao, { escopo: 'backup', motivo: 'Baixar backup do banco de dados', detalhe: 'O arquivo contém hóspedes e usuários.' }));
    const tmp = path.join(app.config.dataDir, `tmp-backup-${uid()}.db`);
    try {
      backupTo(db, tmp);
      const data = fs.readFileSync(tmp);
      audit(db, c.user.nome, 'Backup baixado', `${(data.length / 1024).toFixed(0)} KB`);
      return { __raw: data, contentType: 'application/octet-stream', filename: `backup-novo-paraiso-${c.today()}.db` };
    } finally { fs.rmSync(tmp, { force: true }); }
  });

  add('POST', '/api/limpar', { auth: 'gerente' }, async (c) => {
    if (str(c.body.confirmacao) !== 'APAGAR') throw bad('Digite APAGAR para confirmar.', { confirmacao: 'Digite APAGAR para confirmar.' });
    return c.mutate(() => {
      const g = S.consumeAuth(db, c.session, c.body.autorizacao, { escopo: 'limpar', motivo: 'Apagar todos os hóspedes, reservas e pagamentos', detalhe: 'Esta ação não pode ser desfeita. Baixe um backup antes.' });
      for (const t of ['pagamentos', 'pix_cobrancas', 'consumos', 'reservas', 'hospedes']) db.exec(`DELETE FROM ${t}`);
      db.exec("UPDATE quartos SET status = 'livre'");
      setMeta(db, 'seq_reserva', 0);
      audit(db, c.user.nome, 'Dados operacionais apagados', 'Hóspedes, reservas e pagamentos (a auditoria foi mantida)', g.nome);
      return { ok: true };
    });
  });

  add('POST', '/api/demo', { auth: 'gerente' }, async (c) => {
    if (db.prepare('SELECT (SELECT COUNT(*) FROM hospedes) + (SELECT COUNT(*) FROM reservas) n').get().n) throw conflict('Já existem hóspedes/reservas. Os exemplos só entram em um sistema vazio.');
    const T = c.today();
    return c.mutate(() => {
      const now = nowISO();
      const guest = (nome, cpf, nasc, tel, cidade, uf) => {
        const id = uid();
        db.prepare("INSERT INTO hospedes(id, nome, doc_tipo, doc, nascimento, nacionalidade, telefone, email, cidade, uf, motivo, transporte, criado_em) VALUES (?, ?, 'cpf', ?, ?, 'Brasileira', ?, '', ?, ?, 'Lazer', 'Carro', ?)").run(id, nome, cpf, nasc, tel, cidade, uf, now);
        return { id, nome };
      };
      const maria = guest('Maria das Dores Silva', '52998224725', '1985-04-12', '83999112233', 'João Pessoa', 'PB');
      const joao = guest('João Batista Souza', '11144477735', '1979-11-30', '81988334455', 'Recife', 'PE');
      const ana = guest('Ana Beatriz Lima', '16899535009', '1992-07-08', '84987556677', 'Natal', 'RN');
      const carlos = guest('Carlos Eduardo Ramos', '39053344705', '1968-01-21', '11976889900', 'São Paulo', 'SP');
      const reserve = (g, quartoId, ci, co, status, adultos = 2, criancas = 0) => {
        const q = db.prepare('SELECT diaria_c FROM quartos WHERE id = ?').get(quartoId);
        const id = uid();
        db.prepare(`INSERT INTO reservas(id, codigo, hospede_id, quarto_id, checkin, checkout, adultos, criancas, diaria_c, origem, status, criado_em, checkin_real)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserva', ?, ?, ?)`).run(id, nextCode(db), g.id, quartoId, Core.addDays(T, ci), Core.addDays(T, co), adultos, criancas, q.diaria_c, status, now, status === 'hospedado' ? now : null);
        if (status === 'hospedado') db.prepare("UPDATE quartos SET status = 'ocupado' WHERE id = ?").run(quartoId);
        return { id, g };
      };
      const consume = (r, descricao, qtd, valor) => db.prepare('INSERT INTO consumos(id, reserva_id, descricao, qtd, valor_c, em, por) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid(), r.id, descricao, qtd, toCents(valor), now, 'sistema');
      const pay = (r, metodo, valor, detalhes) => db.prepare("INSERT INTO pagamentos(id, reserva_id, usuario_id, hospede, metodo, valor_c, status, tipo, criado_em, operador, detalhes) VALUES (?, ?, ?, ?, ?, ?, 'autorizado', 'recebimento', ?, ?, ?)").run(uid(), r.id, c.user.id, r.g.nome, metodo, toCents(valor), now, c.user.nome, JSON.stringify(detalhes));
      const r1 = reserve(maria, 'q103', -1, 2, 'hospedado');
      consume(r1, 'Água mineral 500 ml', 2, 5);
      pay(r1, 'dinheiro', 150, { recebido: 150, troco: 0 });
      const r4 = reserve(carlos, 'q105', -3, 0, 'hospedado', 1);
      consume(r4, 'Jantar (porção de camarão)', 1, 89.9);
      pay(r4, 'credito', 300, { bandeira: 'Mastercard', final4: '4444', titular: 'CARLOS E RAMOS', parcelas: 2, nsu: '482913', autorizacao: 'K7M2QP', codigo: '00' });
      reserve(joao, 'q104', 0, 3, 'reservada', 2, 1);
      reserve(ana, 'q201', 5, 8, 'reservada');
      db.exec("UPDATE quartos SET status = 'limpeza' WHERE id = 'q102'; UPDATE quartos SET status = 'manutencao' WHERE id = 'q202'");
      audit(db, c.user.nome, 'Dados de exemplo carregados', '4 hóspedes, 4 reservas');
      return { ok: true };
    });
  });
};
