import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import type { StoreHealth } from '@/types/api';

export function Store() {
  const { api, storeIds } = useAuth();
  const [health, setHealth] = useState<StoreHealth[]>([]);

  useEffect(() => {
    api
      .get<{ data: StoreHealth[] }>(apiPaths.storeHealth)
      .then((r) => setHealth(r.data?.data ?? []))
      .catch(() => setHealth([]));
  }, [api]);

  const myStore = storeIds?.length ? health.find((h) => storeIds.includes(h.storeId)) : health[0];

  if (!myStore) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">My Store</h2>
      <Card className="rounded-2xl shadow-card">
        <CardHeader>
          <CardTitle>{myStore.storeName}</CardTitle>
          <StatusBadge
            variant={
              myStore.status === 'healthy' ? 'healthy' : myStore.status === 'at_risk' ? 'at_risk' : 'critical'
            }
          >
            {myStore.status}
          </StatusBadge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Store ID: {myStore.storeId}</p>
          <p className="mt-2 text-sm text-muted-foreground">Last evaluated: {myStore.lastEvaluatedAt}</p>
        </CardContent>
      </Card>
    </div>
  );
}
