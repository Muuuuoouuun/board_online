# One container serves everything: the built client, the API, and the Socket.IO
# connection, so this runs on any single-service host (Fly.io, Railway, Render,
# Cloud Run) without splitting the app in two.

# ---- build: needs devDependencies for vite/typescript ----
FROM node:22-alpine AS build
WORKDIR /app

# Copy only manifests first so `npm ci` is cached until a dependency changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime: production dependencies only ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev

# The server runs its TypeScript directly through tsx (no compile step), so the
# sources ship as-is. tsx is a runtime dependency of the server for this reason.
COPY packages/shared/src packages/shared/src
COPY packages/server/src packages/server/src
COPY --from=build /app/packages/client/dist packages/client/dist

EXPOSE 3001
CMD ["npm", "start"]
