'use client';

import Link from 'next/link';
import { MapPin, Trophy, Users } from 'lucide-react';
import { daysUntil, formatDate, formatDateRange, money } from '@/lib/format';
import { tournamentHref } from '@/lib/nav';
import type { Tournament } from '@/lib/types';

export function deadlineLabel(t: Tournament): { text: string; cls: string } {
  if (t.status === 'closed') return { text: 'Zapisy zamknięte', cls: 'bg-slate-100 text-slate-600' };
  const d = daysUntil(t.signup_deadline);
  if (d < 0) return { text: 'Po terminie zapisów', cls: 'bg-red-100 text-red-700' };
  if (d === 0) return { text: 'Zapisy do dziś!', cls: 'bg-red-100 text-red-700' };
  if (d <= 3) return { text: `Zapisy jeszcze ${d} ${d === 1 ? 'dzień' : 'dni'}`, cls: 'bg-amber-100 text-amber-700' };
  return { text: `Zapisy do ${formatDate(`${t.signup_deadline}T12:00:00`)}`, cls: 'bg-indigo-50 text-indigo-700' };
}

export default function TournamentCard({ t, clubId, userId }: { t: Tournament; clubId: string; userId: string | null }) {
  const count = t.tournament_signups?.length ?? 0;
  const mine = t.tournament_signups?.some((s) => s.user_id === userId);
  const dl = deadlineLabel(t);
  return (
    <Link
      href={tournamentHref(clubId, t.id)}
      className="card block border-amber-200 bg-gradient-to-br from-amber-50 to-white transition hover:border-amber-400"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
            <Trophy className="h-3.5 w-3.5" /> Turniej · {formatDateRange(t.starts_on, t.ends_on)}
          </p>
          <p className="truncate font-semibold text-slate-900">{t.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {t.location}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {count} {count === 1 ? 'osoba' : count >= 2 && count <= 4 ? 'osoby' : 'osób'}
            </span>
            {t.est_cost_per_person != null ? (
              <span className="font-medium text-amber-800">ok. {money(t.est_cost_per_person)} / os.</span>
            ) : (
              t.entry_fee != null && <span>wpisowe {money(t.entry_fee)}</span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`chip ${dl.cls}`}>{dl.text}</span>
          {mine && <span className="chip bg-emerald-100 text-emerald-700">Jesteś zapisany</span>}
        </div>
      </div>
    </Link>
  );
}
