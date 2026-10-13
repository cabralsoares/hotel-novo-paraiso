# Hotel e Pousada Novo Paraíso — Check-in e Hospedagem

Sistema de recepção com **banco de dados próprio do hotel**: reservas, check-in com pagamento (validação + autorização), hospedagem, check-out, financeiro e auditoria.

- **Publicar na sua VPS:** veja o [DEPLOY.md](DEPLOY.md) (passo a passo).
- **Testar no seu computador:** `node server/server.js` (precisa de Node 22.13 ou mais novo) e abra `http://localhost:3100`.

## Como funciona

```
navegador (tela)  ──HTTPS──▶  servidor Node  ──▶  banco SQLite do hotel (data/hotel.db)
```

- O **banco de dados fica no servidor** e é só do hotel: nenhuma ligação com o AC STORE ou outro sistema. Vários computadores/tablets/celulares usam os mesmos dados, e as telas se atualizam sozinhas (a cada ~8 s).
- **Quem valida e autoriza é o servidor.** A tela confere os dados só para ajudar quem digita; o servidor refaz todas as contas e checagens (valores, saldo, disponibilidade do quarto, CPF/CNPJ, cartão, PIX, descontos). Mexer na tela ou no navegador não burla nada.
- Sem pacotes externos: só o Node (o banco é o SQLite embutido). Nada para instalar além do próprio Node ou do Docker.

## Primeiro acesso

Ao subir pela primeira vez, o servidor mostra no registro (e grava em `data/CODIGO-PRIMEIRO-ACESSO.txt`) um **código de primeiro acesso**, tipo `K7M2-QP9X`. Na tela `/login`, digite o código e crie o usuário **gerente** (senha e PIN). O código impede que um estranho crie o gerente se alguém achar o endereço antes de você. Depois do primeiro acesso ele é apagado. Não existe senha padrão.

## O que o sistema faz

| Tela | Para quê |
|---|---|
| Painel | Ocupação, chegadas/saídas do dia, recebido hoje, mapa de quartos |
| Check-in | 4 etapas: hóspede → estadia → pagamento → confirmação (imprime a ficha) |
| Hospedagem | Conta do hóspede, consumos, receber pagamento, alterar saída, check-out e recibo |
| Reservas / Quartos / Hóspedes | Cadastros, disponibilidade por período, status (livre, ocupado, limpeza, manutenção) |
| Financeiro | Recebimentos por forma, faturados, estornos, recusados, fechamento imprimível |
| Configurações *(gerente)* | Dados do hotel, chave PIX, regras de cobrança, usuários, backup, auditoria |

## Pagamentos: validação e autorização

| Forma | Validação | Autorização |
|---|---|---|
| **PIX** | Chave do hotel válida (a **chave aleatória** é aceita); QR e "copia e cola" no padrão do Banco Central (CRC16 conferido) | Hoje: o operador confere o recebimento no app do banco e informa o **ID do comprovante (E2E, 32 caracteres)**: formato válido, feito nas últimas 6 h e **uso único (o banco de dados recusa repetir)**. Com a integração do banco, vira automático (veja abaixo) |
| **Crédito** | Número (Luhn + bandeira + tamanho), nome, validade, CVV, CPF do titular, parcelas respeitando a parcela mínima | Autorizador de cartão (**simulado**) → NSU e código de autorização |
| **Débito** | Mesmas validações, sempre à vista | Autorizador de cartão (simulado) |
| **Dinheiro** | Valor recebido ≥ valor cobrado; troco calculado | Imediata |
| **Faturado (empresa)** | CNPJ válido, razão social, vencimento até 60 dias | **PIN do gerente** (sempre) |

**Autorização do gerente (PIN)** — conferida no servidor, vira uma ficha de **uso único, que vale 15 min, só para aquele tipo de ação e só naquela sessão** — é exigida para: desconto acima do limite, pagamento acima do limite do operador (padrão R$ 3.000), check-in sem a entrada mínima, faturamento, estornos, devoluções de crédito, remoção de consumos, **troca da chave PIX**, baixar backup e apagar dados. Tudo fica na **Auditoria** com quem pediu e quem autorizou.

Se um check-in for cancelado depois de pagamentos autorizados, eles são **estornados automaticamente** e ficam registrados. Se o navegador fechar no meio, o pagamento aparece no Financeiro como "sem reserva", para o gerente resolver.

## O que ainda é simulado — leia antes de cobrar clientes reais

