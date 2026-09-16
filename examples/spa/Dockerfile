# A telamon SPA: Vite compiles the bundle into the app, and there is no server
# that knows what an OKF document is.
#
# One change before this builds as written: the example depends on `telamon` as
# `workspace:*`, a pnpm protocol npm cannot resolve inside an image. In a real
# deployment that is a published version -- `"telamon": "^0.3.0"` -- and the
# install below works unchanged.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# The markdown. Vite reads it at build time and inlines it, so this directory
# does not exist in the image that runs.
COPY bundle ./bundle
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# `vite preview` serves the built app with the SPA fallback that client-side
# routing needs: a reload on /tables/events_ has to return index.html. A static
# host works just as well with an equivalent rewrite rule -- nginx
# `try_files $uri /index.html`, S3+CloudFront an error-document mapping.
# Owned by the user that runs it: vite writes into node_modules at startup,
# and a root-owned tree makes that an EACCES the moment you drop privileges.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
# Deliberately not vite.config.ts. `preview` serves `dist` by default, and
# loading a TypeScript config means transpiling it to a temp file first --
# work, and a write, for settings that only ever applied to the build.
EXPOSE 3000
USER node
CMD ["npm", "run", "preview"]
