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

/**
 * `GET /api/v1/finance/summary` (ADMIN-only) — real DB-backed shape from
 * `financeManagementService.getFinanceSummary`. Replaces the legacy mock
 * shape (`totalGrossRevenue`/`totalNetRevenue`/`overallMarginPercent`) at
 * the same URL — those fields no longer exist in the response.
 *
 * `cogs.isPartial` MUST be surfaced in the UI whenever true: only sale line
 * items linked to an inventory item with a recorded cost-per-unit are
 * counted, so `cogs.value`/`grossMarginEstimate` can understate true cost —
 * never present `grossMarginEstimate` as a final/authoritative number when
 * `cogs.isPartial` is true.
 */
export interface FinanceCogs {
  value: number;
  isPartial: boolean;
  costedLineItemCount: number;
  totalLineItemCount: number;
  note: string;
}

export interface FinanceSummary {
  period: RollupPeriod;
  branchId: string | null;
  revenue: number;
  orderCount: number;
  taxCollected: number;
  cogs: FinanceCogs;
  grossMarginEstimate: number;
}

/**
 * `GET /api/v1/dashboard/summary` — reachable by ADMIN or STAFF, but the
 * response shape genuinely differs by role (`dashboardService.serializeSummary`):
 * a STAFF caller's object has NO `revenue`/`aov` KEYS at all (not `0`, not
 * `null` — structurally absent). Always check `'revenue' in summary` (or the
 * `hasDashboardRevenue` guard below) before rendering a financial tile —
 * never assume the field exists.
 */
export interface DashboardSummary {
  period: RollupPeriod;
  branchId: string | null;
  orderCount: number;
  lowStockCount: number;
  unresolvedNotificationCount: number;
  revenue?: number;
  aov?: number;
}

export function hasDashboardRevenue(
  s: DashboardSummary
): s is DashboardSummary & { revenue: number; aov: number } {
  return 'revenue' in s && 'aov' in s;
}

/** `GET /api/v1/dashboard/by-branch` — ADMIN-only; do not call for STAFF. */
export interface DashboardByBranchRow {
  branchId: string;
  branchName?: string;
  revenue: number;
  orderCount: number;
  aov: number;
}

