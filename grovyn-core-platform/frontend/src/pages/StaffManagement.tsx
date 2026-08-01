import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/StatusBadge';
import { apiPaths } from '@/services/api';
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import type { Store, Role, StaffAccount, StaffAccountDetail, StaffAccountListResponse, StaffBranchGrantResponse } from '@/types/api';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function errorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { message?: string; details?: string[] } } };
  const details = axiosErr.response?.data?.details;
  if (Array.isArray(details) && details.length > 0) return details.join(' ');
  return axiosErr.response?.data?.message ?? fallback;
}

/** All tenant branches — this page is ADMIN-only, so unlike Sales.tsx/Operations.tsx there's no
 * per-STAFF scoping to apply; every branch in the tenant is a valid grant/assignment target. */
function useAllBranches() {
  const { api } = useAuth();
  const [branches, setBranches] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ data: Store[] }>(apiPaths.branchesList({ pageSize: 100 }))
      .then((r) => setBranches(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => setBranches([]))
      .finally(() => setLoading(false));
  }, [api]);

  return { branches, loading };
}

function RoleBadge({ role }: { role: Role }) {
  return role === 'ADMIN' ? (
    <StatusBadge variant="info">Admin</StatusBadge>
  ) : (
    <StatusBadge variant="neutral">Staff</StatusBadge>
  );
}

/* ---------------------------------------------------------------------- */
/* Staff detail — edit name/role, manage branch assignments (grant/revoke) */
/* row-expand panel, mirrors RepeatEngine.tsx's CustomerDetailPanel.       */
/* ---------------------------------------------------------------------- */

type EditState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string };
type GrantState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string };
type RevokeState = { branchId: string; status: 'submitting' } | { branchId: string; status: 'error'; message: string } | null;

