# Stadtwache für den Betrieb zu Hause (CasaOS/Docker). Siehe docs/casaos.md.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000 LOCAL_STORE_DIR=/data TZ=Europe/Berlin

# Zuerst nur die Paketlisten, damit der Installationsschritt bei Codeänderungen aus dem Zwischenspeicher kommt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs netlify.toml ./
COPY netlify ./netlify
COPY public ./public

# Stand des Images, wird vom Bau (GitHub Action) gesetzt und im Admin als Version angezeigt
ARG BUILD_SHA=
ARG BUILD_DATE=
ENV BUILD_SHA=$BUILD_SHA BUILD_DATE=$BUILD_DATE

VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
