'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, Target } from 'lucide-react';
import { useClub } from '@/lib/club';
import { supabase } from '@/lib/supabase';
import { money, periodLabel, currentPeriod } from '@/lib/format';
import { clubHref } from '@/lib/nav';

interface Mini {
  target: number;
  secured: number;
  forecast: number;
}

/** Skrót budżetu miesiąca (Właściciel/Skarbnik) na stronie Finanse. */
export default function BudgetMini() {
  const { clubId, isFinance, ctx } = useClub();
  const visible = isFinance || ctx.club.budget_public === true;
  const [m, setM] = useState<Mini | null>(null);

  useEffect(() => {
    if (!visible) return;
    void supabase()
      .rpc('budget_overview', { p_club: clubId, p_period: null })
      .then(({ data }) => {
        if (!data) return;
        const d = data as {
          single_fee: number;
          avg_per_session: number;
          items: { amount: number }[];
          monthly: { expected: number };
          trainings: { status: string; charged: number; per_session_signed: number }[];
        };
        const target = d.items.reduce((s, i) => s + Number(i.amount), 0);
        const secured =
          Number(d.monthly.expected) +
          d.trainings.reduce(
            (s, t) => s + (t.status === 'settled' ? Number(t.charged) : t.per_session_signed * Number(d.single_fee)),
            0
          );
        const avg = Math.round(Number(d.avg_per_session ?? 0));
        const forecast =
          Number(d.monthly.expected) +
          d.trainings.reduce(
            (s, t) =>
              s + (t.status === 'settled' ? Number(t.charged) : Math.max(t.per_session_signed, avg) * Number(d.single_fee)),
            0
          );
        setM({ target, secured, forecast });
      });
  }, [clubId, visible]);

  if (!visible) return null;
  const pct = m && m.target > 0 ? Math.min(100, Math.round((m.secured / m.target) * 100)) : 0;
  return (
    <Link href={clubHref(clubId, 'budget')} className="card mb-4 block border-indigo-200 transition hover:border-indigo-400">
      <div className="flex items-center gap-3">
        <Target className="h-6 w-6 shrink-0 text-indigo-600" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Budżet klubu – <span className="capitalize">{periodLabel(currentPeriod())}</span></span>
          <span className="block text-xs text-slate-500">
            {!m
              ? 'Ładowanie…'
              : m.target === 0
                ? isFinance
                  ? 'Ustaw cel miesiąca (sala, księgowa…)'
                  : 'Cel miesiąca nie jest jeszcze ustawiony'
                : `${money(m.secured)} z ${money(m.target)} (${pct}%) · ${
                    m.forecast >= m.target
                      ? `prognoza: na plus ${money(m.forecast - m.target)}`
                      : `prognoza: brakuje ${money(m.target - m.forecast)}`
                  }`}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 text-slate-400" />
      </div>
      {m && m.target > 0 && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-600'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </Link>
  );
}
