import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { InsightCard } from '@/components/InsightCard';
import { StatusBadge, severityToBadgeVariant } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiPaths } from '@/services/api';
import type { ExecutiveBrief, FinanceSummary, StoreHealth, Alert } from '@/types/api';

export function Dashboard() {
  const { api, role } = useAuth();
  const [brief, setBrief] = useState<ExecutiveBrief | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [storeHealth, setStoreHealth] = useState<StoreHealth[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (role === 'ADMIN') {
      Promise.all([
        api.get<ExecutiveBrief>(apiPaths.executiveBrief).then((r) => r.data).catch(() => null),
        api.get<FinanceSummary>(apiPaths.financeSummary).then((r) => r.data).catch(() => null),
        api.get<{ data: StoreHealth[] }>(apiPaths.storeHealth).then((r) => r.data?.data ?? []).catch(() => []),
        api.get<{ data: Alert[] }>(apiPaths.alerts).then((r) => r.data?.data ?? []).catch(() => []),
      ]).then(([b, s, h, a]) => {
        if (b) setBrief(b);
        if (s) setSummary(s);
        setStoreHealth(Array.isArray(h) ? h : []);
        setAlerts(Array.isArray(a) ? a : []);
        setLoading(false);
      });
    } else {
      Promise.all([
        api.get<{ data: StoreHealth[] }>(apiPaths.storeHealth).then((r) => r.data?.data ?? []).catch(() => []),
        api.get<{ data: Alert[] }>(apiPaths.alerts).then((r) => r.data?.data ?? []).catch(() => []),
      ]).then(([h, a]) => {
        setStoreHealth(Array.isArray(h) ? h : []);
        setAlerts(Array.isArray(a) ? a : []);
        setBrief(null);
        setSummary(null);
        setLoading(false);
      });
    }
  }, [api, role]);

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (role === 'ADMIN') {
    const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
    const atRisk = storeHealth.filter((s) => s.status === 'at_risk' || s.status === 'critical');
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground">Executive Dashboard</h2>

        {brief && (
          <Card className="overflow-hidden rounded-2xl border-primary/20 bg-gradient-to-br from-primary/5 to-transparent shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-foreground">What’s happening</CardTitle>
              <p className="text-sm text-muted-foreground">
                Snapshot as of {brief.generatedAt?.replace('T', ' ').slice(0, 16)}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <p>
                  <span className="font-medium text-foreground">Revenue</span>{' '}
                  {brief.businessSnapshot?.totalGrossRevenue != null &&
                    `$${Number(brief.businessSnapshot.totalGrossRevenue).toLocaleString()}`}{' '}
                  · <span className="font-medium text-foreground">Margin</span>{' '}
                  {brief.businessSnapshot?.overallMarginPercent?.toFixed(1)}% ·{' '}
                  <span className="font-medium text-foreground">Stores at risk</span>{' '}
                  {brief.businessSnapshot?.storesAtRiskCount ?? 0}
                </p>
              </div>
              {brief.whatNeedsAttentionToday?.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Needs attention today
                  </p>
                  <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                    {brief.whatNeedsAttentionToday.slice(0, 4).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {brief.suggestedActions?.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    What you should do
                  </p>
                  <ul className="space-y-1 text-sm text-foreground">
                    {brief.suggestedActions.slice(0, 3).map((action, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Gross revenue" value={`$${Number(summary.totalGrossRevenue).toLocaleString()}`} />
            <MetricCard title="Net revenue" value={`$${Number(summary.totalNetRevenue).toLocaleString()}`} />
            <MetricCard title="Profit" value={`$${Number(summary.totalProfit).toLocaleString()}`} />
            <MetricCard
              title="Overall margin"
              value={`${Number(summary.overallMarginPercent).toFixed(1)}%`}
              subtitle={atRisk.length > 0 ? `${atRisk.length} store(s) need attention` : undefined}
            />
          </div>
        )}

        {storeHealth.length > 0 && (
          <InsightCard title="Store health at a glance">
            <ul className="space-y-2 text-sm">
              {storeHealth.slice(0, 6).map((s) => (
                <li key={s.storeId} className="flex items-center justify-between gap-4">
                  <span className="text-foreground">{s.storeName}</span>
                  <StatusBadge
                    variant={
                      s.status === 'healthy' ? 'healthy' : s.status === 'at_risk' ? 'at_risk' : 'critical'
                    }
                  >
                    {s.status.replace('_', ' ')}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          </InsightCard>
        )}

        {criticalAlerts.length > 0 && (
          <InsightCard title="Critical alerts" className="border-amber-200/50">
            <ul className="space-y-2">
              {criticalAlerts.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-start gap-2 rounded-lg border border-amber-200/50 bg-amber-50/50 p-3">
                  <StatusBadge variant="critical">{a.severity}</StatusBadge>
                  <span className="text-sm text-foreground">{a.message}</span>
                </li>
              ))}
            </ul>
          </InsightCard>
        )}

        {alerts.length === 0 && !brief && !summary && storeHealth.length === 0 && (
          <p className="text-muted-foreground">No data yet. Complete setup or run a sync.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">My store</h2>
      {storeHealth.length > 0 ? (
        <>
          <InsightCard title="Store health">
            <ul className="space-y-2 text-sm">
              {storeHealth.map((s) => (
                <li key={s.storeId} className="flex items-center justify-between gap-4">
                  <span className="text-foreground">{s.storeName}</span>
                  <StatusBadge
                    variant={
                      s.status === 'healthy' ? 'healthy' : s.status === 'at_risk' ? 'at_risk' : 'critical'
                    }
                  >
                    {s.status.replace('_', ' ')}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          </InsightCard>
          {alerts.length > 0 && (
            <InsightCard title="Alerts for your store">
              <ul className="space-y-2">
                {alerts.slice(0, 10).map((a) => (
                  <li key={a.id} className="flex items-start gap-2">
                    <StatusBadge variant={severityToBadgeVariant(a.severity)}>{a.severity}</StatusBadge>
                    <span className="text-sm text-foreground">{a.message}</span>
                  </li>
                ))}
              </ul>
            </InsightCard>
          )}
        </>
      ) : (
        <p className="text-muted-foreground">No store data. If you just signed in, your store may still be loading.</p>
      )}
    </div>
  );
}
