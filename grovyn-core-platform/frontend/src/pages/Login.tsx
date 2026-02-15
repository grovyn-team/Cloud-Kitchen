import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Role } from '@/types/api';

const apiBase =
  typeof import.meta.env.VITE_API_BASE_URL === 'string' && import.meta.env.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL
    : '';

const DEMO_PASSWORD = 'grovyn@123';

const FALLBACK_DEMO_STORES: { id: string; name: string }[] = [
  { id: 'store-1', name: 'Demo Store — Downtown' },
  { id: 'store-2', name: 'Demo Store — Mall' },
  { id: 'store-3', name: 'Demo Store — Central' },
];

export function Login() {
  const { isAuthenticated, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('ADMIN');
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (role !== 'STAFF') return;
    const url = apiBase ? `${apiBase}/api/v1/auth/stores` : '/api/v1/auth/stores';
    fetch(url)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => {
        const list = (d.data ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));
        setStores(list.length > 0 ? list : FALLBACK_DEMO_STORES);
        if (list.length > 0 && !storeId) setStoreId(list[0].id);
        else if (list.length === 0 && FALLBACK_DEMO_STORES.length > 0) setStoreId(FALLBACK_DEMO_STORES[0].id);
      })
      .catch(() => {
        setStores(FALLBACK_DEMO_STORES);
        setStoreId(FALLBACK_DEMO_STORES[0]?.id ?? '');
      });
  }, [role]);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/';

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({
        email: email.trim(),
        password: password.trim(),
        role,
        ...(role === 'STAFF' && storeId ? { storeId: storeId.trim() } : {}),
      });
    } catch (err: unknown) {
      let msg = 'Login failed. Try again.';
      if (err && typeof err === 'object' && 'response' in err) {
        const res = (err as { response?: { status?: number; data?: { message?: string } } }).response;
        if (res?.data?.message) msg = res.data.message;
        else if (res?.status === 404 || res?.status === undefined)
          msg =
            'Cannot reach server. Is the backend running? Start it with: cd backend && node src/server.js';
      } else if (
        err &&
        typeof err === 'object' &&
        'message' in err &&
        typeof (err as { message: string }).message === 'string'
      )
        msg = (err as { message: string }).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-muted/20 to-slate-100 p-4 dark:from-slate-950 dark:via-slate-900/50 dark:to-slate-900">
      <Card className="w-full max-w-md overflow-hidden rounded-2xl border border-border/80 shadow-xl">
        <div className="border-b border-border/60 bg-muted/30 px-6 py-5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Admin: admin@grovyn.in · Staff: stafff@grovyn.in (choose a store). Password: grovyn@123
          </p>
        </div>
        <CardContent className="px-6 py-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="login-email" className="block text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="login-password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                placeholder="Enter password"
                required
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="login-role" className="block text-sm font-medium text-foreground">
                Role
              </label>
              <select
                id="login-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <option value="ADMIN">Admin</option>
                <option value="STAFF">Staff</option>
              </select>
            </div>
            {role === 'STAFF' && (
              <div className="space-y-2">
                <label htmlFor="login-store" className="block text-sm font-medium text-foreground">
                  Store
                </label>
                <select
                  id="login-store"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  required
                >
                  <option value="">Select store</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full rounded-lg py-2.5 font-medium transition-colors" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
