import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiPaths } from '@/services/api';
import type {
  FinanceSummary,
  DashboardMetrics,
  StoreProfitability,
  SkuMarginRow,
} from '@/types/api';

export function Finance() {
  const { api } = useAuth();
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [storeProfit, setStoreProfit] = useState<StoreProfitability[]>([]);
  const [skuRows, setSkuRows] = useState<SkuMarginRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<FinanceSummary>(apiPaths.financeSummary).then((r) => r.data).catch(() => null),
      api.get<{ metrics: DashboardMetrics }>(apiPaths.dashboard).then((r) => r.data?.metrics ?? null).catch(() => null),
      api.get<{ data: StoreProfitability[] }>(apiPaths.financeStores).then((r) => r.data?.data ?? []).catch(() => []),
      api.get<{ data: SkuMarginRow[] }>(apiPaths.skusMarginAnalysis).then((r) => r.data?.data ?? []).catch(() => []),
    ]).then(([s, d, st, sk]) => {
      setSummary(s ?? null);
      setMetrics(d ?? null);
      setStoreProfit(Array.isArray(st) ? st : []);
      setSkuRows(Array.isArray(sk) ? sk : []);
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

  const wowMargin = metrics?.wow?.marginDeltaPct ?? 0;
  const wowCommission = metrics?.wow?.commissionDeltaPct ?? 0;
  const commissionTotal = metrics?.last7?.commission ?? 0;
  const grossTotal = metrics?.last7?.revenue ?? summary.totalGrossRevenue;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Finance</h2>
      <p className="text-sm text-muted-foreground">High-level view. Per-store and SKU margin analysis.</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Gross revenue"
          value={`₹${Number(summary.totalGrossRevenue).toLocaleString()}`}
        />
        <MetricCard
          title="Commission / fees lost"
          value={`₹${Number(commissionTotal || (summary.totalGrossRevenue - summary.totalNetRevenue)).toLocaleString()}`}
          subtitle={wowCommission !== 0 ? `${wowCommission >= 0 ? '+' : ''}${wowCommission.toFixed(1)}% WoW` : undefined}
        />
        <MetricCard
          title="Net margin %"
          value={`${Number(summary.overallMarginPercent).toFixed(1)}%`}
          subtitle={wowMargin !== 0 ? `${wowMargin >= 0 ? '+' : ''}${wowMargin.toFixed(1)}% WoW` : undefined}
        />
        <MetricCard
          title="Net earnings"
          value={`₹${Number(summary.totalNetRevenue).toLocaleString()}`}
        />
      </div>

      {storeProfit.length > 0 && (
        <div>
          <h3 className="mb-3 text-base font-semibold text-foreground">Per-store margin breakdown</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {storeProfit.map((s) => {
              const margin = s.marginPercent ?? 0;
              return (
                <Card key={s.storeId} className="rounded-xl border border-border">
                  <CardContent className="p-4">
                    <p className="mb-2 font-medium text-foreground">
                      {s.storeName || s.storeId}
                    </p>
                    <div className="space-y-1 text-sm">
                      <p className="flex justify-between text-muted-foreground">
                        <span>Revenue</span>
                        <span className="font-medium text-foreground">₹{Number(s.grossRevenue ?? 0).toLocaleString()}</span>
                      </p>
                      <p className="flex justify-between text-muted-foreground">
                        <span>Net margin</span>
                        <span className="font-medium text-foreground">{margin.toFixed(1)}%</span>
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-[#22c55e]"
                        style={{ width: `${Math.min(100, margin)}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {wowCommission > 0.2 && (
        <Card className="overflow-hidden rounded-xl border-2 border-[#eab308]/40 bg-[#ef4444]/5">
          <CardHeader>
            <CardTitle className="text-base text-[#ef4444]">AI Commission Alert</CardTitle>
            <p className="text-sm text-muted-foreground">
              Commission WoW change +{wowCommission.toFixed(1)}%. Consider shifting traffic to direct channel.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-foreground">
              <li>Shift traffic to direct channel (app/web)</li>
              <li>Reprice low-margin items</li>
              <li>Loyalty incentives to reduce aggregator share</li>
            </ul>
          </CardContent>
        </Card>
      )}

      {skuRows.length > 0 && (
        <Card className="rounded-xl border border-border">
          <CardHeader>
            <CardTitle className="text-base">SKU / Item margin</CardTitle>
            <p className="text-sm text-muted-foreground">All items sorted by margin %</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Revenue</th>
                    <th className="pb-2 pr-4 font-medium">Cost</th>
                    <th className="pb-2 pr-4 font-medium">Margin</th>
                    <th className="pb-2 pr-4 font-medium">Margin %</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {skuRows.map((row) => (
                    <tr key={row.skuId} className="border-b border-border/60">
                      <td className="py-2 pr-4 font-medium text-foreground">{row.name}</td>
                      <td className="py-2 pr-4">₹{row.revenue.toLocaleString()}</td>
                      <td className="py-2 pr-4">₹{row.cost.toLocaleString()}</td>
                      <td className="py-2 pr-4">₹{row.margin.toLocaleString()}</td>
                      <td className="py-2 pr-4">{row.marginPercent.toFixed(1)}%</td>
                      <td className="py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            row.status === 'OK' ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#f59e0b]/20 text-[#f59e0b]'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
