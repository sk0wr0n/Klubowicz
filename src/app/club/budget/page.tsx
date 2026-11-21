'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, Lightbulb, Pencil, Plus, RotateCcw, Target, Trash2, Users, Volleyball, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { currentPeriod, formatShortDay, formatTime, money, periodLabel } from '@/lib/format';
import { clubHref, trainingHref } from '@/lib/nav';
import OwnerGuard from '@/components/OwnerGuard';
import { useToast } from '@/components/Toast';
import { ConfirmModal, EmptyState, ErrorBox, Modal, PageTitle, Spinner } from '@/components/ui';

interface BudgetItem {
  id: string;
  name: string;
  amount: number;
}
interface BudgetTraining {
  id: string;
  title: string;
  starts_at: string;
  status: 'scheduled' | 'settled';
  max: number;
  signed: number;
  per_session_signed: number;
  charged: number;
  charged_count: number;
}
interface Overview {
  period: string;
  is_past: boolean;
  monthly_fee: number;
  single_fee: number;
  items: BudgetItem[];
  items_custom: boolean;
  scheduled: { monthly: number; single: number; from: string } | null;
  can_edit: boolean;
  monthly: { members: number; charged_count: number; charged: number; expected: number; expected_count: number };
  avg_per_session: number;
  trainings: BudgetTraining[];
  payments_in: number;
}

