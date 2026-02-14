import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { InsightCard } from '@/components/InsightCard';
import { StatusBadge, severityToBadgeVariant } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import type { Alert } from '@/types/api';

export function Alerts() {
  const { api } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    api
      .get<{ data: Alert[] }>(apiPaths.alerts)
      .then((r) => setAlerts(r.data?.data ?? []))
      .catch(() => setAlerts([]));
  }, [api]);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Alerts</h2>
      <InsightCard title="Active alerts">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active alerts.</p>
        ) : (
          <ul className="space-y-3">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-2 rounded-lg border border-border p-3">
                <StatusBadge variant={severityToBadgeVariant(a.severity)}>{a.severity}</StatusBadge>
                <div>
                  <p className="text-sm font-medium">{a.message}</p>
                  {a.type && <p className="text-xs text-muted-foreground">Type: {a.type}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </InsightCard>
    </div>
  );
}
