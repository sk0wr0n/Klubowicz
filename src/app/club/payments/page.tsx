'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, CalendarDays, ChevronRight } from 'lucide-react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { currentPeriod, money, periodLabel, todayInput } from '@/lib/format';
import type { AdminMember, Transaction } from '@/lib/types';
import OwnerGuard from '@/components/OwnerGuard';
import TransactionList from '@/components/TransactionList';
import { useToast } from '@/components/Toast';
import { Avatar, ConfirmModal, ErrorBox, Modal, PageTitle, Spinner } from '@/components/ui';

export default function PaymentsPage() {
  const { clubId, ctx, suspended } = useClub();
  const toast = useToast();
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [chargeOpen, setChargeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'debt'>('all');

  const [payOpen, setPayOpen] = useState(false);
  const [payUser, setPayUser] = useState('');
  const [payType, setPayType] = useState<'payment' | 'adjustment'>('payment');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayInput());
  const [payDesc, setPayDesc] = useState('');

  const [historyOf, setHistoryOf] = useState<AdminMember | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [delTx, setDelTx] = useState<Transaction | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('admin_list_members', { p_club: clubId });
    if (error) setError(errMsg(error));
    else setMembers(((data ?? []) as AdminMember[]).filter((m) => m.status !== 'pending'));
    setLoading(false);
  }, [clubId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadHistory = useCallback(
    async (m: AdminMember) => {
      const { data } = await supabase()
        .from('transactions')
        .select('id, club_id, user_id, amount, type, description, booked_at, created_at')
        .eq('club_id', clubId)
        .eq('user_id', m.user_id)
        .order('booked_at', { ascending: false });
      setHistory((data ?? []) as Transaction[]);
    },
    [clubId]
  );

  const monthlyCount = members.filter((m) => m.status === 'active' && m.billing_mode === 'monthly').length;
  const totalDebt = members.reduce((s, m) => s + Math.min(0, Number(m.balance)), 0);
  const visible = members.filter((m) => filter === 'all' || Number(m.balance) < 0);

  async function chargeMonth() {
    setBusy(true);
    const { data, error } = await supabase().rpc('charge_monthly_fees', { p_club: clubId, p_period: period });
    setBusy(false);
    setChargeOpen(false);
    if (error) toast(errMsg(error), 'error');
    else {
      const n = Number(data);
      toast(
        n > 0
          ? `Naliczono składkę za ${periodLabel(period)}: ${n} os. × ${money(ctx.club.monthly_fee_amount)}.`
          : `Składka za ${periodLabel(period)} była już naliczona wszystkim abonentom.`,
        n > 0 ? 'success' : 'info'
      );
      await load();
    }
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(payAmount.replace(',', '.'));
    if (!payUser || !amount) {
      toast('Wybierz zawodnika i podaj kwotę.', 'error');
      return;
    }
    setBusy(true);
    const { error } = await supabase().rpc('add_manual_transaction', {
      p_club: clubId,
      p_user: payUser,
      p_amount: amount,
      p_type: payType,
      p_description: payDesc,
      p_date: payDate,
    });
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    toast(payType === 'payment' ? 'Zaksięgowano wpłatę.' : 'Dodano korektę.');
    setPayOpen(false);
    setPayAmount('');
    setPayDesc('');
    await load();
    if (historyOf?.user_id === payUser) await loadHistory(historyOf);
  }

  async function deleteTx() {
    if (!delTx) return;
    setBusy(true);
    const { error } = await supabase().rpc('delete_transaction', { p_tx: delTx.id });
    setBusy(false);
    setDelTx(null);
    if (error) toast(errMsg(error), 'error');
    else {
      toast('Usunięto operację.');
      await load();
      if (historyOf) await loadHistory(historyOf);
    }
  }

  return (
    <OwnerGuard>
      <PageTitle title="Rozliczenia" subtitle={`Łączne zadłużenie: ${money(totalDebt)}`} />
      {error && <ErrorBox message={error} />}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="card flex flex-col gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarDays className="h-5 w-5 text-indigo-600" /> Składki miesięczne
          </h2>
          <p className="text-xs text-slate-500">
            Abonentów: {monthlyCount} · stawka {money(ctx.club.monthly_fee_amount)}. Ponowne naliczenie tego samego
            miesiąca jest zablokowane.
          </p>
          <input type="month" className="input" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setChargeOpen(true)} disabled={suspended || !period}>
            Nalicz składkę za {period ? periodLabel(period) : '…'}
          </button>
        </div>
        <div className="card flex flex-col gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Banknote className="h-5 w-5 text-emerald-600" /> Wpłata gotówkowa / korekta
          </h2>
          <p className="text-xs text-slate-500">Zaksięguj wpłatę otrzymaną poza bankiem lub skoryguj saldo.</p>
          <button className="btn btn-success mt-auto" onClick={() => setPayOpen(true)} disabled={suspended}>
            Dodaj wpłatę
          </button>
        </div>
      </div>

      <div className="mb-2 flex gap-2">
        <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('all')}>
          Wszyscy
        </button>
        <button className={`btn btn-sm ${filter === 'debt' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('debt')}>
          Z zadłużeniem
        </button>
      </div>

      {loading ? (
        <Spinner className="mx-auto my-8 h-6 w-6 text-indigo-600" />
      ) : (
        <div className="card p-0">
          <ul className="divide-y divide-slate-100">
            {visible.map((m) => (
              <li key={m.member_id}>
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() => {
                    setHistoryOf(m);
                    void loadHistory(m);
                  }}
                >
                  <Avatar name={m.full_name} size="h-8 w-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {m.full_name ?? m.email}
                      {m.status === 'removed' && <span className="ml-1 text-xs text-slate-400">(były)</span>}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {m.member_code} · {m.billing_mode === 'monthly' ? 'abonament' : 'za trening'}
                    </span>
                  </span>
                  <span className={`text-sm font-semibold ${Number(m.balance) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {money(m.balance)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="p-6 text-center text-sm text-slate-400">Brak pozycji.</li>}
          </ul>
        </div>
      )}

      <ConfirmModal
        open={chargeOpen}
        title="Naliczyć składki?"
        message={
          <>
            Każdy aktywny zawodnik w trybie abonamentu ({monthlyCount} os.) zostanie obciążony kwotą{' '}
            <strong>{money(ctx.club.monthly_fee_amount)}</strong> za <strong>{period && periodLabel(period)}</strong>.
            Osoby, którym składka za ten miesiąc została już naliczona, zostaną pominięte.
          </>
        }
        confirmText="Nalicz"
        busy={busy}
        onConfirm={() => void chargeMonth()}
        onClose={() => setChargeOpen(false)}
      />

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Dodaj wpłatę / korektę"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPayOpen(false)}>
              Anuluj
            </button>
            <button className="btn btn-primary" form="pay-form" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} Zapisz
            </button>
          </>
        }
      >
        <form id="pay-form" onSubmit={addPayment} className="flex flex-col gap-3">
          <div>
            <label className="label">Zawodnik</label>
            <select className="input" value={payUser} onChange={(e) => setPayUser(e.target.value)} required>
              <option value="">— wybierz —</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.email} ({m.member_code}) – saldo {money(m.balance)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Rodzaj</label>
              <select className="input" value={payType} onChange={(e) => setPayType(e.target.value as 'payment' | 'adjustment')}>
                <option value="payment">Wpłata</option>
                <option value="adjustment">Korekta (+/−)</option>
              </select>
            </div>
            <div>
              <label className="label">Kwota (zł)</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder={payType === 'payment' ? '150,00' : '-40,00'}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label className="label">Data</label>
            <input type="date" className="input" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Opis</label>
            <input className="input" placeholder="np. gotówka na hali" value={payDesc} onChange={(e) => setPayDesc(e.target.value)} />
          </div>
        </form>
      </Modal>

      <Modal
        open={historyOf !== null}
        onClose={() => setHistoryOf(null)}
        title={`Historia: ${historyOf?.full_name ?? ''}`}
        footer={
          <button
            className="btn btn-success"
            onClick={() => {
              if (historyOf) setPayUser(historyOf.user_id);
              setPayOpen(true);
            }}
          >
            Dodaj wpłatę
          </button>
        }
      >
        <p className="mb-2 text-sm">
          Saldo:{' '}
          <strong className={Number(historyOf?.balance) < 0 ? 'text-red-600' : 'text-emerald-600'}>{money(historyOf?.balance)}</strong>
          {historyOf?.aliases?.length ? <span className="ml-2 text-xs text-slate-500">Aliasy: {historyOf.aliases.join(', ')}</span> : null}
        </p>
        <TransactionList items={history} onDelete={(t) => setDelTx(t)} />
      </Modal>

      <ConfirmModal
        open={delTx !== null}
        title="Usunąć operację?"
        danger
        message={
          <>
            {delTx?.description} ({money(delTx?.amount)}) zostanie usunięta z historii, a saldo zostanie przeliczone.
          </>
        }
        confirmText="Usuń"
        busy={busy}
        onConfirm={() => void deleteTx()}
        onClose={() => setDelTx(null)}
      />
    </OwnerGuard>
  );
}
