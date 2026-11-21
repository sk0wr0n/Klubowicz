'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Landmark, Ticket } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { money } from '@/lib/format';
import { BILLING_LABEL, type BillingMode, type Transaction } from '@/lib/types';
import BalanceUpdateInfo from '@/components/BalanceUpdateInfo';
import BillingModeHistory from '@/components/BillingModeHistory';
import { useToast } from '@/components/Toast';
import CopyField from '@/components/CopyField';
import TransactionList from '@/components/TransactionList';
import UpcomingCharges from '@/components/UpcomingCharges';
import { ConfirmModal, ErrorBox, PageTitle, Spinner } from '@/components/ui';

export default function FinancePage() {
  const { clubId, ctx, reload, nameOf } = useClub();
  const toast = useToast();
  const [switchTo, setSwitchTo] = useState<BillingMode | null>(null);
  const [switching, setSwitching] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  async function changeMode() {
    if (!switchTo) return;
    setSwitching(true);
    const { error } = await supabase().rpc('set_my_billing_mode', { p_club: clubId, p_mode: switchTo });
    setSwitching(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    toast(`Zmieniono sposób rozliczeń na: ${BILLING_LABEL[switchTo]}.`);
    setSwitchTo(null);
    await reload();
    setHistoryKey((k) => k + 1);
  }
  const { userId, profile } = useAuth();
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase()
      .from('transactions')
      .select('id, club_id, user_id, amount, type, description, booked_at, created_at, tournament_id')
      .eq('club_id', clubId)
      .eq('user_id', userId)
      .order('booked_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(errMsg(error));
        setItems((data ?? []) as Transaction[]);
        setLoading(false);
      });
  }, [clubId, userId]);

  const balance = Math.round(items.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100;
  const due = balance < 0 ? -balance : 0;
  const transferTitle = `${`${ctx.my_member_code ?? ctx.club.prefix} ${profile?.full_name ?? ''}`.trim()} - składka za wynajem sali gimnastycznej`;

  return (
    <>
      <PageTitle title="Moje finanse" subtitle={ctx.club.name} />
      {error && <ErrorBox message={error} />}

      <div className={`card mb-4 text-center ${balance < 0 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <p className="text-sm font-medium text-slate-600">Twoje saldo w klubie</p>
        {loading ? (
          <Spinner className="mx-auto my-3 h-6 w-6" />
        ) : (
          <p className={`my-1 text-4xl font-bold ${balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(balance)}</p>
        )}
        <p className={`text-sm ${balance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
          {balance < 0 ? `Do zapłaty: ${money(due)}` : balance > 0 ? 'Nadpłata – masz środki na kolejne treningi' : 'Wszystko rozliczone'}
        </p>
      </div>

      {!loading && userId && <UpcomingCharges userId={userId} balance={balance} />}

      {ctx.my_billing_mode && userId && (
        <div className="card mb-4 flex flex-col gap-3">
          <h2 className="font-semibold">Sposób rozliczeń</h2>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: 'per_session', icon: Ticket, title: 'Za trening', price: `${money(ctx.club.single_training_fee_amount)} / trening` },
                { key: 'monthly', icon: CalendarDays, title: 'Składka miesięczna', price: `${money(ctx.club.monthly_fee_amount)} / mies.` },
              ] as { key: BillingMode; icon: typeof Ticket; title: string; price: string }[]
            ).map((o) => {
              const Icon = o.icon;
              const active = ctx.my_billing_mode === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  disabled={active}
                  onClick={() => setSwitchTo(o.key)}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                    active ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 bg-white hover:border-indigo-300'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />
                  <span className="text-sm font-semibold">{o.title}</span>
                  <span className="text-xs text-slate-500">{o.price}</span>
                  <span className={`text-[11px] font-semibold ${active ? 'text-indigo-700' : 'text-slate-400'}`}>
                    {active ? '✓ Twój obecny wybór' : 'Kliknij, aby zmienić'}
                  </span>
                </button>
              );
            })}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-slate-500">Historia zmian</summary>
            <div className="mt-2">
              <BillingModeHistory clubId={clubId} userId={userId} nameOf={nameOf} refreshKey={historyKey} />
            </div>
          </details>
        </div>
      )}

      <BalanceUpdateInfo className="mb-4" />

      <div className="card mb-4 flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Landmark className="h-5 w-5 text-indigo-600" /> Dane do przelewu
        </h2>
        {ctx.club.bank_account ? (
          <>
            <p className="-mt-1 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              👆 Stuknij w pole (np. numer konta), a skopiuje się do schowka – potem wklej w aplikacji banku.
            </p>
            {ctx.club.bank_recipient && <CopyField label="Odbiorca" value={ctx.club.bank_recipient} />}
            <CopyField label="Numer konta" value={ctx.club.bank_account} mono />
            <CopyField label="Tytuł przelewu (wymagany)" value={transferTitle} />
            {due > 0 && <CopyField label="Sugerowana kwota wyrównania" value={due.toFixed(2).replace('.', ',')} />}
            <p className="text-xs text-slate-500">
              Zawsze wpisuj swój kod <strong>{ctx.my_member_code}</strong> w tytule – dzięki temu wpłata zostanie
              automatycznie przypisana do Twojego konta.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">Właściciel klubu nie podał jeszcze numeru konta.</p>
        )}
      </div>

      <ConfirmModal
        open={switchTo !== null}
        title="Zmienić sposób rozliczeń?"
        message={
          switchTo === 'monthly' ? (
            <>
              Przechodzisz na <strong>miesięczną składkę za wynajem sali gimnastycznej</strong> (
              {money(ctx.club.monthly_fee_amount)} / mies.). Treningi nie będą już osobno obciążać Twojego salda, a składka
              będzie naliczana 1. dnia każdego miesiąca. Zmiana działa od razu i zostanie
              zapisana w historii.
            </>
          ) : (
            <>
              Przechodzisz na <strong>płatność za trening</strong> ({money(ctx.club.single_training_fee_amount)} / trening).
              Będziesz płacić za każdy trening, na którym zostanie potwierdzona Twoja obecność. Zmiana działa od razu i
              zostanie zapisana w historii.
            </>
          )
        }
        confirmText="Zmień"
        busy={switching}
        onConfirm={() => void changeMode()}
        onClose={() => setSwitchTo(null)}
      />

      <div className="card">
        <h2 className="mb-1 font-semibold">Historia wpłat i obciążeń</h2>
        {loading ? <Spinner className="mx-auto my-6 h-6 w-6" /> : <TransactionList items={items} />}
      </div>
    </>
  );
}
