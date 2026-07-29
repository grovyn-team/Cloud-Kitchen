export type Role = 'ADMIN' | 'STAFF';

export interface AuthSession {
  userId: string;
  role: Role;
  storeIds: string[];
  sessionToken: string;
}

export interface LoginPayload {
  email: string;
  password: string;
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

export interface StoreProfitability {
  storeId: string;
  storeName?: string;
  profit: number;
  marginPercent: number;
  grossRevenue?: number;
  netRevenue?: number;
  [key: string]: unknown;
}

export interface BrandProfitability {
  brandId: string;
  profit: number;
  marginPercent?: number;
  [key: string]: unknown;
}

export interface SkuMargin {
  skuId: string;
  marginPercent: number;
  profit?: number;
  [key: string]: unknown;
}

export interface FinanceInsight {
  type: string;
  entityType: 'STORE' | 'BRAND' | 'SKU';
  entityId: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  evaluatedAt: string;
}

export interface InventoryInsight {
  type: string;
  storeId?: string;
  message?: string;
  severity?: string;
  [key: string]: unknown;
}

export interface WorkforceInsight {
  type: string;
  storeId?: string;
  message?: string;
  [key: string]: unknown;
}

export interface DailyTrendPoint {
  date: string;
  revenue: number;
  marginPct: number;
  repeatPct: number;
  commissionPct: number;
}

export interface StoreMetricsSnapshot {
  storeId: string;
  storeName: string;
  yesterday: { revenue: number; repeatRate: number; orderCount: number; netMarginPct: number };
  last7: { revenue: number; commission?: number; repeatRate: number; orderCount: number; netMarginPct: number };
  last14: { revenue: number; repeatRate: number };
  repeatRateDelta7vs14: number;
}

export interface DashboardMetrics {
  referenceToday: string;
  yesterday: { revenue: number; commission: number; netMarginPct: number; repeatRate: number; orderCount: number };
  last7: { revenue: number; commission: number; netMarginPct: number; repeatRate: number; orderCount: number };
  last14: { revenue: number; commission: number; netMarginPct: number; repeatRate: number };
  wow: { marginDeltaPct: number; repeatDeltaPct: number; commissionDeltaPct: number; revenueDeltaPct: number };
  dailyTrend: DailyTrendPoint[];
  perStore: StoreMetricsSnapshot[];
}

export interface InsightCondition {
  condition: string;
  met: boolean;
  detail: string;
}

export interface AIInsight {
  id: string;
  type: 'critical' | 'warning' | 'opportunity' | 'success';
  icon: string;
  priority: number;
  title: string;
  text: string;
  confidence: number;
  triggerRule: string;
  conditions: InsightCondition[];
}

export interface AIAction {
  priority: number;
  icon: string;
  effort: string;
  insightId: string;
  actionText: string;
  expectedOutcome: string;
}

export interface DashboardData {
  metrics: DashboardMetrics;
  insights: AIInsight[];
  actions: AIAction[];
}

export interface SimulateResult {
  newStores: number;
  totalStores: number;
  currentStores: number;
  projectedMAU: number;
  projectedDailyRevenue: number;
  withoutGrovyn: { marginPercent: number; repeatPercent: number; dailyNet: number };
  withGrovyn: { marginPercent: number; repeatPercent: number; dailyNet: number };
  monthlySavings: number;
}

export interface CustomerSegment {
  id: string;
  label: string;
  icon: string;
  count: number;
  pct: number;
}

export interface ChurnRisk {
  customerId: string;
  name: string;
  ltv: number;
  orders: number;
  lastOrderDaysAgo: number;
  avgValue: number;
  risk: string;
}

export interface CustomerSegmentsData {
  totalCustomers: number;
  repeatRate7d: number;
  wowRepeatDeltaPct: number;
  dormantCount: number;
  predictedReorders: number;
  segments: CustomerSegment[];
  championAvgLtv: number;
  dormantWinBackEstimate: number;
  churnRisks: ChurnRisk[];
}

export interface SaleLineItemInput {
  itemName: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  inventoryItemId?: string;
}

export interface SaleLineItem extends SaleLineItemInput {
  id: string;
  lineTotal?: number;
}

export interface SaleCreatePayload {
  branchId: string;
  saleDate: string;
  paymentMethod?: string;
  taxAmount?: number;
  lineItems: SaleLineItemInput[];
}

export interface Sale {
  id: string;
  branchId: string;
  saleDate: string;
  paymentMethod?: string;
  taxAmount?: number;
  subtotal?: number;
  totalAmount: number;
  lineItems: SaleLineItem[];
  createdAt?: string;
  [key: string]: unknown;
}

export interface SalesImportRowError {
  row: number;
  error: string;
}

export interface SalesImportResult {
  importedCount: number;
  errors: SalesImportRowError[];
  importBatchRef?: string;
}

export type RollupPeriod = 'day' | 'week' | 'month';

export interface SalesRollupPoint {
  branchId: string;
  periodStart: string;
  revenue: number;
  orderCount: number;
  aov: number;
}

export interface SalesRollupResponse {
  period: RollupPeriod;
  branchId?: string | null;
  data: SalesRollupPoint[];
}

export interface SalesListMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface SalesListResponse {
  data: Sale[];
  meta: SalesListMeta;
}

export interface InventoryItemCreatePayload {
  branchId: string;
  name: string;
  sku?: string;
  unit: string;
  lowStockThreshold?: number;
  costPerUnit?: number;
  initialStock?: number;
}

export interface InventoryStockAdjustment {
  quantityDelta: number;
  reason?: string;
}

export interface InventoryItemUpdatePayload {
  name?: string;
  sku?: string | null;
  unit?: string;
  lowStockThreshold?: number | null;
  costPerUnit?: number | null;
  stockAdjustment?: InventoryStockAdjustment;
}

export interface InventoryItem {
  id: string;
  branchId: string;
  name: string;
  sku?: string | null;
  unit: string;
  currentStock: number;
  lowStockThreshold?: number | null;
  costPerUnit?: number | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  branchId: string;
  movementType: string;
  quantityDelta: number;
  resultingStock: number;
  reason?: string | null;
  actorUserId?: string | null;
  relatedSaleId?: string | null;
  importBatchRef?: string | null;
  createdAt: string;
}

export interface InventoryItemDetail extends InventoryItem {
  recentMovements: InventoryMovement[];
}

export interface InventoryListMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface InventoryListResponse {
  data: InventoryItem[];
  meta: InventoryListMeta;
}

export interface InventoryImportRowError {
  row: number;
  error: string;
}

export interface InventoryImportResult {
  importedCount: number;
  createdCount?: number;
  updatedCount?: number;
  errors: InventoryImportRowError[];
  importBatchRef?: string;
}

export interface InventoryRequestPayload {
  branchId: string;
  message: string;
  itemName?: string;
  inventoryItemId?: string;
}

export interface InventoryRequestResult {
  id: string;
  branchId: string;
  type: string;
  title: string;
  message: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  status: string;
  createdAt: string;
}

export interface SkuMarginRow {
  skuId: string;
  name: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPercent: number;
  status: 'OK' | 'ALERT';
  qtySold?: number;
  commission?: number;
  net?: number;
}
