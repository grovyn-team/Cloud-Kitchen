import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export function Topbar() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background px-6">
      <h1 className="text-lg font-semibold text-foreground">Grovyn Core Platform</h1>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {user?.role === 'ADMIN' ? 'Admin' : 'Staff'}
          {user?.storeIds?.length ? ` · ${user.storeIds.length} store(s)` : ''}
        </span>
        <Button variant="ghost" size="sm" onClick={logout} className="gap-2">
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </header>
  );
}
