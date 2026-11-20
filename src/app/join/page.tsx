'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Clock, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { errMsg, supabase } from '@/lib/supabase';
import { clubHref, setLastClub, setNext } from '@/lib/nav';
import { ErrorBox, FullScreenLoader } from '@/components/ui';

/** Odczyt kodu z /join/KOD (przez .htaccess) lub /join/?code=KOD */
function readCode(): string {
  const qs = new URLSearchParams(window.location.search).get('code');
  if (qs) return qs.trim();
  const m = window.location.pathname.match(/^\/join\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]).trim() : '';
}

export default function JoinPage() {
  const { ready, session, refreshMemberships } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [result, setResult] = useState<{ club_id: string; club_name: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    setCode(readCode());
  }, []);

  useEffect(() => {
    if (!ready || code === null || !session || done.current) return;
    if (!code) {
      setError('Brak kodu zaproszenia w linku.');
      return;
    }
    done.current = true;
    supabase()
      .rpc('join_club_by_code', { p_code: code })
      .then(async ({ data, error }) => {
        if (error) {
          setError(errMsg(error));
          return;
        }
        const row = (Array.isArray(data) ? data[0] : data) as { club_id: string; club_name: string; status: string };
        setResult(row);
        await refreshMemberships();
      });
  }, [ready, session, code, refreshMemberships]);

  if (!ready || code === null) return <FullScreenLoader />;

  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
        <UserPlus className="mx-auto h-12 w-12 text-indigo-600" />
        <h1 className="text-2xl font-bold">Zaproszenie do klubu</h1>
        <p className="text-slate-600">
          Zaloguj się, aby dołączyć do klubu (kod: <strong>{code || '—'}</strong>). Po zalogowaniu Właściciel klubu
          zaakceptuje Twoje zgłoszenie.
        </p>
        <Link
          href="/login/"
          className="btn btn-primary py-3"
          onClick={() => setNext(`/join/${encodeURIComponent(code)}`)}
        >
          Zaloguj się i dołącz
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
      {error && (
        <>
          <ErrorBox message={error} />
          <Link href="/" className="btn btn-secondary">
            Przejdź do aplikacji
          </Link>
        </>
      )}
      {!error && !result && <FullScreenLoader text="Dołączanie do klubu…" />}
      {result && result.status === 'pending' && (
        <>
          <Clock className="mx-auto h-12 w-12 text-amber-500" />
          <h1 className="text-2xl font-bold">Zgłoszenie wysłane</h1>
          <p className="text-slate-600">
            Twoja prośba o dołączenie do klubu <strong>{result.club_name}</strong> czeka na akceptację Właściciela klubu.
            Gdy zostanie zaakceptowana, klub pojawi się w aplikacji.
          </p>
          <Link href="/" className="btn btn-primary py-3">
            Przejdź do aplikacji
          </Link>
        </>
      )}
      {result && result.status === 'active' && (
        <>
          <CircleCheck className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="text-2xl font-bold">Jesteś już członkiem</h1>
          <p className="text-slate-600">
            Należysz do klubu <strong>{result.club_name}</strong>.
          </p>
          <Link href={clubHref(result.club_id)} onClick={() => setLastClub(result.club_id)} className="btn btn-primary py-3">
            Przejdź do treningów
          </Link>
        </>
      )}
    </main>
  );
}
