'use client';

import { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { money } from '@/lib/format';
import { BILLING_LABEL, type Transaction } from '@/lib/types';
import CopyField from '@/components/CopyField';
import TransactionList from '@/components/TransactionList';
import { ErrorBox, PageTitle, Spinner } from '@/components/ui';

export default function FinancePage() {
  const { clubId, ctx } = useClub();
  const { userId, profile } = useAuth();
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase()
      .from('transactions')
      .select('id, club_id, user_id, amount, type, description, booked_at, created_at')
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
  const transferTitle = `${ctx.my_member_code ?? ctx.club.prefix} ${profile?.full_name ?? ''}`.trim();

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
        {ctx.my_billing_mode && (
          <p className="mt-2 text-xs text-slate-500">
            Tryb rozliczeń: {BILLING_LABEL[ctx.my_billing_mode]}
            {ctx.my_billing_mode === 'monthly'
              ? ` (${money(ctx.club.monthly_fee_amount)} / mies.)`
              : ` (${money(ctx.club.single_training_fee_amount)} / trening)`}
          </p>
        )}
      </div>

      <div className="card mb-4 flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Landmark className="h-5 w-5 text-indigo-600" /> Dane do przelewu
        </h2>
        {ctx.club.bank_account ? (
          <>
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

      <div className="card">
        <h2 className="mb-1 font-semibold">Historia wpłat i obciążeń</h2>
        {loading ? <Spinner className="mx-auto my-6 h-6 w-6" /> : <TransactionList items={items} />}
      </div>
    </>
  );
}
