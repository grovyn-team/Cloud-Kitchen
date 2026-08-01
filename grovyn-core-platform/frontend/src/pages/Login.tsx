import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function Login() {
  const { isAuthenticated, login } = useAuth();
  const location = useLocation();
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        tenantSlug: tenantSlug.trim(),
        email: email.trim(),
        password: password.trim(),
      });
    } catch (err: unknown) {
      let msg = 'Login failed. Try again.';
      if (err && typeof err === 'object' && 'response' in err) {
        const res = (err as { response?: { status?: number; data?: { message?: string; error?: string } } }).response;
        const bodyMsg = res?.data?.message ?? res?.data?.error;
        if (bodyMsg) msg = bodyMsg;
        else if (res?.status === 503 || res?.status === 0 || res === undefined)
          msg =
            'Backend not reachable. Start the backend locally (npm run dev in grovyn-core-platform/backend) or set VITE_API_BASE_URL in .env to your deployed API and restart the dev server.';
        else if (res?.status === 401) msg = 'Invalid email or password.';
        else if (res?.status === 404) msg = 'Cannot reach server. Is the backend running?';
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
          <p className="mt-1.5 text-sm text-muted-foreground">Enter your workspace slug, email, and password.</p>
        </div>
        <CardContent className="px-6 py-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="login-tenant-slug" className="block text-sm font-medium text-foreground">
                Workspace
              </label>
              <input
                id="login-tenant-slug"
                type="text"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                placeholder="your-workspace-slug"
                required
                autoComplete="organization"
              />
            </div>
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
