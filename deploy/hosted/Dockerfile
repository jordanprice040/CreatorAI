# X06 hosted image: API, workflow worker and migration runner share one build. Reviewable
# configuration only; it was not built or deployed when written (no Docker daemon there).
FROM node:22.21.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22.21.0-bookworm-slim AS runtime
# PostgreSQL client tools for `pnpm backup` against the managed database.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
ENV NODE_ENV=production CREATOR_DEPLOYMENT_MODE=hosted CREATOR_LISTEN_HOST=0.0.0.0
EXPOSE 4310 4320
CMD ["node", "apps/api/dist/main.js"]

# Static web build served by the proxy.
FROM caddy:2.10.2 AS proxy
COPY --from=build /app/apps/web/dist /srv/web
COPY deploy/hosted/Caddyfile /etc/caddy/Caddyfile