export interface DashboardByBranchResponse {
  period: RollupPeriod;
  data: DashboardByBranchRow[];
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

export interface CustomerCreatePayload {
  branchId: string;
  name: string;
  phone?: string;
  email?: string;
  category?: string;
  rating?: number;
  notes?: string;
}

export interface CustomerUpdatePayload {
  name?: string;
  phone?: string | null;
  email?: string | null;
  category?: string | null;
  rating?: number | null;
  notes?: string | null;
}

export interface Customer {
  id: string;
  branchId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  category?: string | null;
  rating?: number | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CustomerListMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface CustomerListResponse {
  data: Customer[];
  meta: CustomerListMeta;
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

export interface InventoryItemCreateResponse extends InventoryItem {
  initialMovement: InventoryMovement | null;
}

export interface InventoryItemUpdateResponse extends InventoryItem {
  movement: InventoryMovement | null;
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

export interface StaffAccountCreatePayload {
  email: string;
  name: string;
  password: string;
  role: Role;
  branchIds?: string[];
}

export interface StaffAccountUpdatePayload {
  name?: string;
  role?: Role;
}

export interface StaffAccount {
  id: string;
  email: string;
  name: string;
  role: Role;
  activeBranchCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface StaffBranchAssignment {
  id: string;
  branchId: string;
  branchName: string;
  grantedAt: string;
}

export interface StaffAccountDetail {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt?: string;
  updatedAt?: string;
  branchAssignments: StaffBranchAssignment[];
}

export interface StaffAccountListMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface StaffAccountListResponse {
  data: StaffAccount[];
  meta: StaffAccountListMeta;
}

export interface StaffBranchGrantResponse {
  id: string;
  userId: string;
  branchId: string;
  grantedAt: string;
  reactivated: boolean;
  alreadyActive: boolean;
}

export type NotificationStatus = 'unread' | 'read' | 'resolved';

export interface Notification {
  id: string;
  branchId: string;
  type: string;
  title: string;
  message: string;
  actorUserId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  status: NotificationStatus;
  resolvedByUserId?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface NotificationListMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface NotificationListResponse {
  data: Notification[];
  meta: NotificationListMeta;
}

export interface ExpansionReadinessCriterion {
  name: string;
  status: string;
  value: string;
}

export interface ExpansionReadiness {
  total: number;
  criteria: ExpansionReadinessCriterion[];
  blockers: string[];
  warnings: string[];
  recommendation: string;
}

export interface ExpansionLocation {
  id: string;
  city: string;
  zone: string;
  demandDensity: number;
  competitorCount: number;
  cannibalizationRisk: number;
  avgRentPerSqFt: number;
  opportunityScore: number;
  demandScore?: number;
  competitionScore?: number;
  cannibalizationScore?: number;
}

export interface ExpansionMonthProjection {
  month: number;
  revenue: number;
  cogs: number;
  commission: number;
  fixedCosts: number;
  netProfit: number;
  cumulative: number;
  rampMultiplier: number;
}

export interface ExpansionSetupCosts {
  equipment: number;
  renovation: number;
  deposit: number;
  inventory: number;
  total: number;
}

export interface ExpansionFinancials {
  setupCosts: ExpansionSetupCosts;
  totalSetupCost: number;
  monthlyProjections: ExpansionMonthProjection[];
  breakevenMonth: number | string;
  year1Revenue: number;
  year1NetProfit: number;
}

export interface ExpansionGrovynImpact {
  feature: string;
  description: string;
  calculation: string;
  monthlyValue: number;
  annualValue: number;
}

export interface ExpansionRisks {
  overall: number;
  breakdown: Record<string, number>;
}

export interface ExpansionScenario {
  name: string;
  newStores: number;
  timeline: number;
  locations: ExpansionLocation[];
  description: string;
}

export interface ExpansionSelectedScenario extends ExpansionScenario {
  financials: ExpansionFinancials;
  grovynImpact: ExpansionGrovynImpact[];
  risks: ExpansionRisks;
}

export interface ExpansionCostAssumptions {
  setupCostPerStore: { equipment: number; renovation: number; deposit: number; inventory: number };
  cogsPct: number;
  commissionPct: number;
  monthlyRentPerStore: number;
  monthlyUtilitiesPerStore: number;
  monthlyStaffCostPerStore: number;
  currency: string;
  locale: string;
}

export interface ExpansionDataSource {
  avgMonthlyRevenuePerStore: number;
  avgMarginPct: number;
  avgMarginIsPartial: boolean;
  unresolvedNotificationCount: number;
  repeatRatePct: number;
  repeatRatePctIsAssumed: boolean;
}

/**
 * `GET /api/v1/expansion/plan` (ADMIN-only) — real DB-backed expansion plan
 * from `expansionService.runExpansionPlan`. Supersedes the legacy in-memory
 * mock at `/api/v1/expansion/simulate` (still mounted, untouched, unused by
 * this page) at a deliberately different URL. Same overall shape the old
 * mock returned (`currentStores`/`readiness`/`topLocations`/`scenarios`/
 * `selectedScenario`) PLUS two additive blocks:
 *  - `costAssumptions`: the resolved cost inputs actually used (query
 *    override > tenant.settings.expansion > engine default).
 *  - `dataSource`: flags what's real-measured vs. assumed. In particular
 *    `dataSource.repeatRatePctIsAssumed` MUST be surfaced in the UI whenever
 *    true — `sale` has no `customer_id` FK yet, so a true repeat-purchase
 *    rate cannot be computed from real data; the repeat rate feeding the
 *    Readiness "Retention" criterion is a conservative assumed default (or a
 *    caller/tenant-supplied override), not a measured figure. Same honesty
 *    posture as `FinanceCogs.isPartial` above — never present it as measured.
 */
export interface ExpansionPlanResponse {
  currentStores: number;
  readiness: ExpansionReadiness;
  topLocations: ExpansionLocation[];
  scenarios: Record<string, ExpansionScenario>;
  selectedScenario: ExpansionSelectedScenario;
  costAssumptions: ExpansionCostAssumptions;
  dataSource: ExpansionDataSource;
}

export type ExpansionScenarioKey = 'conservative' | 'moderate' | 'aggressive';

/** Query-param overrides for `GET /api/v1/expansion/plan` — see `backend/src/routes/expansion.js`'s doc comment for validation ranges. */
export interface ExpansionPlanParams {
  scenario?: ExpansionScenarioKey;
  newStores?: number;
  repeatRatePct?: number;
  cogsPct?: number;
  commissionPct?: number;
  equipmentCostPerStore?: number;
  renovationCostPerStore?: number;
  depositCostPerStore?: number;
  inventoryCostPerStore?: number;
  monthlyRentPerStore?: number;
  monthlyUtilitiesPerStore?: number;
  monthlyStaffCostPerStore?: number;
  currency?: string;
  locale?: string;
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
