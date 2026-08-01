import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import { Info, XCircle } from 'lucide-react';
import type { FinanceSummary, RollupPeriod, Store } from '@/types/api';

const PERIODS: { value: RollupPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const inputClass =
  'h-9 w-56 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function Finance() {
  const { api, role } = useAuth();
  const [period, setPeriod] = useState<RollupPeriod>('day');
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<Store[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // This page is ADMIN-only (backend `financeMgmtAuth` 403s STAFF, and the
  // route is already gated with `RequireRole roles={['ADMIN']}` in
  // router.tsx). This is a defense-in-depth check so the page never fetches
  // financial data for a non-ADMIN session even if reached some other way.
  const isAdmin = role === 'ADMIN';

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<{ data: Store[] }>(apiPaths.branchesList({ pageSize: 100 }))
      .then((r) => setBranches(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => setBranches([]));
  }, [api, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    api
      .get<FinanceSummary>(apiPaths.financeSummary(period, branchId || undefined))
      .then((r) => setSummary(r.data))
      .catch(() => {
        setSummary(null);
        setError('Could not load the finance summary. Try again in a moment.');
      })
      .finally(() => setLoading(false));
  }, [api, isAdmin, period, branchId]);

  const branchNameById = useMemo(() => {
    const m: Record<string, string> = {};
    branches.forEach((b) => {
      m[b.id] = b.name;
    });
    return m;
  }, [branches]);

  if (!isAdmin) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 rounded-xl bg-card p-8 shadow-card">
        <p className="font-medium text-foreground">Access denied.</p>
        <p className="text-sm text-muted-foreground">You don’t have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Finance</h2>
          <p className="text-sm text-muted-foreground">
            Revenue, tax collected, and cost of goods sold, aggregated from real sales data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select className={inputClass} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                type="button"
                size="sm"
                variant={period === p.value ? 'default' : 'ghost'}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{error}</p>
        </div>
      ) : !summary ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">No financial data yet for this {period}.</p>
        </div>
      ) : summary.orderCount === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">
            No sales recorded for {branchId ? branchNameById[branchId] ?? 'this branch' : 'any branch'} this {period}.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Revenue"
              value={`₹${Number(summary.revenue).toLocaleString()}`}
              subtitle={`${summary.orderCount} order${summary.orderCount !== 1 ? 's' : ''}`}
            />
            <MetricCard title="Tax collected" value={`₹${Number(summary.taxCollected).toLocaleString()}`} />
            <MetricCard
              title="Cost of goods sold"
              value={`₹${Number(summary.cogs.value).toLocaleString()}`}
              subtitle={
                summary.cogs.isPartial
                  ? `Partial — ${summary.cogs.costedLineItemCount} of ${summary.cogs.totalLineItemCount} line items have cost data`
                  : `${summary.cogs.costedLineItemCount} of ${summary.cogs.totalLineItemCount} line items costed`
              }
            >
              {summary.cogs.isPartial && (
                <div className="mt-2">
                  <StatusBadge variant="at_risk">Partial data</StatusBadge>
                </div>
              )}
            </MetricCard>
            <MetricCard
              title="Gross margin (estimate)"
              value={`₹${Number(summary.grossMarginEstimate).toLocaleString()}`}
              subtitle={
                summary.cogs.isPartial
                  ? 'Estimate — COGS is incomplete, treat as a floor, not a final figure'
                  : 'Estimate, not a GST-compliance-grade figure'
              }
            />
          </div>

          {summary.cogs.isPartial && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-900">{summary.cogs.note}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
