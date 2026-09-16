# One change before this builds as written: the example depends on `telamon` as
# `workspace:*`, a pnpm protocol npm cannot resolve inside an image. In a real
# deployment that is a published version -- `"telamon": "^0.3.0"`.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs okf.db.json ./
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
