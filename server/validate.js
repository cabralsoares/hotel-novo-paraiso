'use strict';
// Validações de entrada no servidor (reaproveitando as regras compartilhadas com a tela).
const V = require('../public/js/validators.js');
const { validator, str } = require('./util');

const DOC_TYPES = ['cpf', 'rg', 'passaporte'];
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO', 'EX'];
const MOTIVOS = ['Lazer', 'Negócios', 'Trabalho', 'Congresso/Feira', 'Parentes/Amigos', 'Saúde', 'Outro'];
const TRANSPORTES = ['Carro', 'Ônibus', 'Avião', 'Moto', 'Navio', 'Outro'];
const ROOM_TYPES = ['Econômico', 'Standard', 'Luxo', 'Suíte', 'Família'];
const NAME_RE = /^[A-Za-zÀ-ÿ'.\- ]+$/;

/** Normaliza os dados do hóspede como chegam do formulário. */
function cleanGuest(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const docTipo = DOC_TYPES.includes(g.docTipo) ? g.docTipo : 'cpf';
  return {
    nome: str(g.nome).replace(/\s+/g, ' '),
    docTipo,
    doc: docTipo === 'cpf' ? V.digits(g.doc) : str(g.doc).toUpperCase().replace(/\s+/g, ''),
    nascimento: str(g.nascimento),
    nacionalidade: str(g.nacionalidade) || 'Brasileira',
    telefone: V.digits(g.telefone),
    email: str(g.email).toLowerCase(),
    cidade: str(g.cidade),
    uf: str(g.uf).toUpperCase(),
    motivo: MOTIVOS.includes(g.motivo) ? g.motivo : 'Lazer',
    transporte: TRANSPORTES.includes(g.transporte) ? g.transporte : 'Carro',
  };
}

/** `quick`: cadastro rápido de reserva (só nome, CPF e telefone). */
function validateGuest(db, g, { ignoreId = null, today, quick = false }) {
  const v = validator();
  if (!g.nome || g.nome.length > 80 || g.nome.split(' ').filter(Boolean).length < 2 || !NAME_RE.test(g.nome)) v.err('nome', 'Informe o nome completo (nome e sobrenome, só letras).');
  if (g.docTipo === 'cpf') { if (!V.isCPF(g.doc)) v.err('doc', 'CPF inválido.'); }
  else if (!/^[A-Z0-9.\-/]{5,20}$/.test(g.doc)) v.err('doc', 'Documento inválido (mínimo 5 caracteres).');
  if (!v.has('doc')) {
    const dup = db.prepare('SELECT nome FROM hospedes WHERE doc_tipo = ? AND doc = ? AND id <> ?').get(g.docTipo, g.doc, ignoreId || '');
    if (dup) v.err('doc', `Documento já cadastrado para ${dup.nome}. Selecione o hóspede existente.`);
  }
  const brasil = /^brasil/i.test(g.nacionalidade || '');
  if (quick ? !V.isPhone(g.telefone) : brasil ? !V.isPhone(g.telefone) : g.telefone.length < 8) v.err('telefone', 'Telefone inválido. Use DDD + número.');
  if (!quick) {
    if (!V.isDateISO(g.nascimento)) v.err('nascimento', 'Informe a data de nascimento.');
    else if (g.nascimento > today) v.err('nascimento', 'A data de nascimento não pode ser no futuro.');
    else if (V.ageOn(g.nascimento, today) < 18) v.err('nascimento', 'O hóspede responsável precisa ter 18 anos ou mais.');
    else if (V.ageOn(g.nascimento, today) > 120) v.err('nascimento', 'Data de nascimento inválida.');
    if (g.nacionalidade.length < 3 || g.nacionalidade.length > 40) v.err('nacionalidade', 'Informe a nacionalidade.');
    if (g.email && (!V.isEmail(g.email) || g.email.length > 100)) v.err('email', 'E-mail inválido.');
    if (g.cidade.length < 2 || g.cidade.length > 60) v.err('cidade', 'Informe a cidade.');
    if (!UFS.includes(g.uf)) v.err('uf', 'Selecione o estado.');
  }
  v.check();
}

module.exports = { cleanGuest, validateGuest, UFS, ROOM_TYPES, NAME_RE };
