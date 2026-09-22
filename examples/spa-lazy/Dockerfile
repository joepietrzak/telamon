# A telamon SPA that ships an index of the corpus rather than the corpus, plus
# a small JSON API from the same Vite server.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
# The example depends on `telamon` as `workspace:*`, a pnpm protocol npm cannot
# resolve inside an image, so the image installs the published release. In a
# real project package.json already says this and the line is just the install.
RUN npm pkg set dependencies.telamon=^0.3.0 && npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts api.ts index.html ./
COPY src ./src
# The markdown. `okfManifest` reads it at build time: frontmatter is inlined
# into the entry chunk and each body becomes its own chunk, so this directory
# does not exist in the image that runs. `OKF_BUNDLE` picks which directory,
# and vite.config.ts reads the same variable: `--build-arg OKF_BUNDLE=corpus`.
ARG OKF_BUNDLE=bundle
COPY ${OKF_BUNDLE} ./${OKF_BUNDLE}
# `okfBudget` runs here. A build that inlined the corpus fails at this line
# rather than on someone's phone. `metricsApi` counts the bundle here too, into
# dist/metrics.json, since nothing after this line has the markdown to count.
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Owned by the user that runs it: vite writes into node_modules at startup, and
# a root-owned tree makes that an EACCES the moment you drop privileges.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
# The config, because it is what registers `/api/metrics` with `vite preview`.
# Loading it transpiles it into node_modules/.vite-temp first, which is one of
# the writes the chown above is for.
COPY --from=build --chown=node:node /app/vite.config.ts /app/api.ts ./
#
# `preview` gives the SPA fallback client-side routing needs: a reload on
# /en/science has to return index.html. Any static host serves the same `dist/`
# with an equivalent rewrite -- nginx `try_files $uri /index.html` -- though
# then `/api/metrics` is gone and only the static `/metrics.json` is left.
EXPOSE 3000
USER node
CMD ["npm", "run", "preview"]
