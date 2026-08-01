import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { MetricCard } from '@/components/MetricCard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiPaths } from '@/services/api';
import { AlertTriangle, Download, XCircle, Loader2, CheckCircle2, Settings } from 'lucide-react';
import type { Store, TaxSummary } from '@/types/api';

const inputClass =
  'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/**
 * Integration Task 2, round 3 — the missing piece that makes the effective-
 * dated GST model (round 2) reachable by an admin at all: without this form,
 * a tenant's rate could only ever be set by direct SQL. Setting a new rate
 * closes whichever rate is currently open as of the chosen date and opens
 * this one (`POST /api/v1/tax/rates`, `gstRateService.setEffectiveGstRate`).
 */
function SetGstRateForm({ onChanged }: { onChanged: () => void }) {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [ratePercent, setRatePercent] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [state, setState] = useState<{ status: 'idle' | 'submitting' | 'success' | 'error'; message?: string }>({
    status: 'idle',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const rate = Number(ratePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setState({ status: 'error', message: 'Rate must be a number between 0 and 100.' });
      return;
    }
    setState({ status: 'submitting' });
    try {
      await api.post(apiPaths.taxRates, { ratePercent: rate, effectiveFrom });
      setState({ status: 'success' });
      setRatePercent('');
      onChanged();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setState({ status: 'error', message: axiosErr.response?.data?.message ?? 'Could not set the new rate.' });
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Settings className="h-4 w-4" /> Set GST rate
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            New rate (%)
          </label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            className={`${inputClass} w-28`}
            value={ratePercent}
            onChange={(e) => setRatePercent(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Effective from
          </label>
          <input
            type="date"
            className={inputClass}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={state.status === 'submitting'}>
          {state.status === 'submitting' ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </form>
      {state.status === 'success' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> New rate saved, effective {effectiveFrom}.
        </p>
      )}
      {state.status === 'error' && <p className="mt-2 text-xs text-red-700">{state.message}</p>}
    </div>
  );
}

/** First day of the current month, `YYYY-MM-DD`. */
function defaultPeriodStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

/** Today, `YYYY-MM-DD`. */
function defaultPeriodEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Tax() {
  const { api, role } = useAuth();
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<Store[]>([]);
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // This page is ADMIN-only (backend 403s STAFF, and the route is already
  // gated with `RequireRole roles={['ADMIN']}` in router.tsx). This is a
  // defense-in-depth check so the page never fetches tax data for a
  // non-ADMIN session even if reached some other way.
  const isAdmin = role === 'ADMIN';

  const rangeInvalid = periodStart > periodEnd;

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<{ data: Store[] }>(apiPaths.branchesList({ pageSize: 100 }))
      .then((r) => setBranches(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => setBranches([]));
  }, [api, isAdmin]);

  useEffect(() => {
    if (!isAdmin || rangeInvalid) return;
    setLoading(true);
    setError(null);
    api
      .get<TaxSummary>(apiPaths.taxSummary({ branchId: branchId || undefined, periodStart, periodEnd }))
      .then((r) => setSummary(r.data))
      .catch(() => {
        setSummary(null);
        setError('Could not load the tax summary. Try again in a moment.');
      })
      .finally(() => setLoading(false));
  }, [api, isAdmin, branchId, periodStart, periodEnd, rangeInvalid, refreshTick]);

  const branchNameById = useMemo(() => {
    const m: Record<string, string> = {};
    branches.forEach((b) => {
      m[b.id] = b.name;
    });
    return m;
  }, [branches]);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const response = await api.get(
        apiPaths.taxExport({ branchId: branchId || undefined, periodStart, periodEnd, format: 'csv' }),
        { responseType: 'blob' }
      );
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const branchSlug = branchId ? branchNameById[branchId] ?? branchId : 'all-branches';
      a.href = url;
      a.download = `gst-${branchSlug}-${periodStart}_to_${periodEnd}.csv`.replace(/\s+/g, '-');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Could not export the CSV. Try again in a moment.');
    } finally {
      setExporting(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 rounded-xl bg-card p-8 shadow-card">
        <p className="font-medium text-foreground">Access denied.</p>
        <p className="text-sm text-muted-foreground">You don’t have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Tax (GST)</h2>
          <p className="text-sm text-muted-foreground">
            GST summary computed from recorded sales, for a branch and date range.
          </p>
        </div>
        <SetGstRateForm onChanged={() => setRefreshTick((t) => t + 1)} />
        <div className="flex flex-wrap items-end gap-3">
          <select className={cn('w-56', inputClass)} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                From
              </label>
              <input
                type="date"
                className={inputClass}
                value={periodStart}
                max={periodEnd}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                To
              </label>
              <input
                type="date"
                className={inputClass}
                value={periodEnd}
                min={periodStart}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleExport}
            disabled={exporting || rangeInvalid || loading || !summary}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export CSV
          </Button>
        </div>
      </div>

      {/* Compliance disclaimer — mandatory, persistent, not dismissible (D-007). */}
      {summary?.disclaimer && (
        <div className="flex items-start gap-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Not a certified filing</p>
            <p className="text-sm text-amber-900">{summary.disclaimer}</p>
          </div>
        </div>
      )}

      {exportError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{exportError}</p>
        </div>
      )}

      {rangeInvalid ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">
            The "From" date must be on or before the "To" date.
          </p>
        </div>
      ) : loading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{error}</p>
        </div>
      ) : !summary ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">No tax data available for this range.</p>
        </div>
      ) : summary.totalSaleCount === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">
            No sales recorded for {branchId ? branchNameById[branchId] ?? 'this branch' : 'any branch'} between{' '}
            {summary.periodStart} and {summary.periodEnd}.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              title="Taxable amount"
              value={`₹${Number(summary.totalTaxableAmount).toLocaleString()}`}
              subtitle={`${summary.periodStart} to ${summary.periodEnd}`}
            />
            <MetricCard
              title="Tax amount (GST)"
              value={`₹${Number(summary.totalTaxAmount).toLocaleString()}`}
              subtitle={
                summary.rates.length > 1
                  ? `across ${summary.rates.length} GST rates in this period`
                  : `at ${summary.rates[0]?.gstRate ?? 0}% GST rate`
              }
            />
            <MetricCard
              title="Sales counted"
              value={summary.totalSaleCount.toLocaleString()}
              subtitle={branchId ? branchNameById[branchId] ?? 'Selected branch' : 'All branches'}
            />
          </div>

          {/* One row per distinct GST rate actually in force during this window
              — a mid-period rate change shows as multiple rows, by design
              (Integration Task 4): never collapsed into one blended figure. */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">GST rate</th>
                  <th className="px-4 py-2 font-medium">Taxable amount</th>
                  <th className="px-4 py-2 font-medium">Tax amount</th>
                  <th className="px-4 py-2 font-medium">Sales</th>
                </tr>
              </thead>
              <tbody>
                {summary.rates.map((r) => (
                  <tr key={r.gstRate} className="border-b border-border/60">
                    <td className="px-4 py-2.5 font-medium text-foreground">{r.gstRate}%</td>
                    <td className="px-4 py-2.5">₹{Number(r.taxableAmount).toLocaleString()}</td>
                    <td className="px-4 py-2.5">₹{Number(r.taxAmount).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.saleCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
