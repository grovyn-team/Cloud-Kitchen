import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';

export interface ExpansionLocation {
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
}

interface LocationSelectorProps {
  locations: ExpansionLocation[];
  currentStores: number;
}

function formatIndian(num: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num);
}

function ScoreBar(props: { label: string; score: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{props.label}</span>
        <span className="font-medium">{props.score}/100</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-[#3b82f6]" style={{ width: props.score + '%' }} />
      </div>
    </div>
  );
}

export function LocationSelector(props: LocationSelectorProps) {
  const { locations } = props;
  const [selected, setSelected] = useState<ExpansionLocation | null>(null);

  return (
    <>
      <Card className="rounded-xl border border-border">
        <CardContent className="p-6">
          <h2 className="mb-4 text-xl font-semibold text-foreground">Recommended Expansion Locations</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {locations.slice(0, 10).map((loc, i) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => setSelected(loc)}
                className="rounded-xl border-2 border-border p-4 text-left transition hover:border-[#3b82f6]/50 hover:bg-muted/30"
              >
                <div className="mb-2 flex items-start justify-between">
                  <span className="text-xs font-medium text-muted-foreground">#{(i + 1).toString()}</span>
                  <span className="text-lg font-bold text-[#3b82f6]">{loc.opportunityScore}</span>
                </div>
                <div className="mb-1 text-sm font-semibold text-foreground">{loc.zone}</div>
                <div className="text-xs text-muted-foreground">{loc.city}</div>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <div>Demand: {loc.demandDensity}/km²</div>
                  <div>Competition: {loc.competitorCount}</div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
          <Card className="mx-4 w-full max-w-lg rounded-xl border border-border">
            <CardContent className="p-6">
              <div className="mb-4 flex items-start justify-between">
                <h3 className="text-xl font-bold text-foreground">{selected.zone}, {selected.city}</h3>
                <button type="button" onClick={() => setSelected(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close">✕</button>
              </div>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-muted-foreground">Opportunity Score</span>
                <span className="text-2xl font-bold text-[#3b82f6]">{selected.opportunityScore}/100</span>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">Demand Density</div>
                  <div className="text-sm font-semibold">{selected.demandDensity} orders/km²</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">Competition</div>
                  <div className="text-sm font-semibold">{selected.competitorCount} kitchens</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">Cannibalization</div>
                  <div className="text-sm font-semibold">{selected.cannibalizationRisk}% risk</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">Avg Rent</div>
                  <div className="text-sm font-semibold">₹{formatIndian(selected.avgRentPerSqFt)}/sqft</div>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <div className="mb-2 text-sm text-muted-foreground">Score breakdown</div>
                <div className="space-y-2">
                  {selected.demandScore != null ? <ScoreBar label="Demand" score={selected.demandScore} /> : null}
                  {selected.competitionScore != null ? <ScoreBar label="Competition" score={selected.competitionScore} /> : null}
                  {selected.cannibalizationScore != null ? <ScoreBar label="Low cannibalization" score={selected.cannibalizationScore} /> : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