- **Cartão de crédito/débito: o autorizador é uma simulação.** Nenhum cartão é cobrado de verdade. Para cobrar de verdade é preciso contratar maquininha/gateway e trocar `authorize()` e `voidPayment()` em `server/gateway.js`, mantendo o mesmo formato de retorno. Cartões de teste aparecem na tela de pagamento (`4111 1111 1111 1111` aprova; `4000 0000 0000 9995` recusa por saldo).
- **PIX:** o QR é real e recebe de verdade na chave cadastrada, mas **o sistema ainda não consulta o banco**: quem confirma é o operador.
- **Números de cartão não são gravados:** só bandeira, final, nome do titular, CPF mascarado, NSU e autorização. Número completo, validade e CVV passam pelo servidor apenas durante a autorização e não vão para o banco, nem para a auditoria, nem para o registro. *Importante:* com um gateway de verdade, o recomendado é que o navegador envie o cartão direto ao gateway (campos hospedados/tokenização), sem passar pelo servidor do hotel.

### Integrando o PIX com o banco (próximo passo)

Cadastre uma **chave aleatória** no app do banco (Pix → Minhas chaves → Chave aleatória) e use-a em Configurações → Recebimentos: ela funciona hoje e não expõe CPF, CNPJ nem telefone no código. A integração com a API Pix do banco troca o QR fixo por uma **cobrança por venda** (com identificador único) e o banco **avisa o sistema quando o pagamento cai** (webhook), confirmando sozinho, sem digitar comprovante. Para fazer, preciso saber: qual banco/PSP, a documentação da API Pix dele (cobrança imediata + webhook), credenciais de homologação e, se o banco exigir, o certificado (mTLS).

## Segurança

- Senhas e PIN guardados com **scrypt** (hash com sal). Sessão em cookie **HttpOnly + SameSite=Strict** (+ Secure em HTTPS); no banco fica só o hash do token. Sessão expira em 30 min sem uso e em 12 h no máximo.
- Bloqueio por tentativas no servidor: 5 senhas erradas travam o usuário (e 20 o IP); 3 PINs errados travam o PIN; seis cartões recusados travam novas tentativas por um tempo.
- Proteção contra requisições de outros sites (verificação de origem + cabeçalho próprio), cabeçalhos de segurança (CSP, anti-iframe, nosniff, HSTS), limite de tamanho das requisições, caminhos de arquivos protegidos.
- Perfis: **Recepção** não acessa Configurações, usuários, auditoria, backup nem apaga dados (o servidor bloqueia, não só esconde o menu).
- Quarto não pode ser reservado/ocupado duas vezes: dois operadores tentando ao mesmo tempo, só um consegue.
- Limite honesto: o **PIN do gerente é só quatro a seis números**; a proteção é o bloqueio por tentativas. Quem tiver acesso ao arquivo do banco (`hotel.db`) poderia tentar descobri-lo por força bruta, por isso o acesso à VPS e aos backups precisa ser restrito.

## Backup e restauração

- O servidor faz **um backup por dia** em `data/backups/` (guarda os últimos 14).
- O gerente também baixa uma cópia a qualquer hora em **Configurações → Dados e backup** (pede o PIN). O arquivo tem hóspedes e usuários: guarde em local seguro.
- **Copie os backups para fora da VPS** de vez em quando (outro computador ou nuvem): backup só na mesma máquina não protege contra defeito do disco.
- Restaurar (servidor parado): `node server/restore.js caminho/do/backup.db` (no Docker: veja o DEPLOY.md). O banco atual é guardado antes de ser substituído.
- Esqueceu a senha/PIN do único gerente: `node server/reset-gerente.js` (no servidor) redefine ou cria um gerente.

## Testes

```
node tests/run.js            # 15 testes das regras (CPF/CNPJ, cartão, PIX, diárias, parcelas…)
node --test tests/api.test.js # 23 testes da API (segurança, pagamentos, PIN, concorrência…) com banco temporário
```

## Estrutura

```
server/server.js       servidor HTTP (API + arquivos da tela), segurança, rotinas diárias
server/db.js, schema.js  banco SQLite próprio do hotel
server/security.js     senhas (scrypt), sessões, bloqueios, fichas do gerente (PIN)
server/routes/*.js     login/usuários/config · hotel (reservas, check-in) · pagamentos · admin
server/ledger.js       conta do hóspede e lançamento de pagamentos
server/gateway.js      autorizador de cartão (SIMULADO — ponto de integração)
server/pix.js          QR/“copia e cola” PIX (padrão BCB)
server/restore.js      restaura backup · server/reset-gerente.js  recupera o acesso do gerente
public/                a tela (index.html, login/, css/, js/) — validators.js e core.js são usados também pelo servidor
Dockerfile, docker-compose.yml, deploy/   publicação
```
