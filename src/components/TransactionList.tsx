'use client';

import { Trash2 } from 'lucide-react';
import { formatDate, money } from '@/lib/format';
import { TX_LABEL, type Transaction } from '@/lib/types';

/** Chronologiczna historia wpłat i obciążeń z saldem narastającym. */
export default function TransactionList({
  items,
  onDelete,
}: {
  items: Transaction[];
  onDelete?: (tx: Transaction) => void;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">Brak operacji.</p>;
  }
  const asc = [...items].sort((a, b) => a.booked_at.localeCompare(b.booked_at) || a.created_at.localeCompare(b.created_at));
  let running = 0;
  const withBalance = asc.map((t) => {
    running += Number(t.amount);
    return { t, balance: running };
  });
  return (
    <ul className="divide-y divide-slate-100">
      {withBalance.reverse().map(({ t, balance }) => {
        const plus = Number(t.amount) > 0;
        return (
          <li key={t.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{t.description || TX_LABEL[t.type]}</p>
              <p className="text-xs text-slate-500">
                {formatDate(t.booked_at)} · {TX_LABEL[t.type]}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-sm font-semibold ${plus ? 'text-emerald-600' : 'text-red-600'}`}>
                {plus ? '+' : ''}
                {money(t.amount)}
              </p>
              <p className="text-[11px] text-slate-400">saldo {money(balance)}</p>
            </div>
            {onDelete && (
              <button
                className="rounded-lg p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                onClick={() => onDelete(t)}
                aria-label="Usuń operację"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