function StaffDetailPanel({
  staffId,
  onClose,
  onChanged,
}: {
  staffId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api } = useAuth();
  const { branches, loading: branchesLoading } = useAllBranches();
  const [detail, setDetail] = useState<StaffAccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('STAFF');
  const [editState, setEditState] = useState<EditState>({ status: 'idle' });
  const [saved, setSaved] = useState(false);

  const [grantBranchId, setGrantBranchId] = useState('');
  const [grantState, setGrantState] = useState<GrantState>({ status: 'idle' });
  const [revokeState, setRevokeState] = useState<RevokeState>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<StaffAccountDetail>(apiPaths.staffAccountById(staffId))
      .then((r) => {
        setDetail(r.data);
        setName(r.data.name);
        setRole(r.data.role);
      })
      .catch(() => setError('Could not load this staff account. Try again in a moment.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!name.trim()) {
      setEditState({ status: 'error', message: 'Name is required.' });
      return;
    }

    setEditState({ status: 'submitting' });
    setSaved(false);
    try {
      const { data } = await api.patch<{ id: string; email: string; name: string; role: Role }>(
        apiPaths.staffAccountById(detail.id),
        { name: name.trim(), role }
      );
      setEditState({ status: 'idle' });
      setDetail((prev) => (prev ? { ...prev, name: data.name, role: data.role } : prev));
      setSaved(true);
      onChanged();
    } catch (err: unknown) {
      setEditState({ status: 'error', message: errorMessage(err, 'Could not save changes. Check the fields and try again.') });
    }
  }

  const unassignedBranches = useMemo(() => {
    if (!detail) return [];
    const assignedIds = new Set(detail.branchAssignments.map((a) => a.branchId));
    return branches.filter((b) => !assignedIds.has(b.id));
  }, [branches, detail]);

  async function handleGrant() {
    if (!detail || !grantBranchId) return;
    setGrantState({ status: 'submitting' });
    try {
      const { data } = await api.post<StaffBranchGrantResponse>(apiPaths.staffAccountBranches(detail.id), {
        branchId: grantBranchId,
      });
      const branch = branches.find((b) => b.id === data.branchId);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              branchAssignments: [
                ...prev.branchAssignments.filter((a) => a.branchId !== data.branchId),
                { id: data.id, branchId: data.branchId, branchName: branch?.name ?? data.branchId, grantedAt: data.grantedAt },
              ],
            }
          : prev
      );
      setGrantBranchId('');
      setGrantState({ status: 'idle' });
      onChanged();
    } catch (err: unknown) {
      setGrantState({ status: 'error', message: errorMessage(err, 'Could not grant branch access. Try again.') });
    }
  }

  async function handleRevoke(branchId: string) {
    if (!detail) return;
    setRevokeState({ branchId, status: 'submitting' });
    try {
      await api.delete(apiPaths.staffAccountBranchById(detail.id, branchId));
      setDetail((prev) =>
        prev ? { ...prev, branchAssignments: prev.branchAssignments.filter((a) => a.branchId !== branchId) } : prev
      );
      setRevokeState(null);
      onChanged();
    } catch (err: unknown) {
      setRevokeState({ branchId, status: 'error', message: errorMessage(err, 'Could not revoke branch access. Try again.') });
    }
  }

  return (
    <Card className="rounded-2xl border border-border shadow-card">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{detail?.name ?? 'Staff detail'}</CardTitle>
          {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail.email}</p>}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading staff account…</p>
        ) : error ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium text-red-900">{error}</p>
          </div>
        ) : detail ? (
          <>
            <form onSubmit={handleSave} className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Edit account</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</label>
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</label>
                  <input className={inputClass} value={detail.email} disabled />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Role</label>
                  <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    <option value="STAFF">Staff</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
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

            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Branch assignments</p>

              {detail.branchAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No branches assigned yet.</p>
              ) : (
                <div className="space-y-2">
                  {detail.branchAssignments.map((a) => (
                    <div
                      key={a.branchId}
                      className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2"
                    >
                      <span className="text-sm font-medium text-foreground">{a.branchName}</span>
                      <div className="flex items-center gap-2">
                        {revokeState?.branchId === a.branchId && revokeState.status === 'error' && (
                          <span className="text-xs text-red-700">{revokeState.message}</span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={revokeState?.branchId === a.branchId && revokeState.status === 'submitting'}
                          onClick={() => handleRevoke(a.branchId)}
                        >
                          {revokeState?.branchId === a.branchId && revokeState.status === 'submitting' ? 'Revoking…' : 'Revoke'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2 pt-1">
                <div className="w-64">
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Grant access to branch
                  </label>
                  <select
                    className={inputClass}
                    value={grantBranchId}
                    onChange={(e) => setGrantBranchId(e.target.value)}
                    disabled={branchesLoading || unassignedBranches.length === 0}
                  >
                    <option value="">
                      {branchesLoading
                        ? 'Loading branches…'
                        : unassignedBranches.length === 0
                          ? 'All branches already assigned'
                          : 'Select branch…'}
                    </option>
                    {unassignedBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!grantBranchId || grantState.status === 'submitting'}
                  onClick={handleGrant}
                >
                  {grantState.status === 'submitting' ? 'Granting…' : 'Grant'}
                </Button>
              </div>
              {grantState.status === 'error' && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {grantState.message}
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
/* Staff list — table, pagination, deactivate (confirm-then-delete), row- */
/* expand detail panel (RepeatEngine.tsx's pattern).                      */
/* ---------------------------------------------------------------------- */

function StaffList() {
  const { api, user } = useAuth();
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [response, setResponse] = useState<StaffAccountListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deactivateConfirmId, setDeactivateConfirmId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<StaffAccountListResponse>(apiPaths.staffAccountsList({ page, pageSize }))
      .then((r) => setResponse(r.data))
      .catch(() => {
        setResponse(null);
        setError('Could not load staff accounts. Try again in a moment.');
      })
      .finally(() => setLoading(false));
  }, [api, page, refreshTick]);

  const accounts = response?.data ?? [];
  const total = response?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function handleDeactivate(id: string) {
    setDeactivatingId(id);
    setDeactivateError(null);
    try {
      await api.delete(apiPaths.staffAccountById(id));
      setResponse((prev) =>
        prev
          ? { ...prev, data: prev.data.filter((s) => s.id !== id), meta: { ...prev.meta, total: Math.max(0, prev.meta.total - 1) } }
          : prev
      );
      if (selectedId === id) setSelectedId(null);
      setDeactivateConfirmId(null);
    } catch (err: unknown) {
      // Surfaces the backend's last-admin guard message verbatim (e.g. "Cannot
      // deactivate your own account: you are the last active ADMIN…") rather
      // than a generic failure — this is the one deactivate error users will
      // actually hit in practice.
      setDeactivateError(errorMessage(err, 'Could not deactivate this account. Try again.'));
    } finally {
      setDeactivatingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {!loading && !error && `${total} staff account${total !== 1 ? 's' : ''}`}
        </p>
      </div>

      {deactivateError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {deactivateError}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center">
          <p className="text-muted-foreground">Loading staff accounts…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-900">{error}</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <p className="text-muted-foreground">No staff accounts yet. Add one to get started.</p>
        </div>
      ) : (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Active branches</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((s) => (
                    <Fragment key={s.id}>
                      <tr className="border-b border-border/60">
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {s.name}
                          {user?.userId === s.id && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{s.email}</td>
                        <td className="px-4 py-2.5">
                          <RoleBadge role={s.role} />
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{s.activeBranchCount}</td>
                        <td className="px-4 py-2.5">
                          {deactivateConfirmId === s.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-red-700">Deactivate this account?</span>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={deactivatingId === s.id}
                                onClick={() => handleDeactivate(s.id)}
                              >
                                {deactivatingId === s.id ? 'Deactivating…' : 'Confirm'}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => setDeactivateConfirmId(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}
                              >
                                {selectedId === s.id ? 'Hide' : 'View'}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => setDeactivateConfirmId(s.id)}>
                                Deactivate
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
        <StaffDetailPanel
          staffId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => setRefreshTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Add staff account — create form with optional initial branch grants.   */
/* ---------------------------------------------------------------------- */

type AddState = { status: 'idle' } | { status: 'submitting' } | { status: 'success'; account: StaffAccount } | { status: 'error'; message: string };

function StaffAdd() {
  const { api } = useAuth();
  const { branches, loading: branchesLoading } = useAllBranches();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('STAFF');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [state, setState] = useState<AddState>({ status: 'idle' });
  const [formError, setFormError] = useState<string | null>(null);

  function toggleBranch(id: string) {
    setBranchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!email.trim()) {
      setFormError('Enter an email address.');
      return;
    }
    if (!name.trim()) {
      setFormError('Enter a name.');
      return;
    }
    if (!password) {
      setFormError('Enter a password.');
      return;
    }

    setState({ status: 'submitting' });
    try {
      const { data } = await api.post<StaffAccount>(apiPaths.staffAccounts, {
        email: email.trim(),
        name: name.trim(),
        password,
        role,
        branchIds,
      });
      setState({ status: 'success', account: data });
      setEmail('');
      setName('');
      setPassword('');
      setRole('STAFF');
      setBranchIds([]);
    } catch (err: unknown) {
      setState({ status: 'error', message: errorMessage(err, 'Could not create this account. Check the fields and try again.') });
    }
  }

  return (
    <Card className="rounded-2xl shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Add staff account</CardTitle>
        <p className="text-sm text-muted-foreground">
          Create an Admin or Staff login. Branch access can be granted now or later from the account's detail view.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</label>
              <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Password</label>
              <input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Role</label>
              <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Initial branch access (optional)
            </label>
            {branchesLoading ? (
              <p className="text-sm text-muted-foreground">Loading branches…</p>
            ) : branches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No branches available yet.</p>
            ) : (
              <div className="grid max-h-40 gap-2 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary"
                      checked={branchIds.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <XCircle className="h-4 w-4 shrink-0 text-red-600" /> {formError}
            </div>
          )}

          <Button type="submit" disabled={state.status === 'submitting'}>
            {state.status === 'submitting' ? 'Creating…' : 'Create account'}
          </Button>
        </form>

        {state.status === 'success' && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-900">&ldquo;{state.account.name}&rdquo; created.</p>
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

export function StaffManagement() {
  const [tab, setTab] = useState('accounts');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-xl font-semibold text-foreground">Staff management</h2>
          <p className="text-sm text-muted-foreground">
            Create and manage Admin/Staff logins and their branch access. Admin-only.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="add">Add account</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
          <StaffList />
        </TabsContent>
        <TabsContent value="add">
          <StaffAdd />
        </TabsContent>
      </Tabs>
    </div>
  );
}
