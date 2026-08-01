import React from 'react';
import { createBrowserRouter, Navigate, RouteObject } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { RequireRole } from '@/auth/RequireRole';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Branches } from '@/pages/Branches';
import { Operations } from '@/pages/Operations';
import { Finance } from '@/pages/Finance';
import { Tax } from '@/pages/Tax';
import { Sales } from '@/pages/Sales';
import { Alerts } from '@/pages/Alerts';
import { RepeatEngine } from '@/pages/RepeatEngine';
import { ScaleSimulator } from '@/pages/ScaleSimulator';
import { StaffManagement } from '@/pages/StaffManagement';

function RequireAuth({ children }: { children: React.ReactNode }) {
  return <RequireRole roles={['ADMIN', 'STAFF']}>{children}</RequireRole>;
}

const routes: RouteObject[] = [
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      {
        path: 'branches',
        element: <RequireRole roles={['ADMIN', 'STAFF']}><Branches /></RequireRole>,
      },
      {
        path: 'operations',
        element: <RequireRole roles={['ADMIN', 'STAFF']}><Operations /></RequireRole>,
      },
      {
        path: 'sales',
        element: <RequireRole roles={['ADMIN', 'STAFF']}><Sales /></RequireRole>,
      },
      {
        path: 'finance',
        element: <RequireRole roles={['ADMIN']}><Finance /></RequireRole>,
      },
      {
        path: 'tax',
        element: <RequireRole roles={['ADMIN']}><Tax /></RequireRole>,
      },
      {
        // Path kept as 'repeat' (legacy) — page now covers real Customers
        // CRUD (ADMIN+STAFF, branch-scoped) plus the AI segments panel
        // (ADMIN-only, gated inside the page itself).
        path: 'repeat',
        element: <RequireRole roles={['ADMIN', 'STAFF']}><RepeatEngine /></RequireRole>,
      },
      {
        path: 'simulator',
        element: <RequireRole roles={['ADMIN']}><ScaleSimulator /></RequireRole>,
      },
      {
        // ADMIN-only: real staff-account management (`/api/v1/staff/accounts`),
        // not the legacy read-only workforce-snapshot mock (`apiPaths.staff`,
        // surfaced in Operations.tsx's Insights tab), which is untouched.
        path: 'staff',
        element: <RequireRole roles={['ADMIN']}><StaffManagement /></RequireRole>,
      },
      {
        path: 'alerts',
        element: <RequireRole roles={['ADMIN', 'STAFF']}><Alerts /></RequireRole>,
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes);
