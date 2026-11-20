'use client';

import { RefreshCw } from 'lucide-react';
import { useClub } from '@/lib/club';
import { formatDate, formatDateTime } from '@/lib/format';

/** Informacja, kiedy ostatnio zaksięgowano wpłaty (import z banku lub ręcznie). */
export default function BalanceUpdateInfo({ className = '' }: { className?: string }) {
  const { ctx } = useClub();
  const updated = ctx.balances_updated_at;
  const until = ctx.bank_data_until;
  return (
    <div className={`flex items-start gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600 ${className}`}>
      <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {updated ? (
        <p>
          Ostatnia aktualizacja sald: <strong>{formatDateTime(updated)}</strong>
          {until && (
            <>
              {' '}
              · przelewy z banku uwzględnione do <strong>{formatDate(until)}</strong>
            </>
          )}
          . Późniejsze wpłaty pojawią się po kolejnym imporcie.
        </p>
      ) : (
        <p>Wpłaty nie były jeszcze księgowane – salda zawierają tylko naliczone opłaty.</p>
      )}
    </div>
  );
}
