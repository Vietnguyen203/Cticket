# ---- deps: production dependencies only ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini runs as PID 1 and forwards SIGTERM to node, so graceful shutdown works.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations

# Uploaded images (a volume in docker-compose): owned by the node user, which runs the API.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

# Never run as root inside the container.
USER node
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
