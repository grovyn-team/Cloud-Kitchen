import axios, { type AxiosInstance } from 'axios';

const baseURL =
  typeof import.meta.env.VITE_API_BASE_URL === 'string' && import.meta.env.VITE_API_BASE_URL.length > 0
    ? import.meta.env.VITE_API_BASE_URL
    : '';

export function createApi(
  getToken: () => string | null,
  onUnauthorized?: () => void
): AxiosInstance {
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
      if (err.response?.status === 401 && onUnauthorized) {
        onUnauthorized();
      }
      return Promise.reject(err);
    }
  );

  return instance;
}

export const apiPaths = {
  auth: { login: '/api/v1/auth/login' },
  health: '/api/v1/health',
  stores: '/api/v1/stores',
  storeHealth: '/api/v1/store-health',
  storeHealthById: (id: string) => `/api/v1/stores/${id}/health`,
  executiveBrief: '/api/v1/autopilot/executive-brief',
  alerts: '/api/v1/autopilot/alerts',
  financeSummary: '/api/v1/finance/summary',
  financeStores: '/api/v1/finance/stores',
  financeBrands: '/api/v1/finance/brands',
  financeSkus: '/api/v1/finance/skus',
  financeInsights: '/api/v1/finance-insights',
  inventory: '/api/v1/inventory',
  inventoryInsights: '/api/v1/inventory-insights',
  staff: '/api/v1/staff',
  workforceInsights: '/api/v1/workforce-insights',
  dashboard: '/api/v1/dashboard',
  metrics: '/api/v1/metrics',
  insights: '/api/v1/insights',
  actions: '/api/v1/actions',
  simulate: (stores: number) => `/api/v1/simulate?stores=${stores}`,
  customersSegments: '/api/v1/customers/segments',
  skusMarginAnalysis: '/api/v1/skus/margin-analysis',
} as const;
