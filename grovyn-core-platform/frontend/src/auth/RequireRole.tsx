import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@/types/api';
import { useAuth } from './AuthContext';

interface RequireRoleProps {
  children: React.ReactNode;
  roles: Role | Role[];
  fallback?: React.ReactNode;
}

const allowed = (userRole: Role, allowedRoles: Role | Role[]): boolean =>
  Array.isArray(allowedRoles) ? allowedRoles.includes(userRole) : allowedRoles === userRole;

export function RequireRole({ children, roles, fallback }: RequireRoleProps) {
  const { isAuthenticated, role } = useAuth();
  const location = useLocation();

  if (!isAuthenticated || !role) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!allowed(role, roles)) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-xl bg-card p-8 shadow-card">
        <p className="text-muted-foreground">You don’t have access to this page.</p>
      </div>
    );
  }

  return <>{children}</>;
}
