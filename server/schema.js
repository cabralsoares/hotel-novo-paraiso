'use strict';
// Esquema do banco de dados PRÓPRIO do hotel (SQLite). Valores em dinheiro ficam em centavos (INTEGER).
module.exports = `
CREATE TABLE IF NOT EXISTS meta   (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS usuarios (
  id        TEXT PRIMARY KEY,
  nome      TEXT NOT NULL,
  usuario   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  perfil    TEXT NOT NULL CHECK (perfil IN ('gerente','recepcao')),
  ativo     INTEGER NOT NULL DEFAULT 1,
  senha     TEXT NOT NULL,
  pin       TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessoes (
  id         TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criada_em  INTEGER NOT NULL,
  ultimo_uso INTEGER NOT NULL,
  expira_em  INTEGER NOT NULL,
  ip         TEXT,
  agente     TEXT
);

CREATE TABLE IF NOT EXISTS tentativas (
  chave         TEXT PRIMARY KEY,
  falhas        INTEGER NOT NULL,
  bloqueado_ate INTEGER NOT NULL DEFAULT 0,
  atualizado_em INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS autorizacoes (
  id         TEXT PRIMARY KEY,
  sessao_id  TEXT NOT NULL,
  gerente_id TEXT NOT NULL,
  escopo     TEXT NOT NULL,
  valor_c    INTEGER NOT NULL DEFAULT 0,
  motivo     TEXT,
  detalhe    TEXT,
  criada_em  INTEGER NOT NULL,
  expira_em  INTEGER NOT NULL,
  usada      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quartos (
  id         TEXT PRIMARY KEY,
  numero     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tipo       TEXT NOT NULL,
  capacidade INTEGER NOT NULL CHECK (capacidade BETWEEN 1 AND 10),
  diaria_c   INTEGER NOT NULL CHECK (diaria_c > 0),
  andar      INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'livre' CHECK (status IN ('livre','ocupado','limpeza','manutencao')),
  descricao  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS hospedes (
  id           TEXT PRIMARY KEY,
  nome         TEXT NOT NULL,
  doc_tipo     TEXT NOT NULL CHECK (doc_tipo IN ('cpf','rg','passaporte')),
  doc          TEXT NOT NULL,
  nascimento   TEXT NOT NULL DEFAULT '',
  nacionalidade TEXT NOT NULL DEFAULT 'Brasileira',
  telefone     TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  cidade       TEXT NOT NULL DEFAULT '',
  uf           TEXT NOT NULL DEFAULT '',
  motivo       TEXT NOT NULL DEFAULT 'Lazer',
  transporte   TEXT NOT NULL DEFAULT 'Carro',
  criado_em    TEXT NOT NULL,
  UNIQUE (doc_tipo, doc)
);

CREATE TABLE IF NOT EXISTS reservas (
  id                        TEXT PRIMARY KEY,
  codigo                    TEXT NOT NULL UNIQUE,
  hospede_id                TEXT NOT NULL REFERENCES hospedes(id),
  quarto_id                 TEXT NOT NULL REFERENCES quartos(id),
  checkin                   TEXT NOT NULL,
  checkout                  TEXT NOT NULL,
  adultos                   INTEGER NOT NULL,
  criancas                  INTEGER NOT NULL DEFAULT 0,
  diaria_c                  INTEGER NOT NULL,
  desconto_pct              INTEGER NOT NULL DEFAULT 0 CHECK (desconto_pct BETWEEN 0 AND 100),
  desconto_autorizado_por   TEXT NOT NULL DEFAULT '',
  sem_entrada_autorizada_por TEXT NOT NULL DEFAULT '',
  placa                     TEXT NOT NULL DEFAULT '',
  obs                       TEXT NOT NULL DEFAULT '',
  origem                    TEXT NOT NULL DEFAULT 'reserva',
  status                    TEXT NOT NULL DEFAULT 'reservada' CHECK (status IN ('reservada','hospedado','finalizada','cancelada')),
  motivo_cancelamento       TEXT,
  criado_em                 TEXT NOT NULL,
  checkin_real              TEXT,
  checkout_real             TEXT,
  cancelada_em              TEXT
);
CREATE INDEX IF NOT EXISTS ix_reservas_quarto ON reservas (quarto_id, status);
CREATE INDEX IF NOT EXISTS ix_reservas_hospede ON reservas (hospede_id);

CREATE TABLE IF NOT EXISTS consumos (
  id         TEXT PRIMARY KEY,
  reserva_id TEXT NOT NULL REFERENCES reservas(id),
  descricao  TEXT NOT NULL,
  qtd        INTEGER NOT NULL CHECK (qtd BETWEEN 1 AND 99),
  valor_c    INTEGER NOT NULL CHECK (valor_c > 0),
  em         TEXT NOT NULL,
  por        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id             TEXT PRIMARY KEY,
  reserva_id     TEXT REFERENCES reservas(id),
  rascunho       TEXT,
  usuario_id     TEXT NOT NULL,
  hospede        TEXT NOT NULL DEFAULT '',
  metodo         TEXT NOT NULL CHECK (metodo IN ('pix','credito','debito','dinheiro','faturado')),
  valor_c        INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('autorizado','faturado','recusado','estornado')),
  tipo           TEXT NOT NULL DEFAULT 'recebimento' CHECK (tipo IN ('recebimento','devolucao')),
  criado_em      TEXT NOT NULL,
  operador       TEXT NOT NULL,
  autorizado_por TEXT NOT NULL DEFAULT '',
  detalhes       TEXT NOT NULL DEFAULT '{}',
  estorno        TEXT,
  e2e            TEXT
);
CREATE INDEX IF NOT EXISTS ix_pag_reserva ON pagamentos (reserva_id);
CREATE INDEX IF NOT EXISTS ix_pag_rascunho ON pagamentos (rascunho);
-- um comprovante PIX (E2E) só pode pagar uma vez, nunca
CREATE UNIQUE INDEX IF NOT EXISTS ux_pag_e2e ON pagamentos (e2e) WHERE e2e IS NOT NULL;

CREATE TABLE IF NOT EXISTS pix_cobrancas (
  txid       TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  reserva_id TEXT,
  rascunho   TEXT,
  hospede    TEXT NOT NULL DEFAULT '',
  data_saida TEXT,
  valor_c    INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  criada_em  INTEGER NOT NULL,
  expira_em  INTEGER NOT NULL,
  usada      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auditoria (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  em       TEXT NOT NULL,
  operador TEXT NOT NULL,
  acao     TEXT NOT NULL,
  detalhe  TEXT NOT NULL DEFAULT '',
  por      TEXT NOT NULL DEFAULT ''
);
`;
