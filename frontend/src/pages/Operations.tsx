import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { InsightCard } from '@/components/InsightCard';
import { apiPaths } from '@/services/api';

interface Insight {
  type: string;
  message?: string;
  storeId?: string;
  severity?: string;
}

export function Operations() {
  const { api } = useAuth();
  const [invInsights, setInvInsights] = useState<Insight[]>([]);
  const [wfInsights, setWfInsights] = useState<Insight[]>([]);

  useEffect(() => {
    Promise.all([
      api.get<{ data: Insight[] }>(apiPaths.inventoryInsights).then((r) => r.data?.data ?? []),
      api.get<{ data: Insight[] }>(apiPaths.workforceInsights).then((r) => r.data?.data ?? []),
    ]).then(([inv, wf]) => {
      setInvInsights(Array.isArray(inv) ? inv : []);
      setWfInsights(Array.isArray(wf) ? wf : []);
    });
  }, [api]);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Operations</h2>
      <InsightCard title="Inventory risks">
        {invInsights.length === 0 ? (
          <p className="text-sm text-muted-foreground">No inventory insights.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {invInsights.map((i, idx) => (
              <li key={idx}>{i.message ?? i.type}</li>
            ))}
          </ul>
        )}
      </InsightCard>
      <InsightCard title="Staff & workforce">
        {wfInsights.length === 0 ? (
          <p className="text-sm text-muted-foreground">No workforce insights.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {wfInsights.map((i, idx) => (
              <li key={idx}>{i.message ?? i.type}</li>
            ))}
          </ul>
        )}
      </InsightCard>
    </div>
  );
}
