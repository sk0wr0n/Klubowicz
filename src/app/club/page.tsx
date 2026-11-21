'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ClipboardCheck, List, Plus, Trophy } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { dayKey, formatDay } from '@/lib/format';
import { getPref, setPref } from '@/lib/nav';
import type { Tournament, Training } from '@/lib/types';
import CalendarView from '@/components/CalendarView';
import TrainingCard from '@/components/TrainingCard';
import TrainingFormModal from '@/components/TrainingFormModal';
import TournamentCard from '@/components/TournamentCard';
import TournamentFormModal from '@/components/TournamentFormModal';
import { useRouter } from 'next/navigation';
import { tournamentHref } from '@/lib/nav';
import { EmptyState, ErrorBox, PageTitle, Spinner } from '@/components/ui';
import { InstallBanner } from '@/components/InstallHelp';

const TSELECT =
  'id, club_id, name, location, starts_on, ends_on, event_url, entry_fee, signup_deadline, notes, status, closed_at, created_by, created_at, tournament_signups(user_id)';

const SELECT =
  'id, club_id, title, location, starts_at, ends_at, max_participants, notes, status, settled_at, training_signups(user_id, status)';

export default function TrainingsPage() {
  const { clubId, ctx, isStaff } = useClub();
  const { userId } = useAuth();
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [upcoming, setUpcoming] = useState<Training[]>([]);
  const [toSettle, setToSettle] = useState<Training[]>([]);
  const [monthItems, setMonthItems] = useState<Training[]>([]);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tours, setTours] = useState<Tournament[]>([]);
  const [monthTours, setMonthTours] = useState<Tournament[]>([]);
  const router = useRouter();

  useEffect(() => {
    setView(getPref('view', 'list') === 'calendar' ? 'calendar' : 'list');
  }, []);

  const loadList = useCallback(async () => {
    const since = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const { data, error } = await supabase()
      .from('trainings')
      .select(SELECT)
      .eq('club_id', clubId)
      .gte('starts_at', since)
      .order('starts_at')
      .limit(60);
    if (error) throw error;
    setUpcoming((data ?? []) as Training[]);
    const today = dayKey(new Date());
    const { data: td, error: te } = await supabase()
      .from('tournaments')
      .select(TSELECT)
      .eq('club_id', clubId)
      .or(`ends_on.gte.${today},and(ends_on.is.null,starts_on.gte.${today})`)
      .order('starts_on')
      .limit(30);
    if (te) throw te;
    setTours((td ?? []) as Tournament[]);
    if (isStaff) {
      const { data: past } = await supabase()
        .from('trainings')
        .select(SELECT)
        .eq('club_id', clubId)
        .eq('status', 'scheduled')
        .lt('starts_at', new Date().toISOString())
        .gte('starts_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
        .order('starts_at', { ascending: false });
      setToSettle((past ?? []) as Training[]);
    }
  }, [clubId, isStaff]);

  const loadMonth = useCallback(async () => {
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const { data, error } = await supabase()
      .from('trainings')
      .select(SELECT)
      .eq('club_id', clubId)
      .gte('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString())
      .order('starts_at');
    if (error) throw error;
    setMonthItems((data ?? []) as Training[]);
    const { data: td, error: te } = await supabase()
      .from('tournaments')
      .select(TSELECT)
      .eq('club_id', clubId)
      .lt('starts_on', dayKey(to))
      .or(`ends_on.gte.${dayKey(from)},starts_on.gte.${dayKey(from)}`)
      .order('starts_on');
    if (te) throw te;
    setMonthTours((td ?? []) as Tournament[]);
  }, [clubId, month]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'list') await loadList();
      else await loadMonth();
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [view, loadList, loadMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  function switchView(v: 'list' | 'calendar') {
    setView(v);
    setPref('view', v);
  }

  const dayItems = selectedDay ? monthItems.filter((t) => dayKey(new Date(t.starts_at)) === selectedDay) : [];
  const dayTours = selectedDay
    ? monthTours.filter((t) => t.starts_on <= selectedDay && (t.ends_on ?? t.starts_on) >= selectedDay)
    : [];

  return (
    <>
      <PageTitle
        title="Zapisy"
        subtitle="Treningi i turnieje"
        action={
          <div className="flex shrink-0 gap-2">
            <button className="btn btn-secondary btn-sm border-amber-300 text-amber-800" onClick={() => setTourOpen(true)}>
              <Trophy className="h-4 w-4" /> Turniej
            </button>
            {isStaff && (
              <button className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" /> Trening
              </button>
            )}
          </div>
        }
      />

      <InstallBanner />

      <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
        <button
          className={`flex items-center justify-center gap-2 rounded-lg py-2 ${view === 'list' ? 'bg-white shadow-sm' : 'text-slate-500'}`}
          onClick={() => switchView('list')}
        >
          <List className="h-4 w-4" /> Nadchodzące
        </button>
        <button
          className={`flex items-center justify-center gap-2 rounded-lg py-2 ${view === 'calendar' ? 'bg-white shadow-sm' : 'text-slate-500'}`}
          onClick={() => switchView('calendar')}
        >
          <CalendarDays className="h-4 w-4" /> Kalendarz
        </button>
      </div>

      {error && <ErrorBox message={error} />}

      {view === 'list' && (
        <>
          {isStaff && toSettle.length > 0 && (
            <div className="mb-5">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700">
                <ClipboardCheck className="h-4 w-4" /> Obecność do sprawdzenia ({toSettle.length})
              </h2>
              <div className="flex flex-col gap-3">
                {toSettle.map((t) => (
                  <TrainingCard key={t.id} t={t} clubId={clubId} userId={userId} isStaff={isStaff} />
                ))}
              </div>
            </div>
          )}
          {tours.length > 0 && (
            <div className="mb-5">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700">
                <Trophy className="h-4 w-4" /> Turnieje ({tours.length})
              </h2>
              <div className="flex flex-col gap-3">
                {tours.map((t) => (
                  <TournamentCard key={t.id} t={t} clubId={clubId} userId={userId} />
                ))}
              </div>
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="h-6 w-6 text-indigo-600" />
            </div>
          ) : upcoming.length === 0 ? (
            <EmptyState icon={<CalendarDays className="h-12 w-12" />} title="Brak zaplanowanych treningów">
              {isStaff ? 'Dodaj pierwszy trening przyciskiem „Nowy”.' : 'Opiekun klubu jeszcze nie dodał terminów.'}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {upcoming.map((t) => (
                <TrainingCard key={t.id} t={t} clubId={clubId} userId={userId} isStaff={isStaff} />
              ))}
            </div>
          )}
        </>
      )}

      {view === 'calendar' && (
        <>
          <CalendarView
            month={month}
            onMonthChange={(d) => {
              setMonth(d);
              setSelectedDay(null);
            }}
            trainings={monthItems}
            tournaments={monthTours}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            userId={userId}
          />
          {selectedDay && (
            <div className="mt-4">
              <h2 className="mb-2 text-sm font-semibold capitalize text-slate-600">
                {formatDay(`${selectedDay}T12:00:00`)}
              </h2>
              {dayTours.length > 0 && (
                <div className="mb-3 flex flex-col gap-3">
                  {dayTours.map((t) => (
                    <TournamentCard key={t.id} t={t} clubId={clubId} userId={userId} />
                  ))}
                </div>
              )}
              {dayItems.length === 0 && dayTours.length > 0 ? null : dayItems.length === 0 ? (
                <div className="card text-sm text-slate-500">
                  Brak treningów tego dnia.
                  {isStaff && (
                    <button className="btn btn-secondary btn-sm ml-2" onClick={() => setFormOpen(true)}>
                      <Plus className="h-3.5 w-3.5" /> Dodaj
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {dayItems.map((t) => (
                    <TrainingCard key={t.id} t={t} clubId={clubId} userId={userId} isStaff={isStaff} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <TournamentFormModal
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        onSaved={(id) => router.push(tournamentHref(clubId, id))}
        defaultDate={view === 'calendar' && selectedDay ? selectedDay : undefined}
      />
      <TrainingFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load()}
        defaultDate={view === 'calendar' && selectedDay ? selectedDay : undefined}
      />
    </>
  );
}
