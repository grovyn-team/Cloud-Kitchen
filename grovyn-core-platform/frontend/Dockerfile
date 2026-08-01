# Integration Task 5, round 3 — production frontend image. Multi-stage:
# `build` compiles the Vite/React app to static assets, `runtime` serves
# them via nginx (no Node process needed at runtime for a static SPA).
#
# `VITE_API_BASE_URL` is deliberately left UNSET at build time -- the app
# then calls relative `/api/...` paths (see `src/services/api.ts`'s
# `getApiUrl`), which nginx.conf below reverse-proxies to the `backend`
# compose service. This avoids needing to know the deployment's public URL
# at image-build time.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1

EXPOSE 80
