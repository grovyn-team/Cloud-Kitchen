import { Card, CardContent } from '@/components/ui/card';

interface RiskBreakdown {
  marketSaturation?: number;
  cannibalization?: number;
  operational?: number;
  capital?: number;
}

interface Risks {
  overall: number;
  breakdown: RiskBreakdown;
}

interface RiskGaugeProps {
  risks: Risks;
}

function getRiskColor(score: number) {
  if (score < 30) return 'text-[#22c55e]';
  if (score < 60) return 'text-[#f59e0b]';
  return 'text-[#ef4444]';
}

function getRiskLabel(score: number) {
  if (score < 30) return 'Low risk';
  if (score < 60) return 'Moderate risk';
  return 'High risk';
}

function getBarColor(score: number) {
  if (score < 30) return 'bg-[#22c55e]';
  if (score < 60) return 'bg-[#f59e0b]';
  return 'bg-[#ef4444]';
}

function labelKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()).trim();
}

export function RiskGauge({ risks }: RiskGaugeProps) {
  const entries = Object.entries(risks.breakdown || {});

  return (
    <div className="grid gap-4 sm:grid-cols-5">
      <Card className="rounded-xl border-2 border-border">
        <CardContent className="p-4 text-center">
          <div className="mb-2 text-sm text-muted-foreground">Overall risk</div>
          <div className={`text-4xl font-bold ${getRiskColor(risks.overall)}`}>{risks.overall}</div>
          <div className="mt-1 text-xs text-muted-foreground">{getRiskLabel(risks.overall)}</div>
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:col-span-4 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <Card key={key} className="rounded-xl border border-border">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-foreground">{labelKey(key)}</div>
                <div className={`text-lg font-bold ${getRiskColor(value ?? 0)}`}>{value ?? 0}</div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className={`h-full ${getBarColor(value ?? 0)}`} style={{ width: `${Math.min(100, value ?? 0)}%` }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
