import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Building2, DollarSign, AlertCircle, ChefHat, Users, TrendingUp, Receipt, UserCog, Percent } from 'lucide-react';
import type { Role } from '@/types/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth/AuthContext';
import { apiPaths } from '@/services/api';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles: Role[];
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" />, roles: ['ADMIN', 'STAFF'] },
  { to: '/branches', label: 'Branches', icon: <Building2 className="h-5 w-5" />, roles: ['ADMIN', 'STAFF'] },
  { to: '/sales', label: 'Sales', icon: <Receipt className="h-5 w-5" />, roles: ['ADMIN', 'STAFF'] },
  { to: '/operations', label: 'Operations', icon: <ChefHat className="h-5 w-5" />, roles: ['ADMIN', 'STAFF'] },
  { to: '/finance', label: 'Finance', icon: <DollarSign className="h-5 w-5" />, roles: ['ADMIN'] },
  { to: '/tax', label: 'Tax (GST)', icon: <Percent className="h-5 w-5" />, roles: ['ADMIN'] },
  { to: '/repeat', label: 'Customers', icon: <Users className="h-5 w-5" />, roles: ['ADMIN', 'STAFF'] },
  { to: '/simulator', label: 'Scale Simulator', icon: <TrendingUp className="h-5 w-5" />, roles: ['ADMIN'] },
  { to: '/staff', label: 'Staff', icon: <UserCog className="h-5 w-5" />, roles: ['ADMIN'] },
  { to: '/alerts', label: 'Alerts', icon: <AlertCircle className="h-5 w-5" />, roles: ['ADMIN', 'STAFF'] },
];

/** Poll interval for the sidebar's unread-notification badge. Simple
 * fetch-on-mount + interval, per task scope — no websockets. */
const UNREAD_POLL_MS = 60_000;

function useUnreadNotificationCount(enabled: boolean) {
  const { api } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    function fetchCount() {
      api
        .get<{ count: number }>(apiPaths.notificationsUnreadCount())
        .then((r) => {
          if (!cancelled) setCount(r.data?.count ?? 0);
        })
        .catch(() => {
          /* badge is non-critical — silently keep last known count */
        });
    }

    fetchCount();
    const interval = setInterval(fetchCount, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api, enabled]);

  return count;
}

export function Sidebar({ role }: { role: Role | null }) {
  const visible = role ? navItems.filter((item) => item.roles.includes(role)) : [];
  const unreadCount = useUnreadNotificationCount(!!role);

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-card">
      <nav className="flex flex-1 flex-col gap-1 p-4">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            <span className="flex items-center gap-3">
              {item.icon}
              {item.label}
            </span>
            {item.to === '/alerts' && unreadCount > 0 && (
              <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
