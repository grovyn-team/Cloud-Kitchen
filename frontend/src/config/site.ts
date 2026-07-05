/**
 * Centralized branding/site configuration. Nothing UI-related should be hardcoded
 * in components — read it from `siteConfig` here instead.
 *
 * Resolution order (first defined value wins), so the same built image can serve
 * multiple clients without a rebuild:
 *   1. window.__RUNTIME_CONFIG__ — injected by the Docker entrypoint from container env vars
 *      at container start (see frontend/docker-entrypoint.sh).
 *   2. import.meta.env.VITE_* — baked in at build time (local dev, or per-client build).
 *   3. Hardcoded defaults below — the original Grovyn Autopilot branding, so behavior
 *      is unchanged when no configuration is supplied.
 */

interface RuntimeConfig {
  BRAND_NAME?: string;
  BRAND_SHORT_NAME?: string;
  BRAND_LOGO_URL?: string;
  BRAND_FAVICON_URL?: string;
  BRAND_PRIMARY_COLOR?: string;
  BRAND_SECONDARY_COLOR?: string;
  SUPPORT_EMAIL?: string;
  SUPPORT_PHONE?: string;
  COMPANY_ADDRESS?: string;
  SHOW_DEMO_CREDENTIALS?: string;
  API_BASE_URL?: string;
}

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

function runtimeValue(key: keyof RuntimeConfig): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = window.__RUNTIME_CONFIG__?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pick(runtimeKey: keyof RuntimeConfig, buildValue: string | undefined, fallback: string): string {
  return runtimeValue(runtimeKey) ?? (buildValue && buildValue.length > 0 ? buildValue : undefined) ?? fallback;
}

function pickOptional(runtimeKey: keyof RuntimeConfig, buildValue: string | undefined): string | undefined {
  return runtimeValue(runtimeKey) ?? (buildValue && buildValue.length > 0 ? buildValue : undefined);
}

function pickBoolean(runtimeKey: keyof RuntimeConfig, buildValue: string | undefined, fallback: boolean): boolean {
  const raw = runtimeValue(runtimeKey) ?? buildValue;
  if (raw === undefined || raw === '') return fallback;
  return raw !== 'false' && raw !== '0';
}

const env = import.meta.env;

export const siteConfig = {
  name: pick('BRAND_NAME', env.VITE_BRAND_NAME, 'Grovyn Autopilot'),
  shortName: pick('BRAND_SHORT_NAME', env.VITE_BRAND_SHORT_NAME, 'Autopilot'),
  logoUrl: pickOptional('BRAND_LOGO_URL', env.VITE_BRAND_LOGO_URL),
  faviconUrl: pickOptional('BRAND_FAVICON_URL', env.VITE_BRAND_FAVICON_URL),
  colors: {
    primary: pick('BRAND_PRIMARY_COLOR', env.VITE_BRAND_PRIMARY_COLOR, '221 83% 53%'),
    secondary: pick('BRAND_SECONDARY_COLOR', env.VITE_BRAND_SECONDARY_COLOR, '210 40% 96%'),
  },
  contact: {
    supportEmail: pickOptional('SUPPORT_EMAIL', env.VITE_SUPPORT_EMAIL),
    supportPhone: pickOptional('SUPPORT_PHONE', env.VITE_SUPPORT_PHONE),
    address: pickOptional('COMPANY_ADDRESS', env.VITE_COMPANY_ADDRESS),
  },
  demo: {
    showCredentials: pickBoolean('SHOW_DEMO_CREDENTIALS', env.VITE_SHOW_DEMO_CREDENTIALS, true),
    adminEmail: 'admin@grovyn.in',
    staffEmail: 'stafff@grovyn.in',
    password: 'grovyn@123',
  },
  storageKeyPrefix: 'grovyn',
} as const;

/** Applies document title, favicon, and theme color CSS vars from siteConfig. Call once at app start. */
export function applySiteBranding(): void {
  if (typeof document === 'undefined') return;

  document.title = siteConfig.name;

  if (siteConfig.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = siteConfig.faviconUrl;
  }

  const root = document.documentElement;
  root.style.setProperty('--primary', siteConfig.colors.primary);
  root.style.setProperty('--ring', siteConfig.colors.primary);
  root.style.setProperty('--accent', siteConfig.colors.secondary);
  root.style.setProperty('--muted', siteConfig.colors.secondary);
}
