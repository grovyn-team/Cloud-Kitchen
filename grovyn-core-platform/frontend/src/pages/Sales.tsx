import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import { Plus, Trash2, UploadCloud, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type {
  Store,
  Sale,
  SaleLineItemInput,
  SalesImportResult,
  SalesImportRowError,
  AvailableInventoryItem,
  SalesRollupResponse,
  SalesRollupPoint,
  RollupPeriod,
} from '@/types/api';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Branch picker — shared logic for Upload + Manual Entry tabs (STAFF is scoped to their own branch(es)). */
function useScopedBranches() {
  const { api, role, storeIds } = useAuth();
  const [branches, setBranches] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ data: Store[] }>(apiPaths.branchesList({ pageSize: 100 }))
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

  // STAFF with exactly one branch: no picker, just show it (never let them target another branch).
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

/**
 * Integration Task 1, round 3 — "let the user add an alias from the error
 * screen so a failed import is one click from working." Extracts each
 * unmatched item name from the row errors (matching the exact message shape
 * `salesCsvImportService.js`'s `validateAndBuildRows` produces), and offers
 * an inline "map to an existing item, add alias" action per name — does not
 * auto-retry the import; the user re-uploads once every unmatched name is
 * resolved, same explicit re-check discipline every other write flow here
 * uses.
 */
const UNMATCHED_ITEM_NAME_RE = /^itemName "(.+)" does not match any item or alias for this branch\.$/;

function UnmatchedItemAliasFixer({
  branchId,
  errors,
  availableItems,
}: {
  branchId: string;
  errors: SalesImportRowError[];
  availableItems: AvailableInventoryItem[];
}) {
  const { api } = useAuth();
  const unmatchedNames = useMemo(() => {
    const names = new Set<string>();
    errors.forEach((e) => {
      const m = UNMATCHED_ITEM_NAME_RE.exec(e.error);
      if (m) names.add(m[1]);
    });
    return [...names];
  }, [errors]);

  const [selection, setSelection] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, 'idle' | 'submitting' | 'done' | 'error'>>({});

  if (unmatchedNames.length === 0) return null;

  async function handleAddAlias(aliasName: string) {
    const inventoryItemId = selection[aliasName];
    if (!inventoryItemId) return;
    setStatus((s) => ({ ...s, [aliasName]: 'submitting' }));
    try {
      await api.post(apiPaths.inventoryAliases, { branchId, inventoryItemId, aliasName });
      setStatus((s) => ({ ...s, [aliasName]: 'done' }));
    } catch {
      setStatus((s) => ({ ...s, [aliasName]: 'error' }));
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-900">
        Unmatched item names — map to an existing item, then re-upload
      </p>
      {unmatchedNames.map((name) => (
        <div key={name} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-foreground">&ldquo;{name}&rdquo;</span>
          <span className="text-muted-foreground">→</span>
          <select
            className={`${inputClass} w-auto`}
            value={selection[name] ?? ''}
            onChange={(e) => setSelection((s) => ({ ...s, [name]: e.target.value }))}
            disabled={status[name] === 'done'}
          >
            <option value="">Select an item…</option>
            {availableItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selection[name] || status[name] === 'submitting' || status[name] === 'done'}
            onClick={() => handleAddAlias(name)}
          >
            {status[name] === 'submitting' ? 'Adding…' : status[name] === 'done' ? 'Added ✓' : 'Add alias'}
          </Button>
          {status[name] === 'error' && <span className="text-xs text-red-700">Could not add. Try again.</span>}
        </div>
      ))}
    </div>
  );
}

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'success'; result: SalesImportResult }
  | { status: 'row-errors'; result: SalesImportResult }
  | { status: 'error'; message: string };

function SalesUpload() {
  const { api } = useAuth();
  const { available, loading, role } = useScopedBranches();
  const [branchId, setBranchId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ status: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-select the only branch a STAFF user has.
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
      const { data } = await api.post<SalesImportResult>(apiPaths.salesImport, formData, {
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
      const axiosErr = err as { response?: { status?: number; data?: SalesImportResult & { message?: string } } };
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
        <CardTitle className="text-base">Import sales from CSV</CardTitle>
        <p className="text-sm text-muted-foreground">
          Required columns: <code className="rounded bg-muted px-1">saleDate, itemName, quantity, unitPrice</code>.
          Optional: <code className="rounded bg-muted px-1">paymentMethod, sku</code>. GST is computed automatically
          at the rate in force on each row's sale date — do not include a tax column. One row = one sale with one
          line item. Max 5MB / 10,000 rows.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <BranchField value={branchId} onChange={setBranchId} available={available} loading={loading} role={role} />
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                CSV file
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
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
                Imported {state.result.importedCount} sale{state.result.importedCount !== 1 ? 's' : ''} successfully.
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
            {state.result.availableItems && state.result.availableItems.length > 0 && (
              <UnmatchedItemAliasFixer
                branchId={branchId}
                errors={state.result.errors}
                availableItems={state.result.availableItems}
              />
            )}
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

interface DraftLineItem extends SaleLineItemInput {
  key: string;
}

let lineItemCounter = 0;
function emptyLineItem(): DraftLineItem {
  lineItemCounter += 1;
  return { key: `li-${lineItemCounter}`, itemName: '', sku: '', quantity: 1, unitPrice: 0 };
}

type ManualState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; sale: Sale }
  | { status: 'error'; message: string };

function SalesManualEntry() {
  const { api } = useAuth();
  const { available, loading, role } = useScopedBranches();
  const [branchId, setBranchId] = useState('');
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('');
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([emptyLineItem()]);
  const [state, setState] = useState<ManualState>({ status: 'idle' });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (role === 'STAFF' && available.length === 1 && !branchId) {
      setBranchId(available[0].id);
    }
  }, [role, available, branchId]);

  function updateLineItem(key: string, patch: Partial<SaleLineItemInput>) {
    setLineItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addLineItem() {
    setLineItems((rows) => [...rows, emptyLineItem()]);
  }

  function removeLineItem(key: string) {
    setLineItems((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!branchId) {
      setFormError('Select a branch.');
      return;
    }
    if (!saleDate) {
      setFormError('Select a sale date.');
      return;
    }
    const cleanItems = lineItems.filter((li) => li.itemName.trim().length > 0);
    if (cleanItems.length === 0) {
      setFormError('Add at least one line item with an item name.');
      return;
    }
    for (const li of cleanItems) {
      if (!(li.quantity > 0)) {
        setFormError(`"${li.itemName}": quantity must be greater than 0.`);
        return;
      }
      if (li.unitPrice < 0) {
        setFormError(`"${li.itemName}": unit price cannot be negative.`);
        return;
      }
    }

    setState({ status: 'submitting' });
    try {
      const { data } = await api.post<Sale>(apiPaths.sales, {
        branchId,
        saleDate,
        paymentMethod: paymentMethod || undefined,
        lineItems: cleanItems.map(({ itemName, sku, quantity, unitPrice, inventoryItemId }) => ({
          itemName,
          sku: sku || undefined,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
          inventoryItemId,
        })),
      });
      setState({ status: 'success', sale: data });
      setLineItems([emptyLineItem()]);
      setPaymentMethod('');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setState({
        status: 'error',
        message: axiosErr.response?.data?.message ?? 'Could not save this sale. Check the fields and try again.',
      });
    }
  }

  return (
    <Card className="rounded-2xl shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Manual sale entry</CardTitle>
        <p className="text-sm text-muted-foreground">Totals are computed by the server after you submit.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <BranchField value={branchId} onChange={setBranchId} available={available} loading={loading} role={role} />
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sale date
              </label>
              <input
                type="date"
                className={inputClass}
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Payment method (optional)
              </label>
              <input
                type="text"
                className={inputClass}
                placeholder="cash, card, upi…"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Line items</p>
              <Button type="button" variant="outline" size="sm" onClick={addLineItem} className="gap-1">
                <Plus className="h-3.5 w-3.5" /> Add row
              </Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li) => (
                <div key={li.key} className="grid grid-cols-12 items-center gap-2">
                  <input
                    className={`${inputClass} col-span-5`}
                    placeholder="Item name"
                    value={li.itemName}
                    onChange={(e) => updateLineItem(li.key, { itemName: e.target.value })}
                  />
                  <input
                    className={`${inputClass} col-span-2`}
                    placeholder="SKU"
                    value={li.sku ?? ''}
                    onChange={(e) => updateLineItem(li.key, { sku: e.target.value })}
                  />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className={`${inputClass} col-span-2`}
                    placeholder="Qty"
                    value={li.quantity}
                    onChange={(e) => updateLineItem(li.key, { quantity: Number(e.target.value) })}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={`${inputClass} col-span-2`}
                    placeholder="Unit price"
                    value={li.unitPrice}
                    onChange={(e) => updateLineItem(li.key, { unitPrice: Number(e.target.value) })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="col-span-1"
                    onClick={() => removeLineItem(li.key)}
                    disabled={lineItems.length === 1}
                    aria-label="Remove line item"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {formError}
            </div>
          )}

          <Button type="submit" disabled={state.status === 'submitting'}>
            {state.status === 'submitting' ? 'Saving…' : 'Save sale'}
          </Button>
        </form>

        {state.status === 'success' && (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              <p className="text-sm font-medium text-emerald-900">
                Sale saved — total ₹{Number(state.sale.totalAmount).toLocaleString()}
              </p>
            </div>
            <ul className="ml-7 list-disc space-y-0.5 text-xs text-emerald-800">
              {state.sale.lineItems?.map((li) => (
                <li key={li.id}>
                  {li.itemName} × {li.quantity} @ ₹{Number(li.unitPrice).toLocaleString()}
                </li>
              ))}
            </ul>
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

const PERIODS: { value: RollupPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

function SalesRollup() {
  const { api, role, storeIds } = useAuth();
  const { available, loading: branchesLoading } = useScopedBranches();
  const [period, setPeriod] = useState<RollupPeriod>('day');
  const [branchId, setBranchId] = useState<string>(''); // '' = all (ADMIN only; STAFF is server-scoped regardless)
  const [rollup, setRollup] = useState<SalesRollupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<SalesRollupResponse>(apiPaths.salesRollup(period, branchId || undefined))
      .then((r) => setRollup(r.data))
      .catch(() => {
        setRollup(null);
        setError('Could not load sales rollup. Try again in a moment.');
      })
      .finally(() => setLoading(false));
  }, [api, period, branchId]);

  const branchNameById = useMemo(() => {
    const m: Record<string, string> = {};
    available.forEach((b) => {
      m[b.id] = b.name;
    });
    return m;
  }, [available]);

  const rows: SalesRollupPoint[] = rollup?.data ?? [];
  const totalRevenue = rows.reduce((sum, r) => sum + Number(r.revenue || 0), 0);
  const totalOrders = rows.reduce((sum, r) => sum + Number(r.orderCount || 0), 0);
  const blendedAov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              type="button"
              size="sm"
              variant={period === p.value ? 'default' : 'ghost'}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {role === 'ADMIN' && !branchesLoading && available.length > 0 && (
          <select
            className={`${inputClass} w-56`}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
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
      </div>

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center">
          <p className="text-muted-foreground">Loading rollup…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">
            No sales recorded for this {period} yet. Upload a CSV or add a manual entry to see numbers here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard title="Revenue" value={`₹${totalRevenue.toLocaleString()}`} />
            <MetricCard title="Orders" value={totalOrders.toLocaleString()} />
            <MetricCard title="AOV" value={`₹${blendedAov.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
          </div>

          <Card className="rounded-xl border border-border">
            <CardHeader>
              <CardTitle className="text-base">By branch &amp; period</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">Period start</th>
                      <th className="pb-2 pr-4 font-medium">Branch</th>
                      <th className="pb-2 pr-4 font-medium">Revenue</th>
                      <th className="pb-2 pr-4 font-medium">Orders</th>
                      <th className="pb-2 font-medium">AOV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr key={`${r.branchId}-${r.periodStart}-${idx}`} className="border-b border-border/60">
                        <td className="py-2 pr-4">{r.periodStart}</td>
                        <td className="py-2 pr-4 font-medium text-foreground">
                          {branchNameById[r.branchId] ?? r.branchId}
                        </td>
                        <td className="py-2 pr-4">₹{Number(r.revenue).toLocaleString()}</td>
                        <td className="py-2 pr-4">{r.orderCount}</td>
                        <td className="py-2">₹{Number(r.aov).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export function Sales() {
  const [tab, setTab] = useState('upload');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Sales</h2>
        <p className="text-sm text-muted-foreground">Import, enter, and review sales across your branch(es).</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="manual">Manual entry</TabsTrigger>
          <TabsTrigger value="rollup">Rollup</TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <SalesUpload />
        </TabsContent>
        <TabsContent value="manual">
          <SalesManualEntry />
        </TabsContent>
        <TabsContent value="rollup">
          <SalesRollup />
        </TabsContent>
      </Tabs>
    </div>
  );
}
