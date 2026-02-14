import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuth } from '@/auth/AuthContext';

export function Layout() {
  const { role } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-[hsl(var(--background))]">
      <Topbar />
      <div className="flex flex-1">
        <Sidebar role={role} />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
