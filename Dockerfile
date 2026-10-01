# syntax=docker/dockerfile:1

# ---- build: compile the web app and bundle the API -------------------------
FROM node:22-slim AS build
WORKDIR /app

# Manifests first so the dependency layer is cached until they change.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime: production dependencies + built output only ------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev -w @flashcards/api && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/web/dist web
COPY --from=build /app/content content

ENV PORT=3000 \
    WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/apps/api/drizzle \
    CONTENT_DIR=/app/content/packs

USER node
EXPOSE 3000

# Liveness only; it does not touch the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Apply migrations first with: node apps/api/dist/migrate.js
CMD ["node", "apps/api/dist/server.js"]
