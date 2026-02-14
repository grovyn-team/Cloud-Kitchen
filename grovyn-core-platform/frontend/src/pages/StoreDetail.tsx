import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import type { StoreHealth } from '@/types/api';
import { ArrowLeft } from 'lucide-react';

export function StoreDetail() {
  const { id } = useParams<{ id: string }>();
  const { api } = useAuth();
  const [health, setHealth] = useState<StoreHealth | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get<StoreHealth>(apiPaths.storeHealthById(id))
      .then((r) => setHealth(r.data))
      .catch(() => setHealth(null));
  }, [api, id]);

  if (!id) return <p className="text-muted-foreground">No store ID.</p>;
  if (!health) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <Link to="/stores">
        <Button variant="ghost" size="sm" className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to stores
        </Button>
      </Link>
      <Card className="rounded-2xl shadow-card">
        <CardHeader>
          <CardTitle>{health.storeName}</CardTitle>
          <StatusBadge
            variant={
              health.status === 'healthy' ? 'healthy' : health.status === 'at_risk' ? 'at_risk' : 'critical'
            }
          >
            {health.status}
          </StatusBadge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Store ID: {health.storeId}</p>
          <p className="mt-2 text-sm text-muted-foreground">Last evaluated: {health.lastEvaluatedAt}</p>
          {health.signals && Object.keys(health.signals).length > 0 && (
            <pre className="mt-4 rounded-lg bg-muted p-4 text-xs">
              {JSON.stringify(health.signals, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
