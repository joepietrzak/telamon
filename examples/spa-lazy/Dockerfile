# A telamon SPA that ships an index of the corpus rather than the corpus.
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
# The markdown. `okfManifest` reads it at build time: frontmatter is inlined
# into the entry chunk and each body becomes its own chunk, so this directory
# does not exist in the image that runs.
COPY bundle ./bundle
# `okfBudget` runs here. A build that inlined the corpus fails at this line
# rather than on someone's phone.
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Owned by the user that runs it: vite writes into node_modules at startup, and
# a root-owned tree makes that an EACCES the moment you drop privileges.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
# Deliberately not vite.config.ts. `preview` serves `dist` by default, and
# loading a TypeScript config means transpiling it to a temp file first --
# work, and a write, for settings that only ever applied to the build.
#
# `preview` gives the SPA fallback client-side routing needs: a reload on
# /en/science has to return index.html. Any static host serves the same `dist/`
# with an equivalent rewrite -- nginx `try_files $uri /index.html`.
EXPOSE 3000
USER node
CMD ["npm", "run", "preview"]
