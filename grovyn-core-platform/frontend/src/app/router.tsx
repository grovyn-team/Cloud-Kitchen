import React from 'react';
import { createBrowserRouter, Navigate, RouteObject } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { RequireRole } from '@/auth/RequireRole';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Stores } from '@/pages/Stores';
import { StoreDetail } from '@/pages/StoreDetail';
import { Store } from '@/pages/Store';
import { Operations } from '@/pages/Operations';
import { Finance } from '@/pages/Finance';
import { Alerts } from '@/pages/Alerts';

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
        path: 'stores',
        element: <RequireRole roles={['ADMIN']}><Stores /></RequireRole>,
      },
      {
        path: 'stores/:id',
        element: <RequireRole roles={['ADMIN']}><StoreDetail /></RequireRole>,
      },
      {
        path: 'store',
        element: <RequireRole roles={['STAFF']}><Store /></RequireRole>,
      },
      {
        path: 'operations',
        element: <RequireRole roles={['STAFF']}><Operations /></RequireRole>,
      },
      {
        path: 'finance',
        element: <RequireRole roles={['ADMIN']}><Finance /></RequireRole>,
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
