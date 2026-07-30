import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { InsightCard } from '@/components/InsightCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import { UploadCloud, CheckCircle2, AlertTriangle, XCircle, PackageSearch, ChevronLeft, ChevronRight } from 'lucide-react';
import type {
  Store,
  InventoryItem,
  InventoryItemDetail,
  InventoryItemCreateResponse,
  InventoryItemUpdateResponse,
  InventoryListResponse,
  InventoryImportResult,
  InventoryRequestPayload,
  InventoryRequestResult,
} from '@/types/api';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

const textareaClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface Insight {
  type: string;
  message?: string;
  storeId?: string;
  severity?: string;
}

/** Branch picker — shared logic (STAFF is scoped to their own branch(es)), same pattern as Sales.tsx. */
function useScopedBranches() {
  const { api, role, storeIds } = useAuth();
  const [branches, setBranches] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ data: Store[] }>(apiPaths.stores)
      .then((r) => setBranches(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => setBranches([]))
      .finally(() => setLoading(false));
  }, [api]);

  const available = useMemo(() => {
    if (role === 'STAFF') return branches.filter((b) => storeIds.includes(b.id));
    return branches;
  }, [branches, role, storeIds]);

  return { available, loading, role };
}

function BranchField({
  value,
  onChange,
  available,
  loading,
  role,
}: {
  value: string;
  onChange: (v: string) => void;
  available: Store[];
  loading: boolean;
  role: string | null;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading branches…</p>;
  }

  if (role === 'STAFF' && available.length <= 1) {
    return (
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Branch</p>
        <p className="text-sm font-medium text-foreground">{available[0]?.name ?? 'No branch assigned'}</p>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Branch
      </label>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select branch…</option>
        {available.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function lowStockVariant(item: InventoryItem): { label: string; variant: 'critical' | 'at_risk' | 'healthy' | 'neutral' } {
  if (item.lowStockThreshold == null) return { label: 'No threshold', variant: 'neutral' };
  if (item.currentStock <= 0) return { label: 'Out of stock', variant: 'critical' };
  if (item.currentStock <= item.lowStockThreshold) return { label: 'Low stock', variant: 'at_risk' };
  return { label: 'In stock', variant: 'healthy' };
}

function errorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { message?: string } } };
  return axiosErr.response?.data?.message ?? fallback;
}

/* ---------------------------------------------------------------------- */
/* Restock request — minimal inline form, reused inside the detail panel   */
/* and directly from a list row.                                          */
/* ---------------------------------------------------------------------- */

type RequestState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; result: InventoryRequestResult }
  | { status: 'error'; message: string };

