'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarDays, CircleCheck, Clock, Ticket, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { errMsg, supabase } from '@/lib/supabase';
import { clubHref, setLastClub, setNext } from '@/lib/nav';
import { money } from '@/lib/format';
import type { BillingMode } from '@/lib/types';
import { ErrorBox, FullScreenLoader, Spinner } from '@/components/ui';
import { PositionPicker } from '@/components/Position';
import type { Position } from '@/lib/positions';

/** Odczyt kodu z /join/KOD (przez .htaccess / _redirects) lub /join/?code=KOD */
function readCode(): string {
  const qs = new URLSearchParams(window.location.search).get('code');
  if (qs) return qs.trim();
  const m = window.location.pathname.match(/^\/join\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]).trim() : '';
}

interface InviteInfo {
  club_id: string;
  club_name: string;
  monthly_fee_amount: number;
  single_training_fee_amount: number;
  my_status: 'pending' | 'active' | 'removed' | null;
}

export default function JoinPage() {
  const { ready, session, refreshMemberships } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [mode, setMode] = useState<BillingMode | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ club_id: string; club_name: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCode(readCode());
  }, []);

  // Po zalogowaniu: pobierz informacje o klubie (nazwa, stawki) i ewentualny istniejący status
  useEffect(() => {
    if (!ready || code === null || !session) return;
    if (!code) {
      setError('Brak kodu zaproszenia w linku.');
      return;
    }
    supabase()
      .rpc('invite_info', { p_code: code })
      .then(({ data, error }) => {
        if (error) {
          setError(errMsg(error));
          return;
        }
        const row = (Array.isArray(data) ? data[0] : data) as InviteInfo | undefined;
        if (!row) {
          setError('Nieprawidłowy lub nieaktualny link zapraszający.');
          return;
        }
        setInfo(row);
        if (row.my_status === 'pending' || row.my_status === 'active') {
          setResult({ club_id: row.club_id, club_name: row.club_name, status: row.my_status });
        }
      });
  }, [ready, session, code]);

  async function join() {
    if (!code || !mode || !position) return;
    setBusy(true);
    const { data, error } = await supabase().rpc('join_club_by_code', {
      p_code: code,
      p_billing_mode: mode,
      p_position: position,
    });
    setBusy(false);
    if (error) {
      setError(errMsg(error));
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { club_id: string; club_name: string; status: string };
    setResult(row);
    await refreshMemberships();
  }

  if (!ready || code === null) return <FullScreenLoader />;

  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
        <UserPlus className="mx-auto h-12 w-12 text-indigo-600" />
        <h1 className="text-2xl font-bold">Zaproszenie do klubu</h1>
        <p className="text-slate-600">
          Zaloguj się, aby dołączyć do klubu (kod: <strong>{code || '—'}</strong>). Po zalogowaniu wybierzesz sposób
          rozliczeń, a Właściciel klubu zaakceptuje Twoje zgłoszenie.
        </p>
        <Link
          href="/login/"
          className="btn btn-primary py-3"
          onClick={() => setNext(`/join/?code=${encodeURIComponent(code)}`)}
        >
          Zaloguj się i dołącz
        </Link>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
        <ErrorBox message={error} />
        <Link href="/" className="btn btn-secondary">
          Przejdź do aplikacji
        </Link>
      </main>
    );
  }

  if (result?.status === 'pending') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
        <Clock className="mx-auto h-12 w-12 text-amber-500" />
        <h1 className="text-2xl font-bold">Zgłoszenie wysłane</h1>
        <p className="text-slate-600">
          Twoja prośba o dołączenie do klubu <strong>{result.club_name}</strong> czeka na akceptację Właściciela klubu.
          Gdy zostanie zaakceptowana, klub pojawi się w aplikacji.
        </p>
        <p className="text-sm text-slate-500">Sposób rozliczeń możesz później zmienić w zakładce „Finanse”.</p>
        <Link href="/" className="btn btn-primary py-3">
          Przejdź do aplikacji
        </Link>
      </main>
    );
  }

  if (result?.status === 'active') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
        <CircleCheck className="mx-auto h-12 w-12 text-emerald-500" />
        <h1 className="text-2xl font-bold">Jesteś już członkiem</h1>
        <p className="text-slate-600">
          Należysz do klubu <strong>{result.club_name}</strong>.
        </p>
        <Link href={clubHref(result.club_id)} onClick={() => setLastClub(result.club_id)} className="btn btn-primary py-3">
          Przejdź do treningów
        </Link>
      </main>
    );
  }

  if (!info) return <FullScreenLoader text="Wczytywanie zaproszenia…" />;

  const options: { key: BillingMode; icon: typeof Ticket; title: string; price: string; desc: string }[] = [
    {
      key: 'per_session',
      icon: Ticket,
      title: 'Płatność za trening',
      price: `${money(info.single_training_fee_amount)} / trening`,
      desc: 'Płacisz tylko za treningi, na których faktycznie byłeś.',
    },
    {
      key: 'monthly',
      icon: CalendarDays,
      title: 'Abonament miesięczny',
      price: `${money(info.monthly_fee_amount)} / miesiąc`,
      desc: 'Stała opłata co miesiąc – treningi bez dodatkowych opłat.',
    },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <div className="text-center">
        <UserPlus className="mx-auto h-12 w-12 text-indigo-600" />
        <h1 className="mt-2 text-2xl font-bold">Dołącz do klubu</h1>
        <p className="mt-1 text-slate-600">
          <strong>{info.club_name}</strong>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-slate-700">Wybierz sposób rozliczeń:</p>
        {options.map((o) => {
          const Icon = o.icon;
          const selected = mode === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setMode(o.key)}
              className={`card flex items-start gap-3 text-left transition ${
                selected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'hover:border-indigo-300'
              }`}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  selected ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600'
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{o.title}</span>
                <span className="block text-sm font-medium text-indigo-700">{o.price}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{o.desc}</span>
              </span>
              <span
                className={`mt-1 h-5 w-5 shrink-0 rounded-full border-2 ${
                  selected ? 'border-indigo-600 bg-indigo-600 shadow-[inset_0_0_0_3px_white]' : 'border-slate-300'
                }`}
              />
            </button>
          );
        })}
        <p className="text-xs text-slate-500">Możesz to zmienić w każdej chwili w zakładce „Finanse”.</p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-slate-700">Na jakiej pozycji grasz?</p>
        <PositionPicker value={position} onChange={setPosition} />
      </div>

      <button className="btn btn-primary py-3" disabled={!mode || !position || busy} onClick={() => void join()}>
        {busy && <Spinner className="h-4 w-4" />} Dołącz do klubu
      </button>
      {(!mode || !position) && (
        <p className="-mt-3 text-center text-xs text-slate-500">Wybierz sposób rozliczeń i pozycję, aby dołączyć.</p>
      )}
    </main>
  );
}
