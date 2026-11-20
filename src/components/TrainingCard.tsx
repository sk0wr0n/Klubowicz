'use client';

import Link from 'next/link';
import { Clock, MapPin } from 'lucide-react';
import { formatShortDay, formatTime } from '@/lib/format';
import { trainingHref } from '@/lib/nav';
import type { Training } from '@/lib/types';

export function signupCounts(t: Training) {
  const s = t.training_signups ?? [];
  return {
    main: s.filter((x) => x.status === 'main').length,
    reserve: s.filter((x) => x.status === 'reserve').length,
  };
}

export function StatusBadge({ status }: { status: string | undefined }) {
  if (status === 'main') return <span className="chip bg-emerald-100 text-emerald-700">Jesteś zapisany</span>;
  if (status === 'reserve') return <span className="chip bg-amber-100 text-amber-700">Rezerwa</span>;
  if (status === 'late_cancel') return <span className="chip bg-slate-100 text-slate-600">Wypisany po terminie</span>;
  return null;
}

export default function TrainingCard({
  t,
  clubId,
  userId,
  isStaff = false,
}: {
  t: Training;
  clubId: string;
  userId: string | null;
  isStaff?: boolean;
}) {
  const { main, reserve } = signupCounts(t);
  const mine = t.training_signups?.find((s) => s.user_id === userId)?.status;
  const full = main >= t.max_participants;
  const pct = Math.min(100, Math.round((main / t.max_participants) * 100));
  const past = new Date(t.starts_at).getTime() <= Date.now();

  return (
    <Link
      href={trainingHref(clubId, t.id)}
      className={`card block transition hover:border-indigo-300 ${t.status === 'cancelled' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{formatShortDay(t.starts_at)}</p>
          <p className="truncate font-semibold text-slate-900">{t.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {formatTime(t.starts_at)}
              {t.ends_at && `–${formatTime(t.ends_at)}`}
            </span>
            {t.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {t.location}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {t.status === 'cancelled' && <span className="chip bg-red-100 text-red-700">Odwołany</span>}
          {t.status === 'settled' &&
            (isStaff ? (
              <span className="chip bg-emerald-100 text-emerald-700">✓ Obecność sprawdzona</span>
            ) : (
              <span className="chip bg-slate-100 text-slate-600">Zakończony</span>
            ))}
          {t.status === 'scheduled' && past && isStaff && (
            <span className="chip bg-amber-100 text-amber-700">Obecność niesprawdzona</span>
          )}
          <StatusBadge status={mine} />
        </div>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-xs">
          <span className={`font-semibold ${full ? 'text-red-600' : 'text-slate-700'}`}>
            Zapisani: {main} / {t.max_participants} miejsc
          </span>
          {reserve > 0 && <span className="font-medium text-amber-600">Rezerwa: {reserve}</span>}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${full ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
  );
}
