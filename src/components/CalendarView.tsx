'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dayKey, monthLabel } from '@/lib/format';
import type { Tournament, Training } from '@/lib/types';

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

export default function CalendarView({
  month,
  onMonthChange,
  trainings,
  tournaments = [],
  selectedDay,
  onSelectDay,
  userId,
}: {
  month: Date;
  onMonthChange: (d: Date) => void;
  trainings: Training[];
  tournaments?: Tournament[];
  selectedDay: string | null;
  onSelectDay: (key: string) => void;
  userId: string | null;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // poniedziałek = 0
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7) cells.push(null);

  const byDay: Record<string, Training[]> = {};
  for (const t of trainings) {
    const k = dayKey(new Date(t.starts_at));
    (byDay[k] ??= []).push(t);
  }
  const tourDays: Record<string, { mine: boolean }> = {};
  for (const t of tournaments) {
    const mine = Boolean(t.tournament_signups?.some((s) => s.user_id === userId));
    const d = new Date(`${t.starts_on}T12:00:00`);
    const end = new Date(`${t.ends_on ?? t.starts_on}T12:00:00`);
    for (let i = 0; d <= end && i < 14; i++) {
      const k = dayKey(d);
      tourDays[k] = { mine: (tourDays[k]?.mine ?? false) || mine };
      d.setDate(d.getDate() + 1);
    }
  }
  const today = dayKey(new Date());

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          aria-label="Poprzedni miesiąc"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="font-semibold capitalize">{monthLabel(month)}</p>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          aria-label="Następny miesiąc"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-400">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const k = dayKey(d);
          const list = byDay[k] ?? [];
          const tour = tourDays[k];
          const has = list.some((t) => t.status !== 'cancelled') || Boolean(tour);
          const mine = list.some((t) => t.training_signups?.some((s) => s.user_id === userId && s.status !== 'late_cancel'));
          const selected = selectedDay === k;
          return (
            <button
              key={i}
              onClick={() => onSelectDay(k)}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition ${
                selected
                  ? 'bg-indigo-600 font-semibold text-white'
                  : tour
                    ? 'bg-amber-50 font-semibold text-amber-800 hover:bg-amber-100'
                    : has
                    ? 'bg-indigo-50 font-semibold text-indigo-700 hover:bg-indigo-100'
                    : 'text-slate-600 hover:bg-slate-50'
              } ${k === today && !selected ? 'ring-2 ring-indigo-300' : ''}`}
            >
              {d.getDate()}
              {(list.length > 0 || tour) && (
                <span className="absolute bottom-1 flex gap-0.5">
                  {tour && (
                    <span
                      className={`h-1.5 w-1.5 rotate-45 ${selected ? 'bg-white' : tour.mine ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    />
                  )}
                  {list.slice(0, 3).map((t) => (
                    <span
                      key={t.id}
                      className={`h-1.5 w-1.5 rounded-full ${
                        selected ? 'bg-white' : t.status === 'cancelled' ? 'bg-slate-300' : mine ? 'bg-emerald-500' : 'bg-indigo-500'
                      }`}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-indigo-500" /> trening
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rotate-45 bg-amber-500" /> turniej
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> jesteś zapisany
        </span>
      </p>
    </div>
  );
}
