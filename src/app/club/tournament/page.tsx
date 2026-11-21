'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ExternalLink,
  Lock,
  LockOpen,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Trophy,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { formatDate, formatDateRange, money } from '@/lib/format';
import { clubHref } from '@/lib/nav';
import type { Tournament, TournamentParticipant } from '@/lib/types';
import MemberPicker from '@/components/MemberPicker';
import { EventPositionModal, PositionBadge, PositionSummary } from '@/components/Position';
import { deadlineLabel } from '@/components/TournamentCard';
import TournamentFormModal from '@/components/TournamentFormModal';
import { useToast } from '@/components/Toast';
import { Avatar, ConfirmModal, EmptyState, Modal, Spinner } from '@/components/ui';

type Confirm = 'close' | 'reopen' | 'delete' | 'leave' | null;

interface Avail {
  days: string[] | null;
  note: string | null;
  position: string | null;
}

function tournamentDays(from: string, to: string | null): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to ?? from}T12:00:00`);
  while (d <= end && out.length < 14) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function dayShort(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
}

function PaidTick({ label, paid }: { label: string; paid: boolean | null }) {
  if (paid === null) return null;
  return (
    <span className={`chip ${paid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {paid ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {label}
    </span>
  );
}

function PlannedChip({ label, amount }: { label: string; amount?: number | null }) {
  return (
    <span className="chip bg-amber-100 text-amber-800">
      ⏳ {label}
      {amount != null && ` ${money(amount)}`} – po zamknięciu
    </span>
  );
}

