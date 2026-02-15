import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { ReadinessSection } from '@/components/simulator/ReadinessSection';
import { LocationSelector } from '@/components/simulator/LocationSelector';
import { ScenarioCards } from '@/components/simulator/ScenarioCards';
import { FinancialBreakdown } from '@/components/simulator/FinancialBreakdown';
import { GrovynImpactCards } from '@/components/simulator/GrovynImpactCards';
import { RiskGauge } from '@/components/simulator/RiskGauge';
import { TimelineVisualization } from '@/components/simulator/TimelineVisualization';
import { apiPaths } from '@/services/api';

interface ExpansionData {
  currentStores: number;
  readiness: {
    total: number;
    criteria: Array<{ name: string; status: string; value: string }>;
    blockers: string[];
    warnings: string[];
    recommendation: string;
  };
  topLocations: Array<{
    id: string;
    city: string;
    zone: string;
    demandDensity: number;
    competitorCount: number;
    cannibalizationRisk: number;
    avgRentPerSqFt: number;
    opportunityScore: number;
    demandScore?: number;
    competitionScore?: number;
    cannibalizationScore?: number;
  }>;
  scenarios: Record<string, { name: string; newStores: number; timeline: number; locations: unknown[]; description: string }>;
  selectedScenario: {
    name: string;
    newStores: number;
    timeline: number;
    locations: unknown[];
    financials: {
      setupCosts: { equipment: number; renovation: number; deposit: number; inventory: number; total: number };
      totalSetupCost: number;
      monthlyProjections: Array<{
        month: number;
        revenue: number;
        cogs: number;
        commission: number;
        fixedCosts: number;
        netProfit: number;
        cumulative: number;
        rampMultiplier: number;
      }>;
      breakevenMonth: number | string;
      year1Revenue: number;
      year1NetProfit: number;
    };
    grovynImpact: Array<{ feature: string; description: string; calculation: string; monthlyValue: number; annualValue: number }>;
    risks: { overall: number; breakdown: Record<string, number> };
  };
}

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
  const { api } = useAuth();
  const [data, setData] = useState<ExpansionData | null>(null);
  const [selectedScenario, setSelectedScenario] = useState('moderate');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    api
      .get<ExpansionData>(apiPaths.expansionSimulate(selectedScenario))
      .then((r) => {
        setData(r.data);
      })
      .catch(() => {
        setData(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [api, selectedScenario]);

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
        <p className="text-muted-foreground">Unable to load expansion simulation. Please try again.</p>
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

          <ScenarioCards scenarios={data.scenarios} selected={selectedScenario} onSelect={setSelectedScenario} />

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
                <TimelineVisualization newStores={sel.newStores} timeline={sel.timeline} locations={sel.locations as Array<{ zone: string; city?: string }>} />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
