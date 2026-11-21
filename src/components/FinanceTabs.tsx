'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useClub } from '@/lib/club';
import { clubHref } from '@/lib/nav';
import { EmptyState } from './ui';
import type { ReactNode } from 'react';

/** Czy zalogowany widzi zakładkę „Finanse klubu” (sztab finansowy zawsze, reszta – gdy włączono w ustawieniach). */
export function useClubFinanceVisible(): boolean {
  const { isFinance, ctx } = useClub();
  return isFinance || ctx.club.budget_public === true;
}

const CLUB_SUBS = [
  { sub: 'budget', label: 'Budżet', financeOnly: false },
  { sub: 'bank', label: 'Konto', financeOnly: true },
  { sub: 'payments', label: 'Rozliczenia', financeOnly: true },
  { sub: 'import', label: 'Import CSV', financeOnly: true },
] as const;

/** Nagłówek zakładki Finanse: „Moje finanse” / „Finanse klubu” (+ podzakładki dla Właściciela i Skarbnika). */
export default function FinanceTabs({ note }: { note?: ReactNode }) {
  const { clubId, isFinance } = useClub();
  const pathname = usePathname();
  const clubVisible = useClubFinanceVisible();
  const onClub = /^\/club\/(budget|bank|payments|import)/.test(pathname);
  const subs = CLUB_SUBS.filter((s) => isFinance || !s.financeOnly);

  return (
    <div className="mb-4">
      <h1 className="mb-3 text-xl font-bold text-slate-900">Finanse</h1>
      {clubVisible && (
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          <Link
            href={clubHref(clubId, 'finance')}
            className={`rounded-lg py-2 text-center ${!onClub ? 'bg-white shadow-sm' : 'text-slate-500'}`}
          >
            Moje finanse
          </Link>
          <Link
            href={clubHref(clubId, 'budget')}
            className={`rounded-lg py-2 text-center ${onClub ? 'bg-white shadow-sm' : 'text-slate-500'}`}
          >
            Finanse klubu
          </Link>
        </div>
      )}
      {onClub && subs.length > 1 && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {subs.map((s) => {
            const active = pathname.startsWith(`/club/${s.sub}`);
            return (
              <Link
                key={s.sub}
                href={clubHref(clubId, s.sub)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                  active ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      )}
      {note && <p className="mt-2 text-sm text-slate-500">{note}</p>}
    </div>
  );
}

/** Strony „Finanse klubu”: dostęp zależny od roli (financeOnly – tylko Właściciel i Skarbnik). */
export function ClubFinanceGuard({ children, financeOnly = false }: { children: ReactNode; financeOnly?: boolean }) {
  const { isFinance } = useClub();
  const visible = useClubFinanceVisible();
  if (financeOnly ? !isFinance : !visible) {
    return (
      <>
        <FinanceTabs />
        <EmptyState title="Brak dostępu">
          {financeOnly ? 'Ta sekcja jest dostępna dla Właściciela i Skarbnika klubu.' : 'Finanse klubu widzą Właściciel i Skarbnik.'}
        </EmptyState>
      </>
    );
  }
  return <>{children}</>;
}
