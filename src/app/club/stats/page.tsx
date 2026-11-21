'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { money } from '@/lib/format';
import { Avatar, ErrorBox, PageTitle, Spinner } from '@/components/ui';

type Period = 'month' | 'year' | 'all';

interface StatRow {
  user_id: string;
  full_name: string | null;
  member_code: string | null;
  value: number;
  rank: number;
}

interface ClubStats {
  visits: StatRow[];
  cars: StatRow[];
  beers: StatRow[];
  coach?: StatRow[];
  mvp?: StatRow[];
  balance: StatRow[];
  me: {
    visits: number;
    cars: number;
    beers: number;
    balance: number;
    r_visits: number;
    r_cars: number;
    r_beers: number;
    r_balance: number;
    coach?: number;
    mvp?: number;
    r_coach?: number;
    r_mvp?: number;
  } | null;
  members: number;
  trainings: number;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'Ten miesiąc' },
  { key: 'year', label: 'Ten rok' },
  { key: 'all', label: 'Od początku' },
];

function periodStart(p: Period): string | null {
  const now = new Date();
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  if (p === 'year') return new Date(now.getFullYear(), 0, 1).toISOString();
  return null;
}

const MEDAL = ['🥇', '🥈', '🥉'];

function Leaderboard({
  emoji,
  title,
  rows,
  format,
  userId,
  mine,
  myRank,
  empty,
}: {
  emoji: string;
  title: string;
  rows: StatRow[];
  format: (v: number) => string;
  userId: string | null;
  mine: number | undefined;
  myRank: number | undefined;
  empty: string;
}) {
  const meInTop = rows.some((r) => r.user_id === userId);
  return (
    <div className="card">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        <span className="text-xl">{emoji}</span> {title}
      </h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">{empty}</p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {rows.map((r) => {
            const isMe = r.user_id === userId;
            return (
              <li key={r.user_id} className={`flex items-center gap-3 py-2 ${isMe ? '-mx-2 rounded-xl bg-indigo-50 px-2' : ''}`}>
                <span className="w-7 text-center text-sm font-bold text-slate-400">{MEDAL[r.rank - 1] ?? `${r.rank}.`}</span>
                <Avatar name={r.full_name} size="h-8 w-8" />
                <span className={`min-w-0 flex-1 truncate text-sm ${isMe ? 'font-semibold text-indigo-700' : 'font-medium'}`}>
                  {r.full_name ?? 'Członek klubu'}
                  {isMe && ' (Ty)'}
                </span>
                <span className="text-sm font-bold text-slate-800">{format(Number(r.value))}</span>
              </li>
            );
          })}
        </ol>
      )}
      {!meInTop && mine !== undefined && Number(mine) > 0 && myRank !== undefined && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Ty: <strong>{myRank}. miejsce</strong> · {format(Number(mine))}
        </p>
      )}
    </div>
  );
}

export default function StatsPage() {
  const { clubId, ctx } = useClub();
  const { userId } = useAuth();
  const [period, setPeriod] = useState<Period>('month');
  const [stats, setStats] = useState<ClubStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase().rpc('club_stats', { p_club: clubId, p_from: periodStart(period) });
    if (error) setError(errMsg(error));
    else {
      setError(null);
      setStats(data as ClubStats);
    }
    setLoading(false);
  }, [clubId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const times = (v: number) => `${v}×`;
  const me = stats?.me ?? null;

  return (
    <>
      <PageTitle
        title="Statystyki"
        subtitle={
          stats
            ? `${ctx.club.name} · treningi ze sprawdzoną obecnością: ${stats.trainings}`
            : ctx.club.name
        }
      />

      <div className="mb-4 grid grid-cols-3 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`rounded-lg py-2 ${period === p.key ? 'bg-white shadow-sm' : 'text-slate-500'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}

      {loading && !stats ? (
        <Spinner className="mx-auto my-10 h-6 w-6 text-indigo-600" />
      ) : stats ? (
        <div className={`flex flex-col gap-4 ${loading ? 'opacity-60' : ''}`}>
          {me && (
            <div className="card border-indigo-200 bg-indigo-50">
              <h2 className="mb-2 flex items-center gap-2 font-semibold text-indigo-800">
                <Trophy className="h-5 w-5" /> Twoje wyniki
              </h2>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white p-2">
                  <p className="text-xl font-bold text-indigo-700">{me.visits}</p>
                  <p className="text-[11px] text-slate-500">🏐 treningów</p>
                </div>
                <div className="rounded-xl bg-white p-2">
                  <p className="text-xl font-bold text-sky-700">{me.cars}</p>
                  <p className="text-[11px] text-slate-500">🚗 autem</p>
                </div>
                <div className="rounded-xl bg-white p-2">
                  <p className="text-xl font-bold text-amber-600">{me.beers}</p>
                  <p className="text-[11px] text-slate-500">🍺 integracji</p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-white p-2">
                  <p className="text-xl font-bold text-amber-500">{me.mvp ?? 0}</p>
                  <p className="text-[11px] text-slate-500">⭐ razy MVP</p>
                </div>
                <div className="rounded-xl bg-white p-2">
                  <p className="text-xl font-bold text-indigo-700">{me.coach ?? 0}</p>
                  <p className="text-[11px] text-slate-500">📣 razy trenerem</p>
                </div>
              </div>
            </div>
          )}

          <Leaderboard
            emoji="🏐"
            title="Najwięcej treningów"
            rows={stats.visits}
            format={times}
            userId={userId}
            mine={me?.visits}
            myRank={me?.r_visits}
            empty="Brak treningów ze sprawdzoną obecnością w tym okresie."
          />
          <Leaderboard
            emoji="🚗"
            title="Najczęściej autem"
            rows={stats.cars}
            format={times}
            userId={userId}
            mine={me?.cars}
            myRank={me?.r_cars}
            empty="Nikt jeszcze nie przyjechał autem 🙂"
          />
          <Leaderboard
            emoji="🍺"
            title="Najczęściej na integracji"
            rows={stats.beers}
            format={times}
            userId={userId}
            mine={me?.beers}
            myRank={me?.r_beers}
            empty="Jeszcze nikt nie został na integracji."
          />
          <Leaderboard
            emoji="⭐"
            title="Najczęściej MVP treningu"
            rows={stats.mvp ?? []}
            format={times}
            userId={userId}
            mine={me?.mvp}
            myRank={me?.r_mvp}
            empty="Nikt jeszcze nie został MVP – głosujcie po treningu!"
          />
          <Leaderboard
            emoji="📣"
            title="Najczęściej wybierany trenerem"
            rows={stats.coach ?? []}
            format={times}
            userId={userId}
            mine={me?.coach}
            myRank={me?.r_coach}
            empty="Brak rozstrzygniętych głosowań na trenera."
          />
          <Leaderboard
            emoji="💰"
            title="Najwyższe saldo"
            rows={stats.balance}
            format={(v) => money(v)}
            userId={userId}
            mine={me?.balance}
            myRank={me?.r_balance}
            empty="Nikt nie ma jeszcze nadpłaty."
          />
          <p className="text-center text-xs text-slate-400">
            Liczą się treningi, na których Opiekun zatwierdził obecność. Ranking salda pokazuje tylko nadpłaty (stan bieżący). MVP i trener – liczy się zwycięstwo w głosowaniu (przy remisie wszyscy z najwyższą liczbą głosów).
          </p>
        </div>
      ) : null}
    </>
  );
}
