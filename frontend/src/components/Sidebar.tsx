import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Store, DollarSign, AlertCircle, ChefHat, Repeat, TrendingUp } from 'lucide-react';
import type { Role } from '@/types/api';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles: Role[];
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" />, roles: ['ADMIN', 'STAFF'] },
  { to: '/stores', label: 'Stores', icon: <Store className="h-5 w-5" />, roles: ['ADMIN', 'STAFF'] },
  { to: '/operations', label: 'Operations', icon: <ChefHat className="h-5 w-5" />, roles: ['STAFF'] },
  { to: '/finance', label: 'Finance', icon: <DollarSign className="h-5 w-5" />, roles: ['ADMIN'] },
  { to: '/repeat', label: 'AI Repeat Engine', icon: <Repeat className="h-5 w-5" />, roles: ['ADMIN'] },
  { to: '/simulator', label: 'Scale Simulator', icon: <TrendingUp className="h-5 w-5" />, roles: ['ADMIN'] },
  { to: '/alerts', label: 'Alerts', icon: <AlertCircle className="h-5 w-5" />, roles: ['ADMIN', 'STAFF'] },
];

export function Sidebar({ role }: { role: Role | null }) {
  const visible = role ? navItems.filter((item) => item.roles.includes(role)) : [];

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-card">
      <nav className="flex flex-1 flex-col gap-1 p-4">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
