'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Trophy, X } from 'lucide-react';
import { useClub } from '@/lib/club';
import { supabase } from '@/lib/supabase';
import { formatDateRange, money } from '@/lib/format';
import { tournamentHref } from '@/lib/nav';
import type { Transaction } from '@/lib/types';

interface TRow {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string | null;
  status: 'open' | 'closed';
  entry_fee: number | null;
  est_cost_per_person: number | null;
  tournament_signups: { user_id: string }[];
}

type Tx = Transaction & { tournament_id?: string | null };

/** Finanse: moje turnieje – wpisowe i opłaty dodatkowe w jednym miejscu, z informacją o opłaceniu. */
export default function MyTournaments({ userId, items }: { userId: string; items: Tx[] }) {
  const { clubId } = useClub();
  const [rows, setRows] = useState<TRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    void supabase()
      .from('tournaments')
      .select('id, name, starts_on, ends_on, status, entry_fee, est_cost_per_person, tournament_signups(user_id)')
      .eq('club_id', clubId)
      .gte('starts_on', since)
      .order('starts_on')
      .then(({ data }) => {
        if (!alive) return;
        const withCharges = new Set(items.filter((i) => i.tournament_id).map((i) => i.tournament_id));
        setRows(
          ((data ?? []) as TRow[]).filter(
            (t) => t.tournament_signups?.some((s) => s.user_id === userId) || withCharges.has(t.id)
          )
        );
      });
    return () => {
      alive = false;
    };
  }, [clubId, userId, items]);

  if (!rows || rows.length === 0) return null;

  // Opłacone = wpłaty pokrywają obciążenia od najstarszych (FIFO), tak jak na stronie turnieju
  const credit = items.filter((i) => Number(i.amount) > 0).reduce((s, i) => s + Number(i.amount), 0);
  const charges = items
    .filter((i) => Number(i.amount) < 0)
    .sort((a, b) => a.booked_at.localeCompare(b.booked_at) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const paid = new Set<string>();
  let cum = 0;
  for (const c of charges) {
    cum += -Number(c.amount);
    if (cum <= credit + 0.001) paid.add(c.id);
  }

  return (
    <div className="card mb-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        <Trophy className="h-5 w-5 text-amber-600" /> Moje turnieje
      </h2>
      <div className="flex flex-col gap-3">
        {rows.map((t) => {
          const txs = items.filter((i) => i.tournament_id === t.id);
          const fee = txs.find((i) => i.type === 'tournament_fee');
          const extras = txs.filter((i) => i.type === 'tournament_extra');
          const n = t.tournament_signups?.length ?? 0;
          const estFee = !fee && t.entry_fee != null && n > 0 ? Math.round((Number(t.entry_fee) / n) * 100) / 100 : null;
          const charged = txs.reduce((s, i) => s - Number(i.amount), 0);
          return (
            <Link key={t.id} href={tournamentHref(clubId, t.id)} className="block rounded-xl border border-amber-200 bg-amber-50/40 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate font-semibold text-slate-900">{t.name}</p>
                <p className="shrink-0 text-xs text-slate-500">{formatDateRange(t.starts_on, t.ends_on)}</p>
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Wpisowe</span>
                  {fee ? (
                    <Amount amount={-Number(fee.amount)} paid={paid.has(fee.id)} />
                  ) : (
                    <span className="text-xs text-amber-700">
                      {estFee != null ? `≈ ${money(estFee)} – po zamknięciu zapisów` : 'kwota jeszcze nieznana'}
                    </span>
                  )}
                </li>
                {extras.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-slate-600">{(x.description ?? 'Opłata dodatkowa').split(':')[0]}</span>
                    <Amount amount={-Number(x.amount)} paid={paid.has(x.id)} />
                  </li>
                ))}
                {extras.length === 0 && (
                  <li className="text-xs text-slate-400">Opłaty dodatkowe (np. nocleg) – brak lub jeszcze nie dodane</li>
                )}
              </ul>
              <div className="mt-2 flex items-center justify-between border-t border-amber-200 pt-2 text-sm">
                <span className="font-medium text-slate-700">Naliczone razem</span>
                <span className="font-bold text-slate-900">{money(charged)}</span>
              </div>
              {t.est_cost_per_person != null && (
                <p className="mt-1 text-[11px] text-slate-500">Przewidywany koszt całkowity: ok. {money(t.est_cost_per_person)} / os.</p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Amount({ amount, paid }: { amount: number; paid: boolean }) {
  return (
    <span className={`chip shrink-0 ${paid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {paid ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {money(amount)} {paid ? 'opłacone' : 'do zapłaty'}
    </span>
  );
}
