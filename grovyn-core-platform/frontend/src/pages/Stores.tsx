import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import type { Store } from '@/types/api';
import type { StoreHealth } from '@/types/api';
import type { Alert } from '@/types/api';

export function Stores() {
  const { api } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [health, setHealth] = useState<StoreHealth[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ data: Store[] }>(apiPaths.stores).then((r) => r.data?.data ?? []),
      api.get<{ data: StoreHealth[] }>(apiPaths.storeHealth).then((r) => r.data?.data ?? []),
      api.get<{ data: Alert[] }>(apiPaths.alerts).then((r) => r.data?.data ?? []),
    ])
      .then(([s, h, a]) => {
        setStores(Array.isArray(s) ? s : []);
        setHealth(Array.isArray(h) ? h : []);
        setAlerts(Array.isArray(a) ? a : []);
      })
      .finally(() => setLoading(false));
  }, [api]);

  const healthByStore = useMemo(() => {
    const m: Record<string, StoreHealth> = {};
    health.forEach((h) => {
      m[h.storeId] = h;
    });
    return m;
  }, [health]);

  const alertCountByStore = useMemo(() => {
    const m: Record<string, number> = {};
    alerts.forEach((a) => {
      a.entities?.forEach((e) => {
        if (e.type === 'STORE') {
          m[e.id] = (m[e.id] ?? 0) + 1;
        }
      });
    });
    return m;
  }, [alerts]);

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-muted-foreground">Loading stores…</p>
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground">Stores</h2>
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">No stores visible. You may only have access to specific stores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Stores</h2>
      <p className="text-sm text-muted-foreground">
        {stores.length} store{stores.length !== 1 ? 's' : ''} · Status and issues at a glance
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((store) => {
          const h = healthByStore[store.id];
          const issueCount = alertCountByStore[store.id] ?? 0;
          return (
            <Link key={store.id} to={`/stores/${store.id}`} className="block transition-opacity hover:opacity-95">
              <Card className="h-full rounded-2xl shadow-card transition-shadow hover:shadow-lg">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground">{store.name}</h3>
                    {h && (
                      <StatusBadge
                        variant={
                          h.status === 'healthy' ? 'healthy' : h.status === 'at_risk' ? 'at_risk' : 'critical'
                        }
                      >
                        {h.status.replace('_', ' ')}
                      </StatusBadge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground">ID: {store.id}</p>
                  {issueCount > 0 && (
                    <p className="mt-2 text-sm text-amber-700">
                      {issueCount} alert{issueCount !== 1 ? 's' : ''} for this store
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
