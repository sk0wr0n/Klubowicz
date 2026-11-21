'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Hourglass } from 'lucide-react';
import { useClub } from '@/lib/club';
import { supabase } from '@/lib/supabase';
import { formatDate, formatShortDay, money } from '@/lib/format';
import { tournamentHref, trainingHref } from '@/lib/nav';

interface Item {
  key: string;
  href: string;
  date: number; // do sortowania
  title: string;
  amount: number | null; // null = kwota jeszcze nieznana
  approx?: boolean;
  when: string;
}

const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTHS_NOM = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

/** „Wkrótce na saldzie” – obciążenia, które dopiero zostaną naliczone. */
export default function UpcomingCharges({ userId, balance }: { userId: string; balance: number }) {
  const { clubId, ctx } = useClub();
  const [items, setItems] = useState<Item[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const sb = supabase();
      const fee = Number(ctx.club.single_training_fee_amount);
      const perSession = ctx.my_billing_mode === 'per_session';
      const [tr, to, cl] = await Promise.all([
        perSession && fee > 0
          ? sb
              .from('training_signups')
              .select('training_id, trainings!inner(id, title, starts_at, status, club_id)')
              .eq('user_id', userId)
              .eq('status', 'main')
              .eq('trainings.club_id', clubId)
              .eq('trainings.status', 'scheduled')
          : Promise.resolve({ data: [] as unknown[] }),
        sb
          .from('tournaments')
          .select('id, name, entry_fee, signup_deadline, starts_on, status, tournament_signups(user_id)')
          .eq('club_id', clubId)
          .eq('status', 'open'),
        ctx.my_billing_mode === 'monthly'
          ? sb.from('clubs').select('auto_monthly_fee, auto_monthly_fee_from').eq('id', clubId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const out: Item[] = [];
      const now = Date.now();

      for (const row of (tr.data ?? []) as { trainings: { id: string; title: string; starts_at: string } }[]) {
        const t = row.trainings;
        const past = new Date(t.starts_at).getTime() <= now;
        out.push({
          key: `t-${t.id}`,
          href: trainingHref(clubId, t.id),
          date: new Date(t.starts_at).getTime(),
          title: `${t.title} · ${formatShortDay(t.starts_at)}`,
          amount: fee,
          when: past ? 'czeka na potwierdzenie obecności przez Opiekuna' : 'po treningu, gdy Opiekun potwierdzi obecność',
        });
      }

      for (const t of (to.data ?? []) as {
        id: string;
        name: string;
        entry_fee: number | null;
        signup_deadline: string;
        tournament_signups: { user_id: string }[];
      }[]) {
        const n = t.tournament_signups?.length ?? 0;
        if (!t.tournament_signups?.some((s) => s.user_id === userId)) continue;
        out.push({
          key: `x-${t.id}`,
          href: tournamentHref(clubId, t.id),
          date: new Date(`${t.signup_deadline}T12:00:00`).getTime(),
          title: `🏆 Wpisowe: ${t.name}`,
          amount: t.entry_fee != null && n > 0 ? Math.round((Number(t.entry_fee) / n) * 100) / 100 : null,
          approx: true,
          when: `po zamknięciu zapisów (termin ${formatDate(`${t.signup_deadline}T12:00:00`)}) – zależy od liczby chętnych`,
        });
      }

      const club = cl.data as { auto_monthly_fee: boolean; auto_monthly_fee_from: string | null } | null;
      const monthly = Number(ctx.club.monthly_fee_amount);
      if (club?.auto_monthly_fee && monthly > 0) {
        const d = new Date();
        const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        let target = next;
        if (club.auto_monthly_fee_from) {
          const [y, m] = club.auto_monthly_fee_from.split('-').map(Number);
          const from = new Date(y, m - 1, 1);
          if (from > target) target = from;
        }
        out.push({
          key: 'monthly',
          href: '',
          date: target.getTime(),
          title: `Składka za ${MONTHS_NOM[target.getMonth()]} (wynajem sali)`,
          amount: monthly,
          when: `naliczana automatycznie 1 ${MONTHS_GEN[target.getMonth()]}`,
        });
      }

      out.sort((a, b) => a.date - b.date);
      if (alive) setItems(out);
    })();
    return () => {
      alive = false;
    };
  }, [clubId, userId, ctx.club.single_training_fee_amount, ctx.club.monthly_fee_amount, ctx.my_billing_mode]);

  if (!items || items.length === 0) return null;

  const total = Math.round(items.reduce((s, i) => s + (i.amount ?? 0), 0) * 100) / 100;
  const after = Math.round((balance - total) * 100) / 100;
  const unknown = items.some((i) => i.amount === null);
  const trainings = items.filter((i) => i.key.startsWith('t-')).length;
  const visible = showAll ? items : items.slice(0, 4);

  return (
    <div className="card mb-4 border-amber-200 bg-amber-50/60">
      <h2 className="flex items-center gap-2 font-semibold text-amber-900">
        <Hourglass className="h-5 w-5 text-amber-600" /> Wkrótce na Twoim saldzie
      </h2>
      <p className="mt-1 text-sm text-amber-900">
        {trainings > 0 && (
          <>
            Jesteś zapisany na <strong>{trainings}</strong> {trainings === 1 ? 'trening' : trainings < 5 ? 'treningi' : 'treningów'}.{' '}
          </>
        )}
        Te kwoty jeszcze <strong>nie zeszły</strong> z salda – pojawią się w nim niedługo.
      </p>

      <ul className="mt-3 flex flex-col divide-y divide-amber-100 rounded-xl bg-white">
        {visible.map((i) => {
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">{i.title}</span>
                <span className="block text-[11px] text-slate-500">{i.when}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-amber-700">
                {i.amount === null ? 'kwota wkrótce' : `${i.approx ? '≈ ' : ''}−${money(i.amount)}`}
              </span>
            </>
          );
          return (
            <li key={i.key}>
              {i.href ? (
                <Link href={i.href} className="flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {items.length > 4 && (
        <button className="mt-2 text-xs font-medium text-amber-800 underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Pokaż mniej' : `Pokaż wszystkie (${items.length})`}
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-white p-2">
          <p className="text-[11px] text-slate-500">Do naliczenia</p>
          <p className="text-lg font-bold text-amber-700">
            {unknown || items.some((i) => i.approx) ? '≈ ' : ''}−{money(total)}
          </p>
        </div>
        <div className="rounded-xl bg-white p-2">
          <p className="text-[11px] text-slate-500">Saldo po naliczeniu</p>
          <p className={`text-lg font-bold ${after < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(after)}</p>
        </div>
      </div>
      {after < 0 && (
        <p className="mt-2 text-xs text-amber-900">
          💡 Chcesz mieć spokój? Wpłać z góry <strong>{money(-after)}</strong> – dane do przelewu są niżej.
        </p>
      )}
    </div>
  );
}
