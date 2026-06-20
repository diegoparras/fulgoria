# Fulgoria — imagen del server fino (sirve estáticos + login). Multi-stage para una imagen chica.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Dependencias ya resueltas
COPY --from=deps /app/node_modules ./node_modules
# Código de la app (lo que .dockerignore deja pasar: index.html, src, styles, vendor,
# samples/banco-rio-cc.pdf, favicon, server.js, package.json…). NUNCA .env ni samples/private.
COPY . .
EXPOSE 3000
USER node
CMD ["node", "server.js"]
