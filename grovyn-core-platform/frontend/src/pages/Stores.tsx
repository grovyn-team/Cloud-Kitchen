import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { InsightCard } from '@/components/InsightCard';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import type { Store } from '@/types/api';
import type { StoreHealth } from '@/types/api';

export function Stores() {
  const { api } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [health, setHealth] = useState<StoreHealth[]>([]);

  useEffect(() => {
    Promise.all([
      api.get<{ data: Store[] }>(apiPaths.stores).then((r) => r.data?.data ?? []),
      api.get<{ data: StoreHealth[] }>(apiPaths.storeHealth).then((r) => r.data?.data ?? []),
    ]).then(([s, h]) => {
      setStores(Array.isArray(s) ? s : []);
      setHealth(Array.isArray(h) ? h : []);
    });
  }, [api]);

  const healthByStore = useMemo(() => {
    const m: Record<string, StoreHealth> = {};
    health.forEach((h) => { m[h.storeId] = h; });
    return m;
  }, [health]);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Stores</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((store) => {
          const h = healthByStore[store.id];
          return (
            <Link key={store.id} to={`/stores/${store.id}`}>
              <InsightCard title={store.name} className="transition-shadow hover:shadow-lg">
                <p className="text-sm text-muted-foreground">ID: {store.id}</p>
                {h && (
                  <StatusBadge
                    variant={h.status === 'healthy' ? 'healthy' : h.status === 'at_risk' ? 'at_risk' : 'critical'}
                  >
                    {h.status}
                  </StatusBadge>
                )}
              </InsightCard>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
