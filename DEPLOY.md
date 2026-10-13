# Publicar na VPS (passo a passo)

Objetivo: o sistema do hotel rodar **num serviço próprio, com banco próprio**, e o endereço `https://hotelpousadanovoparaiso.gmsti.com/login` passar a abrir **este** sistema (hoje ele abre o AC STORE).

> **Segurança do AC STORE:** estes passos **não mexem** no AC STORE nem no banco dele. Só mudam, no OpenResty, para onde vai o nome `hotelpousadanovoparaiso.gmsti.com`. O AC STORE continua no endereço próprio dele. Antes de começar, anote o que o AC STORE usa (porta, pasta) para não confundir.

## O que já se sabe da sua VPS (`184.107.88.246`)

- Tem **OpenResty** (Nginx) nas portas 80 e 443, e é ele que entrega o nome do hotel ao AC STORE.
- O DNS (`gmsti.com`) fica no **Cloudflare**, e o nome do hotel já aponta para a VPS. **Não precisa mudar DNS.**

## 1. Entrar na VPS e conferir o Docker

```
ssh SEU_USUARIO@184.107.88.246
docker --version && docker compose version
```
Se não tiver Docker, instale seguindo https://docs.docker.com/engine/install/ (ou use o modo sem Docker, no fim).

## 2. Baixar o projeto do GitHub

O código está no repositório **privado** `cabralsoares/hotel-novo-paraiso`. Como é privado, a VPS precisa de uma **chave de implantação** (só leitura) — assim não é preciso guardar sua senha nem um token do GitHub na VPS.

Na VPS:
```
ssh-keygen -t ed25519 -f ~/.ssh/hotel_deploy -N "" -C "vps-hotel"
cat ~/.ssh/hotel_deploy.pub          # copie esta linha
```
No GitHub: repositório → **Settings → Deploy keys → Add deploy key** → cole a linha, dê o nome "VPS" e **deixe "Allow write access" desmarcado**.

De volta à VPS:
```
cat >> ~/.ssh/config <<'EOF'
Host github-hotel
  HostName github.com
  User git
  IdentityFile ~/.ssh/hotel_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
sudo mkdir -p /opt/hotel-novo-paraiso && sudo chown "$USER" /opt/hotel-novo-paraiso
git clone git@github-hotel:cabralsoares/hotel-novo-paraiso.git /opt/hotel-novo-paraiso
```
(`.env` e a pasta `data` **não** vão para o GitHub — são criadas na VPS e ficam só lá.)

*Sem GitHub:* envie do seu computador com `scp -r server public package.json Dockerfile docker-compose.yml .dockerignore .env.example SEU_USUARIO@184.107.88.246:/opt/hotel-novo-paraiso/`.

## 3. Subir o sistema

Na VPS:
```
cd /opt/hotel-novo-paraiso
cp .env.example .env
docker compose up -d --build
docker compose logs hotel | grep "PRIMEIRO ACESSO"      # mostra o código de primeiro acesso
curl -s http://127.0.0.1:3100/api/saude                  # deve responder {"ok":true}
```
O banco é criado no volume Docker `hotel-data` (separado de tudo). A porta `3100` só aceita conexões da própria VPS.

> Se a porta 3100 já estiver em uso por outra coisa, troque nos dois lugares: `ports:` no `docker-compose.yml` e `PORT` no `Dockerfile`/ambiente.

## 4. Apontar o nome do hotel para o sistema novo (OpenResty)

Descubra **onde** o OpenResty configura o nome do hotel:
```
grep -rl "hotelpousadanovoparaiso" /etc /opt /www /usr/local 2>/dev/null
```
Pelo tipo de painel:

- **1Panel (usa OpenResty):** *Sites* → o site `hotelpousadanovoparaiso.gmsti.com` → *Proxy reverso* (ou *Configuração*) → troque o destino de `http://127.0.0.1:PORTA_DO_AC_STORE` para `http://127.0.0.1:3100`.
- **Arquivo de configuração:** edite o `server` desse nome e troque **só** o `proxy_pass` (veja o modelo em `deploy/openresty-hotel.conf`; mantenha as linhas de SSL que já existem e acrescente os `proxy_set_header`).

Recarregue com teste antes: `openresty -t && openresty -s reload` (ou o botão do painel).

**Para voltar atrás:** devolva o `proxy_pass` antigo e recarregue. O sistema do hotel continua rodando, só deixa de receber o tráfego.

## 5. Conferir o Cloudflare

SSL/TLS → modo **Full** (ou Full strict, se o certificado de origem for válido). Não use *Flexible*.

## 6. Primeiro acesso

Abra `https://hotelpousadanovoparaiso.gmsti.com/login`, digite o **código de primeiro acesso** (passo 3) e crie o gerente. Depois:
1. Configurações → **Hotel**: nome, CNPJ, telefone, endereço.
2. Configurações → **Recebimentos**: chave PIX (aleatória) e regras de cobrança.
3. Configurações → **Usuários**: crie as recepcionistas.
4. Confira que o **AC STORE** continua abrindo no endereço dele.

## Backups

- Diários, automáticos, dentro do volume: `docker compose cp hotel:/data/backups ./backups-hotel` traz para a pasta atual.
- Agende uma cópia **para fora da VPS** (cron + `scp`/`rclone`), por exemplo todo dia às 3h:
  `0 3 * * * cd /opt/hotel-novo-paraiso && docker compose cp hotel:/data/backups /home/SEU_USUARIO/backups-hotel`
- **Restaurar:**
  ```
  docker compose stop hotel
  docker compose run --rm -v "$PWD/backup.db:/tmp/backup.db:ro" hotel node server/restore.js /tmp/backup.db
  docker compose start hotel
  ```
  (O banco atual é guardado como `hotel.antes-da-restauracao-…db` antes de ser trocado. A ferramenta recusa arquivos que não sejam um banco do hotel.)

## Atualizar para uma versão nova

```
cd /opt/hotel-novo-paraiso && git pull && docker compose up -d --build
```
O banco fica no volume e não é tocado. Faça um backup antes de atualizar (o servidor já faz um por dia).

## Sem Docker (alternativa)

Precisa de Node 22.13+. Copie o projeto para `/opt/hotel-novo-paraiso`, crie o `.env`, crie um usuário `hotel` e use `deploy/hotel.service` (systemd). O banco fica em `/opt/hotel-novo-paraiso/data`.

## Se algo der errado

- `docker compose logs -f hotel` mostra o que o servidor está fazendo (o registro nunca grava senhas nem dados de cartão).
- "Sessão expirou" logo após entrar: confira `COOKIE_SECURE` (use `1` com HTTPS) e se o OpenResty envia `X-Forwarded-Proto`.
- Esqueceu a senha (ou o PIN) do único gerente: na VPS, `docker compose run --rm -it hotel node server/reset-gerente.js` redefine a senha e o PIN (e limpa os bloqueios) ou cria um gerente novo. Fica na auditoria.
