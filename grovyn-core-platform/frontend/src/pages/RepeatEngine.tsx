import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import type { Store, Customer, CustomerListResponse } from '@/types/api';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

const textareaClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function errorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { message?: string; details?: string[] } } };
  const details = axiosErr.response?.data?.details;
  if (Array.isArray(details) && details.length > 0) return details.join(' ');
  return axiosErr.response?.data?.message ?? fallback;
}

/** Branch picker — shared logic (STAFF is scoped to their own branch(es)), same pattern as Sales.tsx/Operations.tsx. */
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
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Branch</label>
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

function RatingDisplay({ rating }: { rating?: number | null }) {
  if (rating == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      <span className="text-foreground">{rating}/5</span>
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Customer detail — edit form, mirrors Operations.tsx's item detail       */
/* pattern.                                                                 */
/* ---------------------------------------------------------------------- */

type EditState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string };

function CustomerDetailPanel({
  customerId,
  onClose,
  onChanged,
}: {
  customerId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api } = useAuth();
  const [detail, setDetail] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('');
  const [rating, setRating] = useState('');
  const [notes, setNotes] = useState('');
  const [editState, setEditState] = useState<EditState>({ status: 'idle' });
  const [saved, setSaved] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<Customer>(apiPaths.customerById(customerId))
      .then((r) => {
        setDetail(r.data);
        setName(r.data.name);
        setPhone(r.data.phone ?? '');
        setEmail(r.data.email ?? '');
        setCategory(r.data.category ?? '');
        setRating(r.data.rating != null ? String(r.data.rating) : '');
        setNotes(r.data.notes ?? '');
      })
      .catch(() => setError('Could not load this customer. Try again in a moment.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!name.trim()) {
      setEditState({ status: 'error', message: 'Name is required.' });
      return;
    }
    if (rating.trim() && (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) {
      setEditState({ status: 'error', message: 'Rating must be a whole number between 1 and 5.' });
      return;
    }

    setEditState({ status: 'submitting' });
    setSaved(false);
    try {
      const { data } = await api.patch<Customer>(apiPaths.customerById(detail.id), {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        category: category.trim() || null,
        rating: rating.trim() ? Number(rating) : null,
        notes: notes.trim() || null,
      });
      setEditState({ status: 'idle' });
      setDetail(data);
      setSaved(true);
      onChanged();
    } catch (err: unknown) {
      setEditState({ status: 'error', message: errorMessage(err, 'Could not save changes. Check the fields and try again.') });
    }
  }

  return (
    <Card className="rounded-2xl border border-border shadow-card">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{detail?.name ?? 'Customer detail'}</CardTitle>
          {detail && <p className="mt-0.5 text-xs text-muted-foreground">ID: {detail.id}</p>}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading customer…</p>
        ) : error ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium text-red-900">{error}</p>
          </div>
        ) : detail ? (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Phone</p>
                <p className="text-sm font-medium text-foreground">{detail.phone ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                <p className="text-sm font-medium text-foreground">{detail.email ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Category</p>
                {detail.category ? <StatusBadge variant="info">{detail.category}</StatusBadge> : <p className="text-sm text-muted-foreground">—</p>}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Rating</p>
                <RatingDisplay rating={detail.rating} />
              </div>
            </div>
            {detail.notes && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                <p className="whitespace-pre-wrap text-sm text-foreground">{detail.notes}</p>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Edit customer</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</label>
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</label>
                  <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</label>
                  <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Category</label>
                  <input
                    className={inputClass}
                    placeholder="e.g. VIP, corporate, regular…"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Rating (1–5)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    step="1"
                    className={inputClass}
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</label>
                <textarea className={textareaClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {editState.status === 'error' && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {editState.message}
                </div>
              )}
              {saved && editState.status === 'idle' && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> Changes saved.
                </div>
              )}

              <Button type="submit" size="sm" disabled={editState.status === 'submitting'}>
                {editState.status === 'submitting' ? 'Saving…' : 'Save changes'}
              </Button>
            </form>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Customers list — branch-scoped, category filter, pagination, delete,   */
/* row-expand detail panel (Operations.tsx's pattern).                    */
/* ---------------------------------------------------------------------- */

function CustomersList() {
  const { api, role, storeIds } = useAuth();
  const { available, loading: branchesLoading } = useScopedBranches();
  const [branchId, setBranchId] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [response, setResponse] = useState<CustomerListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [branchId, categoryFilter]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<CustomerListResponse>(
        apiPaths.customersList({ branchId: branchId || undefined, category: categoryFilter || undefined, page, pageSize })
      )
      .then((r) => setResponse(r.data))
      .catch(() => {
        setResponse(null);
        setError('Could not load customers. Try again in a moment.');
      })
      .finally(() => setLoading(false));
  }, [api, branchId, categoryFilter, page, refreshTick]);

  const branchNameById = useMemo(() => {
    const m: Record<string, string> = {};
    available.forEach((b) => {
      m[b.id] = b.name;
    });
    return m;
  }, [available]);

  const customers = response?.data ?? [];
  const total = response?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showBranchCol = role === 'ADMIN' && !branchId;

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await api.delete(apiPaths.customerById(id));
      setResponse((prev) => (prev ? { ...prev, data: prev.data.filter((c) => c.id !== id), meta: { ...prev.meta, total: Math.max(0, prev.meta.total - 1) } } : prev));
      if (selectedId === id) setSelectedId(null);
      setDeleteConfirmId(null);
    } catch (err: unknown) {
      setDeleteError(errorMessage(err, 'Could not delete this customer. Try again.'));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
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
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Category
              </label>
              <input
                className={`${inputClass} w-48`}
                placeholder="Filter by category…"
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setCategoryFilter(categoryInput.trim());
                }}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setCategoryFilter(categoryInput.trim())}>
              Apply
            </Button>
            {categoryFilter && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCategoryInput('');
                  setCategoryFilter('');
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
        {!loading && !error && (
          <p className="text-xs text-muted-foreground">
            {total} customer{total !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {deleteError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {deleteError}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center">
          <p className="text-muted-foreground">Loading customers…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{error}</p>
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">
            {categoryFilter ? `No customers found in category "${categoryFilter}".` : 'No customers yet. Add one to get started.'}
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
                    <th className="px-4 py-2 font-medium">Phone</th>
                    <th className="px-4 py-2 font-medium">Email</th>
                    {showBranchCol && <th className="px-4 py-2 font-medium">Branch</th>}
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 font-medium">Rating</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <Fragment key={c.id}>
                      <tr className="border-b border-border/60">
                        <td className="px-4 py-2.5 font-medium text-foreground">{c.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{c.phone ?? '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{c.email ?? '—'}</td>
                        {showBranchCol && (
                          <td className="px-4 py-2.5 text-muted-foreground">{branchNameById[c.branchId] ?? c.branchId}</td>
                        )}
                        <td className="px-4 py-2.5">
                          {c.category ? <StatusBadge variant="info">{c.category}</StatusBadge> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <RatingDisplay rating={c.rating} />
                        </td>
                        <td className="px-4 py-2.5">
                          {deleteConfirmId === c.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-red-700">Delete this customer?</span>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={deletingId === c.id}
                                onClick={() => handleDelete(c.id)}
                              >
                                {deletingId === c.id ? 'Deleting…' : 'Confirm'}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                              >
                                {selectedId === c.id ? 'Hide' : 'View'}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteConfirmId(c.id)}>
                                Delete
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  ))}
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
        <CustomerDetailPanel
          customerId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => setRefreshTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Add customer — manual entry, mirrors Operations.tsx's add-item form.   */
/* ---------------------------------------------------------------------- */

type AddState = { status: 'idle' } | { status: 'submitting' } | { status: 'success'; customer: Customer } | { status: 'error'; message: string };

function CustomerAdd() {
  const { api } = useAuth();
  const { available, loading, role } = useScopedBranches();
  const [branchId, setBranchId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('');
  const [rating, setRating] = useState('');
  const [notes, setNotes] = useState('');
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
      setFormError('Enter a customer name.');
      return;
    }
    if (rating.trim() && (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) {
      setFormError('Rating must be a whole number between 1 and 5.');
      return;
    }

    setState({ status: 'submitting' });
    try {
      const { data } = await api.post<Customer>(apiPaths.customers, {
        branchId,
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        category: category.trim() || undefined,
        rating: rating.trim() ? Number(rating) : undefined,
        notes: notes.trim() || undefined,
      });
      setState({ status: 'success', customer: data });
      setName('');
      setPhone('');
      setEmail('');
      setCategory('');
      setRating('');
      setNotes('');
    } catch (err: unknown) {
      setState({ status: 'error', message: errorMessage(err, 'Could not save this customer. Check the fields and try again.') });
    }
  }

  return (
    <Card className="rounded-2xl shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Add customer</CardTitle>
        <p className="text-sm text-muted-foreground">Category is free text (e.g. VIP, corporate, regular). Rating is optional, 1–5.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <BranchField value={branchId} onChange={setBranchId} available={available} loading={loading} role={role} />
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Customer name
              </label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Phone (optional)
              </label>
              <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Email (optional)
              </label>
              <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Category (optional)
              </label>
              <input
                className={inputClass}
                placeholder="e.g. VIP, corporate, regular…"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Rating (optional, 1–5)
              </label>
              <input type="number" min="1" max="5" step="1" className={inputClass} value={rating} onChange={(e) => setRating(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes (optional)
            </label>
            <textarea className={textareaClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {formError}
            </div>
          )}

          <Button type="submit" disabled={state.status === 'submitting'}>
            {state.status === 'submitting' ? 'Saving…' : 'Save customer'}
          </Button>
        </form>

        {state.status === 'success' && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-900">&ldquo;{state.customer.name}&rdquo; saved.</p>
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


export function RepeatEngine() {
  const [tab, setTab] = useState('customers');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Customers</h2>
        <p className="text-sm text-muted-foreground">
          Manage customers across your branch(es): view, add, edit and remove records.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="add">Add customer</TabsTrigger>
        </TabsList>

        <TabsContent value="customers">
          <CustomersList />
        </TabsContent>
        <TabsContent value="add">
          <CustomerAdd />
        </TabsContent>
      </Tabs>
    </div>
  );
}
