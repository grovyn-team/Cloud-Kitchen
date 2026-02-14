import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import type { FinanceSummary, FinanceInsight } from '@/types/api';

export function Finance() {
  const { api } = useAuth();
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [insights, setInsights] = useState<FinanceInsight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<FinanceSummary>(apiPaths.financeSummary).then((r) => r.data).catch(() => null),
      api.get<{ data: FinanceInsight[] }>(apiPaths.financeInsights).then((r) => r.data?.data ?? []).catch(() => []),
    ]).then(([s, i]) => {
      setSummary(s ?? null);
      setInsights(Array.isArray(i) ? i : []);
      setLoading(false);
    });
  }, [api]);

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground">Finance</h2>
        <p className="text-muted-foreground">Unable to load financial summary.</p>
      </div>
    );
  }

  const criticalCount = insights.filter((i) => i.severity === 'critical').length;
  const warningCount = insights.filter((i) => i.severity === 'warning').length;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Finance</h2>
      <p className="text-sm text-muted-foreground">High-level view. Flagged items need your attention.</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Gross revenue" value={`$${Number(summary.totalGrossRevenue).toLocaleString()}`} />
        <MetricCard title="Net revenue" value={`$${Number(summary.totalNetRevenue).toLocaleString()}`} />
        <MetricCard title="Profit" value={`$${Number(summary.totalProfit).toLocaleString()}`} />
        <MetricCard
          title="Overall margin"
          value={`${Number(summary.overallMarginPercent).toFixed(1)}%`}
          subtitle={criticalCount > 0 ? `${criticalCount} critical issue(s) flagged` : undefined}
        />
      </div>

      {insights.length > 0 ? (
        <Card className="rounded-2xl shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Flagged issues</CardTitle>
            <p className="text-sm text-muted-foreground">
              {insights.length} item{insights.length !== 1 ? 's' : ''} need attention
              {criticalCount > 0 && ` · ${criticalCount} critical`}
              {warningCount > 0 && ` · ${warningCount} warning`}
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {insights.map((insight, idx) => (
                <div key={idx} className="rounded-xl border border-border bg-muted/30 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <StatusBadge
                      variant={
                        insight.severity === 'critical'
                          ? 'critical'
                          : insight.severity === 'warning'
                            ? 'warning'
                            : 'info'
                      }
                    >
                      {insight.severity}
                    </StatusBadge>
                    <span className="text-xs font-medium text-muted-foreground">
                      {insight.type.replace(/_/g, ' ')} · {insight.entityType}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{insight.message}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-2xl border-green-200/50 bg-green-50/30 shadow-card">
          <CardContent className="flex items-center gap-3 p-6">
            <span className="text-2xl">✓</span>
            <div>
              <p className="font-medium text-foreground">No flagged issues</p>
              <p className="text-sm text-muted-foreground">
                Margins and profitability are within expected ranges.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
