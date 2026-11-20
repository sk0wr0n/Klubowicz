'use client';

import { Ban, TriangleAlert } from 'lucide-react';
import { useClub } from '@/lib/club';
import { money } from '@/lib/format';

export default function SubscriptionBanner() {
  const { ctx, isOwner } = useClub();
  const status = ctx.subscription_status;
  const p = ctx.platform;

  // Właściciel: zaległość lub zawieszenie – kwota i dane do przelewu
  if (isOwner && p && (status !== 'active' || p.unpaid_amount > 0)) {
    const severe = status === 'suspended';
    return (
      <div className={`${severe ? 'bg-red-600' : status === 'past_due' ? 'bg-amber-500' : 'bg-sky-600'} text-white`}>
        <div className="mx-auto flex max-w-3xl gap-3 px-4 py-3 text-sm">
          {severe ? <Ban className="mt-0.5 h-5 w-5 shrink-0" /> : <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />}
          <div className="flex-1">
            <p className="font-semibold">
              {severe
                ? 'Klub zawieszony – zapisy, rozliczenia treningów i import CSV są zablokowane.'
                : status === 'past_due'
                  ? 'Zaległa opłata za aplikację'
                  : 'Nowa opłata za aplikację do zapłaty'}
            </p>
            <p className="mt-0.5">
              Do zapłaty: <strong>{money(p.unpaid_amount)}</strong>
              {p.bank_account && (
                <>
                  {' '}
                  · przelew na konto <strong className="whitespace-nowrap">{p.bank_account}</strong>
                  {p.bank_recipient && <> ({p.bank_recipient})</>}
                </>
              )}
              {' '}· tytuł: <strong>{`${p.platform_name} ${ctx.club.prefix}`}</strong>
            </p>
            {!severe && (
              <p className="mt-0.5 text-xs opacity-90">
                Brak płatności przez {p.suspend_after_days} dni od naliczenia spowoduje zawieszenie klubu.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Pozostali członkowie: tylko informacja o zawieszeniu
  if (status === 'suspended') {
    return (
      <div className="bg-red-600 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 text-sm">
          <Ban className="h-5 w-5 shrink-0" />
          <p>Klub jest tymczasowo zawieszony – zapisy na treningi są zablokowane. Skontaktuj się z Właścicielem klubu.</p>
        </div>
      </div>
    );
  }
  return null;
}
