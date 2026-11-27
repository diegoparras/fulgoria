# Fulgoria — imagen del server fino (sirve estáticos + login). Multi-stage para una imagen chica.
# Imagen base pinneada por digest para builds reproducibles (node:24-alpine, LTS).
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Dependencias ya resueltas
COPY --from=deps /app/node_modules ./node_modules
# Código de la app (lo que .dockerignore deja pasar: index.html, src, styles, vendor,
# samples/banco-rio-cc.pdf, favicon, server.js, package.json, CHANGELOG.md…). NUNCA .env ni
# samples/private. El CHANGELOG.md es la fuente de las novedades del log de arranque y de la UI.
COPY . .
# Modo estudio (PERSISTENCIA=on): base y documentos en /data. Montá un volumen ahí (EasyPanel:
# Mounts → Volume → /data) o se pierden al redeployar. Con ALMACENAMIENTO=s3 los documentos van al
# bucket, pero la base sigue en /data.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
