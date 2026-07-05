import React from 'react';
import { createBrowserRouter, Navigate, RouteObject } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { RequireRole } from '@/auth/RequireRole';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Stores } from '@/pages/Stores';
import { StoreDetail } from '@/pages/StoreDetail';
import { Operations } from '@/pages/Operations';
import { Finance } from '@/pages/Finance';
import { Alerts } from '@/pages/Alerts';
import { RepeatEngine } from '@/pages/RepeatEngine';
import { ScaleSimulator } from '@/pages/ScaleSimulator';

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
        element: <RequireRole roles={['ADMIN', 'STAFF']}><Stores /></RequireRole>,
      },
      {
        path: 'stores/:id',
        element: <RequireRole roles={['ADMIN', 'STAFF']}><StoreDetail /></RequireRole>,
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
        path: 'repeat',
        element: <RequireRole roles={['ADMIN']}><RepeatEngine /></RequireRole>,
      },
      {
        path: 'simulator',
        element: <RequireRole roles={['ADMIN']}><ScaleSimulator /></RequireRole>,
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
