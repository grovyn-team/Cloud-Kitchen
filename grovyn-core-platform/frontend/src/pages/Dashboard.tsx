import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { InsightCard } from '@/components/InsightCard';
import { StatusBadge, severityToBadgeVariant } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkline } from '@/components/Sparkline';
import { apiPaths } from '@/services/api';
import type {
  ExecutiveBrief,
  FinanceSummary,
  StoreHealth,
  Alert,
  DashboardData,
  AIInsight,
  AIAction,
  DashboardMetrics,
} from '@/types/api';

function WowDelta({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const isUp = value >= 0;
  return (
    <span className={isUp ? 'text-[#22c55e]' : 'text-[#ef4444]'}>
      {isUp ? '▲' : '▼'} {isUp ? '+' : ''}{value}{suffix} WoW
    </span>
  );
}

export function Dashboard() {
  const { api, role } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [brief, setBrief] = useState<ExecutiveBrief | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [storeHealth, setStoreHealth] = useState<StoreHealth[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);

  useEffect(() => {
    if (role === 'ADMIN') {
      Promise.all([
        api.get<DashboardData>(apiPaths.dashboard).then((r) => r.data).catch(() => null),
        api.get<ExecutiveBrief>(apiPaths.executiveBrief).then((r) => r.data).catch(() => null),
        api.get<{ data: StoreHealth[] }>(apiPaths.storeHealth).then((r) => r.data?.data ?? []).catch(() => []),
        api.get<{ data: Alert[] }>(apiPaths.alerts).then((r) => r.data?.data ?? []).catch(() => []),
      ]).then(([d, b, h, a]) => {
        if (d) setDashboard(d);
        if (b) setBrief(b);
        setStoreHealth(Array.isArray(h) ? h : []);
        setAlerts(Array.isArray(a) ? a : []);
        if (d?.metrics) setSummary(null);
        else if (b) setSummary(null);
        setLoading(false);
      });
    } else {
      Promise.all([
        api.get<{ data: StoreHealth[] }>(apiPaths.storeHealth).then((r) => r.data?.data ?? []).catch(() => []),
        api.get<{ data: Alert[] }>(apiPaths.alerts).then((r) => r.data?.data ?? []).catch(() => []),
      ]).then(([h, a]) => {
        setStoreHealth(Array.isArray(h) ? h : []);
        setAlerts(Array.isArray(a) ? a : []);
        setDashboard(null);
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

  if (role === 'ADMIN' && dashboard) {
    const m: DashboardMetrics = dashboard.metrics;
    const insights: AIInsight[] = dashboard.insights || [];
    const actions: AIAction[] = dashboard.actions || [];
    const revenueTrend = m.dailyTrend?.map((d) => d.revenue) ?? [];
    const marginTrend = m.dailyTrend?.map((d) => d.marginPct) ?? [];
    const repeatTrend = m.dailyTrend?.map((d) => d.repeatPct) ?? [];
    const commissionTrend = m.dailyTrend?.map((d) => d.commissionPct) ?? [];
    const commissionPct = m.yesterday?.revenue
      ? (m.yesterday.commission / m.yesterday.revenue) * 100
      : 0;

    return (
      <div className="space-y-6">
        {/* Hero — AI Executive Summary */}
        <Card className="overflow-hidden rounded-2xl border-2 border-[#eab308]/40 bg-gradient-to-br from-[#eab308]/5 to-transparent shadow-lg">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg text-foreground">AI Executive Summary</CardTitle>
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                GET /api/dashboard
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Daily Operations Overview · Yesterday&apos;s performance · {insights.length} insights · Computed server-side
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 rounded-lg border border-border/60 bg-background/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Yesterday Revenue
                </p>
                <p className="font-serif text-2xl font-semibold text-foreground">
                  ₹{Number(m.yesterday?.revenue ?? 0).toLocaleString()}
                </p>
                <Sparkline data={revenueTrend} />
                <p className="text-xs"><WowDelta value={m.wow?.revenueDeltaPct ?? 0} suffix="%" /></p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Net Margin %
                </p>
                <p className="font-serif text-2xl font-semibold text-foreground">
                  {(m.yesterday?.netMarginPct ?? 0).toFixed(1)}%
                </p>
                <Sparkline data={marginTrend} />
                <p className="text-xs"><WowDelta value={m.wow?.marginDeltaPct ?? 0} /></p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Repeat Rate
                </p>
                <p className="font-serif text-2xl font-semibold text-foreground">
                  {(m.yesterday?.repeatRate ?? 0).toFixed(1)}%
                </p>
                <Sparkline data={repeatTrend} />
                <p className="text-xs"><WowDelta value={m.wow?.repeatDeltaPct ?? 0} /></p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Commission
                </p>
                <p className="font-serif text-2xl font-semibold text-foreground">
                  {commissionPct.toFixed(1)}%
                </p>
                <Sparkline data={commissionTrend} />
                <p className="text-xs">of revenue</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* What Should I Do Today — 3 Action Cards */}
        {actions.length > 0 && (
          <div>
            <h3 className="mb-3 text-base font-semibold text-foreground">What Should I Do Today?</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {actions.map((action) => (
                <Card
                  key={action.insightId}
                  className="overflow-hidden rounded-xl border border-border shadow-sm transition-shadow hover:shadow"
                >
                  <CardContent className="p-5">
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white ${
                          action.priority === 1 ? 'bg-[#ef4444]' : action.priority === 2 ? 'bg-[#f59e0b]' : 'bg-[#3b82f6]'
                        }`}
                      >
                        {action.priority}
                      </span>
                      <span className="text-xs text-muted-foreground">{action.effort}</span>
                    </div>
                    <p className="mb-3 text-sm font-medium text-foreground">{action.actionText}</p>
                    <div className="rounded-lg border border-[#22c55e]/30 bg-[#22c55e]/5 p-2 text-xs text-foreground">
                      {action.expectedOutcome}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Triggered by: {action.insightId}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* AI Intelligence Feed */}
        {insights.length > 0 && (
          <div>
            <h3 className="mb-1 text-base font-semibold text-foreground">AI Intelligence Feed</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Trend analysis · Confidence scoring · Rule explainability — click any insight
            </p>
            <div className="space-y-3">
              {insights.map((ins) => {
                const expanded = expandedInsight === ins.id;
                const typeClass =
                  ins.type === 'critical'
                    ? 'bg-[#ef4444]/10 border-[#ef4444]/30'
                    : ins.type === 'warning'
                    ? 'bg-[#f59e0b]/10 border-[#f59e0b]/30'
                    : ins.type === 'opportunity'
                    ? 'bg-[#3b82f6]/10 border-[#3b82f6]/30'
                    : 'bg-[#22c55e]/10 border-[#22c55e]/30';
                return (
                  <Card
                    key={ins.id}
                    className={`cursor-pointer overflow-hidden rounded-xl border transition-shadow hover:shadow ${typeClass}`}
                    onClick={() => setExpandedInsight(expanded ? null : ins.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">{ins.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground">{ins.title}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                ins.type === 'critical'
                                  ? 'bg-[#ef4444] text-white'
                                  : ins.type === 'warning'
                                  ? 'bg-[#f59e0b] text-white'
                                  : ins.type === 'opportunity'
                                  ? 'bg-[#3b82f6] text-white'
                                  : 'bg-[#22c55e] text-white'
                              }`}
                            >
                              {ins.type}
                            </span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {ins.confidence}% conf.
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">{ins.text}</p>
                          {expanded && (
                            <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs">
                              <p className="mb-2 font-semibold text-foreground">Why this insight was generated</p>
                              <p className="mb-2 text-muted-foreground">{ins.triggerRule}</p>
                              <ul className="space-y-1">
                                {ins.conditions?.map((c, i) => (
                                  <li key={i} className="flex items-center gap-2">
                                    <span className={c.met ? 'text-[#22c55e]' : 'text-muted-foreground'}>
                                      {c.met ? '✓' : '○'}
                                    </span>
                                    <span className="text-foreground">{c.condition}</span>
                                    <span className="text-muted-foreground">{c.detail}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <button
                            type="button"
                            className="mt-2 text-xs text-[#3b82f6] hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedInsight(expanded ? null : ins.id);
                            }}
                          >
                            {expanded ? '▲ Hide rule & conditions' : '▶ View trigger rule & conditions'}
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Store Performance Snapshot */}
        {m.perStore?.length > 0 && (
          <div>
            <h3 className="mb-3 text-base font-semibold text-foreground">Store Performance Snapshot</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {m.perStore.map((s) => (
                <Card key={s.storeId} className="overflow-hidden rounded-xl border border-border">
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium text-foreground">{s.storeName}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          (s.last7?.netMarginPct ?? 0) > 20 ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#f59e0b]/20 text-[#f59e0b]'
                        }`}
                      >
                        {(s.last7?.netMarginPct ?? 0).toFixed(1)}% margin
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Revenue</p>
                        <p className="font-medium">₹{Number(s.last7?.revenue ?? 0).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Orders</p>
                        <p className="font-medium">{s.last7?.orderCount ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Commission %</p>
                        <p className="font-medium">
                          {s.last7?.revenue && s.last7.commission != null
                            ? `${((s.last7.commission / s.last7.revenue) * 100).toFixed(1)}%`
                            : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Repeat</p>
                        <p className="font-medium">{(s.last7?.repeatRate ?? 0).toFixed(1)}%</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs">
                      Repeat Δ 7d vs 14d:{' '}
                      <span className={s.repeatRateDelta7vs14 >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}>
                        {s.repeatRateDelta7vs14 >= 0 ? '▲' : '▼'} {s.repeatRateDelta7vs14.toFixed(1)}%
                      </span>
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (role === 'ADMIN' && !dashboard) {
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
                    `₹${Number(brief.businessSnapshot.totalGrossRevenue).toLocaleString()}`}{' '}
                  · <span className="font-medium text-foreground">Margin</span>{' '}
                  {brief.businessSnapshot?.overallMarginPercent?.toFixed(1)}% ·{' '}
                  <span className="font-medium text-foreground">Stores at risk</span>{' '}
                  {brief.businessSnapshot?.storesAtRiskCount ?? 0}
                </p>
              </div>
              {brief.whatNeedsAttentionToday?.length > 0 && (
                <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                  {brief.whatNeedsAttentionToday.slice(0, 4).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
              {brief.suggestedActions?.length > 0 && (
                <ul className="space-y-1 text-sm text-foreground">
                  {brief.suggestedActions.slice(0, 3).map((action, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {action}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Gross revenue" value={`₹${Number(summary.totalGrossRevenue).toLocaleString()}`} />
            <MetricCard title="Net revenue" value={`₹${Number(summary.totalNetRevenue).toLocaleString()}`} />
            <MetricCard title="Profit" value={`₹${Number(summary.totalProfit).toLocaleString()}`} />
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
