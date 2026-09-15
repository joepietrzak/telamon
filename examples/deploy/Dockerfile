# A telamon server is a Node process with a bundle next to it.
#
# One change before this builds: this example depends on `telamon` as
# `workspace:*`, which is a pnpm protocol and not something npm can resolve
# inside an image. In a real deployment that is a published version --
# `"telamon": "^0.3.0"` -- and the install below works as written.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY server.mjs ./
# The bundle. Swap this COPY for a database source and the image carries no
# content at all -- it reads the warehouse at request time.
COPY bundle ./bundle

ENV PORT=3000
EXPOSE 3000
# The uid rather than the name: a Kubernetes pod with runAsNonRoot cannot
# verify a named user, and refuses to start the container. 1000 is `node` in
# the official images.
USER 1000
CMD ["node", "server.mjs"]
