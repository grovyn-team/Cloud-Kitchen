import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiPaths } from '@/services/api';
import type { CustomerSegmentsData } from '@/types/api';

export function RepeatEngine() {
  const { api } = useAuth();
  const [data, setData] = useState<CustomerSegmentsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<CustomerSegmentsData>(apiPaths.customersSegments)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground">AI Repeat Engine</h2>
        <p className="text-muted-foreground">Unable to load customer segments.</p>
      </div>
    );
  }

  const totalPct = data.segments.reduce((s, seg) => s + seg.pct, 0) || 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold text-foreground">AI Repeat Engine</h2>
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
          GET /api/customers/segments
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-xl border border-border">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Customers</p>
            <p className="font-serif text-2xl font-semibold text-foreground">{data.totalCustomers.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Repeat Rate (7d)</p>
            <p className="font-serif text-2xl font-semibold text-foreground">{data.repeatRate7d.toFixed(1)}%</p>
            <p className={`text-xs ${data.wowRepeatDeltaPct >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
              {data.wowRepeatDeltaPct >= 0 ? '▲' : '▼'} {data.wowRepeatDeltaPct.toFixed(1)}% WoW
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dormant Count</p>
            <p className="font-serif text-2xl font-semibold text-foreground">{data.dormantCount.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Predicted Reorders</p>
            <p className="font-serif text-2xl font-semibold text-foreground">{data.predictedReorders}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-xl border border-border">
          <CardHeader>
            <CardTitle className="text-base">Customer Segmentation</CardTitle>
            <p className="text-sm text-muted-foreground">Champions · Loyal · New · Dormant</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.segments.map((seg) => (
              <div key={seg.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-foreground">
                    {seg.icon} {seg.label}
                  </span>
                  <span className="text-muted-foreground">
                    {seg.count.toLocaleString()} ({seg.pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(seg.pct / totalPct) * 100}%`,
                      backgroundColor:
                        seg.id === 'champion' ? '#22c55e' : seg.id === 'loyal' ? '#3b82f6' : seg.id === 'new' ? '#eab308' : '#94a3b8',
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-xl border-2 border-[#eab308]/40 bg-gradient-to-br from-[#eab308]/5 to-transparent">
          <CardHeader>
            <CardTitle className="text-base">AI Recommendation — Upsell Campaign: Champions</CardTitle>
            <p className="text-sm text-muted-foreground">High-value customers · Estimated revenue lift</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <p className="font-medium text-foreground">
                Champions: {data.segments.find((s) => s.id === 'champion')?.count ?? 0} customers
              </p>
              <p className="text-muted-foreground">Avg LTV: ₹{Number(data.championAvgLtv).toLocaleString()}</p>
              <p className="text-foreground">Estimated revenue lift from targeted upsell: +15–20% on champion orders</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl border border-border">
        <CardHeader>
          <CardTitle className="text-base">Dormant Win-Back</CardTitle>
          <p className="text-sm text-muted-foreground">15% recovery rate · Monthly revenue estimate</p>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground">
            <strong>{data.dormantCount}</strong> dormant customers. At 15% recovery, estimated monthly revenue:{' '}
            <strong className="text-[#22c55e]">₹{data.dormantWinBackEstimate.toLocaleString()}</strong>
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-xl border border-border">
        <CardHeader>
          <CardTitle className="text-base">Churn Risk — Top 8</CardTitle>
          <p className="text-sm text-muted-foreground">High LTV, inactive 14+ days</p>
        </CardHeader>
        <CardContent>
          {data.churnRisks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No high-risk churn customers in this segment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">LTV</th>
                    <th className="pb-2 pr-4 font-medium">Orders</th>
                    <th className="pb-2 pr-4 font-medium">Last order (days ago)</th>
                    <th className="pb-2 pr-4 font-medium">Avg value</th>
                    <th className="pb-2 font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {data.churnRisks.map((c) => (
                    <tr key={c.customerId} className="border-b border-border/60">
                      <td className="py-2 pr-4 font-medium text-foreground">{c.name}</td>
                      <td className="py-2 pr-4">₹{c.ltv.toLocaleString()}</td>
                      <td className="py-2 pr-4">{c.orders}</td>
                      <td className="py-2 pr-4">{c.lastOrderDaysAgo}</td>
                      <td className="py-2 pr-4">₹{c.avgValue.toLocaleString()}</td>
                      <td className="py-2">
                        <span className="rounded bg-[#ef4444]/20 px-2 py-0.5 text-xs font-medium text-[#ef4444]">
                          {c.risk}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
