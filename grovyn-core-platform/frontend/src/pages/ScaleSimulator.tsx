import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiPaths } from '@/services/api';
import type { SimulateResult } from '@/types/api';

/** Indian number format: ₹2,52,681 (commas every 2 digits after first 3) */
function formatIndianCurrency(n: number): string {
  const whole = Math.round(n);
  const s = String(whole);
  if (s.length <= 3) return s;
  return s.slice(0, s.length - 3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
}

export function ScaleSimulator() {
  const { api } = useAuth();
  const [stores, setStores] = useState(3);
  const [data, setData] = useState<SimulateResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<SimulateResult>(apiPaths.simulate(stores))
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [api, stores]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold text-foreground">Scale Simulator</h2>
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
          GET /api/simulate?stores=N
        </span>
      </div>

      <Card className="rounded-xl border border-border">
        <CardHeader>
          <CardTitle className="text-base">New stores to add</CardTitle>
          <p className="text-sm text-muted-foreground">Slide to see impact with vs without Grovyn AI</p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={1}
              max={10}
              value={stores}
              onChange={(e) => setStores(Number(e.target.value))}
              className="w-48 accent-primary"
            />
            <span className="font-mono font-semibold text-foreground">{stores}</span>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex min-h-[120px] items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="rounded-xl border border-border">
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total stores</p>
                <p className="font-serif text-2xl font-semibold text-foreground">{data.totalStores}</p>
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-border">
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Growth</p>
                <p className="font-serif text-2xl font-semibold text-foreground">
                  {data.currentStores} → {data.totalStores}
                </p>
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-border">
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Projected MAU</p>
                <p className="font-serif text-2xl font-semibold text-foreground">{data.projectedMAU.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-border">
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Projected daily revenue</p>
                <p className="font-serif text-2xl font-semibold text-foreground">
                  ₹{data.projectedDailyRevenue.toLocaleString()}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden rounded-xl border-2 border-[#ef4444]/30 bg-[#ef4444]/5">
              <CardHeader>
                <CardTitle className="text-base text-foreground">Without Grovyn AI</CardTitle>
                <p className="text-sm text-muted-foreground">Margin erodes · Repeat drops</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Margin:</span>{' '}
                  <span className="font-semibold text-[#ef4444]">{data.withoutGrovyn.marginPercent.toFixed(1)}%</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Repeat:</span>{' '}
                  <span className="font-semibold">{data.withoutGrovyn.repeatPercent.toFixed(1)}%</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Daily net:</span>{' '}
                  <span className="font-semibold">₹{formatIndianCurrency(data.withoutGrovyn.dailyNet)}</span>
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-xl border-2 border-[#eab308]/40 bg-gradient-to-br from-[#22c55e]/10 to-transparent">
              <CardHeader>
                <CardTitle className="text-base text-foreground">With Grovyn AI</CardTitle>
                <p className="text-sm text-muted-foreground">Margin improved · Repeat improved</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Margin:</span>{' '}
                  <span className="font-semibold text-[#22c55e]">{data.withGrovyn.marginPercent.toFixed(1)}%</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Repeat:</span>{' '}
                  <span className="font-semibold text-[#22c55e]">{data.withGrovyn.repeatPercent.toFixed(1)}%</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Daily net:</span>{' '}
                  <span className="font-semibold">₹{formatIndianCurrency(data.withGrovyn.dailyNet)}</span>
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden rounded-xl border-2 border-[#eab308]/50 bg-gradient-to-r from-[#eab308]/20 to-[#22c55e]/20">
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Monthly impact protected
              </p>
              <p className="mt-2 font-serif text-4xl font-bold tracking-tight text-foreground">
                ₹{formatIndianCurrency(data.monthlySavings)}/month
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {!loading && !data && (
        <p className="text-muted-foreground">Unable to load simulator data.</p>
      )}
    </div>
  );
}
