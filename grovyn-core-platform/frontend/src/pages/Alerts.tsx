import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import type { Notification, NotificationListResponse, NotificationStatus, Store } from '@/types/api';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';

type StatusTab = NotificationStatus | 'all';

const inputClass =
  'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

const PAGE_SIZE = 20;
// "All" isn't a real backend `status` value (see notificationService.js's
// NOTIFICATION_STATUSES = ['unread','read','resolved']) — it's built here by
// fetching the three real statuses in parallel and merging client-side.
// Kept simple per task scope: no cross-status server pagination, just one
// wider page per status, newest first.
const ALL_PAGE_SIZE = 50;

function errorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { message?: string } } };
  return axiosErr.response?.data?.message ?? fallback;
}

function statusBadgeVariant(status: NotificationStatus): 'warning' | 'success' | 'info' {
  if (status === 'unread') return 'warning';
  if (status === 'resolved') return 'success';
  return 'info';
}

function formatType(type: string): string {
  if (!type) return type;
  return type
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

export function Alerts() {
  const { api, role } = useAuth();
  const [tab, setTab] = useState<StatusTab>('unread');
  const [branchId, setBranchId] = useState<string>('');
  const [stores, setStores] = useState<Store[]>([]);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<Notification[]>([]);
  const [total, setTotal] = useState<number | null>(null); // null => not applicable ("All" tab, client-merged)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [actionState, setActionState] = useState<{ id: string; kind: 'read' | 'resolve' } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ADMIN-only branch picker; STAFF is auto-scoped server-side (never fetched
  // or shown a filter, per the RBAC gate-at-the-route rule).
  useEffect(() => {
    if (role !== 'ADMIN') return;
    api
      .get<{ data: Store[] }>(apiPaths.branchesList({ pageSize: 100 }))
      .then((r) => setStores(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => setStores([]));
  }, [api, role]);

  const storeNames = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);

  useEffect(() => {
    setPage(1);
  }, [tab, branchId]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    if (tab === 'all') {
      Promise.all(
        (['unread', 'read', 'resolved'] as NotificationStatus[]).map((s) =>
          api
            .get<NotificationListResponse>(
              apiPaths.notifications({ status: s, branchId: branchId || undefined, page: 1, pageSize: ALL_PAGE_SIZE })
            )
            .then((r) => r.data?.data ?? [])
        )
      )
        .then((results) => {
          const merged = results.flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
          setItems(merged);
          setTotal(null);
        })
        .catch(() => {
          setItems([]);
          setError('Could not load notifications. Try again in a moment.');
        })
        .finally(() => setLoading(false));
      return;
    }

    api
      .get<NotificationListResponse>(
        apiPaths.notifications({ status: tab, branchId: branchId || undefined, page, pageSize: PAGE_SIZE })
      )
      .then((r) => {
        setItems(r.data?.data ?? []);
        setTotal(r.data?.meta?.total ?? 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
        setError('Could not load notifications. Try again in a moment.');
      })
      .finally(() => setLoading(false));
  }, [api, tab, branchId, page]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const totalPages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;

  async function handleMarkRead(id: string) {
    setActionState({ id, kind: 'read' });
    setActionError(null);
    try {
      await api.patch(apiPaths.notificationMarkRead(id));
      setRefreshTick((t) => t + 1);
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'Could not mark this notification as read. Try again.'));
    } finally {
      setActionState(null);
    }
  }

  async function handleResolve(id: string) {
    setActionState({ id, kind: 'resolve' });
    setActionError(null);
    try {
      await api.patch(apiPaths.notificationResolve(id));
      setRefreshTick((t) => t + 1);
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'Could not resolve this notification. Try again.'));
    } finally {
      setActionState(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Alerts</h2>
        <p className="text-sm text-muted-foreground">
          {role === 'ADMIN' ? 'Notifications across all branches.' : 'Notifications for your branch.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
          <TabsList>
            <TabsTrigger value="unread">Unread</TabsTrigger>
            <TabsTrigger value="read">Read</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        {role === 'ADMIN' && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Branch</label>
            <select className={inputClass} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All branches</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {actionError}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-muted-foreground">Loading notifications…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <Card className="rounded-2xl border-border shadow-card">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-foreground">
              {tab === 'unread' ? 'No unread notifications' : tab === 'read' ? 'No read notifications' : tab === 'resolved' ? 'No resolved notifications' : 'No notifications'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">When something needs attention, it will show up here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-2xl border border-border shadow-card">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id} className="flex flex-wrap items-start gap-3 p-4">
                  <StatusBadge variant={statusBadgeVariant(n.status)}>{n.status}</StatusBadge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{n.title}</p>
                      <span className="text-xs text-muted-foreground">· {formatType(n.type)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {storeNames.get(n.branchId) ?? n.branchId} · {formatDate(n.createdAt)}
                      {n.status === 'resolved' && n.resolvedAt ? ` · resolved ${formatDate(n.resolvedAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {n.status === 'unread' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionState?.id === n.id}
                        onClick={() => handleMarkRead(n.id)}
                      >
                        {actionState?.id === n.id && actionState.kind === 'read' ? 'Marking…' : 'Mark read'}
                      </Button>
                    )}
                    {/* Resolve is ADMIN-only — gated here (not just relying on the
                        backend's 403) so STAFF never even sees the control. */}
                    {role === 'ADMIN' && n.status !== 'resolved' && (
                      <Button type="button" size="sm" disabled={actionState?.id === n.id} onClick={() => handleResolve(n.id)}>
                        {actionState?.id === n.id && actionState.kind === 'resolve' ? 'Resolving…' : 'Resolve'}
                      </Button>
                    )}
                    {n.status === 'resolved' && (
                      <span className="flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Resolved
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {tab !== 'all' && totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="gap-1"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
