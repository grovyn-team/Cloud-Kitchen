export type Role = 'ADMIN' | 'STAFF';

export interface AuthSession {
  userId: string;
  role: Role;
  storeIds: string[];
  sessionToken: string;
}

export interface LoginPayload {
  email: string;
  role: Role;
  storeId?: string;
}

export interface ApiMeta {
  count: number;
}

export interface Store {
  id: string;
  name: string;
  cityId: string;
  [key: string]: unknown;
}

export interface StoreHealth {
  storeId: string;
  storeName: string;
  status: 'healthy' | 'at_risk' | 'critical';
  signals: Record<string, unknown>;
  lastEvaluatedAt: string;
}

export interface ExecutiveBrief {
  generatedAt: string;
  businessSnapshot: {
    totalGrossRevenue: number;
    totalNetRevenue: number;
    totalProfit: number;
    overallMarginPercent: number;
    storesAtRiskCount: number;
  };
  whatNeedsAttentionToday: string[];
  suggestedActions: string[];
}

export interface Alert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  entities?: { type: string; id: string }[];
  evaluatedAt?: string;
}

export interface FinanceSummary {
  totalGrossRevenue: number;
  totalNetRevenue: number;
  totalProfit: number;
  overallMarginPercent: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: ApiMeta;
}
