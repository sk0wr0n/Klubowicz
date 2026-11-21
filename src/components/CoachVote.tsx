'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Megaphone } from 'lucide-react';
import { useClub } from '@/lib/club';
import { normalize } from '@/lib/csv';
import { errMsg, supabase } from '@/lib/supabase';
import type { Signup, Training } from '@/lib/types';
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

/** Głosowanie na trenera treningu (anonimowe, jeden głos na osobę). */
export default function CoachVote({
  training,
  signups,
  userId,
  open,
  onOpenChange,
}: {
  training: Training;
  signups: Signup[];
  userId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { memberMap, nameOf } = useClub();
  const toast = useToast();
  const [rows, setRows] = useState<VoteRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const main = useMemo(() => signups.filter((s) => s.status === 'main'), [signups]);
  const mine = signups.find((s) => s.user_id === userId);
  const closed = training.status !== 'scheduled' || new Date(training.starts_at).getTime() <= Date.now();
  const canVote = !closed && Boolean(mine) && mine?.status !== 'late_cancel';
  const signupKey = signups.map((s) => `${s.user_id}:${s.status}`).join(',');

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('coach_votes', { p_training: training.id });
    if (!error) setRows((data ?? []) as VoteRow[]);
  }, [training.id]);

  useEffect(() => {
    void load();
  }, [load, signupKey]);

  const myVote = rows?.find((r) => r.is_my_vote)?.candidate_id ?? null;
  const top = rows && rows.length > 0 ? rows[0].votes : 0;
  const leaders = rows ? rows.filter((r) => r.votes === top && top > 0) : [];
  const candidates = main.filter((s) => s.user_id !== userId);
  const filtered = candidates.filter(
    (s) => !q || normalize(nameOf(s.user_id)).includes(normalize(q))
  );

  async function vote(candidate: string | null) {
    setBusy(candidate ?? 'none');
    const { error } = await supabase().rpc('vote_coach', { p_training: training.id, p_candidate: candidate });
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

  return (
    <>
      <div className="card mb-4">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Megaphone className="h-5 w-5 text-indigo-600" /> {closed ? 'Trener treningu' : 'Kto poprowadzi trening?'}
        </h2>

        {rows === null ? (
          <Spinner className="h-5 w-5 text-slate-400" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            {closed ? 'Nikt nie oddał głosu na trenera.' : 'Nikt jeszcze nie głosował. Zagłosuj, kto ma być trenerem!'}
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm">
              {closed ? 'Wybrany głosowaniem: ' : leaders.length > 1 ? 'Remis: ' : 'Prowadzi: '}
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
                    <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(r.votes / top) * 100}%` }} />
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
              <Megaphone className="h-4 w-4" /> {myVote ? `Zmień głos (teraz: ${nameOf(myVote)})` : 'Zagłosuj na trenera'}
            </button>
          ) : (
            <p className="mt-2 text-xs text-slate-400">Głosować mogą osoby zapisane na trening. Głosowanie jest anonimowe.</p>
          ))}
      </div>

      <Modal open={open && canVote} onClose={() => onOpenChange(false)} title="Kto ma być trenerem?">
        <p className="mb-3 text-sm text-slate-600">
          Wybierz osobę z listy głównej. Głos jest anonimowy – inni widzą tylko liczbę głosów. Możesz go zmienić do
          rozpoczęcia treningu.
        </p>
        {candidates.length > 6 && (
          <input className="input mb-3" placeholder="Szukaj…" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Na liście głównej nie ma jeszcze innych osób.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {filtered.map((s) => {
              const m = memberMap[s.user_id];
              const selected = myVote === s.user_id;
              const count = rows?.find((r) => r.candidate_id === s.user_id)?.votes ?? 0;
              return (
                <li key={s.user_id}>
                  <button
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left ${
                      selected ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                    disabled={busy !== null}
                    onClick={() => void vote(selected ? null : s.user_id)}
                  >
                    <Avatar name={m?.profiles?.full_name} url={m?.profiles?.avatar_url} size="h-8 w-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{nameOf(s.user_id)}</span>
                      {count > 0 && <span className="block text-[11px] text-slate-500">{votesLabel(count)}</span>}
                    </span>
                    <PositionBadge position={m?.position} />
                    {busy === s.user_id ? (
                      <Spinner className="h-4 w-4" />
                    ) : selected ? (
                      <span className="chip bg-indigo-600 text-white">
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
