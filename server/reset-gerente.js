'use strict';
// Recupera o acesso quando o gerente esquece a senha/PIN. Só funciona com acesso ao servidor (que já dá acesso ao banco).
//   node server/reset-gerente.js            (no Docker: docker compose run --rm -it hotel node server/reset-gerente.js)
const readline = require('node:readline/promises');
const path = require('node:path');
const V = require('../public/js/validators.js');
const DB = require('./db');
const S = require('./security');
const { uid, nowISO } = require('./util');

async function main() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const { db } = DB.open(dataDir);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  // no terminal: pergunta e espera; com entrada canalizada (echo ... | node ...): lê todas as linhas antes
  const piped = [];
  if (!process.stdin.isTTY) for await (const line of rl) piped.push(line);
  rl.question = async (q) => { if (process.stdin.isTTY) return readline.Interface.prototype.question.call(rl, q); process.stdout.write(q + '\n'); return piped.shift() || ''; };
  try {
    const managers = db.prepare("SELECT usuario, nome, ativo FROM usuarios WHERE perfil = 'gerente' ORDER BY nome").all();
    console.log(managers.length ? 'Gerentes existentes: ' + managers.map((m) => `${m.usuario}${m.ativo ? '' : ' (desativado)'}`).join(', ') : 'Ainda não há nenhum gerente.');
    const usuario = (await rl.question('Usuário do gerente a recuperar (ou um novo login para criar): ')).trim();
    if (!/^[a-z0-9._-]{3,20}$/i.test(usuario)) throw new Error('Usuário inválido (3 a 20 letras, números, ponto, hífen ou _).');
    const existing = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);
    if (existing && existing.perfil !== 'gerente') throw new Error('Esse usuário não é gerente.');
    const nome = existing ? existing.nome : (await rl.question('Nome completo do novo gerente: ')).trim();
    if (nome.length < 3) throw new Error('Informe o nome.');
    const senha = await rl.question('Nova senha (mín. 8, letras e números): ');
    const pw = V.passwordError(senha, usuario); if (pw) throw new Error(pw);
    const pin = (await rl.question('Novo PIN de autorização (4 a 6 números): ')).trim();
    const pn = V.pinError(pin); if (pn) throw new Error(pn);
    const [sh, ph] = [await S.hashSecret(senha), await S.hashSecret(pin)];
    DB.tx(db, () => {
      if (existing) {
        db.prepare('UPDATE usuarios SET senha = ?, pin = ?, ativo = 1 WHERE id = ?').run(sh, ph, existing.id);
        db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(existing.id);
      } else {
        db.prepare("INSERT INTO usuarios(id, nome, usuario, perfil, ativo, senha, pin, criado_em) VALUES (?, ?, ?, 'gerente', 1, ?, ?, ?)").run(uid(), nome, usuario, sh, ph, nowISO());
      }
      db.prepare("DELETE FROM tentativas WHERE chave LIKE 'login:%' OR chave LIKE 'pin:%' OR chave LIKE 'senha:%' OR chave LIKE 'loginip:%' OR chave LIKE 'pinip:%'").run();
      DB.bump(db);
      DB.audit(db, 'servidor', existing ? 'Acesso do gerente recuperado' : 'Gerente criado pelo servidor', usuario);
    });
    console.log(existing ? `Pronto: senha e PIN de "${usuario}" redefinidos e bloqueios limpos. Peça para entrar de novo.` : `Pronto: gerente "${usuario}" criado.`);
  } finally { rl.close(); db.close(); }
}
main().catch((e) => { console.error('Não foi possível:', e.message); process.exit(1); });
