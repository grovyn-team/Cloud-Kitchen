import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import type { Alert } from '@/types/api';
import type { Store } from '@/types/api';

export function Alerts() {
  const { api, role } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ data: Alert[] }>(apiPaths.alerts).then((r) => r.data?.data ?? []).catch(() => []),
      api.get<{ data: Store[] }>(apiPaths.stores).then((r) => r.data?.data ?? []).catch(() => []),
    ]).then(([a, st]) => {
      setAlerts(Array.isArray(a) ? a : []);
      setStores(Array.isArray(st) ? st : []);
      setLoading(false);
    });
  }, [api]);

  const storeNames = new Map(stores.map((s) => [s.id, s.name]));
  const critical = alerts.filter((a) => a.severity === 'critical');
  const warning = alerts.filter((a) => a.severity === 'warning');
  const info = alerts.filter((a) => a.severity === 'info');

  function storeLabel(alert: Alert): string {
    const storeId = alert.entities?.find((e) => e.type === 'STORE')?.id;
    if (storeId && storeNames.has(storeId)) return storeNames.get(storeId)!;
    return storeId || '—';
  }

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-muted-foreground">Loading alerts…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Alerts</h2>
      <p className="text-sm text-muted-foreground">
        {role === 'ADMIN'
          ? 'All alerts across stores and operations.'
          : 'Alerts for your store only.'}
      </p>

      {alerts.length > 0 && (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground">
          {critical.length} critical · {warning.length} warnings · {info.length} info
        </p>
      )}

      {alerts.length === 0 ? (
        <Card className="rounded-2xl border-border shadow-card">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="font-medium text-foreground">No active alerts</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When something needs attention, it will show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {critical.length > 0 && (
            <Card className="rounded-2xl border-amber-200/50 shadow-card">
              <CardHeader>
                <CardTitle className="text-base text-foreground">Critical</CardTitle>
                <p className="text-sm text-muted-foreground">Requires immediate action</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {critical.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200/50 bg-amber-50/50 p-4"
                    >
                      <StatusBadge variant="critical">{a.severity}</StatusBadge>
                      <div className="min-w-0 flex-1">
                        {a.entities?.some((e) => e.type === 'STORE') && (
                          <p className="text-xs font-medium text-muted-foreground">
                            Store: {storeLabel(a)}
                          </p>
                        )}
                        <p className="text-sm font-medium text-foreground">{a.message}</p>
                        {a.evaluatedAt && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {a.evaluatedAt.replace('T', ' ').slice(0, 16)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {warning.length > 0 && (
            <Card className="rounded-2xl shadow-card">
              <CardHeader>
                <CardTitle className="text-base text-foreground">Warnings</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {warning.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-4"
                    >
                      <StatusBadge variant="warning">{a.severity}</StatusBadge>
                      <div className="min-w-0 flex-1">
                        {a.entities?.some((e) => e.type === 'STORE') && (
                          <p className="text-xs font-medium text-muted-foreground">
                            Store: {storeLabel(a)}
                          </p>
                        )}
                        <p className="text-sm text-foreground">{a.message}</p>
                        {a.evaluatedAt && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {a.evaluatedAt.replace('T', ' ').slice(0, 16)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {info.length > 0 && (
            <Card className="rounded-2xl shadow-card">
              <CardHeader>
                <CardTitle className="text-base text-foreground">Info</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {info.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <StatusBadge variant="info">{a.severity}</StatusBadge>
                      <div className="min-w-0 flex-1">
                        {a.entities?.some((e) => e.type === 'STORE') && (
                          <p className="text-xs font-medium text-muted-foreground">
                            Store: {storeLabel(a)}
                          </p>
                        )}
                        <p className="text-sm text-foreground">{a.message}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
