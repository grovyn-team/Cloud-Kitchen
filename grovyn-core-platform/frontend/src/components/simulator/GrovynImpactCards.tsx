import { Card, CardContent } from '@/components/ui/card';

export interface GrovynImpact {
  feature: string;
  description: string;
  calculation: string;
  monthlyValue: number;
  annualValue: number;
}

interface GrovynImpactCardsProps {
  impacts: GrovynImpact[];
}

function formatIndian(num: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num);
}

export function GrovynImpactCards({ impacts }: GrovynImpactCardsProps) {
  const totalMonthly = impacts.reduce((s, i) => s + i.monthlyValue, 0);
  const totalAnnual = impacts.reduce((s, i) => s + i.annualValue, 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {impacts.map((impact, i) => (
          <Card key={i} className="overflow-hidden rounded-xl border-2 border-[#eab308]/30 from-[#eab308]/10 to-transparent bg-gradient-to-br">
            <CardContent className="p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="text-sm font-semibold text-foreground">{impact.feature}</div>
                <span className="rounded bg-[#eab308]/20 px-2 py-0.5 text-xs font-medium text-[#eab308]">AI</span>
              </div>
              <div className="mb-3 text-xs text-muted-foreground">{impact.description}</div>
              <div className="mb-3 text-xs text-muted-foreground">{impact.calculation}</div>
              <div className="flex items-end justify-between">
                <div><div className="text-xs text-muted-foreground">Monthly</div><div className="text-lg font-bold text-[#22c55e]">₹{formatIndian(impact.monthlyValue)}</div></div>
                <div className="text-right"><div className="text-xs text-muted-foreground">Annual</div><div className="text-sm font-semibold">₹{formatIndian(impact.annualValue)}</div></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden rounded-xl border-2 border-[#22c55e]/30 bg-[#22c55e]/10">
        <CardContent className="flex items-center justify-between p-4">
          <div><div className="text-sm text-muted-foreground">Total Grovyn Autopilot value</div><div className="mt-1 text-xs text-muted-foreground">Combined impact</div></div>
          <div className="text-right"><div className="text-2xl font-bold text-[#22c55e]">₹{formatIndian(totalMonthly)}/mo</div><div className="text-sm text-muted-foreground">₹{formatIndian(totalAnnual)}/year</div></div>
        </CardContent>
      </Card>
    </div>
  );
}
