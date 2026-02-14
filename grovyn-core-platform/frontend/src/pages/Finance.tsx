import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { InsightCard } from '@/components/InsightCard';
import { apiPaths } from '@/services/api';
import type { FinanceSummary } from '@/types/api';

export function Finance() {
  const { api } = useAuth();
  const [summary, setSummary] = useState<FinanceSummary | null>(null);

  useEffect(() => {
    api
      .get<FinanceSummary>(apiPaths.financeSummary)
      .then((r) => setSummary(r.data))
      .catch(() => setSummary(null));
  }, [api]);

  if (!summary) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Finance</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Gross Revenue" value={`$${Number(summary.totalGrossRevenue).toLocaleString()}`} />
        <MetricCard title="Net Revenue" value={`$${Number(summary.totalNetRevenue).toLocaleString()}`} />
        <MetricCard title="Profit" value={`$${Number(summary.totalProfit).toLocaleString()}`} />
        <MetricCard title="Margin" value={`${Number(summary.overallMarginPercent).toFixed(1)}%`} />
      </div>
      <InsightCard title="Summary">
        <p className="text-sm text-muted-foreground">
          Financial overview. Use finance/stores, finance/brands, finance/skus for breakdowns (API).
        </p>
      </InsightCard>
    </div>
  );
}
