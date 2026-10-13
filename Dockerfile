# Hotel e Pousada Novo Paraíso — sem dependências externas (só o Node), banco SQLite em /data
FROM node:24-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100 \
    DATA_DIR=/data \
    HOTEL_TZ=America/Recife \
    TRUST_PROXY=1 \
    COOKIE_SECURE=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

# o banco do hotel fica no volume /data (separado do código e de qualquer outro sistema)
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:3100/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