function RestockRequestForm({ item, onClose }: { item: InventoryItem; onClose?: () => void }) {
  const { api } = useAuth();
  const [message, setMessage] = useState(`Please restock ${item.name} (currently ${item.currentStock} ${item.unit}).`);
  const [state, setState] = useState<RequestState>({ status: 'idle' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      setState({ status: 'error', message: 'Enter a message describing what you need.' });
      return;
    }
    setState({ status: 'submitting' });
    const payload: InventoryRequestPayload = {
      branchId: item.branchId,
      message: message.trim(),
      itemName: item.name,
      inventoryItemId: item.id,
    };
    try {
      const { data } = await api.post<InventoryRequestResult>(apiPaths.inventoryRequests, payload);
      setState({ status: 'success', result: data });
    } catch (err: unknown) {
      setState({ status: 'error', message: errorMessage(err, 'Could not send the request. Try again.') });
    }
  }

  if (state.status === 'success') {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div className="flex-1">
          <p className="text-sm font-medium text-emerald-900">Restock request sent to admin.</p>
        </div>
        {onClose && (
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        className={textareaClass}
        rows={2}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What do you need restocked, and how urgently?"
      />
      {state.status === 'error' && (
        <p className="flex items-center gap-1.5 text-xs text-red-700">
          <XCircle className="h-3.5 w-3.5 shrink-0" /> {state.message}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={state.status === 'submitting'}>
          {state.status === 'submitting' ? 'Sending…' : 'Send restock request'}
        </Button>
        {onClose && (
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/* Item detail — recent movement history + edit form + restock request.   */
/* ---------------------------------------------------------------------- */

type EditState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string };

function InventoryItemDetailPanel({
  itemId,
  onClose,
  onChanged,
}: {
  itemId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api } = useAuth();
  const [detail, setDetail] = useState<InventoryItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRequest, setShowRequest] = useState(false);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('');
  const [costPerUnit, setCostPerUnit] = useState('');
  const [quantityDelta, setQuantityDelta] = useState('');
  const [reason, setReason] = useState('');
  const [editState, setEditState] = useState<EditState>({ status: 'idle' });

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<InventoryItemDetail>(apiPaths.inventoryItemById(itemId))
      .then((r) => {
        setDetail(r.data);
        setName(r.data.name);
        setSku(r.data.sku ?? '');
        setUnit(r.data.unit);
        setLowStockThreshold(r.data.lowStockThreshold != null ? String(r.data.lowStockThreshold) : '');
        setCostPerUnit(r.data.costPerUnit != null ? String(r.data.costPerUnit) : '');
      })
      .catch(() => setError('Could not load this item. Try again in a moment.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!name.trim()) {
      setEditState({ status: 'error', message: 'Name is required.' });
      return;
    }
    if (!unit.trim()) {
      setEditState({ status: 'error', message: 'Unit is required.' });
      return;
    }
    const delta = quantityDelta.trim() ? Number(quantityDelta) : 0;
    if (quantityDelta.trim() && !Number.isFinite(delta)) {
      setEditState({ status: 'error', message: 'Stock adjustment must be a number.' });
      return;
    }

    setEditState({ status: 'submitting' });
    try {
      const { data } = await api.patch<InventoryItemUpdateResponse>(apiPaths.inventoryItemById(detail.id), {
        name: name.trim(),
        sku: sku.trim() || null,
        unit: unit.trim(),
        lowStockThreshold: lowStockThreshold.trim() ? Number(lowStockThreshold) : null,
        costPerUnit: costPerUnit.trim() ? Number(costPerUnit) : null,
        ...(delta !== 0 ? { stockAdjustment: { quantityDelta: delta, reason: reason.trim() || undefined } } : {}),
      });
      setEditState({ status: 'idle' });
      setQuantityDelta('');
      setReason('');
      setDetail((prev) => (prev ? { ...prev, ...data } : prev));
      load();
      onChanged();
    } catch (err: unknown) {
      setEditState({ status: 'error', message: errorMessage(err, 'Could not save changes. Check the fields and try again.') });
    }
  }

  return (
    <Card className="rounded-2xl border border-border shadow-card">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{detail?.name ?? 'Item detail'}</CardTitle>
          {detail && <p className="mt-0.5 text-xs text-muted-foreground">SKU: {detail.sku ?? '—'}</p>}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading item…</p>
        ) : error ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium text-red-900">{error}</p>
          </div>
        ) : detail ? (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current stock</p>
                <p className="text-lg font-semibold text-foreground">
                  {detail.currentStock} {detail.unit}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Low-stock threshold</p>
                <p className="text-lg font-semibold text-foreground">{detail.lowStockThreshold ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Cost / unit</p>
                <p className="text-lg font-semibold text-foreground">
                  {detail.costPerUnit != null ? `₹${Number(detail.costPerUnit).toLocaleString()}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                <StatusBadge variant={lowStockVariant(detail).variant}>{lowStockVariant(detail).label}</StatusBadge>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-4 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Edit item</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Name
                  </label>
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    SKU
                  </label>
                  <input className={inputClass} value={sku} onChange={(e) => setSku(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Unit
                  </label>
                  <input className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Low-stock threshold
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClass}
                    value={lowStockThreshold}
                    onChange={(e) => setLowStockThreshold(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Cost / unit
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClass}
                    value={costPerUnit}
                    onChange={(e) => setCostPerUnit(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Stock adjustment (+/-)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className={inputClass}
                    placeholder="e.g. -5 or 20"
                    value={quantityDelta}
                    onChange={(e) => setQuantityDelta(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Adjustment reason (optional)
                  </label>
                  <input
                    className={inputClass}
                    placeholder="e.g. wastage, stock count correction"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              </div>

              {editState.status === 'error' && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {editState.message}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={editState.status === 'submitting'}>
                  {editState.status === 'submitting' ? 'Saving…' : 'Save changes'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowRequest((v) => !v)}>
                  {showRequest ? 'Hide restock request' : 'Request restock'}
                </Button>
              </div>
            </form>

            {showRequest && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <RestockRequestForm item={detail} onClose={() => setShowRequest(false)} />
              </div>
            )}

            <div className="border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent movement history
              </p>
              {detail.recentMovements.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stock movements recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Date</th>
                        <th className="pb-2 pr-4 font-medium">Type</th>
                        <th className="pb-2 pr-4 font-medium">Delta</th>
                        <th className="pb-2 pr-4 font-medium">Resulting stock</th>
                        <th className="pb-2 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.recentMovements.map((m) => (
                        <tr key={m.id} className="border-b border-border/60">
                          <td className="py-2 pr-4 text-xs text-muted-foreground">
                            {new Date(m.createdAt).toLocaleString()}
                          </td>
                          <td className="py-2 pr-4">{m.movementType}</td>
                          <td className={`py-2 pr-4 font-medium ${m.quantityDelta < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                            {m.quantityDelta > 0 ? '+' : ''}
                            {m.quantityDelta}
                          </td>
                          <td className="py-2 pr-4">{m.resultingStock}</td>
                          <td className="py-2 text-muted-foreground">{m.reason ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Items list — branch-scoped, low-stock filter, pagination, detail panel */
/* ---------------------------------------------------------------------- */

function InventoryItemsList() {
  const { api, role, storeIds } = useAuth();
  const { available, loading: branchesLoading } = useScopedBranches();
  const [branchId, setBranchId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [response, setResponse] = useState<InventoryListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requestRowId, setRequestRowId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [branchId, lowStockOnly]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<InventoryListResponse>(apiPaths.inventoryItemsList({ branchId: branchId || undefined, lowStock: lowStockOnly, page, pageSize }))
      .then((r) => setResponse(r.data))
      .catch(() => {
        setResponse(null);
        setError('Could not load inventory items. Try again in a moment.');
      })
      .finally(() => setLoading(false));
  }, [api, branchId, lowStockOnly, page, refreshTick]);

  const branchNameById = useMemo(() => {
    const m: Record<string, string> = {};
    available.forEach((b) => {
      m[b.id] = b.name;
    });
    return m;
  }, [available]);

  const items = response?.data ?? [];
  const total = response?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {role === 'ADMIN' && !branchesLoading && available.length > 0 && (
            <select className={`${inputClass} w-56`} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All branches</option>
              {available.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          {role === 'STAFF' && (
            <StatusBadge variant="info">
              Scoped to {storeIds.length === 1 ? (branchNameById[storeIds[0]] ?? 'your branch') : 'your branches'}
            </StatusBadge>
          )}
          <Button
            type="button"
            size="sm"
            variant={lowStockOnly ? 'default' : 'outline'}
            onClick={() => setLowStockOnly((v) => !v)}
            className="gap-1.5"
          >
            <PackageSearch className="h-3.5 w-3.5" />
            Low stock only
          </Button>
        </div>
        {!loading && !error && (
          <p className="text-xs text-muted-foreground">
            {total} item{total !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center">
          <p className="text-muted-foreground">Loading items…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">
            {lowStockOnly
              ? 'No items are at or below their low-stock threshold right now.'
              : 'No inventory items yet. Add one manually or import a CSV/XLSX.'}
          </p>
        </div>
      ) : (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">SKU</th>
                    {role === 'ADMIN' && !branchId && <th className="px-4 py-2 font-medium">Branch</th>}
                    <th className="px-4 py-2 font-medium">Stock</th>
                    <th className="px-4 py-2 font-medium">Threshold</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const status = lowStockVariant(item);
                    return (
                      <Fragment key={item.id}>
                        <tr className="border-b border-border/60">
                          <td className="px-4 py-2.5 font-medium text-foreground">{item.name}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{item.sku ?? '—'}</td>
                          {role === 'ADMIN' && !branchId && (
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {branchNameById[item.branchId] ?? item.branchId}
                            </td>
                          )}
                          <td className="px-4 py-2.5">
                            {item.currentStock} {item.unit}
                          </td>
                          <td className="px-4 py-2.5">{item.lowStockThreshold ?? '—'}</td>
                          <td className="px-4 py-2.5">
                            <StatusBadge variant={status.variant}>{status.label}</StatusBadge>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                              >
                                {selectedId === item.id ? 'Hide' : 'View'}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setRequestRowId(requestRowId === item.id ? null : item.id)}
                              >
                                Restock
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {requestRowId === item.id && (
                          <tr className="border-b border-border/60 bg-muted/20">
                            <td colSpan={role === 'ADMIN' && !branchId ? 7 : 6} className="px-4 py-3">
                              <RestockRequestForm item={item} onClose={() => setRequestRowId(null)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
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

      {selectedId && (
        <InventoryItemDetailPanel
          itemId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => setRefreshTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Add item — manual entry, mirrors Sales' manual entry form structure.   */
/* ---------------------------------------------------------------------- */

type AddState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; item: InventoryItemCreateResponse }
  | { status: 'error'; message: string };

function InventoryAddItem() {
  const { api } = useAuth();
  const { available, loading, role } = useScopedBranches();
  const [branchId, setBranchId] = useState('');
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('');
  const [costPerUnit, setCostPerUnit] = useState('');
  const [initialStock, setInitialStock] = useState('');
  const [state, setState] = useState<AddState>({ status: 'idle' });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (role === 'STAFF' && available.length === 1 && !branchId) {
      setBranchId(available[0].id);
    }
  }, [role, available, branchId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!branchId) {
      setFormError('Select a branch.');
      return;
    }
    if (!name.trim()) {
      setFormError('Enter an item name.');
      return;
    }
    if (!unit.trim()) {
      setFormError('Enter a unit (e.g. kg, litre, piece).');
      return;
    }

    setState({ status: 'submitting' });
    try {
      const { data } = await api.post<InventoryItemCreateResponse>(apiPaths.inventoryItems, {
        branchId,
        name: name.trim(),
        sku: sku.trim() || undefined,
        unit: unit.trim(),
        lowStockThreshold: lowStockThreshold.trim() ? Number(lowStockThreshold) : undefined,
        costPerUnit: costPerUnit.trim() ? Number(costPerUnit) : undefined,
        initialStock: initialStock.trim() ? Number(initialStock) : undefined,
      });
      setState({ status: 'success', item: data });
      setName('');
      setSku('');
      setUnit('');
      setLowStockThreshold('');
      setCostPerUnit('');
      setInitialStock('');
    } catch (err: unknown) {
      setState({ status: 'error', message: errorMessage(err, 'Could not save this item. Check the fields and try again.') });
    }
  }

  return (
    <Card className="rounded-2xl shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Add inventory item</CardTitle>
        <p className="text-sm text-muted-foreground">Set an optional low-stock threshold to get flagged when stock runs low.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <BranchField value={branchId} onChange={setBranchId} available={available} loading={loading} role={role} />
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Item name
              </label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                SKU (optional)
              </label>
              <input className={inputClass} value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Unit
              </label>
              <input className={inputClass} placeholder="kg, litre, piece…" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Low-stock threshold (optional)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Cost / unit (optional)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={costPerUnit}
                onChange={(e) => setCostPerUnit(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Initial stock (optional)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
              />
            </div>
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {formError}
            </div>
          )}

          <Button type="submit" disabled={state.status === 'submitting'}>
            {state.status === 'submitting' ? 'Saving…' : 'Save item'}
          </Button>
        </form>

        {state.status === 'success' && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-900">
              &ldquo;{state.item.name}&rdquo; saved with {state.item.currentStock} {state.item.unit} in stock.
            </p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium text-red-900">{state.message}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Import — CSV/XLSX upload, 3-state result UI, copied from Sales.tsx.    */
/* ---------------------------------------------------------------------- */

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'success'; result: InventoryImportResult }
  | { status: 'row-errors'; result: InventoryImportResult }
  | { status: 'error'; message: string };

function InventoryUpload() {
  const { api } = useAuth();
  const { available, loading, role } = useScopedBranches();
  const [branchId, setBranchId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ status: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (role === 'STAFF' && available.length === 1 && !branchId) {
      setBranchId(available[0].id);
    }
  }, [role, available, branchId]);

  const canSubmit = !!branchId && !!file && state.status !== 'uploading';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !branchId) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setState({ status: 'error', message: 'File exceeds the 5MB upload limit. Split it into smaller files.' });
      return;
    }
    setState({ status: 'uploading' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('branchId', branchId);
    try {
      const { data } = await api.post<InventoryImportResult>(apiPaths.inventoryImport, formData, {
        headers: { 'Content-Type': undefined },
      });
      if (data.errors && data.errors.length > 0) {
        setState({ status: 'row-errors', result: data });
      } else {
        setState({ status: 'success', result: data });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: InventoryImportResult & { message?: string } } };
      const resp = axiosErr.response;
      if (resp?.status === 422 && resp.data?.errors) {
        setState({ status: 'row-errors', result: resp.data });
      } else if (resp?.status === 413) {
        setState({ status: 'error', message: 'File too large or too many rows (limits: 5MB / 10,000 rows).' });
      } else {
        setState({
          status: 'error',
          message: resp?.data?.message ?? 'Upload failed. Check your connection and try again.',
        });
      }
    }
  }

  return (
    <Card className="rounded-2xl shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Import inventory from CSV/XLSX</CardTitle>
        <p className="text-sm text-muted-foreground">
          Required columns: <code className="rounded bg-muted px-1">name, unit</code>. Optional:{' '}
          <code className="rounded bg-muted px-1">sku, lowStockThreshold, costPerUnit, quantity</code>. An existing SKU/name
          updates that item&apos;s stock; a new one creates it. Nothing is imported if any row has an error.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <BranchField value={branchId} onChange={setBranchId} available={available} loading={loading} role={role} />
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                CSV or XLSX file
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className={inputClass}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <Button type="submit" disabled={!canSubmit} className="gap-2">
            <UploadCloud className="h-4 w-4" />
            {state.status === 'uploading' ? 'Uploading…' : 'Upload & import'}
          </Button>
        </form>

        {state.status === 'success' && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-medium text-emerald-900">
                Imported {state.result.importedCount} item{state.result.importedCount !== 1 ? 's' : ''}
                {typeof state.result.createdCount === 'number' && typeof state.result.updatedCount === 'number'
                  ? ` (${state.result.createdCount} new, ${state.result.updatedCount} updated).`
                  : '.'}
              </p>
              {state.result.importBatchRef && (
                <p className="mt-1 text-xs text-emerald-700">Batch ref: {state.result.importBatchRef}</p>
              )}
            </div>
          </div>
        )}

        {state.status === 'row-errors' && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
              <p className="text-sm font-medium text-amber-900">
                Nothing was imported — {state.result.errors.length} row error
                {state.result.errors.length !== 1 ? 's' : ''} found. Fix these rows and re-upload.
              </p>
            </div>
            <div className="max-h-64 overflow-y-auto rounded border border-amber-200/70 bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-amber-100/60">
                  <tr className="text-left text-amber-900">
                    <th className="px-3 py-1.5 font-medium">Row</th>
                    <th className="px-3 py-1.5 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {state.result.errors.map((e, idx) => (
                    <tr key={idx} className="border-t border-amber-100">
                      <td className="px-3 py-1.5 font-mono text-xs">{e.row}</td>
                      <td className="px-3 py-1.5">{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium text-red-900">{state.message}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Legacy AI insights — unrelated to the real inventory module (backend   */
/* `routes/inventory.js` mock), left as-is, folded into its own tab.      */
/* ---------------------------------------------------------------------- */

function OperationsInsights() {
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
    <div className="space-y-4">
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

export function Operations() {
  const [tab, setTab] = useState('items');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Operations</h2>
        <p className="text-sm text-muted-foreground">
          Manage inventory across your branch(es): view stock, add items, import in bulk, and request restocks.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="add">Add item</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="items">
          <InventoryItemsList />
        </TabsContent>
        <TabsContent value="add">
          <InventoryAddItem />
        </TabsContent>
        <TabsContent value="import">
          <InventoryUpload />
        </TabsContent>
        <TabsContent value="insights">
          <OperationsInsights />
        </TabsContent>
      </Tabs>
    </div>
  );
}
