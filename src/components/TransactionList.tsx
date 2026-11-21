'use client';

import { useState } from 'react';
import { ChevronDown, Trash2, Trophy } from 'lucide-react';
import { formatDate, money } from '@/lib/format';
import { TX_LABEL, type Transaction } from '@/lib/types';

type Entry =
  | { kind: 'tx'; key: string; t: Transaction; amount: number; sortDate: string; sortCreated: string }
  | {
      kind: 'tour';
      key: string;
      name: string;
      parts: Transaction[];
      amount: number;
      sortDate: string;
      sortCreated: string;
    };

function tournamentName(parts: Transaction[]): string {
  for (const p of parts) {
    const d = p.description ?? '';
    if (p.type === 'tournament_fee') {
      const m = d.match(/^Wpisowe:\s*(.+?)\s*\(/);
      if (m) return m[1];
    }
  }
  const d = parts[0]?.description ?? '';
  const i = d.indexOf(':');
  return i >= 0 ? d.slice(i + 1).trim() : 'Turniej';
}

function partLabel(p: Transaction): string {
  if (p.type === 'tournament_fee') return 'Wpisowe';
  const d = p.description ?? '';
  const i = d.indexOf(':');
  return i > 0 ? d.slice(0, i) : 'Opłata dodatkowa';
}

/**
 * Chronologiczna historia wpłat i obciążeń z saldem narastającym.
 * Obciążenia za turniej (wpisowe + opłaty dodatkowe) są pokazane jako jedna pozycja „Turniej”,
 * którą można rozwinąć. Przy trybie usuwania (onDelete) pokazujemy wszystko osobno.
 */
export default function TransactionList({
  items,
  onDelete,
}: {
  items: Transaction[];
  onDelete?: (tx: Transaction) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">Brak operacji.</p>;
  }

  const entries: Entry[] = [];
  const groups = new Map<string, Transaction[]>();
  for (const t of items) {
    if (!onDelete && t.tournament_id) {
      const g = groups.get(t.tournament_id) ?? [];
      g.push(t);
      groups.set(t.tournament_id, g);
    } else {
      entries.push({ kind: 'tx', key: t.id, t, amount: Number(t.amount), sortDate: t.booked_at, sortCreated: t.created_at });
    }
  }
  for (const [id, parts] of groups) {
    parts.sort((a, b) => a.booked_at.localeCompare(b.booked_at) || a.created_at.localeCompare(b.created_at));
    const last = parts[parts.length - 1];
    entries.push({
      kind: 'tour',
      key: `tour-${id}`,
      name: tournamentName(parts),
      parts,
      amount: Math.round(parts.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100,
      sortDate: last.booked_at,
      sortCreated: last.created_at,
    });
  }

  entries.sort((a, b) => a.sortDate.localeCompare(b.sortDate) || a.sortCreated.localeCompare(b.sortCreated));
  let running = 0;
  const withBalance = entries.map((e) => {
    running += e.amount;
    return { e, balance: running };
  });

  return (
    <ul className="divide-y divide-slate-100">
      {withBalance.reverse().map(({ e, balance }) => {
        const plus = e.amount > 0;
        if (e.kind === 'tour') {
          const isOpen = open.has(e.key);
          return (
            <li key={e.key} className="py-3">
              <button
                className="flex w-full items-center gap-3 text-left"
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (isOpen) n.delete(e.key);
                    else n.add(e.key);
                    return n;
                  })
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800">
                    <Trophy className="h-4 w-4 shrink-0 text-amber-600" />
                    <span className="truncate">Turniej: {e.name}</span>
                  </p>
                  <p className="flex items-center gap-1 text-xs text-slate-500">
                    {formatDate(e.sortDate)} · {e.parts.length} {e.parts.length === 1 ? 'pozycja' : e.parts.length < 5 ? 'pozycje' : 'pozycji'}
                    <ChevronDown className={`h-3.5 w-3.5 transition ${isOpen ? 'rotate-180' : ''}`} />
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${plus ? 'text-emerald-600' : 'text-red-600'}`}>
                    {plus ? '+' : ''}
                    {money(e.amount)}
                  </p>
                  <p className="text-[11px] text-slate-400">saldo {money(balance)}</p>
                </div>
              </button>
              {isOpen && (
                <ul className="ml-6 mt-2 flex flex-col gap-1 border-l-2 border-amber-200 pl-3">
                  {e.parts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600">
                        {partLabel(p)} <span className="text-slate-400">· {formatDate(p.booked_at)}</span>
                      </span>
                      <span className="font-medium text-red-600">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        }
        const t = e.t;
        return (
          <li key={e.key} className="flex items-center gap-3 py-3">
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
