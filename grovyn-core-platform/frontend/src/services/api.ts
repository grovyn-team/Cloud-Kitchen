import axios, { type AxiosInstance } from 'axios';

const baseURL =
  typeof import.meta.env.VITE_API_BASE_URL === 'string' && import.meta.env.VITE_API_BASE_URL.length > 0
    ? import.meta.env.VITE_API_BASE_URL
    : '';

export function createApi(getToken: () => string | null): AxiosInstance {
  const instance = axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
  });

  instance.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (r) => r,
    (err) => {
      if (err.response?.status === 401) {
        // Consumer can listen or redirect; we don't store tokens or redirect here
      }
      return Promise.reject(err);
    }
  );

  return instance;
}

// API methods — use with getApi() from auth context
export const apiPaths = {
  auth: {
    login: '/api/v1/auth/login',
  },
  health: '/api/v1/health',
  stores: '/api/v1/stores',
  storeHealth: '/api/v1/store-health',
  storeHealthById: (id: string) => `/api/v1/stores/${id}/health`,
  executiveBrief: '/api/v1/autopilot/executive-brief',
  alerts: '/api/v1/autopilot/alerts',
  financeSummary: '/api/v1/finance/summary',
  inventory: '/api/v1/inventory',
  inventoryInsights: '/api/v1/inventory-insights',
  staff: '/api/v1/staff',
  workforceInsights: '/api/v1/workforce-insights',
} as const;
