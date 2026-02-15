import { Card, CardContent } from '@/components/ui/card';

interface Criterion {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  value: string;
}

interface Readiness {
  total: number;
  criteria: Criterion[];
  blockers: string[];
  warnings: string[];
  recommendation: string;
}

interface ReadinessSectionProps {
  readiness: Readiness;
  currentStores: number;
}

function getScoreColor(score: number) {
  if (score >= 80) return 'text-[#22c55e]';
  if (score >= 60) return 'text-[#f59e0b]';
  return 'text-[#ef4444]';
}

function getScoreBg(score: number) {
  if (score >= 80) return 'bg-[#22c55e]/10 border-[#22c55e]/30';
  if (score >= 60) return 'bg-[#f59e0b]/10 border-[#f59e0b]/30';
  return 'bg-[#ef4444]/10 border-[#ef4444]/30';
}

export function ReadinessSection({ readiness, currentStores }: ReadinessSectionProps) {
  return (
    <Card className={`rounded-xl border-2 ${getScoreBg(readiness.total)}`}>
      <CardContent className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Expansion Readiness</h2>
            <p className="text-sm text-muted-foreground">
              Assessment based on current {currentStores} store{currentStores !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="text-center">
            <div className={`text-5xl font-bold ${getScoreColor(readiness.total)}`}>{readiness.total}</div>
            <div className="text-xs text-muted-foreground">/ 100</div>
          </div>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          {readiness.criteria.map((c, i) => (
            <div key={i} className="rounded-lg border border-border bg-background/50 p-3 text-center">
              <div className="mb-2 text-2xl">{c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '⚠'}</div>
              <div className="text-sm font-medium text-foreground">{c.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{c.value}</div>
            </div>
          ))}
        </div>
        {readiness.warnings.length > 0 && (
          <div className="mt-4 space-y-2">
            {readiness.warnings.map((w, i) => (
              <div key={i} className="flex items-start text-sm text-[#f59e0b]">
                <span className="mr-2">⚠</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
