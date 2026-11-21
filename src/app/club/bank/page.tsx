'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileUp, Landmark, Pencil } from 'lucide-react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { currentPeriod, formatDate, formatDateTime, money, periodLabel, todayInput } from '@/lib/format';
import { parseAmount } from '@/lib/csv';
import { clubHref } from '@/lib/nav';
import FinanceTabs, { ClubFinanceGuard } from '@/components/FinanceTabs';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorBox, Modal, Spinner } from '@/components/ui';

interface Overview {
  balance: number | null;
  snapshot: { as_of: string; balance: number; source: 'csv' | 'manual'; created_at: string } | null;
  last_date: string | null;
  first_date: string | null;
  last_import_at: string | null;
  rows: number;
  months: { period: string; inflow: number | null; outflow: number | null }[];
}
interface Row {
  id: string;
  booked_on: string;
  amount: number;
  title: string | null;
  counterparty: string | null;
  balance_after: number | null;
  member_id: string | null;
}

function shift(p: string, d: number) {
  const [y, m] = p.split('-').map(Number);
  return currentPeriod(new Date(y, m - 1 + d, 1));
}

/** Konto klubu: saldo i historia operacji z wyciągów CSV (Właściciel + Skarbnik). */
export default function BankPage() {
  const { clubId, nameOf } = useClub();
  const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<{ date: string; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadOv = useCallback(async () => {
    const { data, error } = await supabase().rpc('bank_overview', { p_club: clubId });
    if (error) setError(errMsg(error));
    else {
      const o = data as Overview;
      setOv(o);
      // na start pokaż miesiąc z ostatnimi operacjami
      if (o.last_date) setPeriod((p) => (p === currentPeriod() ? o.last_date!.slice(0, 7) : p));
    }
  }, [clubId]);

  useEffect(() => {
    void loadOv();
  }, [loadOv]);

  useEffect(() => {
    setRows(null);
    void supabase()
      .rpc('bank_history', { p_club: clubId, p_period: period })
      .then(({ data, error }) => {
        if (error) setError(errMsg(error));
        else setRows((data ?? []) as Row[]);
      });
  }, [clubId, period]);

  const visible = useMemo(
    () => (rows ?? []).filter((r) => filter === 'all' || (filter === 'in' ? r.amount > 0 : r.amount < 0)),
    [rows, filter]
  );
  const monthIn = (rows ?? []).filter((r) => r.amount > 0).reduce((s, r) => s + Number(r.amount), 0);
  const monthOut = -(rows ?? []).filter((r) => r.amount < 0).reduce((s, r) => s + Number(r.amount), 0);

  async function saveManual() {
    if (!manual) return;
    const amount = parseAmount(manual.amount);
    if (amount === null) {
      toast('Podaj kwotę, np. 2450,30', 'error');
      return;
    }
    setBusy(true);
    const { error } = await supabase().rpc('set_bank_balance', { p_club: clubId, p_date: manual.date, p_balance: amount });
    setBusy(false);
    if (error) toast(errMsg(error), 'error');
    else {
      setManual(null);
      toast('Zapisano stan konta.');
      await loadOv();
    }
  }

  return (
    <ClubFinanceGuard financeOnly>
      <FinanceTabs />
      {error && <ErrorBox message={error} />}

      {!ov ? (
        !error && <Spinner className="mx-auto my-10 h-6 w-6 text-indigo-600" />
      ) : (
        <div className="flex flex-col gap-4">
          <div
            className={`card text-center ${
              ov.balance === null ? '' : ov.balance < 0 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <p className="flex items-center justify-center gap-2 text-sm font-medium text-slate-600">
              <Landmark className="h-4 w-4" /> Stan konta klubu
            </p>
            {ov.balance === null ? (
              <p className="my-2 text-sm text-slate-500">
                Brak salda. Zaimportuj wyciąg z kolumną „Saldo po operacji” albo wpisz stan konta ręcznie.
              </p>
            ) : (
              <>
                <p className={`my-1 text-4xl font-bold ${ov.balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {money(ov.balance)}
                </p>
                <p className="text-xs text-slate-500">
                  {ov.snapshot && (
                    <>
                      saldo {ov.snapshot.source === 'csv' ? 'z wyciągu' : 'wpisane ręcznie'} na {formatDate(ov.snapshot.as_of)}
                      {ov.last_date && ov.last_date > ov.snapshot.as_of && ` + operacje do ${formatDate(ov.last_date)}`}
                    </>
                  )}
                </p>
              </>
            )}
            {ov.last_import_at && (
              <p className="mt-1 text-[11px] text-slate-400">Ostatni import: {formatDateTime(ov.last_import_at)}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href={clubHref(clubId, 'import')} className="btn btn-primary btn-sm">
                <FileUp className="h-4 w-4" /> Importuj CSV
              </Link>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setManual({ date: todayInput(), amount: ov.balance !== null ? String(ov.balance) : '' })}
              >
                <Pencil className="h-4 w-4" /> Wpisz stan
              </button>
            </div>
          </div>

          {ov.months.length > 0 && (
            <div className="card">
              <h2 className="mb-2 font-semibold">Miesiące</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {ov.months.map((m) => {
                  const inf = Number(m.inflow ?? 0);
                  const out = Number(m.outflow ?? 0);
                  const net = inf - out;
                  return (
                    <li key={m.period}>
                      <button
                        className={`flex w-full items-center gap-2 py-2 text-left ${m.period === period ? 'font-semibold' : ''}`}
                        onClick={() => setPeriod(m.period)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block capitalize">{periodLabel(m.period)}</span>
                          <span className="block text-xs font-normal">
                            <span className="text-emerald-600">+{money(inf)}</span>
                            <span className="text-slate-400"> · </span>
                            <span className="text-red-600">−{money(out)}</span>
                          </span>
                        </span>
                        <span className={`shrink-0 text-right font-semibold ${net < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {net >= 0 ? '+' : '−'}
                          {money(Math.abs(net))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <button className="btn btn-ghost btn-sm" onClick={() => setPeriod(shift(period, -1))} aria-label="Poprzedni miesiąc">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <p className="font-semibold capitalize">{periodLabel(period)}</p>
              <button className="btn btn-ghost btn-sm" onClick={() => setPeriod(shift(period, 1))} aria-label="Następny miesiąc">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-3 flex gap-2">
              {(
                [
                  ['all', 'Wszystkie'],
                  ['in', `Wpływy +${money(monthIn)}`],
                  ['out', `Wydatki −${money(monthOut)}`],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-secondary'} px-2.5 text-xs`}
                  onClick={() => setFilter(k)}
                >
                  {l}
                </button>
              ))}
            </div>
            {rows === null ? (
              <Spinner className="mx-auto my-6 h-6 w-6" />
            ) : visible.length === 0 ? (
              <EmptyState title="Brak operacji">
                {ov.rows === 0 ? 'Zaimportuj wyciąg CSV – zapiszemy całą historię konta.' : 'W tym miesiącu nie ma zapisanych operacji.'}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visible.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">{r.title || '(brak tytułu)'}</span>
                      <span className="block break-words text-xs text-slate-500">
                        {formatDate(r.booked_on)}
                        {r.counterparty && ` · ${r.counterparty}`}
                      </span>
                      {r.member_id && (
                        <span className="chip mt-1 bg-emerald-100 text-emerald-700">wpłata: {nameOf(r.member_id)}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block text-sm font-semibold ${r.amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {r.amount > 0 ? '+' : '−'}
                        {money(Math.abs(Number(r.amount)))}
                      </span>
                      {r.balance_after !== null && (
                        <span className="block text-[11px] text-slate-400">saldo {money(r.balance_after)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <Modal open={manual !== null} onClose={() => setManual(null)} title="Stan konta">
        {manual && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveManual();
            }}
          >
            <p className="text-sm text-slate-600">
              Wpisz saldo z aplikacji banku na koniec wybranego dnia. Operacje z późniejszych wyciągów będą do niego doliczane.
            </p>
            <label>
              <span className="label">Na dzień</span>
              <input className="input" type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
            </label>
            <label>
              <span className="label">Saldo (zł)</span>
              <input
                className="input"
                inputMode="decimal"
                value={manual.amount}
                onChange={(e) => setManual({ ...manual, amount: e.target.value })}
                autoFocus
              />
            </label>
            <button className="btn btn-primary" disabled={busy || !manual.amount.trim() || !manual.date}>
              {busy ? <Spinner className="h-4 w-4" /> : 'Zapisz'}
            </button>
          </form>
        )}
      </Modal>
    </ClubFinanceGuard>
  );
}