/** „2026-12” → „1 grudnia 2026” */
function firstDayLabel(p: string): string {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function shiftPeriod(p: string, delta: number): string {
  const [y, m] = p.split('-').map(Number);
  return currentPeriod(new Date(y, m - 1 + delta, 1));
}
const ceil5 = (v: number) => Math.max(5, Math.ceil(v / 5) * 5);
const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

interface Suggestion {
  key: string;
  title: string;
  desc: string;
  monthly: number | null;
  single: number | null;
}

type Scope = 'month' | 'all';

function BudgetGuard({ children }: { children: ReactNode }) {
  const { isFinance, ctx, clubId } = useClub();
  if (isFinance) return <OwnerGuard allowFinance>{children}</OwnerGuard>;
  if (!ctx.club.budget_public)
    return <EmptyState title="Brak dostępu">Budżet klubu widzą Właściciel i Skarbnik.</EmptyState>;
  return (
    <>
      <Link href={clubHref(clubId, 'finance')} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Finanse
      </Link>
      {children}
    </>
  );
}

export default function BudgetPage() {
  const { clubId, isOwner, reload } = useClub();
  const toast = useToast();
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; name: string; amount: string; scope: Scope } | null>(null);
  const [busy, setBusy] = useState(false);
  const [delItem, setDelItem] = useState<BudgetItem | null>(null);
  const [apply, setApply] = useState<Suggestion | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('budget_overview', { p_club: clubId, p_period: period });
    if (error) setError(errMsg(error));
    else {
      setError(null);
      setData(data as Overview);
    }
  }, [clubId, period]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const calc = useMemo(() => {
    if (!data) return null;
    const fm = Number(data.monthly_fee);
    const fs = Number(data.single_fee);
    const target = data.items.reduce((s, i) => s + Number(i.amount), 0);
    const monthly = Number(data.monthly.expected);
    const settled = data.trainings.filter((t) => t.status === 'settled');
    const planned = data.trainings.filter((t) => t.status === 'scheduled');
    const settledIncome = settled.reduce((s, t) => s + Number(t.charged), 0);
    const settledEntries = settled.reduce((s, t) => s + t.charged_count, 0);
    const signedEntries = planned.reduce((s, t) => s + t.per_session_signed, 0);
    const avg = Number(data.avg_per_session);
    const forecastEntries = planned.reduce((s, t) => s + Math.max(t.per_session_signed, Math.round(avg)), 0);
    const secured = monthly + settledIncome + signedEntries * fs;
    const forecast = monthly + settledIncome + forecastEntries * fs;
    const gap = target - forecast;

    // podpowiedzi zmiany stawek – „żeby w podobnym miesiącu wyjść na cel”
    const M = data.monthly.expected_count;
    const E = settledEntries + forecastEntries;
    const suggestions: Suggestion[] = [];
    const tolerance = Math.max(20, target * 0.03);
    if (target > 0 && Math.abs(gap) > tolerance && (M > 0 || E > 0)) {
      const up = gap > 0;
      if (M > 0) {
        const nm = ceil5((target - E * fs) / M);
        if (nm !== fm && (up ? nm > fm : nm < fm))
          suggestions.push({
            key: 'm',
            title: `Składka miesięczna ${money(nm)}`,
            desc: `zamiast ${money(fm)}, opłata za trening bez zmian (${M} ${plural(M, 'osoba', 'osoby', 'osób')} na składce)`,
            monthly: nm,
            single: null,
          });
      }
      if (E > 0) {
        const ns = ceil5((target - M * fm) / E);
        if (ns !== fs && (up ? ns > fs : ns < fs))
          suggestions.push({
            key: 's',
            title: `Opłata za trening ${money(ns)}`,
            desc: `zamiast ${money(fs)}, składka bez zmian (ok. ${E} ${plural(E, 'wejście', 'wejścia', 'wejść')} „za trening” w miesiącu)`,
            monthly: null,
            single: ns,
          });
      }
      const base = M * fm + E * fs;
      if (M > 0 && E > 0 && base > 0) {
        const k = target / base;
        const nm = ceil5(fm * k);
        const ns = ceil5(fs * k);
        if ((nm !== fm || ns !== fs) && (up ? nm >= fm && ns >= fs : nm <= fm && ns <= fs))
          suggestions.push({
            key: 'b',
            title: `Obie stawki: składka ${money(nm)}, trening ${money(ns)}`,
            desc: `${up ? 'podwyżka' : 'obniżka'} po równo o ok. ${Math.abs(Math.round((k - 1) * 100))}%`,
            monthly: nm,
            single: ns,
          });
      }
    }
    return {
      fm,
      fs,
      target,
      monthly,
      settled,
      planned,
      settledIncome,
      settledEntries,
      signedEntries,
      forecastEntries,
      avg,
      secured,
      forecast,
      gap,
      suggestions,
    };
  }, [data]);

  async function saveItem() {
    if (!edit) return;
    const amount = Number(edit.amount.replace(',', '.'));
    setBusy(true);
    const { error } = await supabase().rpc('save_budget_item', {
      p_club: clubId,
      p_period: period,
      p_id: edit.id,
      p_name: edit.name,
      p_amount: amount,
      p_scope: edit.scope,
    });
    setBusy(false);
    if (error) toast(errMsg(error), 'error');
    else {
      setEdit(null);
      await load();
    }
  }

  async function removeItem(scope: Scope) {
    if (!delItem) return;
    setBusy(true);
    const { error } = await supabase().rpc('delete_budget_item', {
      p_club: clubId,
      p_period: period,
      p_id: delItem.id,
      p_scope: scope,
    });
    setBusy(false);
    setDelItem(null);
    if (error) toast(errMsg(error), 'error');
    else await load();
  }

  async function resetMonth() {
    setBusy(true);
    const { error } = await supabase().rpc('reset_budget_month', { p_club: clubId, p_period: period });
    setBusy(false);
    if (error) toast(errMsg(error), 'error');
    else {
      toast('Przywrócono stałe koszty w tym miesiącu.');
      await load();
    }
  }

  async function applySuggestion() {
    if (!apply) return;
    setBusy(true);
    const { error } = await supabase().rpc('schedule_club_fees', {
      p_club: clubId,
      p_monthly: apply.monthly,
      p_single: apply.single,
      p_from: applyFrom,
    });
    setBusy(false);
    setApply(null);
    if (error) toast(errMsg(error), 'error');
    else {
      toast(`Nowe stawki zaplanowane od ${firstDayLabel(applyFrom)}.`);
      await reload();
      await load();
    }
  }

  const isCurrent = period === currentPeriod();
  // zmiany stawek zawsze od kolejnego miesiąca (albo od oglądanego, jeśli jest w przyszłości)
  const nextMonth = shiftPeriod(currentPeriod(), 1);
  const applyFrom = period > nextMonth ? period : nextMonth;

  async function cancelScheduled() {
    setBusy(true);
    const { error } = await supabase().rpc('cancel_scheduled_fees', { p_club: clubId });
    setBusy(false);
    if (error) toast(errMsg(error), 'error');
    else {
      toast('Anulowano zaplanowaną zmianę stawek.');
      await reload();
      await load();
    }
  }
  const canEdit = data?.can_edit === true;
  const monthName = periodLabel(period).split(' ')[0];
  const pct = (v: number) => (calc && calc.target > 0 ? Math.min(100, Math.round((v / calc.target) * 100)) : 0);

  return (
    <BudgetGuard>
      <PageTitle title="Budżet miesiąca" subtitle="Cel kosztów vs składki i opłaty za treningi" />

      <div className="mb-4 flex items-center justify-between rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        <button className="btn btn-ghost btn-sm" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Poprzedni miesiąc">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button className="text-center" onClick={() => setPeriod(currentPeriod())}>
          <span className="block font-semibold capitalize">{periodLabel(period)}</span>
          {!isCurrent && <span className="block text-[11px] text-indigo-600">wróć do bieżącego</span>}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Następny miesiąc">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {error && <ErrorBox message={error} />}
      {!data || !calc ? (
        !error && <Spinner className="mx-auto my-10 h-6 w-6 text-indigo-600" />
      ) : (
        <div className="flex flex-col gap-4">
          {data.scheduled && (
            <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-indigo-900">Od {firstDayLabel(data.scheduled.from)} nowe stawki</span>
                <span className="block text-xs text-indigo-800">
                  składka {money(data.scheduled.monthly)} · trening {money(data.scheduled.single)}
                  {period >= data.scheduled.from ? ' – uwzględnione w tym miesiącu' : ''}
                </span>
              </span>
              {isOwner && (
                <button className="shrink-0 text-xs font-semibold text-indigo-700 underline" disabled={busy} onClick={() => void cancelScheduled()}>
                  Anuluj
                </button>
              )}
            </div>
          )}
          {/* CEL */}
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <Target className="h-5 w-5 text-indigo-600" /> Cel miesiąca
              </h2>
              <span className="text-xl font-bold">{money(calc.target)}</span>
            </div>
            {calc.target === 0 ? (
              <p className="text-sm text-slate-500">
                {canEdit
                  ? 'Dodaj poniżej koszty miesięczne (np. sala, księgowa), żeby zobaczyć, jak daleko jesteście od celu.'
                  : 'Cel na ten miesiąc nie jest jeszcze ustawiony.'}
              </p>
            ) : (
              <>
                <div className="relative mt-1 h-4 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-indigo-200"
                    style={{ width: `${pct(calc.forecast)}%` }}
                    title="prognoza"
                  />
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full ${calc.secured >= calc.target ? 'bg-emerald-500' : 'bg-indigo-600'}`}
                    style={{ width: `${pct(calc.secured)}%` }}
                    title="pewne"
                  />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-base font-bold text-indigo-700">{money(calc.secured)}</p>
                    <p className="text-slate-500">pewne ({pct(calc.secured)}%)</p>
                  </div>
                  <div>
                    <p className="text-base font-bold text-indigo-400">{money(calc.forecast)}</p>
                    <p className="text-slate-500">prognoza</p>
                  </div>
                  <div>
                    <p className={`text-base font-bold ${calc.gap > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {calc.gap > 0 ? `−${money(calc.gap)}` : `+${money(-calc.gap)}`}
                    </p>
                    <p className="text-slate-500">{calc.gap > 0 ? 'brakuje' : 'nadwyżka'}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Pewne = składki + rozliczone treningi + osoby już zapisane „za trening”. Prognoza zakłada co najmniej{' '}
                  {Math.round(calc.avg)} {plural(Math.round(calc.avg), 'osobę', 'osoby', 'osób')} „za trening” na każdym zaplanowanym
                  treningu (średnia z ostatnich 90 dni).
                </p>
              </>
            )}
          </div>

          {/* SKĄD PIENIĄDZE */}
          <div className="card">
            <h2 className="mb-2 font-semibold">Skąd pieniądze</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              <li className="flex items-center gap-3 py-2.5">
                <Users className="h-5 w-5 shrink-0 text-violet-600" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Składki miesięczne</span>
                  <span className="block text-xs text-slate-500">
                    {data.monthly.expected_count} {plural(data.monthly.expected_count, 'osoba', 'osoby', 'osób')} ×{' '}
                    {money(calc.fm)}
                    {data.monthly.charged_count > 0
                      ? ` · naliczono ${data.monthly.charged_count}`
                      : data.is_past
                        ? ' · nie naliczono'
                        : ' · jeszcze nienaliczone'}
                  </span>
                </span>
                <span className="font-semibold">{money(calc.monthly)}</span>
              </li>
              <li className="flex items-center gap-3 py-2.5">
                <Volleyball className="h-5 w-5 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Treningi rozliczone</span>
                  <span className="block text-xs text-slate-500">
                    {calc.settled.length} {plural(calc.settled.length, 'trening', 'treningi', 'treningów')} · {calc.settledEntries}{' '}
                    {plural(calc.settledEntries, 'osoba', 'osoby', 'osób')} „za trening”
                  </span>
                </span>
                <span className="font-semibold">{money(calc.settledIncome)}</span>
              </li>
              <li className="flex items-center gap-3 py-2.5">
                <Volleyball className="h-5 w-5 shrink-0 text-indigo-400" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Treningi zaplanowane</span>
                  <span className="block text-xs text-slate-500">
                    {calc.planned.length} {plural(calc.planned.length, 'trening', 'treningi', 'treningów')} · zapisanych „za
                    trening”: {calc.signedEntries} ({money(calc.signedEntries * calc.fs)}) · prognoza {calc.forecastEntries} os.
                  </span>
                </span>
                <span className="font-semibold text-indigo-500">{money(calc.forecastEntries * calc.fs)}</span>
              </li>
              {canEdit && (
              <li className="flex items-center gap-3 py-2.5">
                <Wallet className="h-5 w-5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Wpłynęło przelewami</span>
                  <span className="block text-xs text-slate-500">wszystkie wpłaty zaksięgowane w tym miesiącu</span>
                </span>
                <span className="font-semibold text-slate-600">{money(data.payments_in)}</span>
              </li>
              )}
            </ul>
            {calc.fs > 0 && calc.fm > 0 && (
              <p className="mt-2 text-[11px] text-slate-400">
                Składka {money(calc.fm)} = {(calc.fm / calc.fs).toFixed(1).replace('.', ',')} treningu po {money(calc.fs)}.
              </p>
            )}
          </div>

          {/* PODPOWIEDŹ */}
          {canEdit && calc.target > 0 && (
            <div className={`card ${calc.gap > 0 ? 'border-amber-300 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/50'}`}>
              <h2 className="mb-1 flex items-center gap-2 font-semibold">
                <Lightbulb className={`h-5 w-5 ${calc.gap > 0 ? 'text-amber-600' : 'text-emerald-600'}`} /> Podpowiedź
              </h2>
              {calc.suggestions.length === 0 ? (
                <p className="text-sm text-slate-600">
                  {Math.abs(calc.gap) <= Math.max(20, calc.target * 0.03)
                    ? 'Stawki są dobrze dobrane – prognoza pokrywa cel. 👍'
                    : 'Za mało danych, żeby coś zaproponować (brak osób na składce i zapisów na treningi).'}
                </p>
              ) : (
                <>
                  <p className="mb-2 text-sm text-slate-600">
                    {calc.gap > 0
                      ? `Przy obecnych stawkach brakuje ok. ${money(calc.gap)}. Żeby w podobnym miesiącu wyjść na cel:`
                      : `Prognoza przekracza cel o ok. ${money(-calc.gap)}. Możecie obniżyć stawki:`}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {calc.suggestions.map((s) => (
                      <li key={s.key} className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{s.title}</span>
                          <span className="block text-xs text-slate-500">{s.desc}</span>
                        </span>
                        {isOwner && (
                          <button className="btn btn-secondary btn-sm shrink-0" onClick={() => setApply(s)}>
                            Od {firstDayLabel(applyFrom).split(' ').slice(0, 2).join(' ')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Inne opcje: więcej treningów w miesiącu, zachęcenie osób „za trening” do składki albo większy limit miejsc.
                    {!isOwner && ' Stawki zmienia Właściciel klubu.'}
                  </p>
                </>
              )}
            </div>
          )}

          {/* KOSZTY */}
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">
                Koszty – <span className="capitalize">{monthName}</span>
              </h2>
              {canEdit && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEdit({ id: null, name: '', amount: '', scope: data.items.length === 0 && !data.items_custom ? 'all' : 'month' })}
                >
                  <Plus className="h-4 w-4" /> Dodaj
                </button>
              )}
            </div>
            {data.items_custom && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <span>Kwoty ustawione tylko dla tego miesiąca.</span>
                {canEdit && (
                  <button className="inline-flex items-center gap-1 font-semibold" disabled={busy} onClick={() => void resetMonth()}>
                    <RotateCcw className="h-3.5 w-3.5" /> Przywróć stałe
                  </button>
                )}
              </div>
            )}
            {data.items.length === 0 ? (
              <p className="text-sm text-slate-500">
                {canEdit ? 'Brak pozycji. Dodaj np. „Sala – 1500 zł”, „Księgowa – 150 zł”.' : 'Brak pozycji.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{i.name}</span>
                    <span className="text-sm font-semibold">{money(i.amount)}</span>
                    {canEdit && (
                      <>
                        <button
                          className="btn btn-ghost btn-sm px-2"
                          aria-label="Edytuj"
                          onClick={() => setEdit({ id: i.id, name: i.name, amount: String(i.amount), scope: 'month' })}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button className="btn btn-ghost btn-sm px-2 text-red-600" aria-label="Usuń" onClick={() => setDelItem(i)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
                <li className="flex justify-between py-2 text-sm font-bold">
                  <span>Razem</span>
                  <span>{money(calc.target)}</span>
                </li>
              </ul>
            )}
            {canEdit && (
              <p className="mt-1 text-[11px] text-slate-400">
                Stałe koszty obowiązują co miesiąc. Gdy faktura w danym miesiącu jest inna (np. święta), zmień kwotę „tylko w tym miesiącu”.
              </p>
            )}
          </div>

          {/* TRENINGI */}
          {data.trainings.length > 0 && (
            <div className="card">
              <h2 className="mb-2 font-semibold">Treningi w miesiącu</h2>
              <ul className="divide-y divide-slate-100">
                {data.trainings.map((t) => (
                  <li key={t.id}>
                    <Link href={trainingHref(clubId, t.id)} className="flex items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium capitalize">
                          {formatShortDay(t.starts_at)}, {formatTime(t.starts_at)}
                        </span>
                        <span className="block text-xs text-slate-500">
                          zapisanych {t.signed}/{t.max} · „za trening” {t.status === 'settled' ? t.charged_count : t.per_session_signed}
                        </span>
                      </span>
                      {t.status === 'settled' ? (
                        <span className="font-semibold text-emerald-700">{money(t.charged)}</span>
                      ) : (
                        <span className="text-xs text-indigo-500">≈ {money(Math.max(t.per_session_signed, Math.round(calc.avg)) * calc.fs)}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? 'Edytuj koszt' : 'Nowy koszt miesięczny'}>
        {edit && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveItem();
            }}
          >
            <label>
              <span className="label">Nazwa</span>
              <input
                className="input"
                placeholder="np. Sala, Księgowa, Piłki"
                value={edit.name}
                maxLength={60}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                autoFocus
              />
            </label>
            <label>
              <span className="label">Kwota miesięcznie (zł)</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="1500"
                value={edit.amount}
                onChange={(e) => setEdit({ ...edit, amount: e.target.value })}
              />
            </label>
            <div>
              <span className="label">Dotyczy</span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['month', 'Tylko ten miesiąc', 'np. niższa faktura w święta'],
                    ['all', 'Ten i kolejne miesiące', 'stała kwota; poprzednie bez zmian'],
                  ] as const
                ).map(([v, t, d]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setEdit({ ...edit, scope: v })}
                    className={`rounded-xl border p-2.5 text-left text-sm ${
                      edit.scope === v ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-200'
                    }`}
                  >
                    <span className="block font-semibold">{t}</span>
                    <span className="block text-[11px] text-slate-500">{d}</span>
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" disabled={busy || !edit.name.trim() || !edit.amount.trim()}>
              {busy ? <Spinner className="h-4 w-4" /> : 'Zapisz'}
            </button>
          </form>
        )}
      </Modal>

      <Modal open={delItem !== null} onClose={() => setDelItem(null)} title="Usunąć koszt?">
        {delItem && (
          <div className="flex flex-col gap-2">
            <p className="mb-1 text-sm text-slate-600">
              {delItem.name} – {money(delItem.amount)}
            </p>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void removeItem('month')}>
              Usuń tylko w tym miesiącu
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => void removeItem('all')}>
              Usuń na stałe (ten i kolejne miesiące)
            </button>
          </div>
        )}
      </Modal>
      <ConfirmModal
        open={apply !== null}
        title={`Nowe stawki od ${firstDayLabel(applyFrom)}?`}
        message={
          apply ? (
            <>
              {apply.monthly !== null && (
                <span className="block">
                  Składka miesięczna: <strong>{money(apply.monthly)}</strong>
                </span>
              )}
              {apply.single !== null && (
                <span className="block">
                  Opłata za trening: <strong>{money(apply.single)}</strong>
                </span>
              )}
              <span className="mt-2 block text-xs text-slate-500">
                Do końca bieżącego miesiąca obowiązują dotychczasowe stawki. Od {firstDayLabel(applyFrom)} nowa składka i opłata za
                treningi rozliczane od tego dnia. Zawodnicy zobaczą zapowiedź zmiany w Finansach. Możesz ją anulować do tego czasu.
              </span>
            </>
          ) : (
            ''
          )
        }
        confirmText="Zaplanuj zmianę"
        busy={busy}
        onConfirm={() => void applySuggestion()}
        onClose={() => setApply(null)}
      />
    </BudgetGuard>
  );
}
