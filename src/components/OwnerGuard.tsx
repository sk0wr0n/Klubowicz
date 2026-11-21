'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useClub } from '@/lib/club';
import { clubHref } from '@/lib/nav';
import { EmptyState } from './ui';

/** Widoki dostępne wyłącznie dla Właściciela klubu (dodatkowo chronione przez RLS/RPC w bazie). */
export default function OwnerGuard({
  children,
  back = true,
  allowFinance = false,
}: {
  children: ReactNode;
  back?: boolean;
  /** dostęp także dla Skarbnika (finanse klubu) */
  allowFinance?: boolean;
}) {
  const { isOwner, isFinance, clubId } = useClub();
  if (!isOwner && !(allowFinance && isFinance)) {
    return (
      <EmptyState title="Brak dostępu">
        {allowFinance
          ? 'Ta sekcja jest dostępna dla Właściciela i Skarbnika klubu.'
          : 'Ta sekcja jest dostępna tylko dla Właściciela klubu.'}
      </EmptyState>
    );
  }
  return (
    <>
      {back && (
        <Link href={clubHref(clubId, 'admin')} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Zarządzanie
        </Link>
      )}
      {children}
    </>
  );
}