function PaidAmount({ label, amount, paid }: { label: string; amount: number | null; paid: boolean | null }) {
  if (amount === null || paid === null) return null;
  return (
    <span className={`chip ${paid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {paid ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {label} {money(amount)}
    </span>
  );
}

export default function TournamentPage() {
  const tId = useSearchParams().get('t') ?? '';
  const router = useRouter();
  const toast = useToast();
  const { userId } = useAuth();
  const { clubId, isStaff, suspended, memberMap, nameOf } = useClub();

  const [t, setT] = useState<Tournament | null>(null);
  const [people, setPeople] = useState<TournamentParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [removeUid, setRemoveUid] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraDesc, setExtraDesc] = useState('Nocleg');
  const [extraAmount, setExtraAmount] = useState('');
  const [extraFor, setExtraFor] = useState<Set<string>>(new Set());
  const [delExtra, setDelExtra] = useState<{ id: string; label: string } | null>(null);
  const [avail, setAvail] = useState<Record<string, Avail>>({});
  const [myDays, setMyDays] = useState<Set<string>>(new Set());
  const [myNote, setMyNote] = useState('');
  const [posEdit, setPosEdit] = useState<string | null>(null);
  const [posBusy, setPosBusy] = useState(false);

  const load = useCallback(async () => {
    if (!tId) return;
    const sb = supabase();
    const [a, b, c] = await Promise.all([
      sb.from('tournaments').select('*').eq('id', tId).eq('club_id', clubId).maybeSingle(),
      sb.rpc('tournament_participants', { p_tournament: tId }),
      sb.from('tournament_signups').select('user_id, days, note, position').eq('tournament_id', tId),
    ]);
    const av: Record<string, Avail> = {};
    for (const r of (c.data ?? []) as { user_id: string; days: string[] | null; note: string | null; position: string | null }[]) {
      av[r.user_id] = { days: r.days, note: r.note, position: r.position };
    }
    setAvail(av);
    if (a.error) toast(errMsg(a.error), 'error');
    setT((a.data as Tournament | null) ?? null);
    setPeople(((b.data ?? []) as TournamentParticipant[]).map((p) => ({ ...p, extras: p.extras ?? null })));
    setLoading(false);
  }, [tId, clubId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const me = people.find((p) => p.user_id === userId);
  const days = useMemo(() => (t ? tournamentDays(t.starts_on, t.ends_on) : []), [t]);
  const multiDay = days.length > 1;
  const mine = userId ? avail[userId] : undefined;
  useEffect(() => {
    setMyDays(new Set(mine?.days ?? days));
    setMyNote(mine?.note ?? '');
  }, [mine?.days, mine?.note, days]);
  const availChanged =
    myNote.trim() !== (mine?.note ?? '') ||
    [...myDays].sort().join(',') !== (mine?.days ?? days).slice().sort().join(',');
  const perDay = days.map((d) => ({
    d,
    n: people.filter((p) => {
      const ds = avail[p.user_id]?.days;
      return !ds || ds.includes(d);
    }).length,
  }));
  const count = people.length;
  const isAuthor = t?.created_by === userId;
  const closed = t?.status === 'closed';
  const fee = t?.entry_fee != null ? Number(t.entry_fee) : null;
  const share = fee != null && count > 0 ? Math.round((fee / count) * 100) / 100 : null;
  const effPos = (uid: string) => avail[uid]?.position ?? memberMap[uid]?.position ?? null;
  const positions = useMemo(
    () => people.map((p) => avail[p.user_id]?.position ?? memberMap[p.user_id]?.position),
    [people, memberMap, avail]
  );
  const anyCharges = people.some((p) => p.fee_paid !== null || p.extras_paid !== null);

  async function rpc(fn: string, args: Record<string, unknown>, ok?: string): Promise<unknown> {
    setBusy(true);
    const { data, error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      throw error;
    }
    if (ok) toast(ok);
    return data;
  }

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      setConfirm(null);
      await load();
    } catch {
      /* komunikat pokazany */
    }
  }

  async function addExtra() {
    const amount = Number(extraAmount.replace(',', '.'));
    if (!amount || amount <= 0) {
      toast('Podaj kwotę na osobę.', 'error');
      return;
    }
    if (extraFor.size === 0) {
      toast('Zaznacz przynajmniej jedną osobę.', 'error');
      return;
    }
    await run(async () => {
      await rpc(
        'add_tournament_extra',
        { p_tournament: tId, p_users: [...extraFor], p_amount: amount, p_description: extraDesc },
        `Dodano opłatę „${extraDesc}” dla ${extraFor.size} os.`
      );
      setExtraOpen(false);
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-indigo-600" />
      </div>
    );
  }
  if (!t) {
    return (
      <EmptyState title="Nie znaleziono turnieju">
        <Link href={clubHref(clubId)} className="btn btn-secondary mt-3">
          Wróć do listy
        </Link>
      </EmptyState>
    );
  }

  const dl = deadlineLabel(t);
  const canJoin = !closed && !suspended && dl.text !== 'Po terminie zapisów';

  let info: ReactNode = null;
  if (closed) {
    info = (
      <>
        Zapisy zamknięte. Wpisowe <strong>{money(fee)}</strong> podzielone na <strong>{count}</strong> os. – po{' '}
        <strong>{money(share)}</strong> na osobę (już na saldzie). Jeśli ktoś wypadnie albo dojdzie, Opiekun zmienia listę, a
        kwoty przeliczają się same.
      </>
    );
  } else if (fee != null) {
    info = (
      <>
        Wpisowe <strong>{money(fee)}</strong>
        {count > 0 && (
          <>
            {' '}
            / {count} os. = ok. <strong>{money(share)}</strong> na osobę
          </>
        )}
        . Kwota zostanie naliczona na saldo, gdy Opiekun zamknie zapisy – im więcej osób, tym taniej.
      </>
    );
  } else {
    info = <>Wpisowe nie jest jeszcze znane – każdy może je uzupełnić w „Edytuj”. Bez kwoty nie da się zamknąć zapisów.</>;
  }

  return (
    <>
      <Link href={clubHref(clubId)} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Zapisy
      </Link>

      <div className="card mb-4 border-amber-200">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
              <Trophy className="h-3.5 w-3.5" /> Turniej
            </p>
            <h1 className="text-xl font-bold text-slate-900">{t.name}</h1>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`chip ${dl.cls}`}>{dl.text}</span>
            {me && <span className="chip bg-emerald-100 text-emerald-700">Jesteś zapisany</span>}
          </div>
        </div>

        <div className="mt-2 flex flex-col gap-1 text-sm text-slate-600">
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> {formatDateRange(t.starts_on, t.ends_on)}
          </span>
          <span className="inline-flex items-center gap-2">
            <MapPin className="h-4 w-4" /> {t.location}
          </span>
          <span className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4" /> Zapisy do {formatDate(`${t.signup_deadline}T12:00:00`)}
          </span>
          {t.event_url && (
            <a
              href={t.event_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-medium text-indigo-600"
            >
              <ExternalLink className="h-4 w-4" /> Strona wydarzenia
            </a>
          )}
        </div>
        {t.notes && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{t.notes}</p>}

        {(t.est_cost_per_person != null || t.cost_notes) && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Przewidywany koszt na osobę</p>
            {t.est_cost_per_person != null && (
              <p className="text-2xl font-bold text-slate-900">
                ok. {money(t.est_cost_per_person)}
              </p>
            )}
            {t.cost_notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{t.cost_notes}</p>}
            <p className="mt-1 text-[11px] text-slate-400">Kwota orientacyjna – dokładne obciążenia nalicza Opiekun.</p>
          </div>
        )}
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">💰 {info}</p>

        {me && (me.fee_amount != null || me.extras_amount != null) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <PaidAmount label="Twoje wpisowe" amount={me.fee_amount} paid={me.fee_paid} />
            {me.extras_paid === null && me.extras_planned ? (
              <PlannedChip label="Opłaty dodatkowe" amount={me.extras_amount} />
            ) : (
              <PaidAmount label="Opłaty dodatkowe" amount={me.extras_amount} paid={me.extras_paid} />
            )}
          </div>
        )}

        {me && (
          <div className="mt-3 rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-semibold">Moja obecność</p>
            {multiDay && (
              <>
                <p className="mb-2 text-xs text-slate-500">Odznacz dni, w które Cię nie będzie.</p>
                <div className="flex flex-wrap gap-1.5">
                  {days.map((d) => {
                    const on = myDays.has(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          setMyDays((s) => {
                            const n = new Set(s);
                            if (on) n.delete(d);
                            else n.add(d);
                            return n;
                          })
                        }
                        className={`chip px-3 py-1.5 text-xs ${on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400 line-through'}`}
                      >
                        {on && <Check className="h-3 w-3" />} {dayShort(d)}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <input
              className="input mt-2"
              maxLength={200}
              value={myNote}
              onChange={(e) => setMyNote(e.target.value)}
              placeholder={multiDay ? 'np. dojadę w piątek wieczorem / wyjeżdżam po 1. dniu' : 'np. dojadę na 2. mecz, będę o 10:00'}
            />
            {availChanged && (
              <button
                className="btn btn-primary btn-sm mt-2 w-full"
                disabled={busy || (multiDay && myDays.size === 0)}
                onClick={() =>
                  void run(() =>
                    rpc(
                      'set_tournament_availability',
                      { p_tournament: tId, p_days: multiDay ? [...myDays].sort() : null, p_note: myNote },
                      'Zapisano Twoją obecność.'
                    )
                  )
                }
              >
                Zapisz
              </button>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {!me && canJoin && (
            <button
              className="btn btn-primary py-3"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await rpc('join_tournament', { p_tournament: tId }, 'Zapisano na turniej!');
                  if (userId && (memberMap[userId]?.positions?.length ?? 0) > 1) setPosEdit(userId);
                })
              }
            >
              <UserPlus className="h-4 w-4" /> Zapisz się na turniej
            </button>
          )}
          {!me && !canJoin && (
            <p className="text-center text-sm text-slate-500">Zapisy są zamknięte – w sprawie dopisania napisz do Opiekuna.</p>
          )}
          {me && !closed && (
            <button className="btn btn-secondary text-red-600" disabled={busy} onClick={() => setConfirm('leave')}>
              Wypisz mnie
            </button>
          )}
          {me && closed && (
            <p className="text-center text-xs text-slate-500">Zapisy są zamknięte – jeśli nie możesz jechać, daj znać Opiekunowi.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-secondary" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edytuj
            </button>
            {(isStaff || (isAuthor && !anyCharges)) && (
              <button className="btn btn-secondary text-red-600" onClick={() => setConfirm('delete')}>
                <Trash2 className="h-4 w-4" /> Usuń
              </button>
            )}
          </div>
          {isStaff && !closed && (
            <button
              className="btn btn-primary"
              disabled={busy || fee == null || count === 0}
              onClick={() => setConfirm('close')}
            >
              <Lock className="h-4 w-4" /> Zamknij zapisy i nalicz wpisowe
            </button>
          )}
          {isStaff && !closed && fee == null && (
            <p className="text-center text-xs text-amber-700">Aby zamknąć zapisy, uzupełnij kwotę wpisowego (Edytuj).</p>
          )}
          {isStaff && closed && (
            <button className="btn btn-ghost text-slate-600" disabled={busy} onClick={() => setConfirm('reopen')}>
              <LockOpen className="h-4 w-4" /> Otwórz zapisy ponownie
            </button>
          )}
        </div>
      </div>

      <div className="card mb-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Uczestnicy ({count})</h2>
          {isStaff && (
            <button className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(true)}>
              <UserPlus className="h-4 w-4" /> Dodaj
            </button>
          )}
        </div>
        {count > 0 && (
          <div className="mb-3">
            <PositionSummary positions={positions} />
          </div>
        )}
        {count > 0 && multiDay && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {perDay.map(({ d, n }) => (
              <span key={d} className="chip bg-amber-50 text-amber-800">
                📅 {dayShort(d)}: {n} os.
              </span>
            ))}
          </div>
        )}
        {count === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">Nikt jeszcze się nie zapisał.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {people.map((p, i) => {
              const m = memberMap[p.user_id];
              const showAmounts = isStaff || p.user_id === userId;
              return (
                <li key={p.user_id} className="py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-right text-xs text-slate-400">{i + 1}.</span>
                    <Avatar name={m?.profiles?.full_name} url={m?.profiles?.avatar_url} size="h-8 w-8" />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-medium ${p.user_id === userId ? 'text-indigo-700' : ''}`}>
                        {nameOf(p.user_id)}
                        {p.user_id === userId && ' (Ty)'}
                      </p>
                      {(avail[p.user_id]?.days || avail[p.user_id]?.note) && (
                        <p className="text-[11px] text-slate-500">
                          {avail[p.user_id]?.days && (
                            <span className="font-medium text-amber-700">
                              tylko {avail[p.user_id]!.days!.map(dayShort).join(', ')}
                            </span>
                          )}
                          {avail[p.user_id]?.days && avail[p.user_id]?.note && ' · '}
                          {avail[p.user_id]?.note && <span className="italic">„{avail[p.user_id]!.note}”</span>}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {showAmounts ? (
                          <>
                            <PaidAmount label="wpisowe" amount={p.fee_amount} paid={p.fee_paid} />
                            {p.extras_paid === null && p.extras_planned ? (
                              <PlannedChip label="dodatkowe" amount={p.extras_amount} />
                            ) : (
                              <PaidAmount label="dodatkowe" amount={p.extras_amount} paid={p.extras_paid} />
                            )}
                          </>
                        ) : (
                          <>
                            <PaidTick label="wpisowe" paid={p.fee_paid} />
                            {p.extras_paid === null && p.extras_planned ? (
                              <PlannedChip label="dodatkowe" />
                            ) : (
                              <PaidTick label="dodatkowe" paid={p.extras_paid} />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {p.user_id === userId || isStaff ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-lg"
                        aria-label="Zmień pozycję na turnieju"
                        onClick={() => setPosEdit(p.user_id)}
                      >
                        {effPos(p.user_id) ? (
                          <PositionBadge position={effPos(p.user_id)} />
                        ) : (
                          <span className="chip border border-dashed border-slate-300 text-slate-400">+ poz.</span>
                        )}
                      </button>
                    ) : (
                      <PositionBadge position={effPos(p.user_id)} />
                    )}
                    {isStaff && (
                      <button
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Wypisz"
                        onClick={() => setRemoveUid(p.user_id)}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {isStaff && p.extras && p.extras.length > 0 && (
                    <ul className="ml-16 mt-1 flex flex-col gap-0.5">
                      {p.extras.map((x) => (
                        <li key={x.id} className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="min-w-0 flex-1 truncate">
                            {x.description.split(':')[0]} – {money(x.amount)} {x.planned ? '(zaplanowane)' : x.paid ? '✓' : ''}
                          </span>
                          <button
                            className="text-slate-400 hover:text-red-600"
                            aria-label="Usuń opłatę"
                            onClick={() => setDelExtra({ id: x.id, label: `${x.description.split(':')[0]} ${money(x.amount)}` })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {isStaff && count > 0 && (
          <button
            className="btn btn-secondary mt-3 w-full"
            onClick={() => {
              setExtraFor(new Set(people.map((p) => p.user_id)));
              setExtraAmount('');
              setExtraDesc('Nocleg');
              setExtraOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Dodaj opłatę dodatkową (np. nocleg)
          </button>
        )}
        <p className="mt-3 text-xs text-slate-400">
          {isStaff
            ? 'Zielone = opłacone (wpłaty pokrywają obciążenia od najstarszych), czerwone = do zapłaty.'
            : '✓ = opłacone, ✗ = jeszcze do zapłaty. Kwoty widzi Opiekun i sam zainteresowany.'}
        </p>
      </div>

      <EventPositionModal
        open={posEdit !== null}
        title="Pozycja na tym turnieju"
        personName={posEdit && posEdit !== userId ? nameOf(posEdit) : undefined}
        memberPositions={posEdit ? memberMap[posEdit]?.positions ?? [] : []}
        current={posEdit ? effPos(posEdit) : null}
        busy={posBusy}
        onPick={(pos) =>
          void (async () => {
            if (!posEdit) return;
            setPosBusy(true);
            const { error } = await supabase().rpc('set_tournament_signup_position', {
              p_tournament: tId,
              p_user: posEdit === userId ? null : posEdit,
              p_position: pos,
            });
            setPosBusy(false);
            if (error) {
              toast(errMsg(error), 'error');
              return;
            }
            setPosEdit(null);
            await load();
          })()
        }
        onClose={() => setPosEdit(null)}
      />
      <TournamentFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => void load()} tournament={t} />

      <MemberPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeIds={people.map((p) => p.user_id)}
        title="Dopisz do turnieju"
        onPick={(uid) => {
          setPickerOpen(false);
          void run(() =>
            rpc(
              'staff_add_tournament_signup',
              { p_tournament: tId, p_user: uid },
              closed ? `Dopisano: ${nameOf(uid)}. Wpisowe przeliczone dla wszystkich.` : `Dopisano: ${nameOf(uid)}.`
            )
          );
        }}
      />

      <Modal
        open={extraOpen}
        onClose={() => setExtraOpen(false)}
        title="Opłata dodatkowa"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setExtraOpen(false)} disabled={busy}>
              Anuluj
            </button>
            <button className="btn btn-primary" onClick={() => void addExtra()} disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} Nalicz
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Za co</label>
              <input className="input" value={extraDesc} onChange={(e) => setExtraDesc(e.target.value)} />
            </div>
            <div>
              <label className="label">Kwota na osobę (zł)</label>
              <input className="input" inputMode="decimal" value={extraAmount} onChange={(e) => setExtraAmount(e.target.value)} placeholder="np. 80" />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="label">Kogo obciążyć</p>
              <button
                className="text-xs font-medium text-indigo-600"
                onClick={() =>
                  setExtraFor(extraFor.size === people.length ? new Set() : new Set(people.map((p) => p.user_id)))
                }
              >
                {extraFor.size === people.length ? 'Odznacz wszystkich' : 'Zaznacz wszystkich'}
              </button>
            </div>
            <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
              {people.map((p) => (
                <li key={p.user_id}>
                  <label className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-indigo-600"
                      checked={extraFor.has(p.user_id)}
                      onChange={(e) =>
                        setExtraFor((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(p.user_id);
                          else n.delete(p.user_id);
                          return n;
                        })
                      }
                    />
                    {nameOf(p.user_id)}
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-slate-500">
              Każda zaznaczona osoba dostanie osobne obciążenie. Kto był krócej – odznacz go i dodaj mu osobno mniejszą kwotę.{' '}
              {closed
                ? 'Zapisy są zamknięte – opłata od razu trafi na saldo.'
                : 'Zapisy są otwarte – opłata będzie zaplanowana i zejdzie z salda razem z wpisowym przy zamknięciu zapisów.'}
            </p>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={confirm === 'close'}
        title="Zamknąć zapisy?"
        message={
          <>
            Wpisowe <strong>{money(fee)}</strong> zostanie podzielone na <strong>{count}</strong> os. – każdy dostanie obciążenie{' '}
            <strong>{money(share)}</strong>.
            {people.some((p) => p.extras_planned) && <> Razem z wpisowym zejdą też zaplanowane opłaty dodatkowe (np. nocleg).</>}{' '}
            Zawodnicy nie będą mogli sami się zapisać ani wypisać. Zmiany listy (wypadnięcie, dopisanie) zrobisz tutaj – kwoty
            przeliczą się automatycznie.
          </>
        }
        confirmText="Zamknij i nalicz"
        busy={busy}
        onConfirm={() => void run(() => rpc('close_tournament', { p_tournament: tId }, 'Zapisy zamknięte – wpisowe i opłaty dodatkowe naliczone.'))}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'reopen'}
        title="Otworzyć zapisy ponownie?"
        message="Naliczone wpisowe i opłaty dodatkowe zostaną cofnięte z sald (opłaty dodatkowe wrócą do zaplanowanych). Po ponownym zamknięciu wszystko naliczy się od nowa."
        confirmText="Otwórz zapisy"
        busy={busy}
        onConfirm={() => void run(() => rpc('reopen_tournament', { p_tournament: tId }, 'Zapisy otwarte ponownie.'))}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'leave'}
        title="Wypisać się z turnieju?"
        message="Możesz zapisać się ponownie, dopóki zapisy są otwarte."
        confirmText="Wypisz mnie"
        danger
        busy={busy}
        onConfirm={() => void run(() => rpc('leave_tournament', { p_tournament: tId }, 'Wypisano z turnieju.'))}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'delete'}
        title="Usunąć turniej?"
        message={
          anyCharges
            ? 'Turniej i wszystkie jego obciążenia (wpisowe, opłaty dodatkowe) zostaną usunięte z sald zawodników.'
            : 'Turniej i lista zapisanych zostaną usunięte.'
        }
        confirmText="Usuń turniej"
        danger
        busy={busy}
        onConfirm={() =>
          void (async () => {
            try {
              await rpc('delete_tournament', { p_tournament: tId }, 'Usunięto turniej.');
              router.replace(clubHref(clubId));
            } catch {
              /* */
            }
          })()
        }
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={removeUid !== null}
        title="Wypisać z turnieju?"
        message={
          removeUid && (
            <>
              <strong>{nameOf(removeUid)}</strong> zostanie wypisany.
              {closed || people.find((p) => p.user_id === removeUid)?.extras_amount != null ? (
                <> Jego obciążenia za ten turniej zostaną cofnięte, a wpisowe przeliczy się na pozostałych {count - 1} os.</>
              ) : null}
            </>
          )
        }
        confirmText="Wypisz"
        danger
        busy={busy}
        onConfirm={() =>
          void run(async () => {
            const uid = removeUid!;
            await rpc('staff_remove_tournament_signup', { p_tournament: tId, p_user: uid }, `Wypisano: ${nameOf(uid)}.`);
            setRemoveUid(null);
          })
        }
        onClose={() => setRemoveUid(null)}
      />
      <ConfirmModal
        open={delExtra !== null}
        title="Usunąć opłatę dodatkową?"
        message={delExtra && <>Obciążenie „{delExtra.label}” zostanie cofnięte.</>}
        confirmText="Usuń"
        danger
        busy={busy}
        onConfirm={() =>
          void run(async () => {
            await rpc('delete_tournament_extra', { p_extra: delExtra!.id }, 'Usunięto opłatę.');
            setDelExtra(null);
          })
        }
        onClose={() => setDelExtra(null)}
      />
    </>
  );
}
