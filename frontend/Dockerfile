# syntax=docker/dockerfile:1

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Optional build-time branding/API values for single-client builds. Prefer runtime
# env vars (see docker-entrypoint.sh) when one image must serve multiple clients.
ARG VITE_API_BASE_URL
ARG VITE_BRAND_NAME
ARG VITE_BRAND_SHORT_NAME
ARG VITE_BRAND_LOGO_URL
ARG VITE_BRAND_FAVICON_URL
ARG VITE_BRAND_PRIMARY_COLOR
ARG VITE_BRAND_SECONDARY_COLOR
RUN npm run build

# ---- runtime ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --chown=101:0 --from=build /app/dist /usr/share/nginx/html
COPY --chown=101:0 nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:0 docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
