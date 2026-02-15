import { Card, CardContent } from '@/components/ui/card';

export interface Scenario {
  name: string;
  newStores: number;
  timeline: number;
  locations: unknown[];
  description: string;
}

interface ScenarioCardsProps {
  scenarios: Record<string, Scenario>;
  selected: string;
  onSelect: (key: string) => void;
}

export function ScenarioCards({ scenarios, selected, onSelect }: ScenarioCardsProps) {
  return (
    <Card className="rounded-xl border border-border">
      <CardContent className="p-6">
        <h2 className="mb-4 text-xl font-semibold text-foreground">Choose your strategy</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.entries(scenarios).map(([key, scenario]) => (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={
                selected === key
                  ? 'rounded-xl border-2 border-[#3b82f6] bg-[#3b82f6]/10 p-6 text-left'
                  : 'rounded-xl border-2 border-border p-6 text-left hover:border-muted-foreground/30'
              }
            >
              <div className="mb-2 text-lg font-bold text-foreground">{scenario.name}</div>
              <div className="mb-4 text-sm text-muted-foreground">{scenario.description}</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">New stores</span>
                  <span className="font-medium">{scenario.newStores}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timeline</span>
                  <span className="font-medium">{scenario.timeline} months</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
