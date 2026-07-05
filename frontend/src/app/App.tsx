import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthContext';
import { router } from './router';
import { applySiteBranding } from '@/config/site';
import '@/index.css';

export default function App() {
  useEffect(() => {
    applySiteBranding();
  }, []);

  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
