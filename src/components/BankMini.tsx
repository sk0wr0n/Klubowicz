'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, Landmark } from 'lucide-react';
import { useClub } from '@/lib/club';
import { supabase } from '@/lib/supabase';
import { formatDate, money } from '@/lib/format';
import { clubHref } from '@/lib/nav';

/** Skrót stanu konta klubu (z wyciągów CSV) – Rozliczenia, dla Właściciela i Skarbnika. */
export default function BankMini() {
  const { clubId } = useClub();
  const [ov, setOv] = useState<{ balance: number | null; last_date: string | null; snapshot: { as_of: string } | null } | null>(null);

  useEffect(() => {
    void supabase()
      .rpc('bank_overview', { p_club: clubId })
      .then(({ data }) => data && setOv(data as typeof ov));
  }, [clubId]);

  const date = ov?.last_date ?? ov?.snapshot?.as_of ?? null;
  return (
    <Link href={clubHref(clubId, 'bank')} className="card mb-4 flex items-center gap-3 transition hover:border-indigo-300">
      <Landmark className="h-6 w-6 shrink-0 text-indigo-600" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Konto klubu</span>
        <span className="block text-xs text-slate-500">
          {!ov
            ? 'Ładowanie…'
            : ov.balance === null
              ? 'Zaimportuj wyciąg CSV, żeby widzieć stan konta i historię'
              : `historia operacji${date ? ` · dane do ${formatDate(date)}` : ''}`}
        </span>
      </span>
      {ov && ov.balance !== null && (
        <span className={`text-lg font-bold ${ov.balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(ov.balance)}</span>
      )}
      <ChevronRight className="h-5 w-5 text-slate-400" />
    </Link>
  );
}
