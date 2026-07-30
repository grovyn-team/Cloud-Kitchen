import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { ReadinessSection } from '@/components/simulator/ReadinessSection';
import { LocationSelector } from '@/components/simulator/LocationSelector';
import { ScenarioCards } from '@/components/simulator/ScenarioCards';
import { FinancialBreakdown } from '@/components/simulator/FinancialBreakdown';
import { GrovynImpactCards } from '@/components/simulator/GrovynImpactCards';
import { RiskGauge } from '@/components/simulator/RiskGauge';
import { TimelineVisualization } from '@/components/simulator/TimelineVisualization';
import { apiPaths } from '@/services/api';
import { Info, XCircle } from 'lucide-react';
import type { ExpansionPlanResponse, ExpansionScenarioKey } from '@/types/api';

function formatIndianCurrency(n: number): string {
  const whole = Math.round(n);
  const s = String(whole);
  if (s.length <= 3) return s;
  return s.slice(0, s.length - 3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
}

function MetricCard({ label, value, change }: { label: string; value: string; change?: string }) {
  return (
    <Card className="rounded-xl border border-border">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="font-serif text-2xl font-semibold text-foreground">{value}</div>
        {change != null && <div className="mt-1 text-sm text-[#22c55e]">{change}</div>}
      </CardContent>
    </Card>
  );
}

export function ScaleSimulator() {
  const { api, role } = useAuth();
  const [data, setData] = useState<ExpansionPlanResponse | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<ExpansionScenarioKey>('moderate');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // This page is ADMIN-only (backend router mounts `GET /expansion/plan`
  // behind `requireRole(['ADMIN'])`, 403s STAFF, and the route is already
  // gated with `RequireRole roles={['ADMIN']}` in router.tsx). This is a
  // defense-in-depth check, same pattern as `Finance.tsx`/`StaffManagement.tsx`,
  // so this page never fetches cross-branch financial projections for a
  // non-ADMIN session even if reached some other way.
  const isAdmin = role === 'ADMIN';

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    setError(false);
    api
      .get<ExpansionPlanResponse>(apiPaths.expansionPlan({ scenario: selectedScenario }))
      .then((r) => {
        setData(r.data);
      })
      .catch(() => {
        setData(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [api, isAdmin, selectedScenario]);

  if (!isAdmin) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 rounded-xl bg-card p-8 shadow-card">
        <p className="font-medium text-foreground">Access denied.</p>
        <p className="text-sm text-muted-foreground">You don’t have permission to view this page.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-muted-foreground">Loading expansion plan…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground">Scale Simulator</h2>
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">Unable to load the expansion plan. Please try again.</p>
        </div>
      </div>
    );
  }

  const isReady = data.readiness.recommendation === 'ready';
  const needsCaution = data.readiness.recommendation === 'caution';
  const sel = data.selectedScenario;
  const fin = sel.financials;

  return (
    <div className="max-w-7xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Scale Simulator</h1>
        <p className="mt-2 text-muted-foreground">Strategic expansion planning for your cloud kitchen network</p>
      </div>

      <ReadinessSection readiness={data.readiness} currentStores={data.currentStores} />

      {data.dataSource.repeatRatePctIsAssumed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-amber-900">Repeat rate is assumed, not measured</p>
              <StatusBadge variant="at_risk">Assumed</StatusBadge>
            </div>
            <p className="text-sm text-amber-900">
              The "Retention" readiness criterion above uses an assumed {data.dataSource.repeatRatePct}% repeat rate.
              Grovyn can't yet link individual customers to sales to compute a real repeat-order rate, so this is a
              conservative placeholder, not a figure derived from your sales data — treat any expansion decision
              driven by it accordingly.
            </p>
          </div>
        </div>
      )}

      {!isReady && !needsCaution && (
        <Card className="rounded-xl border-2 border-[#ef4444]/30 bg-[#ef4444]/5">
          <CardContent className="p-8 text-center">
            <h2 className="mb-4 text-2xl font-bold text-[#ef4444]">Not ready to scale yet</h2>
            <p className="mb-6 text-[#ef4444]">Address these before expanding:</p>
            <ul className="mx-auto max-w-md space-y-2 text-left">
              {data.readiness.blockers.map((blocker, i) => (
                <li key={i} className="flex items-start">
                  <span className="mr-2 text-[#ef4444]">✗</span>
                  <span>{blocker}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(isReady || needsCaution) && (
        <>
          <LocationSelector locations={data.topLocations} currentStores={data.currentStores} />

          <ScenarioCards
            scenarios={data.scenarios}
            selected={selectedScenario}
            onSelect={(key) => setSelectedScenario(key as ExpansionScenarioKey)}
          />

          <Card className="rounded-xl border border-border">
            <CardContent className="space-y-8 p-6">
              <h2 className="text-2xl font-semibold text-foreground">Expansion plan details</h2>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  label="Total stores"
                  value={String(data.currentStores + sel.newStores)}
                  change={`+${sel.newStores}`}
                />
                <MetricCard label="Year 1 revenue" value={`₹${formatIndianCurrency(fin.year1Revenue)}`} />
                <MetricCard label="Setup investment" value={`₹${formatIndianCurrency(fin.totalSetupCost)}`} />
                <MetricCard label="Breakeven" value={typeof fin.breakevenMonth === 'number' ? `Month ${fin.breakevenMonth}` : String(fin.breakevenMonth)} />
              </div>

              <div>
                <h3 className="mb-4 text-xl font-semibold text-foreground">Financial breakdown</h3>
                <FinancialBreakdown
                  projections={fin.monthlyProjections}
                  setupCosts={fin.setupCosts}
                  breakevenMonth={fin.breakevenMonth}
                />
              </div>

              <div>
                <h3 className="mb-4 text-xl font-semibold text-foreground">How Grovyn Autopilot protects your expansion</h3>
                <GrovynImpactCards impacts={sel.grovynImpact} />
              </div>

              <div>
                <h3 className="mb-4 text-xl font-semibold text-foreground">Risk analysis</h3>
                <RiskGauge risks={sel.risks} />
              </div>

              <div>
                <h3 className="mb-4 text-xl font-semibold text-foreground">Rollout timeline</h3>
                <TimelineVisualization newStores={sel.newStores} timeline={sel.timeline} locations={sel.locations} />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
