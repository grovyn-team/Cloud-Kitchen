import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { apiPaths } from '@/services/api';
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, Building2 } from 'lucide-react';

/**
 * P1-06 frontend (Integration Task 1) — real Branch management page.
 * Supersedes the legacy `Stores.tsx`/`StoreDetail.tsx` mock store-health
 * pages (deleted — see `routes/v1/index.js`'s top doc comment for why: no
 * real per-branch health/insight data source exists or is planned). ADMIN
 * gets full CRUD; STAFF gets a read-only list scoped server-side to their
 * assigned branches. Reuses `StaffManagement.tsx`'s list/row-expand/add-tab
 * pattern (`Branch` list meta shape matches `StaffAccountListResponse`'s).
 */

interface Branch {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  openingHours: string | null;
  timezone: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface BranchListResponse {
  data: Branch[];
  meta: { page: number; pageSize: number; total: number };
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function errorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { message?: string; details?: string[] } } };
  const details = axiosErr.response?.data?.details;
  if (Array.isArray(details) && details.length > 0) return details.join(' ');
  return axiosErr.response?.data?.message ?? fallback;
}

type FormFields = {
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  openingHours: string;
  timezone: string;
};

const emptyFields: FormFields = {
  name: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  phone: '',
  openingHours: '',
  timezone: '',
};

function toPayload(fields: FormFields) {
  return {
    name: fields.name.trim(),
    address: fields.address.trim() || null,
    city: fields.city.trim() || null,
    state: fields.state.trim() || null,
    postalCode: fields.postalCode.trim() || null,
    phone: fields.phone.trim() || null,
    openingHours: fields.openingHours.trim() || null,
    timezone: fields.timezone.trim() || null,
  };
}

function BranchFields({
  fields,
  onChange,
}: {
  fields: FormFields;
  onChange: (next: FormFields) => void;
}) {
  const set = (key: keyof FormFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...fields, [key]: e.target.value });

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</label>
        <input className={inputClass} value={fields.name} onChange={set('name')} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</label>
        <input className={inputClass} value={fields.phone} onChange={set('phone')} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Timezone</label>
        <input className={inputClass} value={fields.timezone} onChange={set('timezone')} placeholder="Asia/Kolkata" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Address</label>
        <input className={inputClass} value={fields.address} onChange={set('address')} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">City</label>
        <input className={inputClass} value={fields.city} onChange={set('city')} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">State</label>
        <input className={inputClass} value={fields.state} onChange={set('state')} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Postal code
        </label>
        <input className={inputClass} value={fields.postalCode} onChange={set('postalCode')} />
      </div>
      <div className="sm:col-span-3">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Opening hours
        </label>
        <input
          className={inputClass}
          value={fields.openingHours}
          onChange={set('openingHours')}
          placeholder="Mon-Sat 09:00-22:00, Sun closed"
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Branch detail — inline edit, ADMIN-only. Row-expand panel, mirrors      */
/* StaffManagement.tsx's StaffDetailPanel.                                 */
/* ---------------------------------------------------------------------- */

type EditState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string };

