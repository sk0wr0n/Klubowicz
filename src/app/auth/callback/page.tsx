'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { popNext } from '@/lib/nav';
import { ErrorBox, FullScreenLoader } from '@/components/ui';

/**
 * Powrót z Google OAuth / Magic Link.
 * Klient Supabase (detectSessionInUrl + PKCE) sam wymienia ?code= na sesję podczas inicjalizacji.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const errDesc = url.searchParams.get('error_description') ?? hash.get('error_description');
    if (errDesc) {
      const raw = decodeURIComponent(errDesc.replace(/\+/g, ' '));
      setError(
        /expired|invalid/i.test(raw)
          ? 'Ten link logowania wygasł albo został już użyty. Działa tylko najnowszy link z e-maila – wróć do logowania i wyślij nowy.'
          : raw
      );
      return;
    }
    let cancelled = false;
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session) {
          router.replace(popNext() ?? '/');
        } else {
          setError(
            'Nie udało się zalogować. Link mógł wygasnąć albo został już użyty (działa tylko najnowszy link z e-maila). Wróć do logowania i wyślij nowy link.'
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!error) return <FullScreenLoader text="Logowanie…" />;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <ErrorBox message={error} />
      <Link href="/login/" className="btn btn-primary">
        Wyślij nowy link logowania
      </Link>
    </main>
  );
}
