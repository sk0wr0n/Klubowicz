'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FullScreenLoader } from './ui';

/**
 * Strona 404 z zabezpieczeniem dla linków zapraszających:
 * jeśli serwer nie przekierował /join/KOD, przenosimy na /join/?code=KOD.
 */
export default function NotFoundRedirect() {
  const [redirecting, setRedirecting] = useState(true);

  useEffect(() => {
    const m = window.location.pathname.match(/^\/join\/([^/]+)\/?$/);
    if (m) {
      window.location.replace(`/join/?code=${encodeURIComponent(decodeURIComponent(m[1]))}`);
      return;
    }
    setRedirecting(false);
  }, []);

  if (redirecting) return <FullScreenLoader />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-bold text-indigo-600">404</p>
      <h1 className="text-xl font-semibold">Nie znaleziono strony</h1>
      <p className="text-sm text-slate-500">Ta strona nie istnieje lub link jest nieaktualny.</p>
      <Link href="/" className="btn btn-primary">
        Przejdź do aplikacji
      </Link>
    </main>
  );
}
