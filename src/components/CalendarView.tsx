'use client';

import { Check, ChevronLeft, ChevronRight, Trophy, Volleyball } from 'lucide-react';
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
  const tourDays: Record<string, { mine: boolean; count: number }> = {};
  for (const t of tournaments) {
    const mine = Boolean(t.tournament_signups?.some((s) => s.user_id === userId));
    const d = new Date(`${t.starts_on}T12:00:00`);
    const end = new Date(`${t.ends_on ?? t.starts_on}T12:00:00`);
    for (let i = 0; d <= end && i < 14; i++) {
      const k = dayKey(d);
      tourDays[k] = {
        mine: (tourDays[k]?.mine ?? false) || mine,
        count: (tourDays[k]?.count ?? 0) + (t.tournament_signups?.length ?? 0),
      };
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
          const active = list.filter((t) => t.status !== 'cancelled');
          const cancelledOnly = list.length > 0 && active.length === 0;
          const mineTraining = active.some((t) =>
            t.training_signups?.some((s) => s.user_id === userId && s.status !== 'late_cancel')
          );
          const mine = mineTraining || Boolean(tour?.mine);
          const trainingCount = active.reduce(
            (n, t) => n + (t.training_signups?.filter((x) => x.status === 'main').length ?? 0),
            0
          );
          const selected = selectedDay === k;
          const isToday = k === today;
          const tone = selected
            ? 'bg-indigo-600 text-white shadow-md'
            : tour
              ? 'bg-gradient-to-b from-amber-100 to-amber-50 text-amber-900 hover:from-amber-200'
              : active.length
                ? 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                : 'text-slate-600 hover:bg-slate-50';
          return (
            <button
              key={i}
              onClick={() => onSelectDay(k)}
              className={`relative flex aspect-square flex-col items-center justify-start gap-0.5 rounded-xl pt-1.5 text-sm transition ${tone} ${
                isToday && !selected ? 'ring-2 ring-indigo-400' : ''
              } ${mine && !selected ? 'ring-2 ring-emerald-400' : ''}`}
            >
              <span className={`leading-none ${active.length || tour ? 'font-bold' : ''}`}>{d.getDate()}</span>
              {(active.length > 0 || tour || cancelledOnly) && (
                <span className={`flex items-center ${active.length > 0 && tour ? 'flex-col gap-0' : 'gap-0.5'}`}>
                  {active.length > 0 && (
                    <span className="flex items-center gap-px leading-none">
                      <Volleyball
                        className={`${tour ? 'h-3 w-3' : 'h-3.5 w-3.5'} ${selected ? 'text-white' : 'text-indigo-600'}`}
                        strokeWidth={2.2}
                      />
                      <span className={`text-[10px] font-semibold ${selected ? 'text-white' : 'text-indigo-700'}`}>{trainingCount}</span>
                    </span>
                  )}
                  {tour && (
                    <span className="flex items-center gap-px leading-none">
                      <Trophy
                        className={`${active.length > 0 ? 'h-3 w-3' : 'h-3.5 w-3.5'} ${selected ? 'text-white' : 'text-amber-600'}`}
                        strokeWidth={2.2}
                      />
                      <span className={`text-[10px] font-semibold ${selected ? 'text-white' : 'text-amber-800'}`}>{tour.count}</span>
                    </span>
                  )}
                  {cancelledOnly && !tour && <Volleyball className="h-4 w-4 text-slate-300" />}
                </span>
              )}
              {mine && (
                <span
                  className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full ${
                    selected ? 'bg-white text-emerald-600' : 'bg-emerald-500 text-white'
                  } shadow`}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Volleyball className="h-3.5 w-3.5 text-indigo-600" /> trening
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="font-semibold text-slate-700">liczba</span> = ile osób zapisanych
        </span>
        <span className="inline-flex items-center gap-1">
          <Trophy className="h-3.5 w-3.5 text-amber-600" /> turniej
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>{' '}
          jesteś zapisany
        </span>
      </p>
    </div>
  );
}
