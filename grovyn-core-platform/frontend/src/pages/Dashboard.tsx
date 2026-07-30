import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import { XCircle } from 'lucide-react';
import {
  hasDashboardRevenue,
  type DashboardSummary,
  type DashboardByBranchResponse,
  type DashboardByBranchRow,
  type RollupPeriod,
} from '@/types/api';

const PERIODS: { value: RollupPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

export function Dashboard() {
  const { api, role } = useAuth();
  const [period, setPeriod] = useState<RollupPeriod>('day');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ADMIN-only cross-branch breakdown — never fetched for STAFF (the
  // backend 403s it, and STAFF has no business seeing other branches'
  // revenue anyway).
  const [byBranch, setByBranch] = useState<DashboardByBranchRow[]>([]);
  const [byBranchLoading, setByBranchLoading] = useState(false);
  const [byBranchError, setByBranchError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<DashboardSummary>(apiPaths.dashboardSummary(period))
      .then((r) => setSummary(r.data))
      .catch(() => {
        setSummary(null);
        setError('Could not load the dashboard summary. Try again in a moment.');
      })
      .finally(() => setLoading(false));
  }, [api, period]);

  useEffect(() => {
    if (role !== 'ADMIN') {
      setByBranch([]);
      setByBranchError(null);
      return;
    }
    setByBranchLoading(true);
    setByBranchError(null);
    api
      .get<DashboardByBranchResponse>(apiPaths.dashboardByBranch(period))
      .then((r) => setByBranch(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => {
        setByBranch([]);
        setByBranchError('Could not load the per-branch breakdown.');
      })
      .finally(() => setByBranchLoading(false));
  }, [api, role, period]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            {role === 'ADMIN' ? 'Business performance across your tenant.' : 'Your branch at a glance.'}
          </p>
        </div>
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

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{error}</p>
        </div>
      ) : !summary ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">No data yet for this {period}.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Revenue/AOV are only rendered when the key is present in the
                response at all — never rendered as a placeholder/zero for a
                STAFF session, which genuinely never receives these keys. */}
            {hasDashboardRevenue(summary) && (
              <>
                <MetricCard title="Revenue" value={`₹${Number(summary.revenue).toLocaleString()}`} />
                <MetricCard
                  title="Average order value"
                  value={`₹${Number(summary.aov).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                />
              </>
            )}
            <MetricCard title="Orders" value={summary.orderCount.toLocaleString()} />
            <MetricCard title="Low stock items" value={summary.lowStockCount.toLocaleString()}>
              {summary.lowStockCount > 0 && (
                <div className="mt-2">
                  <StatusBadge variant="at_risk">Needs restock</StatusBadge>
                </div>
              )}
            </MetricCard>
            <MetricCard
              title="Unresolved notifications"
              value={summary.unresolvedNotificationCount.toLocaleString()}
            >
              {summary.unresolvedNotificationCount > 0 && (
                <div className="mt-2">
                  <StatusBadge variant="warning">Needs attention</StatusBadge>
                </div>
              )}
            </MetricCard>
          </div>

          {role === 'ADMIN' && (
            <Card className="rounded-xl border border-border">
              <CardHeader>
                <CardTitle className="text-base">By branch</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Revenue, orders, and AOV for every branch this {period}.
                </p>
              </CardHeader>
              <CardContent>
                {byBranchLoading ? (
                  <div className="flex min-h-[100px] items-center justify-center">
                    <p className="text-muted-foreground">Loading…</p>
                  </div>
                ) : byBranchError ? (
                  <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                    <p className="text-sm font-medium text-red-900">{byBranchError}</p>
                  </div>
                ) : byBranch.length === 0 ? (
                  <p className="text-muted-foreground">No branches found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Branch</th>
                          <th className="pb-2 pr-4 font-medium">Revenue</th>
                          <th className="pb-2 pr-4 font-medium">Orders</th>
                          <th className="pb-2 font-medium">AOV</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byBranch.map((b) => (
                          <tr key={b.branchId} className="border-b border-border/60">
                            <td className="py-2 pr-4 font-medium text-foreground">
                              {b.branchName ?? b.branchId}
                            </td>
                            <td className="py-2 pr-4">₹{Number(b.revenue).toLocaleString()}</td>
                            <td className="py-2 pr-4">{b.orderCount}</td>
                            <td className="py-2">
                              ₹{Number(b.aov).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
