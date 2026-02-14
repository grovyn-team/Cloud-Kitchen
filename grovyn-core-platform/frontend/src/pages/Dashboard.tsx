import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { InsightCard } from '@/components/InsightCard';
import { StatusBadge, severityToBadgeVariant } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import type { ExecutiveBrief, FinanceSummary, StoreHealth, Alert } from '@/types/api';

export function Dashboard() {
  const { api, role } = useAuth();
  const [brief, setBrief] = useState<ExecutiveBrief | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [storeHealth, setStoreHealth] = useState<StoreHealth[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

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
      });
    }
  }, [api, role]);

  if (role === 'ADMIN') {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground">Executive Dashboard</h2>
        {brief && (
          <InsightCard title="Executive Brief">
            <p className="mb-2 text-sm text-muted-foreground">Generated: {brief.generatedAt}</p>
            <div className="grid gap-2 text-sm">
              <p><strong>Snapshot:</strong> Revenue {brief.businessSnapshot?.totalGrossRevenue != null && `$${Number(brief.businessSnapshot.totalGrossRevenue).toLocaleString()}`} · Margin {brief.businessSnapshot?.overallMarginPercent?.toFixed(1)}% · Stores at risk: {brief.businessSnapshot?.storesAtRiskCount ?? 0}</p>
              {brief.whatNeedsAttentionToday?.length > 0 && (
                <ul className="list-inside list-disc text-muted-foreground">
                  {brief.whatNeedsAttentionToday.slice(0, 3).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </InsightCard>
        )}
        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Gross Revenue" value={`$${Number(summary.totalGrossRevenue).toLocaleString()}`} />
            <MetricCard title="Net Revenue" value={`$${Number(summary.totalNetRevenue).toLocaleString()}`} />
            <MetricCard title="Profit" value={`$${Number(summary.totalProfit).toLocaleString()}`} />
            <MetricCard title="Margin" value={`${Number(summary.overallMarginPercent).toFixed(1)}%`} />
          </div>
        )}
        {storeHealth.length > 0 && (
          <InsightCard title="Store health">
            <ul className="space-y-1 text-sm">
              {storeHealth.slice(0, 5).map((s) => (
                <li key={s.storeId}>
                  {s.storeName} — <StatusBadge variant={s.status === 'healthy' ? 'healthy' : s.status === 'at_risk' ? 'at_risk' : 'critical'}>{s.status}</StatusBadge>
                </li>
              ))}
            </ul>
          </InsightCard>
        )}
        {alerts.length > 0 && (
          <InsightCard title="Alerts">
            <ul className="space-y-2">
              {alerts.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <StatusBadge variant={severityToBadgeVariant(a.severity)}>{a.severity}</StatusBadge> {a.message}
                </li>
              ))}
            </ul>
          </InsightCard>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">My Store</h2>
      {storeHealth.length > 0 && (
        <>
          <InsightCard title="Store health">
            <ul className="space-y-2 text-sm">
              {storeHealth.map((s) => (
                <li key={s.storeId}>
                  {s.storeName} — <StatusBadge variant={s.status === 'healthy' ? 'healthy' : s.status === 'at_risk' ? 'at_risk' : 'critical'}>{s.status}</StatusBadge>
                </li>
              ))}
            </ul>
          </InsightCard>
        </>
      )}
      {alerts.length > 0 && (
        <InsightCard title="Alerts">
          <ul className="space-y-2">
            {alerts.slice(0, 10).map((a) => (
              <li key={a.id}>
                <StatusBadge variant={severityToBadgeVariant(a.severity)}>{a.severity}</StatusBadge> {a.message}
              </li>
            ))}
          </ul>
        </InsightCard>
      )}
    </div>
  );
}
