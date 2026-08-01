import axios, { type AxiosInstance } from 'axios';
import type { ExpansionPlanParams, RollupPeriod } from '@/types/api';

// When VITE_API_BASE_URL is set (e.g. Vercel), call API directly. Otherwise use proxy in dev (empty baseURL).
const baseURL =
  typeof import.meta.env.VITE_API_BASE_URL === 'string' && import.meta.env.VITE_API_BASE_URL.length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : '';

/** Build full API URL for a path (e.g. '/api/v1/auth/stores') — avoids double slashes. */
export function getApiUrl(path: string): string {
  const p = path.startsWith('/') ? path.slice(1) : path;
  return baseURL ? `${baseURL}/${p}` : `/${p}`;
}

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
  // DEAD -- kept ONLY so the orphaned, unrouted `pages/Stores.tsx`,
  // `pages/StoreDetail.tsx`, `pages/Store.tsx` still compile (Integration
  // Task 2 unmounted every backend route these call: `/stores`,
  // `/store-health`, `/stores/:id/health`, `/inventory-insights`,
  // `/workforce-insights`, `/finance/stores`, `/finance-insights`,
  // `/autopilot/alerts` — see `routes/v1/index.js`'s top doc comment. Every
  // real branch picker in the app uses `branches`/`branchesList` below
  // instead. Deleting these 3 unrouted files (recommended — they are 100%
  // superseded by the real `Branches` page) would let this whole block be
  // removed too; deleting frontend page files was outside this pass's
  // explicit scope, so it's flagged for a decision instead of done here.
  stores: '/api/v1/stores',
  storeHealth: '/api/v1/store-health',
  storeHealthById: (id: string) => `/api/v1/stores/${id}/health`,
  alerts: '/api/v1/autopilot/alerts',
  inventoryInsights: '/api/v1/inventory-insights',
  workforceInsights: '/api/v1/workforce-insights',
  financeStores: '/api/v1/finance/stores',
  financeInsights: '/api/v1/finance-insights',
  // Real DB-backed branch management (P1-06, Integration Task 1). ADMIN gets
  // full CRUD; STAFF list/detail is scoped server-side to their assigned
  // branches. Supersedes the legacy `/api/v1/stores` mock -- every branch
  // picker in the app now calls `branchesList` (a generous pageSize so a
  // picker dropdown gets every branch in one call, not a paginated slice).
  branches: '/api/v1/branches',
  branchById: (id: string) => `/api/v1/branches/${id}`,
  branchesList: (params: { page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams();
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 100));
    return `/api/v1/branches?${q.toString()}`;
  },
  // Real DB-backed dashboard aggregation (P2-03/P2-04/P2-06). `summary` is
  // reachable by ADMIN or STAFF — the response SHAPE differs by role (STAFF
  // never gets `revenue`/`aov` keys at all, see `types/api.ts`'s
  // `DashboardSummary`). `by-branch` is ADMIN-only — do not call it for a
  // STAFF session (backend 403s, and it fetches data STAFF shouldn't see).
  dashboardSummary: (period: RollupPeriod, branchId?: string) =>
    branchId
      ? `/api/v1/dashboard/summary?period=${period}&branchId=${branchId}`
      : `/api/v1/dashboard/summary?period=${period}`,
  dashboardByBranch: (period: RollupPeriod) => `/api/v1/dashboard/by-branch?period=${period}`,
  // Real DB-backed finance summary (P2-03/P2-06), ADMIN-only. Same URL as the
  // legacy in-memory mock it superseded — the RESPONSE SHAPE is different
  // (see `FinanceSummary` in `types/api.ts`), so this is now a function
  // (period is required by the backend) rather than a bare path string.
  financeSummary: (period: RollupPeriod, branchId?: string) =>
    branchId
      ? `/api/v1/finance/summary?period=${period}&branchId=${branchId}`
      : `/api/v1/finance/summary?period=${period}`,
  // Real DB-backed expansion plan (P35-01/P35-02), ADMIN-only. See
  // `ExpansionPlanResponse`/`ExpansionPlanParams` in `types/api.ts` for the
  // response shape and the accepted override params respectively.
  expansionPlan: (params: ExpansionPlanParams = {}) => {
    const q = new URLSearchParams();
    if (params.scenario) q.set('scenario', params.scenario);
    if (params.newStores != null) q.set('newStores', String(params.newStores));
    if (params.repeatRatePct != null) q.set('repeatRatePct', String(params.repeatRatePct));
    if (params.cogsPct != null) q.set('cogsPct', String(params.cogsPct));
    if (params.commissionPct != null) q.set('commissionPct', String(params.commissionPct));
    if (params.equipmentCostPerStore != null) q.set('equipmentCostPerStore', String(params.equipmentCostPerStore));
    if (params.renovationCostPerStore != null) q.set('renovationCostPerStore', String(params.renovationCostPerStore));
    if (params.depositCostPerStore != null) q.set('depositCostPerStore', String(params.depositCostPerStore));
    if (params.inventoryCostPerStore != null) q.set('inventoryCostPerStore', String(params.inventoryCostPerStore));
    if (params.monthlyRentPerStore != null) q.set('monthlyRentPerStore', String(params.monthlyRentPerStore));
    if (params.monthlyUtilitiesPerStore != null) q.set('monthlyUtilitiesPerStore', String(params.monthlyUtilitiesPerStore));
    if (params.monthlyStaffCostPerStore != null) q.set('monthlyStaffCostPerStore', String(params.monthlyStaffCostPerStore));
    if (params.currency) q.set('currency', params.currency);
    if (params.locale) q.set('locale', params.locale);
    const qs = q.toString();
    return qs ? `/api/v1/expansion/plan?${qs}` : '/api/v1/expansion/plan';
  },
  sales: '/api/v1/sales',
  salesImport: '/api/v1/sales/import',
  salesRollup: (period: 'day' | 'week' | 'month', branchId?: string) =>
    branchId
      ? `/api/v1/sales/rollup?period=${period}&branchId=${branchId}`
      : `/api/v1/sales/rollup?period=${period}`,
  salesById: (id: string) => `/api/v1/sales/${id}`,
  inventoryItems: '/api/v1/inventory/items',
  inventoryItemById: (id: string) => `/api/v1/inventory/items/${id}`,
  inventoryImport: '/api/v1/inventory/import',
  inventoryRequests: '/api/v1/inventory/requests',
  inventoryItemsList: (params: { branchId?: string; lowStock?: boolean; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params.branchId) q.set('branchId', params.branchId);
    if (params.lowStock) q.set('lowStock', 'true');
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    const qs = q.toString();
    return qs ? `/api/v1/inventory/items?${qs}` : '/api/v1/inventory/items';
  },
  customers: '/api/v1/customers',
  customerById: (id: string) => `/api/v1/customers/${id}`,
  customersList: (params: { branchId?: string; category?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params.branchId) q.set('branchId', params.branchId);
    if (params.category) q.set('category', params.category);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    const qs = q.toString();
    return qs ? `/api/v1/customers?${qs}` : '/api/v1/customers';
  },
  // Real staff-account management (ADMIN-only) — mounted under `/staff/accounts`,
  // deliberately distinct from the legacy `apiPaths.staff` ('/api/v1/staff')
  // read-only workforce-snapshot mock, which is a separate endpoint. See
  // `backend/src/routes/staffManagement.js`'s doc comment for why the paths differ.
  staffAccounts: '/api/v1/staff/accounts',
  staffAccountById: (id: string) => `/api/v1/staff/accounts/${id}`,
  staffAccountsList: (params: { page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    const qs = q.toString();
    return qs ? `/api/v1/staff/accounts?${qs}` : '/api/v1/staff/accounts';
  },
  staffAccountBranches: (id: string) => `/api/v1/staff/accounts/${id}/branches`,
  staffAccountBranchById: (id: string, branchId: string) => `/api/v1/staff/accounts/${id}/branches/${branchId}`,
  notifications: (params: { status?: 'unread' | 'read' | 'resolved'; branchId?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.branchId) q.set('branchId', params.branchId);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    const qs = q.toString();
    return qs ? `/api/v1/notifications?${qs}` : '/api/v1/notifications';
  },
  notificationsUnreadCount: (branchId?: string) =>
    branchId ? `/api/v1/notifications/unread-count?branchId=${branchId}` : '/api/v1/notifications/unread-count',
  notificationMarkRead: (id: string) => `/api/v1/notifications/${id}/read`,
  notificationResolve: (id: string) => `/api/v1/notifications/${id}/resolve`,
  // Real DB-backed GST summary/export (ADMIN-only). `periodStart`/`periodEnd`
  // are required by the backend (`YYYY-MM-DD`); `branchId` omitted means
  // all branches. See `TaxSummary` in `types/api.ts` for the response shape
  // and its mandatory-disclaimer note.
  taxSummary: (params: { branchId?: string; periodStart: string; periodEnd: string }) => {
    const q = new URLSearchParams();
    if (params.branchId) q.set('branchId', params.branchId);
    q.set('periodStart', params.periodStart);
    q.set('periodEnd', params.periodEnd);
    return `/api/v1/tax/summary?${q.toString()}`;
  },
  // Downloads a CSV file — fetch with `responseType: 'blob'` via the
  // authenticated `api` client (a plain `<a href>` can't attach the bearer
  // token), then trigger the browser download from the blob.
  taxExport: (params: { branchId?: string; periodStart: string; periodEnd: string; format?: string }) => {
    const q = new URLSearchParams();
    if (params.branchId) q.set('branchId', params.branchId);
    q.set('periodStart', params.periodStart);
    q.set('periodEnd', params.periodEnd);
    q.set('format', params.format ?? 'csv');
    return `/api/v1/tax/export?${q.toString()}`;
  },
} as const;