function BranchDetailPanel({
  branch,
  onClose,
  onSaved,
}: {
  branch: Branch;
  onClose: () => void;
  onSaved: (updated: Branch) => void;
}) {
  const { api } = useAuth();
  const [fields, setFields] = useState<FormFields>({
    name: branch.name,
    address: branch.address ?? '',
    city: branch.city ?? '',
    state: branch.state ?? '',
    postalCode: branch.postalCode ?? '',
    phone: branch.phone ?? '',
    openingHours: branch.openingHours ?? '',
    timezone: branch.timezone ?? '',
  });
  const [editState, setEditState] = useState<EditState>({ status: 'idle' });
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!fields.name.trim()) {
      setEditState({ status: 'error', message: 'Name is required.' });
      return;
    }
    setEditState({ status: 'submitting' });
    setSaved(false);
    try {
      const { data } = await api.patch<Branch>(apiPaths.branchById(branch.id), toPayload(fields));
      setEditState({ status: 'idle' });
      setSaved(true);
      onSaved(data);
    } catch (err: unknown) {
      setEditState({ status: 'error', message: errorMessage(err, 'Could not save changes. Check the fields and try again.') });
    }
  }

  return (
    <Card className="rounded-2xl border border-border shadow-card">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <CardTitle className="text-base">{branch.name}</CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <BranchFields fields={fields} onChange={setFields} />

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
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Branch list — table, pagination. ADMIN: edit/delete + row-expand detail */
/* panel. STAFF: read-only list of their assigned branches, no actions.    */
/* ---------------------------------------------------------------------- */

function BranchList() {
  const { api, role } = useAuth();
  const isAdmin = role === 'ADMIN';
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [response, setResponse] = useState<BranchListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<BranchListResponse>(apiPaths.branchesList({ page, pageSize }))
      .then((r) => setResponse(r.data))
      .catch(() => {
        setResponse(null);
        setError('Could not load branches. Try again in a moment.');
      })
      .finally(() => setLoading(false));
  }, [api, page, refreshTick]);

  const branches = response?.data ?? [];
  const total = response?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await api.delete(apiPaths.branchById(id));
      setResponse((prev) =>
        prev
          ? { ...prev, data: prev.data.filter((b) => b.id !== id), meta: { ...prev.meta, total: Math.max(0, prev.meta.total - 1) } }
          : prev
      );
      if (selectedId === id) setSelectedId(null);
      setDeleteConfirmId(null);
    } catch (err: unknown) {
      setDeleteError(errorMessage(err, 'Could not delete this branch. Try again.'));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {!loading && !error && `${total} branch${total !== 1 ? 'es' : ''}`}
      </p>

      {deleteError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {deleteError}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center">
          <p className="text-muted-foreground">Loading branches…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{error}</p>
        </div>
      ) : branches.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">
            {isAdmin ? 'No branches yet. Add one to get started.' : 'You are not assigned to any branch yet.'}
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
                    <th className="px-4 py-2 font-medium">City</th>
                    <th className="px-4 py-2 font-medium">Phone</th>
                    {isAdmin && <th className="px-4 py-2 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b) => (
                    <Fragment key={b.id}>
                      <tr className="border-b border-border/60">
                        <td className="px-4 py-2.5 font-medium text-foreground">{b.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{b.city ?? '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{b.phone ?? '—'}</td>
                        {isAdmin && (
                          <td className="px-4 py-2.5">
                            {deleteConfirmId === b.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-red-700">Delete this branch?</span>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  disabled={deletingId === b.id}
                                  onClick={() => handleDelete(b.id)}
                                >
                                  {deletingId === b.id ? 'Deleting…' : 'Confirm'}
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
                                  onClick={() => setSelectedId(selectedId === b.id ? null : b.id)}
                                >
                                  {selectedId === b.id ? 'Hide' : 'Edit'}
                                </Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteConfirmId(b.id)}>
                                  Delete
                                </Button>
                              </div>
                            )}
                          </td>
                        )}
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

      {isAdmin && selectedId && (
        <BranchDetailPanel
          branch={branches.find((b) => b.id === selectedId) as Branch}
          onClose={() => setSelectedId(null)}
          onSaved={() => setRefreshTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Add branch — create form. ADMIN-only.                                  */
/* ---------------------------------------------------------------------- */

type AddState = { status: 'idle' } | { status: 'submitting' } | { status: 'success'; branch: Branch } | { status: 'error'; message: string };

function BranchAdd() {
  const { api } = useAuth();
  const [fields, setFields] = useState<FormFields>(emptyFields);
  const [state, setState] = useState<AddState>({ status: 'idle' });
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!fields.name.trim()) {
      setFormError('Enter a branch name.');
      return;
    }
    setState({ status: 'submitting' });
    try {
      const { data } = await api.post<Branch>(apiPaths.branches, toPayload(fields));
      setState({ status: 'success', branch: data });
      setFields(emptyFields);
    } catch (err: unknown) {
      setState({ status: 'error', message: errorMessage(err, 'Could not create this branch. Check the fields and try again.') });
    }
  }

  return (
    <Card className="rounded-2xl shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Add branch</CardTitle>
        <p className="text-sm text-muted-foreground">Only the name is required — fill in the rest now or later.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          <BranchFields fields={fields} onChange={setFields} />

          {formError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {formError}
            </div>
          )}

          <Button type="submit" disabled={state.status === 'submitting'}>
            {state.status === 'submitting' ? 'Creating…' : 'Create branch'}
          </Button>
        </form>

        {state.status === 'success' && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-900">&ldquo;{state.branch.name}&rdquo; created.</p>
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

export function Branches() {
  const { role } = useAuth();
  const isAdmin = role === 'ADMIN';
  const [tab, setTab] = useState('list');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-xl font-semibold text-foreground">Branches</h2>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? 'Create and manage your branches.' : 'Branches you have access to.'}
          </p>
        </div>
      </div>

      {isAdmin ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="list">Branches</TabsTrigger>
            <TabsTrigger value="add">Add branch</TabsTrigger>
          </TabsList>
          <TabsContent value="list">
            <BranchList />
          </TabsContent>
          <TabsContent value="add">
            <BranchAdd />
          </TabsContent>
        </Tabs>
      ) : (
        <BranchList />
      )}
    </div>
  );
}
