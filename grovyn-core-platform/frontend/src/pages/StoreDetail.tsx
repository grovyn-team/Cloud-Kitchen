import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { apiPaths } from '@/services/api';
import type { StoreHealth } from '@/types/api';
import type { InventoryInsight, WorkforceInsight, FinanceInsight } from '@/types/api';
import type { StoreProfitability } from '@/types/api';
import { ArrowLeft } from 'lucide-react';

export function StoreDetail() {
  const { id } = useParams<{ id: string }>();
  const { api, role } = useAuth();
  const [health, setHealth] = useState<StoreHealth | null>(null);
  const [invInsights, setInvInsights] = useState<InventoryInsight[]>([]);
  const [wfInsights, setWfInsights] = useState<WorkforceInsight[]>([]);
  const [storeProfit, setStoreProfit] = useState<StoreProfitability | null>(null);
  const [financeInsights, setFinanceInsights] = useState<FinanceInsight[]>([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const requests: Promise<unknown>[] = [
      api.get<StoreHealth>(apiPaths.storeHealthById(id)).then((r) => setHealth(r.data)).catch(() => setHealth(null)),
      api.get<{ data: InventoryInsight[] }>(apiPaths.inventoryInsights).then((r) => {
        const data = r.data?.data ?? [];
        setInvInsights(Array.isArray(data) ? data.filter((i) => i.storeId === id) : []);
      }).catch(() => setInvInsights([])),
      api.get<{ data: WorkforceInsight[] }>(apiPaths.workforceInsights).then((r) => {
        const data = r.data?.data ?? [];
        setWfInsights(Array.isArray(data) ? data.filter((i) => i.storeId === id) : []);
      }).catch(() => setWfInsights([])),
    ];
    if (role === 'ADMIN') {
      requests.push(
        api.get<{ data: StoreProfitability[] }>(apiPaths.financeStores).then((r) => {
          const list = r.data?.data ?? [];
          const one = list.find((s: { storeId: string }) => s.storeId === id);
          setStoreProfit(one ?? null);
        }).catch(() => setStoreProfit(null)),
        api.get<{ data: FinanceInsight[] }>(apiPaths.financeInsights).then((r) => {
          const data = r.data?.data ?? [];
          setFinanceInsights(Array.isArray(data) ? data.filter((i) => i.entityType === 'STORE' && i.entityId === id) : []);
        }).catch(() => setFinanceInsights([]))
      );
    }
    Promise.all(requests).finally(() => setLoading(false));
  }, [api, id, role]);

  if (!id) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">No store selected.</p>
        <Link to="/stores"><Button variant="outline">Back to stores</Button></Link>
      </div>
    );
  }

  if (loading && !health) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Store not found or you don’t have access.</p>
        <Link to="/stores">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to stores
          </Button>
        </Link>
      </div>
    );
  }

  const signalKeys = health.signals ? Object.keys(health.signals) : [];
  const hasIssues = signalKeys.length > 0 || invInsights.length > 0 || wfInsights.length > 0;

  return (
    <div className="space-y-6">
      <Link to="/stores">
        <Button variant="ghost" size="sm" className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to stores
        </Button>
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-foreground">{health.storeName}</h2>
        <StatusBadge
          variant={
            health.status === 'healthy' ? 'healthy' : health.status === 'at_risk' ? 'at_risk' : 'critical'
          }
        >
          {health.status.replace('_', ' ')}
        </StatusBadge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          {role === 'ADMIN' && <TabsTrigger value="finance">Finance</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview">
          <Card className="rounded-2xl shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Health &amp; issues</CardTitle>
              <p className="text-sm text-muted-foreground">Last evaluated: {health.lastEvaluatedAt}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasIssues ? (
                <>
                  {signalKeys.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Signals
                      </p>
                      <ul className="space-y-1 text-sm text-foreground">
                        {signalKeys.map((k) => (
                          <li key={k}>
                            {k}: {String((health.signals as Record<string, unknown>)[k])}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {invInsights.length === 0 && wfInsights.length === 0 && signalKeys.length === 0 && (
                    <p className="text-sm text-muted-foreground">No issues flagged for this store.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No issues flagged. Store is in good shape.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operations">
          <div className="space-y-4">
            <Card className="rounded-2xl shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Inventory</CardTitle>
              </CardHeader>
              <CardContent>
                {invInsights.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No inventory alerts for this store.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {invInsights.map((i, idx) => (
                      <li key={idx}>{i.message ?? i.type}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-2xl shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Staff &amp; workforce</CardTitle>
              </CardHeader>
              <CardContent>
                {wfInsights.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No workforce alerts for this store.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {wfInsights.map((i, idx) => (
                      <li key={idx}>{i.message ?? i.type}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {role === 'ADMIN' && (
          <TabsContent value="finance">
            <div className="space-y-4">
              {storeProfit != null && (
                <Card className="rounded-2xl shadow-card">
                  <CardHeader>
                    <CardTitle className="text-base">Store profitability</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">
                      <span className="font-medium text-foreground">Profit</span>{' '}
                      ${Number(storeProfit.profit).toLocaleString()} ·{' '}
                      <span className="font-medium text-foreground">Margin</span>{' '}
                      {Number(storeProfit.marginPercent).toFixed(1)}%
                    </p>
                  </CardContent>
                </Card>
              )}
              {financeInsights.length > 0 && (
                <Card className="rounded-2xl shadow-card">
                  <CardHeader>
                    <CardTitle className="text-base">Finance alerts for this store</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {financeInsights.map((i, idx) => (
                        <li key={idx}>
                          <StatusBadge variant={i.severity === 'critical' ? 'critical' : i.severity === 'warning' ? 'warning' : 'info'}>
                            {i.severity}
                          </StatusBadge>{' '}
                          {i.message}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
              {storeProfit == null && financeInsights.length === 0 && (
                <p className="text-sm text-muted-foreground">No finance data for this store.</p>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
