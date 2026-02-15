interface Location {
  zone: string;
  city?: string;
}

interface Phase {
  phase: number;
  months: string;
  stores: number;
  locations: Location[];
  milestones: string[];
}

interface TimelineVisualizationProps {
  newStores: number;
  timeline: number;
  locations: Location[];
}

function buildPhases(newStores: number, locations: Location[]): Phase[] {
  const locs = locations || [];

  if (newStores === 1) {
    return [
      {
        phase: 1,
        months: '0–3',
        stores: 1,
        locations: locs.slice(0, 1),
        milestones: [
          'Site selection',
          'Setup & renovation',
          'Soft launch',
          'Ramp to full capacity',
        ],
      },
    ];
  }

  if (newStores === 3) {
    return [
      {
        phase: 1,
        months: '0–3',
        stores: 1,
        locations: locs.slice(0, 1),
        milestones: ['Validate model with first location', 'Test operations'],
      },
      {
        phase: 2,
        months: '4–9',
        stores: 2,
        locations: locs.slice(1, 3),
        milestones: ['Scale to 2 more locations', 'Build SOPs', 'Centralize procurement'],
      },
    ];
  }

  return [
    {
      phase: 1,
      months: '0–3',
      stores: Math.min(2, newStores),
      locations: locs.slice(0, 2),
      milestones: ['Initial expansion', 'Setup infrastructure'],
    },
    {
      phase: 2,
      months: '4–9',
      stores: Math.min(2, Math.max(0, newStores - 2)),
      locations: locs.slice(2, 4),
      milestones: ['Controlled growth', 'Hire ops team'],
    },
    {
      phase: 3,
      months: '10–12',
      stores: Math.max(0, newStores - 4),
      locations: locs.slice(4),
      milestones: ['Rapid scale', 'Leverage brand'],
    },
  ];
}

export function TimelineVisualization({ newStores, timeline, locations }: TimelineVisualizationProps) {
  const phases = buildPhases(newStores, locations);

  return (
    <div className="space-y-4">
      {phases.map((phase) => (
        <div
          key={phase.phase}
          className="border-l-4 border-[#3b82f6] pl-6 pb-6"
        >
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="text-sm font-bold text-[#3b82f6]">PHASE {phase.phase}</div>
              <div className="text-xs text-muted-foreground">Months {phase.months}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-foreground">
                {phase.stores} new store{phase.stores !== 1 ? 's' : ''}
              </div>
              <div className="text-xs text-muted-foreground">
                {phase.locations.map((loc) => loc.zone).join(', ') || '—'}
              </div>
            </div>
          </div>
          <ul className="space-y-1">
            {phase.milestones.map((milestone, i) => (
              <li key={i} className="flex items-start text-sm text-foreground">
                <span className="mr-2 text-[#3b82f6]">→</span>
                <span>{milestone}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
