'use client';

import { useEffect, type ReactNode } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ToastProvider } from './Toast';
import { FullScreenLoader } from './ui';

function ConfigGate({ children }: { children: ReactNode }) {
  const { configured } = useAuth();
  if (configured === null) return <FullScreenLoader />;
  if (!configured) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-bold text-slate-900">Aplikacja nie jest jeszcze skonfigurowana</h1>
        <p className="text-slate-600">
          Uzupełnij plik <code className="rounded bg-slate-100 px-1">config.js</code> w głównym katalogu strony
          (na serwerze OVH: katalog <code className="rounded bg-slate-100 px-1">www</code>) – wpisz Project URL oraz
          klucz <em>Publishable</em> (sb_publishable_…) z Supabase (Project Settings → API Keys).
        </p>
        <p className="text-sm text-slate-500">Szczegóły: docs/DEPLOY_OVH_SUPABASE.md, krok 3.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <ServiceWorkerRegistrar />
        <ConfigGate>{children}</ConfigGate>
      </AuthProvider>
    </ToastProvider>
  );
}
