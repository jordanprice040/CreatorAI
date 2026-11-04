# X06 hosted image: API, workflow worker and migration runner share one build. Reviewable
# configuration only; it was not built or deployed when written (no Docker daemon there).
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22.23.4-bookworm-slim AS runtime
# Match the supported PostgreSQL 18 server; Bookworm's default client is too old
# to dump 16+ servers. Use the PostgreSQL project's signed package repository.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl --fail -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/products && chown node:node /data/products
USER node
ENV NODE_ENV=production CREATOR_DEPLOYMENT_MODE=hosted CREATOR_LISTEN_HOST=0.0.0.0
EXPOSE 4310 4320
CMD ["node", "apps/api/dist/main.js"]

# Static web build served by the proxy.
FROM caddy:2.10.2 AS proxy
COPY --from=build /app/apps/web/dist /srv/web
COPY deploy/hosted/Caddyfile /etc/caddy/Caddyfile
