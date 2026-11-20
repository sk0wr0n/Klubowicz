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
      setError(decodeURIComponent(errDesc.replace(/\+/g, ' ')));
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
            'Nie udało się zalogować. Link mógł wygasnąć albo został otwarty w innej przeglądarce niż ta, w której o niego poproszono. Wróć do logowania i użyj kodu z e-maila lub wyślij nowy link.'
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
        Wróć do logowania
      </Link>
    </main>
  );
}
