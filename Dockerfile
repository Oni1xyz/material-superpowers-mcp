FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
COPY package.json package-lock.json LICENSE ./
RUN npm ci --ignore-scripts --engine-strict
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
ENV NODE_ENV=production MATERIAL_CACHE_DIR=/app/.cache/material
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/LICENSE ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/index.js"]
