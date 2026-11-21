'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Ban,
  Beer,
  Car,
  ClipboardCheck,
  Clock,
  MapPin,
  Pencil,
  RefreshCw,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { formatDay, formatTime, hoursUntil, money } from '@/lib/format';
import { clubHref } from '@/lib/nav';
import type { Attendance, Signup, Training } from '@/lib/types';
import CoachVote from '@/components/CoachVote';
import MemberPicker from '@/components/MemberPicker';
import { EventPositionModal, PositionBadge, PositionSummary } from '@/components/Position';
import TrainingFormModal from '@/components/TrainingFormModal';
import { StatusBadge } from '@/components/TrainingCard';
import { useToast } from '@/components/Toast';
import { Avatar, ConfirmModal, EmptyState, Spinner } from '@/components/ui';

type ConfirmKind = 'join' | 'leave' | 'settle' | 'cancel' | 'restore' | 'delete' | 'remove' | null;

export default function TrainingPage() {
  const tId = useSearchParams().get('t') ?? '';
  const router = useRouter();
  const toast = useToast();
  const { userId } = useAuth();
  const { clubId, ctx, isStaff, suspended, memberMap, nameOf } = useClub();

  const [training, setTraining] = useState<Training | null>(null);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [removeUid, setRemoveUid] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [picker, setPicker] = useState<'list' | 'attendance' | null>(null);
  const [attMode, setAttMode] = useState(false);
  const [voteOpen, setVoteOpen] = useState(false);
  const [mvpOpen, setMvpOpen] = useState(false);
  const [posEdit, setPosEdit] = useState<{ uid: string; afterJoin?: boolean } | null>(null);
  const [posBusy, setPosBusy] = useState(false);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [chargeLate, setChargeLate] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!tId) return;
    const sb = supabase();
    const [t, s, a] = await Promise.all([
      sb.from('trainings').select('*').eq('id', tId).eq('club_id', clubId).maybeSingle(),
      sb
        .from('training_signups')
        .select('id, training_id, user_id, status, has_car, wants_beer, added_by_staff, signed_up_at, position')
        .eq('training_id', tId)
        .order('signed_up_at'),
      sb.from('training_attendance').select('user_id, present').eq('training_id', tId),
    ]);
    if (t.error) toast(errMsg(t.error), 'error');
    setTraining((t.data as Training | null) ?? null);
    setSignups((s.data ?? []) as Signup[]);
    setAttendance((a.data ?? []) as Attendance[]);
    setLoading(false);
  }, [tId, clubId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: odświeżanie listy, gdy ktoś się zapisze/wypisze
  useEffect(() => {
    if (!tId) return;
    const sb = supabase();
    const channel = sb
      .channel(`signups-${tId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'training_signups', filter: `training_id=eq.${tId}` }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [tId, load]);

  const main = useMemo(() => signups.filter((s) => s.status === 'main'), [signups]);
  const reserve = useMemo(() => signups.filter((s) => s.status === 'reserve'), [signups]);
  const late = useMemo(() => signups.filter((s) => s.status === 'late_cancel'), [signups]);
  const mine = signups.find((s) => s.user_id === userId);
  const fee = Number(ctx.club.single_training_fee_amount);
  const deadline = ctx.club.cancellation_deadline_hours;
  const lateFeeOn = ctx.club.late_cancel_fee_enabled !== false;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-7 w-7 text-indigo-600" />
      </div>
    );
  }
  if (!training) {
    return (
      <EmptyState title="Nie znaleziono treningu">
        <Link href={clubHref(clubId)} className="btn btn-secondary mt-2">
          Wróć do listy
        </Link>
      </EmptyState>
    );
  }

  const started = new Date(training.starts_at).getTime() <= Date.now();
  const open = training.status === 'scheduled' && !started && !suspended;
  const afterDeadline = hoursUntil(training.starts_at) < deadline;
  const isPerSession = ctx.my_billing_mode === 'per_session';
  const lateLeave = lateFeeOn && mine?.status === 'main' && isPerSession && afterDeadline;
  const cars = main.filter((s) => s.has_car).length;
  const beers = main.filter((s) => s.wants_beer).length;

  async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    setBusy(true);
    const { data, error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      throw error;
    }
    return data;
  }

  async function doJoin() {
    try {
      const res = (await rpc('join_training', { p_training: tId })) as string;
      setConfirm(null);
      if (res === 'main') toast('Zapisano! Jesteś na liście głównej.');
      else toast('Lista jest pełna – jesteś na liście rezerwowej. Awansujesz automatycznie, gdy zwolni się miejsce.', 'info');
      await load();
      const myPos = userId ? memberMap[userId]?.positions ?? [] : [];
      if (userId && myPos.length > 1) setPosEdit({ uid: userId, afterJoin: true });
      else setVoteOpen(true);
    } catch {
      /* komunikat pokazany */
    }
  }

  async function doLeave() {
    try {
      const res = (await rpc('leave_training', { p_training: tId })) as string;
      setConfirm(null);
      toast(res === 'late_cancel' ? 'Wypisano po terminie – opłata może zostać naliczona.' : 'Wypisano z treningu.', res === 'late_cancel' ? 'info' : 'success');
      await load();
    } catch {
      /* */
    }
  }

  async function toggleFlag(kind: 'car' | 'beer') {
    if (!mine) return;
    try {
      await rpc('set_signup_flags', {
        p_training: tId,
        p_has_car: kind === 'car' ? !mine.has_car : null,
        p_wants_beer: kind === 'beer' ? !mine.wants_beer : null,
      });
      await load();
    } catch {
      /* */
    }
  }

  async function staffAdd(uid: string) {
    try {
      await rpc('staff_add_signup', { p_training: tId, p_user: uid });
      toast(`Dopisano: ${nameOf(uid)}`);
      if (picker === 'attendance') setPresent((p) => new Set(p).add(uid));
      setPicker(null);
      await load();
    } catch {
      /* */
    }
  }

  async function staffRemove() {
    if (!removeUid) return;
    try {
      await rpc('staff_remove_signup', { p_training: tId, p_user: removeUid });
      setConfirm(null);
      setRemoveUid(null);
      toast('Usunięto z listy.');
      await load();
    } catch {
      /* */
    }
  }

  function startAttendance() {
    setPresent(new Set(main.map((s) => s.user_id)));
    setChargeLate(new Set(late.filter((s) => memberMap[s.user_id]?.billing_mode === 'per_session').map((s) => s.user_id)));
    setAttMode(true);
  }

  const presentArr = [...present];
  const lateToCharge = late
    .map((s) => s.user_id)
    .filter((u) => chargeLate.has(u) && !present.has(u) && memberMap[u]?.billing_mode === 'per_session');

  async function doSettle() {
    try {
      const res = (await rpc('settle_training', {
        p_training: tId,
        p_present: presentArr,
        p_charge_late: lateToCharge,
      })) as { present: number };
      setConfirm(null);
      setAttMode(false);
      toast(`Obecność zapisana: ${res.present} ${res.present === 1 ? 'osoba' : 'osób'}.`);
      await load();
    } catch {
      /* */
    }
  }

  async function setStatus(status: 'cancelled' | 'scheduled') {
    setBusy(true);
    const { error } = await supabase().from('trainings').update({ status }).eq('id', tId);
    setBusy(false);
    setConfirm(null);
    if (error) toast(errMsg(error), 'error');
    else {
      toast(status === 'cancelled' ? 'Trening odwołany.' : 'Trening przywrócony.');
      await load();
    }
  }

  async function doDelete() {
    setBusy(true);
    const { error } = await supabase().from('trainings').delete().eq('id', tId);
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    toast('Trening usunięty.');
    router.replace(clubHref(clubId));
  }

  const effPos = (uid: string) => signups.find((x) => x.user_id === uid)?.position ?? memberMap[uid]?.position ?? null;

  async function savePosition(p: string) {
    if (!posEdit) return;
    setPosBusy(true);
    const { error } = await supabase().rpc('set_signup_position', {
      p_training: tId,
      p_user: posEdit.uid === userId ? null : posEdit.uid,
      p_position: p,
    });
    setPosBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    const after = posEdit.afterJoin;
    setPosEdit(null);
    await load();
    if (after) setVoteOpen(true);
  }

  function PersonRow({ s, index, right }: { s: Signup; index?: number; right?: ReactNode }) {
    const m = memberMap[s.user_id];
    return (
      <li className="flex items-center gap-3 py-2.5">
        {index !== undefined && <span className="w-5 text-right text-xs font-semibold text-slate-400">{index}.</span>}
        <Avatar name={m?.profiles?.full_name} url={m?.profiles?.avatar_url} size="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-medium ${s.user_id === userId ? 'text-indigo-700' : 'text-slate-800'}`}>
            {nameOf(s.user_id)}
            {s.user_id === userId && ' (Ty)'}
          </p>
          {s.added_by_staff && <p className="text-[11px] text-slate-400">dopisany przez opiekuna</p>}
        </div>
        {(s.user_id === userId || isStaff) && training?.status === 'scheduled' ? (
          <button
            type="button"
            className="shrink-0 rounded-lg"
            aria-label="Zmień pozycję na tym treningu"
            onClick={() => setPosEdit({ uid: s.user_id })}
          >
            {s.position ?? m?.position ? (
              <PositionBadge position={s.position ?? m?.position} />
            ) : (
              <span className="chip border border-dashed border-slate-300 text-slate-400">+ poz.</span>
            )}
          </button>
        ) : (
          <PositionBadge position={s.position ?? m?.position} />
        )}
        {s.has_car && <Car className="h-4 w-4 text-sky-600" aria-label="Będę autem" />}
        {s.wants_beer && <Beer className="h-4 w-4 text-amber-500" aria-label="Integracja po treningu" />}
        {right}
      </li>
    );
  }

  const removeBtn = (uid: string) =>
    isStaff && training.status === 'scheduled' && !attMode ? (
      <button
        className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
        aria-label="Usuń z listy"
        onClick={() => {
          setRemoveUid(uid);
          setConfirm('remove');
        }}
      >
        <X className="h-4 w-4" />
      </button>
    ) : null;

  const attCheckbox = (uid: string) => (
    <input
      type="checkbox"
      className="h-5 w-5 accent-emerald-600"
      checked={present.has(uid)}
      onChange={(e) =>
        setPresent((p) => {
          const n = new Set(p);
          if (e.target.checked) n.add(uid);
          else n.delete(uid);
          return n;
        })
      }
      aria-label="Obecny"
    />
  );

  return (
    <>
      <Link href={clubHref(clubId)} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Treningi
      </Link>

      {/* Nagłówek treningu */}
      <div className="card mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{formatDay(training.starts_at)}</p>
            <h1 className="text-xl font-bold">{training.title}</h1>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {formatTime(training.starts_at)}
                {training.ends_at && `–${formatTime(training.ends_at)}`}
              </span>
              {training.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {training.location}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {training.status === 'cancelled' && <span className="chip bg-red-100 text-red-700">Odwołany</span>}
            {training.status === 'settled' &&
              (isStaff ? (
                <span className="chip bg-emerald-100 text-emerald-700">✓ Obecność sprawdzona</span>
              ) : (
                <span className="chip bg-slate-100 text-slate-600">Zakończony</span>
              ))}
            {training.status === 'scheduled' && started && isStaff && (
              <span className="chip bg-amber-100 text-amber-700">Obecność niesprawdzona</span>
            )}
            <StatusBadge status={mine?.status} />
          </div>
        </div>
        {training.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{training.notes}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <div className="rounded-xl bg-indigo-50 p-2">
            <p className="text-lg font-bold text-indigo-700">
              {main.length} / {training.max_participants}
            </p>
            <p className="text-xs text-indigo-600">Zapisani / miejsc</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-2">
            <p className="text-lg font-bold text-amber-700">{reserve.length}</p>
            <p className="text-xs text-amber-600">Rezerwa</p>
          </div>
          <div className="rounded-xl bg-sky-50 p-2">
            <p className="text-lg font-bold text-sky-700">{cars}</p>
            <p className="text-xs text-sky-600">🚗 Autem</p>
          </div>
          <div className="rounded-xl bg-orange-50 p-2">
            <p className="text-lg font-bold text-orange-700">{beers}</p>
            <p className="text-xs text-orange-600">🍺 Integracja</p>
          </div>
        </div>

        {/* Akcje zawodnika */}
        {!attMode && (
          <div className="mt-4 flex flex-col gap-3">
            {open && (!mine || mine.status === 'late_cancel') && (
              <button
                className="btn btn-primary py-3"
                disabled={busy}
                onClick={() => (isPerSession && fee > 0 ? setConfirm('join') : void doJoin())}
              >
                {busy && <Spinner className="h-4 w-4" />}
                {main.length >= training.max_participants ? 'Zapisz mnie na listę rezerwową' : 'Zapisz się na trening'}
              </button>
            )}
            {open && isPerSession && fee > 0 && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                💳 Opłata <strong>{money(fee)}</strong> zostanie naliczona <strong>po treningu</strong>, gdy Opiekun potwierdzi
                obecność – nie w momencie zapisu.
                {lateFeeOn && ` Wypisanie się do ${deadline} h przed treningiem jest bezpłatne.`}
              </p>
            )}
            {open && !isPerSession && (
              <p className="text-center text-xs text-slate-400">
                Płacisz składkę miesięczną – za ten trening nic nie dopłacasz.
              </p>
            )}
            {open && mine && mine.status !== 'late_cancel' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`btn py-3 ${mine.has_car ? 'bg-sky-600 text-white hover:bg-sky-700' : 'btn-secondary'}`}
                    onClick={() => void toggleFlag('car')}
                    disabled={busy}
                  >
                    <Car className="h-5 w-5" /> {mine.has_car ? 'Będę autem' : 'Autem?'}
                  </button>
                  <button
                    className={`btn py-3 ${mine.wants_beer ? 'bg-amber-500 text-white hover:bg-amber-600' : 'btn-secondary'}`}
                    onClick={() => void toggleFlag('beer')}
                    disabled={busy}
                  >
                    <Beer className="h-5 w-5" /> {mine.wants_beer ? 'Zostaję na piwo' : 'Integracja?'}
                  </button>
                </div>
                <p className="text-center text-xs text-slate-400">
                  🚗 = mogę kogoś zabrać · 🍺 = zostaję po treningu na integrację
                </p>
                <button className="btn btn-secondary text-red-600" onClick={() => setConfirm('leave')} disabled={busy}>
                  Wypisz mnie
                </button>
              </>
            )}
            {training.status === 'scheduled' && started && !isStaff && (
              <p className="text-center text-sm text-slate-500">Trening już się rozpoczął – w sprawie obecności zwróć się do Opiekuna.</p>
            )}
            {suspended && training.status === 'scheduled' && (
              <p className="text-center text-sm text-red-600">Zapisy są zablokowane – klub jest zawieszony.</p>
            )}
          </div>
        )}
      </div>

      <CoachVote
        kind="mvp"
        training={training}
        signups={signups}
        attendance={attendance}
        userId={userId}
        open={mvpOpen}
        onOpenChange={setMvpOpen}
      />
      <CoachVote training={training} signups={signups} userId={userId} open={voteOpen} onOpenChange={setVoteOpen} />

      {/* Tryb sprawdzania obecności */}
      {attMode ? (
        <div className="card mb-4 border-emerald-300">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Sprawdzanie obecności</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setAttMode(false)}>
              Anuluj
            </button>
          </div>
          <div className="mb-2">
            <PositionSummary positions={[...present].map((u) => effPos(u))} />
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Zaznacz osoby faktycznie obecne. Odznacz nieobecnych. Osoby, które przyszły, ale nie zapisały się w aplikacji,
            dodaj przyciskiem poniżej.
          </p>

          <ul className="divide-y divide-slate-100">
            {[...main, ...reserve].map((s) => (
              <PersonRow
                key={s.id}
                s={s}
                right={
                  <span className="flex items-center gap-2">
                    {s.status === 'reserve' && <span className="chip bg-amber-100 text-amber-700">rezerwa</span>}
                    {attCheckbox(s.user_id)}
                  </span>
                }
              />
            ))}
          </ul>

          {late.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-slate-600">Wypisani po terminie</h3>
              <ul className="divide-y divide-slate-100">
                {late.map((s) => {
                  const ps = memberMap[s.user_id]?.billing_mode === 'per_session';
                  return (
                    <PersonRow
                      key={s.id}
                      s={s}
                      right={
                        <span className="flex items-center gap-3">
                          {lateFeeOn && ps && !present.has(s.user_id) && (
                            <label className="flex items-center gap-1 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-red-600"
                                checked={chargeLate.has(s.user_id)}
                                onChange={(e) =>
                                  setChargeLate((p) => {
                                    const n = new Set(p);
                                    if (e.target.checked) n.add(s.user_id);
                                    else n.delete(s.user_id);
                                    return n;
                                  })
                                }
                              />
                              obciąż {money(fee)}
                            </label>
                          )}
                          {attCheckbox(s.user_id)}
                        </span>
                      }
                    />
                  );
                })}
              </ul>
            </>
          )}

          <button className="btn btn-secondary mt-3 w-full border-dashed" onClick={() => setPicker('attendance')} disabled={busy}>
            <UserPlus className="h-4 w-4" /> + Dodaj osobę z klubu (niezapisaną w apce)
          </button>

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
            Obecnych: <strong>{present.size}</strong> (zapisanych na liście głównej: {main.length})
          </div>

          <button className="btn btn-success mt-3 w-full py-3" onClick={() => setConfirm('settle')} disabled={busy || suspended}>
            <ClipboardCheck className="h-5 w-5" /> Zatwierdź obecność
          </button>
        </div>
      ) : (
        <>
          {/* Lista główna */}
          <div className="card mb-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-semibold">Lista główna</h2>
              <span className="text-sm text-slate-500">
                Zapisani: {main.length} / {training.max_participants} miejsc
              </span>
            </div>
            {main.length > 0 && (
              <div className="mb-2 mt-1">
                <PositionSummary positions={main.map((s) => s.position ?? memberMap[s.user_id]?.position)} />
              </div>
            )}
            {main.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">Nikt jeszcze się nie zapisał.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {main.map((s, i) => (
                  <PersonRow key={s.id} s={s} index={i + 1} right={removeBtn(s.user_id)} />
                ))}
              </ul>
            )}
          </div>

          {reserve.length > 0 && (
            <div className="card mb-4 border-amber-200">
              <h2 className="mb-1 font-semibold text-amber-700">Lista rezerwowa ({reserve.length})</h2>
              <p className="mb-1 text-xs text-slate-500">Kolejność zgłoszeń – pierwsza osoba awansuje automatycznie po zwolnieniu miejsca.</p>
              <ul className="divide-y divide-slate-100">
                {reserve.map((s, i) => (
                  <PersonRow key={s.id} s={s} index={i + 1} right={removeBtn(s.user_id)} />
                ))}
              </ul>
            </div>
          )}

          {late.length > 0 && (
            <div className="card mb-4">
              <h2 className="mb-1 text-sm font-semibold text-slate-500">Wypisani po terminie</h2>
              <ul className="divide-y divide-slate-100">
                {late.map((s) => (
                  <PersonRow key={s.id} s={s} right={removeBtn(s.user_id)} />
                ))}
              </ul>
            </div>
          )}

          {training.status === 'settled' && attendance.length > 0 && (
            <div className="card mb-4">
              <h2 className="mb-2 font-semibold">Obecność sprawdzona</h2>
              <div className="flex flex-wrap gap-2">
                {attendance
                  .slice()
                  .sort((a, b) => Number(b.present) - Number(a.present))
                  .map((a) => (
                    <span
                      key={a.user_id}
                      className={`chip ${a.present ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500 line-through'}`}
                    >
                      {nameOf(a.user_id)}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Panel Opiekuna / Właściciela */}
          {isStaff && training.status !== 'settled' && (
            <div className="card mb-4 flex flex-col gap-2">
              <h2 className="font-semibold">Panel opiekuna</h2>
              {training.status === 'scheduled' && (
                <>
                  <button className="btn btn-success py-3" onClick={startAttendance} disabled={suspended}>
                    <ClipboardCheck className="h-5 w-5" /> Sprawdź obecność
                  </button>
                  <button className="btn btn-secondary" onClick={() => setPicker('list')} disabled={suspended}>
                    <UserPlus className="h-4 w-4" /> Dopisz osobę z klubu
                  </button>
                  <button className="btn btn-secondary" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" /> Edytuj trening
                  </button>
                  <button className="btn btn-secondary text-red-600" onClick={() => setConfirm('cancel')}>
                    <Ban className="h-4 w-4" /> Odwołaj trening
                  </button>
                </>
              )}
              {training.status === 'cancelled' && (
                <button className="btn btn-secondary" onClick={() => setConfirm('restore')}>
                  <RefreshCw className="h-4 w-4" /> Przywróć trening
                </button>
              )}
              <button className="btn btn-ghost text-red-600" onClick={() => setConfirm('delete')}>
                <Trash2 className="h-4 w-4" /> Usuń trening
              </button>
            </div>
          )}

          {/* Autor treningu (bez roli Opiekuna) może go edytować, odwołać lub usunąć */}
          {!isStaff && training.created_by === userId && training.status !== 'settled' && (
            <div className="card mb-4 flex flex-col gap-2">
              <h2 className="font-semibold">Twój trening</h2>
              <p className="text-xs text-slate-500">Dodałeś ten trening – możesz go zmienić. Obecność sprawdza Opiekun.</p>
              {training.status === 'scheduled' && (
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-secondary" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" /> Edytuj
                  </button>
                  <button className="btn btn-secondary text-red-600" onClick={() => setConfirm('cancel')}>
                    <Ban className="h-4 w-4" /> Odwołaj
                  </button>
                </div>
              )}
              {training.status === 'cancelled' && (
                <button className="btn btn-secondary" onClick={() => setConfirm('restore')}>
                  <RefreshCw className="h-4 w-4" /> Przywróć trening
                </button>
              )}
              <button className="btn btn-ghost text-red-600" onClick={() => setConfirm('delete')}>
                <Trash2 className="h-4 w-4" /> Usuń trening
              </button>
            </div>
          )}
        </>
      )}

      {/* Modale */}
      <ConfirmModal
        open={confirm === 'join'}
        title="Potwierdź udział"
        message={
          <>
            Za udział w treningu Twoje saldo w klubie <strong>{ctx.club.name}</strong> zostanie obciążone kwotą{' '}
            <strong>{money(fee)}</strong>.
            <p className="mt-2">
              Opłata nalicza się <strong>po treningu</strong>, gdy Opiekun potwierdzi obecność – teraz saldo się nie zmieni.
              {lateFeeOn && ` Wypisanie się do ${deadline} h przed treningiem jest bezpłatne.`}
            </p>
            {main.length >= training.max_participants && (
              <p className="mt-2 text-amber-700">
                Lista jest pełna – trafisz na listę rezerwową. Opłata zostanie naliczona tylko, jeśli faktycznie zagrasz.
              </p>
            )}
          </>
        }
        confirmText="Tak, zapisuję się"
        busy={busy}
        onConfirm={() => void doJoin()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'leave'}
        title="Wypisać się z treningu?"
        danger={Boolean(lateLeave)}
        message={
          lateLeave ? (
            <>
              Wypisujesz się po terminie (mniej niż <strong>{deadline} h</strong> przed treningiem). Zgodnie z zasadami
              klubu Opiekun może naliczyć opłatę <strong>{money(fee)}</strong>.
            </>
          ) : (
            'Twoje miejsce zajmie pierwsza osoba z listy rezerwowej.'
          )
        }
        confirmText="Wypisz mnie"
        busy={busy}
        onConfirm={() => void doLeave()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'settle'}
        title="Zatwierdzić obecność?"
        message={
          <>
            Obecnych: <strong>{present.size}</strong>.
            <br />
            Po zatwierdzeniu lista obecności zostanie zamknięta i nie będzie można jej edytować.
          </>
        }
        confirmText="Zatwierdź obecność"
        busy={busy}
        onConfirm={() => void doSettle()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'cancel'}
        title="Odwołać trening?"
        danger
        message="Trening zostanie oznaczony jako odwołany. Nikt nie zostanie obciążony."
        confirmText="Odwołaj"
        busy={busy}
        onConfirm={() => void setStatus('cancelled')}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'restore'}
        title="Przywrócić trening?"
        message="Trening wróci do kalendarza, a zapisy zostaną otwarte."
        confirmText="Przywróć"
        busy={busy}
        onConfirm={() => void setStatus('scheduled')}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'delete'}
        title="Usunąć trening?"
        danger
        message="Trening i wszystkie zapisy zostaną trwale usunięte."
        confirmText="Usuń"
        busy={busy}
        onConfirm={() => void doDelete()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'remove'}
        title="Usunąć z listy?"
        danger
        message={
          <>
            Usunąć <strong>{removeUid ? nameOf(removeUid) : ''}</strong> z listy tego treningu?
          </>
        }
        confirmText="Usuń z listy"
        busy={busy}
        onConfirm={() => void staffRemove()}
        onClose={() => {
          setConfirm(null);
          setRemoveUid(null);
        }}
      />

      <MemberPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        onPick={(uid) => void staffAdd(uid)}
        excludeIds={signups.filter((s) => s.status !== 'late_cancel').map((s) => s.user_id)}
        title={picker === 'attendance' ? 'Dodaj obecną osobę (niezapisaną w apce)' : 'Dopisz osobę do treningu'}
      />
      <EventPositionModal
        open={posEdit !== null}
        title={posEdit?.afterJoin ? 'Na jakiej pozycji grasz na tym treningu?' : 'Pozycja na tym treningu'}
        personName={posEdit && posEdit.uid !== userId ? nameOf(posEdit.uid) : undefined}
        memberPositions={posEdit ? memberMap[posEdit.uid]?.positions ?? [] : []}
        current={posEdit ? effPos(posEdit.uid) : null}
        busy={posBusy}
        onPick={(p) => void savePosition(p)}
        onClose={() => {
          const after = posEdit?.afterJoin;
          setPosEdit(null);
          if (after) setVoteOpen(true);
        }}
      />
      <TrainingFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => void load()} training={training} />
    </>
  );
}
