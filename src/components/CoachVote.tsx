'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Megaphone, Star } from 'lucide-react';
import { useClub } from '@/lib/club';
import { normalize } from '@/lib/csv';
import { errMsg, supabase } from '@/lib/supabase';
import type { Attendance, Signup, Training } from '@/lib/types';
import { PositionBadge } from './Position';
import { useToast } from './Toast';
import { Avatar, Modal, Spinner } from './ui';

interface VoteRow {
  candidate_id: string;
  votes: number;
  is_my_vote: boolean;
}

function votesLabel(n: number): string {
  if (n === 1) return '1 głos';
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${n} głosy`;
  return `${n} głosów`;
}

const MVP_WINDOW_MS = 7 * 24 * 3600 * 1000;

/**
 * Głosowanie (anonimowe, jeden głos na osobę):
 *  - coach: kto poprowadzi trening – przed treningiem, zapisani (główna + rezerwa) na osoby z listy głównej;
 *  - mvp: najlepszy zawodnik – po rozpoczęciu (do 7 dni), tylko osoby, które były na treningu.
 */
export default function CoachVote({
  kind = 'coach',
  training,
  signups,
  attendance = [],
  userId,
  open,
  onOpenChange,
}: {
  kind?: 'coach' | 'mvp';
  training: Training;
  signups: Signup[];
  attendance?: Attendance[];
  userId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const isMvp = kind === 'mvp';
  const { memberMap, nameOf } = useClub();
  const toast = useToast();
  const [rows, setRows] = useState<VoteRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // MVP: po sprawdzeniu obecności liczą się obecni, wcześniej – lista główna
  const participants = useMemo(() => {
    if (isMvp && attendance.length > 0) return attendance.filter((a) => a.present).map((a) => a.user_id);
    return signups.filter((s) => s.status === 'main').map((s) => s.user_id);
  }, [isMvp, attendance, signups]);
  const mine = signups.find((s) => s.user_id === userId);
  const startMs = new Date(training.starts_at).getTime();
  const started = startMs <= Date.now();
  const closed = isMvp
    ? training.status === 'cancelled' || Date.now() > startMs + MVP_WINDOW_MS
    : training.status !== 'scheduled' || started;
  const canVote = isMvp
    ? !closed && started && Boolean(userId && participants.includes(userId))
    : !closed && Boolean(mine) && mine?.status !== 'late_cancel';
  const signupKey =
    signups.map((s) => `${s.user_id}:${s.status}`).join(',') + '|' + attendance.map((a) => `${a.user_id}:${a.present}`).join(',');

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc(isMvp ? 'mvp_votes' : 'coach_votes', { p_training: training.id });
    if (!error) setRows((data ?? []) as VoteRow[]);
  }, [training.id, isMvp]);

  useEffect(() => {
    void load();
  }, [load, signupKey]);

  const myVote = rows?.find((r) => r.is_my_vote)?.candidate_id ?? null;
  const top = rows && rows.length > 0 ? rows[0].votes : 0;
  const leaders = rows ? rows.filter((r) => r.votes === top && top > 0) : [];
  const candidates = participants.filter((u) => u !== userId);
  const filtered = candidates.filter((u) => !q || normalize(nameOf(u)).includes(normalize(q)));

  async function vote(candidate: string | null) {
    setBusy(candidate ?? 'none');
    const { error } = await supabase().rpc(isMvp ? 'vote_mvp' : 'vote_coach', {
      p_training: training.id,
      p_candidate: candidate,
    });
    setBusy(null);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    toast(candidate ? `Oddano głos na: ${nameOf(candidate)}.` : 'Wycofano głos.');
    onOpenChange(false);
    setQ('');
    await load();
  }

  if (training.status === 'cancelled') return null;
  if (isMvp && !started) return null;
  // MVP po zamknięciu bez głosów – nie pokazuj pustej karty
  if (isMvp && closed && rows !== null && rows.length === 0) return null;

  const Icon = isMvp ? Star : Megaphone;
  const iconClass = isMvp ? 'h-5 w-5 text-amber-500' : 'h-5 w-5 text-indigo-600';
  const title = isMvp
    ? closed
      ? 'MVP treningu'
      : 'MVP treningu – kto zagrał najlepiej?'
    : closed
      ? 'Trener treningu'
      : 'Kto poprowadzi trening?';

  return (
    <>
      <div className="card mb-4">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Icon className={iconClass} /> {title}
        </h2>

        {rows === null ? (
          <Spinner className="h-5 w-5 text-slate-400" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            {closed
              ? 'Nikt nie oddał głosu na trenera.'
              : isMvp
                ? 'Nikt jeszcze nie głosował. Kto był dziś najlepszy?'
                : 'Nikt jeszcze nie głosował. Zagłosuj, kto ma być trenerem!'}
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm">
              {closed ? (isMvp ? '🏆 MVP: ' : 'Wybrany głosowaniem: ') : leaders.length > 1 ? 'Remis: ' : 'Prowadzi: '}
              <strong>{leaders.map((l) => nameOf(l.candidate_id)).join(', ')}</strong>{' '}
              <span className="text-slate-500">({votesLabel(top)})</span>
            </p>
            <ul className="flex flex-col gap-1.5">
              {rows.slice(0, 5).map((r) => (
                <li key={r.candidate_id} className="flex items-center gap-2 text-sm">
                  <span className={`min-w-0 flex-1 truncate ${r.is_my_vote ? 'font-semibold text-indigo-700' : ''}`}>
                    {nameOf(r.candidate_id)}
                  </span>
                  {r.is_my_vote && <span className="chip shrink-0 bg-indigo-100 text-indigo-700">Twój głos</span>}
                  <span className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100">
                    <span className={`block h-full rounded-full ${isMvp ? 'bg-amber-400' : 'bg-indigo-500'}`} style={{ width: `${(r.votes / top) * 100}%` }} />
                  </span>
                  <span className="w-14 shrink-0 text-right text-xs text-slate-500">{votesLabel(r.votes)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {!closed &&
          (canVote ? (
            <button className="btn btn-secondary mt-3 w-full" onClick={() => onOpenChange(true)}>
              <Icon className="h-4 w-4" />{' '}
              {myVote ? `Zmień głos (teraz: ${nameOf(myVote)})` : isMvp ? 'Zagłosuj na MVP' : 'Zagłosuj na trenera'}
            </button>
          ) : (
            <p className="mt-2 text-xs text-slate-400">
              {isMvp
                ? 'Na MVP głosują tylko osoby, które były na treningu (do 7 dni po treningu). Głosowanie jest anonimowe.'
                : 'Głosować mogą osoby zapisane na trening. Głosowanie jest anonimowe.'}
            </p>
          ))}
      </div>

      <Modal
        open={open && canVote}
        onClose={() => onOpenChange(false)}
        title={isMvp ? 'Kto był MVP treningu?' : 'Kto ma być trenerem?'}
      >
        <p className="mb-3 text-sm text-slate-600">
          {isMvp
            ? 'Wybierz osobę, która zagrała najlepiej. Głos jest anonimowy – inni widzą tylko liczbę głosów. Możesz go zmienić przez 7 dni od treningu.'
            : 'Wybierz osobę z listy głównej. Głos jest anonimowy – inni widzą tylko liczbę głosów. Możesz go zmienić do rozpoczęcia treningu.'}
        </p>
        {candidates.length > 6 && (
          <input className="input mb-3" placeholder="Szukaj…" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            {isMvp ? 'Brak innych osób obecnych na treningu.' : 'Na liście głównej nie ma jeszcze innych osób.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {filtered.map((uid) => {
              const m = memberMap[uid];
              const selected = myVote === uid;
              const count = rows?.find((r) => r.candidate_id === uid)?.votes ?? 0;
              return (
                <li key={uid}>
                  <button
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left ${
                      selected ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                    disabled={busy !== null}
                    onClick={() => void vote(selected ? null : uid)}
                  >
                    <Avatar name={m?.profiles?.full_name} url={m?.profiles?.avatar_url} size="h-8 w-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{nameOf(uid)}</span>
                      {count > 0 && <span className="block text-[11px] text-slate-500">{votesLabel(count)}</span>}
                    </span>
                    <PositionBadge position={m?.position} />
                    {busy === uid ? (
                      <Spinner className="h-4 w-4" />
                    ) : selected ? (
                      <span className={`chip text-white ${isMvp ? 'bg-amber-500' : 'bg-indigo-600'}`}>
                        <Check className="h-3 w-3" /> Twój głos
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {myVote && (
          <button className="btn btn-ghost mt-3 w-full text-red-600" disabled={busy !== null} onClick={() => void vote(null)}>
            Wycofaj mój głos
          </button>
        )}
      </Modal>
    </>
  );
}
