#!/bin/sh
# Regenerates runtime-config.js from container environment variables at container start,
# so the same built image can serve multiple clients (different branding, different API URL)
# without a rebuild. Runs automatically via nginx's /docker-entrypoint.d/ mechanism.
# See ../frontend/src/config/site.ts for how these are consumed.
set -e

CONFIG_FILE="/usr/share/nginx/html/runtime-config.js"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

{
  printf 'window.__RUNTIME_CONFIG__ = {\n'
  printf '  BRAND_NAME: "%s",\n' "$(json_escape "${VITE_BRAND_NAME:-}")"
  printf '  BRAND_SHORT_NAME: "%s",\n' "$(json_escape "${VITE_BRAND_SHORT_NAME:-}")"
  printf '  BRAND_LOGO_URL: "%s",\n' "$(json_escape "${VITE_BRAND_LOGO_URL:-}")"
  printf '  BRAND_FAVICON_URL: "%s",\n' "$(json_escape "${VITE_BRAND_FAVICON_URL:-}")"
  printf '  BRAND_PRIMARY_COLOR: "%s",\n' "$(json_escape "${VITE_BRAND_PRIMARY_COLOR:-}")"
  printf '  BRAND_SECONDARY_COLOR: "%s",\n' "$(json_escape "${VITE_BRAND_SECONDARY_COLOR:-}")"
  printf '  SUPPORT_EMAIL: "%s",\n' "$(json_escape "${VITE_SUPPORT_EMAIL:-}")"
  printf '  SUPPORT_PHONE: "%s",\n' "$(json_escape "${VITE_SUPPORT_PHONE:-}")"
  printf '  COMPANY_ADDRESS: "%s",\n' "$(json_escape "${VITE_COMPANY_ADDRESS:-}")"
  printf '  SHOW_DEMO_CREDENTIALS: "%s",\n' "$(json_escape "${VITE_SHOW_DEMO_CREDENTIALS:-}")"
  printf '  API_BASE_URL: "%s"\n' "$(json_escape "${VITE_API_BASE_URL:-}")"
  printf '};\n'
} > "$CONFIG_FILE"

echo "[docker-entrypoint] runtime-config.js generated from environment"
