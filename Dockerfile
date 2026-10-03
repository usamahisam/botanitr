# Trading Botani v2.0 — satu image berisi server + web build
# Build:  docker compose up --build -d
FROM node:20-alpine AS build

# Toolchain build native (better-sqlite3)
RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --no-audit --no-fund --ignore-scripts

COPY . .
# Build native binding better-sqlite3 untuk platform image (toolchain tersedia di stage ini)
RUN npm rebuild better-sqlite3
RUN npm run build

FROM node:20-alpine AS runtime
RUN apk add --no-cache sqlite-libs
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
# Bawa hasil compile native better-sqlite3 dari build stage (deterministik, tanpa toolchain)
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/src/db/schema.sql ./server/dist/db/schema.sql
COPY --from=build /app/web/dist ./web/dist

# Data persisten (SQLite) — mount sebagai volume
VOLUME ["/app/server/data"]
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
