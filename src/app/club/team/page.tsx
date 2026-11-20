'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Users } from 'lucide-react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { normalize } from '@/lib/csv';
import { formatDate, money } from '@/lib/format';
import { ROLE_LABEL, type TeamMember, type Transaction } from '@/lib/types';
import BalanceUpdateInfo from '@/components/BalanceUpdateInfo';
import TransactionList from '@/components/TransactionList';
import { Avatar, EmptyState, ErrorBox, Modal, PageTitle, Spinner } from '@/components/ui';

/** Cały zespół i stan kont – dla Opiekuna i Właściciela (tylko odczyt). */
export default function TeamPage() {
  const { clubId, isStaff } = useClub();
  const [list, setList] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'debt'>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [history, setHistory] = useState<Transaction[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('team_overview', { p_club: clubId });
    if (error) setError(errMsg(error));
    else setList((data ?? []) as TeamMember[]);
    setLoading(false);
  }, [clubId]);

  useEffect(() => {
    if (isStaff) void load();
  }, [isStaff, load]);

  async function openMember(m: TeamMember) {
    setSelected(m);
    setHistory(null);
    const { data, error } = await supabase().rpc('member_history', { p_club: clubId, p_user: m.user_id });
    if (error) setError(errMsg(error));
    setHistory((data ?? []) as Transaction[]);
  }

  const visible = useMemo(() => {
    const nq = normalize(q);
    return list.filter(
      (m) =>
        (filter === 'all' || Number(m.balance) < 0) &&
        (!nq || normalize(`${m.full_name ?? ''} ${m.member_code ?? ''}`).includes(nq))
    );
  }, [list, filter, q]);

  if (!isStaff) {
    return <EmptyState title="Brak dostępu">Ta sekcja jest dostępna dla Opiekuna i Właściciela klubu.</EmptyState>;
  }

  const inDebt = list.filter((m) => Number(m.balance) < 0).length;

  return (
    <>
      <PageTitle
        title="Zespół"
        subtitle={`Członków: ${list.length}${inDebt ? ` · do zapłaty ma ${inDebt} os.` : ' · wszyscy rozliczeni'}`}
      />
      {error && <ErrorBox message={error} />}
      <BalanceUpdateInfo className="mb-3" />

      <div className="mb-3 flex flex-col gap-2">
        <input className="input" placeholder="Szukaj po nazwisku lub kodzie…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-2">
          <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('all')}>
            Wszyscy
          </button>
          <button className={`btn btn-sm ${filter === 'debt' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('debt')}>
            Do zapłaty ({inDebt})
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto my-8 h-6 w-6 text-indigo-600" />
      ) : visible.length === 0 ? (
        <EmptyState icon={<Users className="h-10 w-10" />} title="Brak osób" />
      ) : (
        <div className="card p-0">
          <ul className="divide-y divide-slate-100">
            {visible.map((m) => {
              const b = Number(m.balance);
              return (
                <li key={m.member_id}>
                  <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" onClick={() => void openMember(m)}>
                    <Avatar name={m.full_name} size="h-9 w-9" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.full_name ?? 'Bez nazwy'} <span className="text-xs font-normal text-slate-400">{m.member_code}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                        <span className={`chip ${m.billing_mode === 'monthly' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                          {m.billing_mode === 'monthly' ? 'abonament' : 'za trening'}
                        </span>
                        {m.role !== 'member' && <span className="chip bg-sky-100 text-sky-700">{ROLE_LABEL[m.role]}</span>}
                        {m.last_present_at && <span>ost. obecność {formatDate(m.last_present_at)}</span>}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={`block text-sm font-semibold ${b < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(b)}</span>
                      <span className="block text-[10px] text-slate-400">{b < 0 ? 'do zapłaty' : b > 0 ? 'nadpłata' : 'rozliczony'}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Modal open={selected !== null} onClose={() => setSelected(null)} title={selected?.full_name ?? ''}>
        {selected && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 text-center text-xs">
              <div className={`rounded-xl p-2 ${Number(selected.balance) < 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                <p className={`text-lg font-bold ${Number(selected.balance) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {money(selected.balance)}
                </p>
                <p className="text-slate-500">saldo</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2">
                <p className="text-sm font-semibold text-slate-800">
                  {selected.last_payment_at ? formatDate(selected.last_payment_at) : '—'}
                </p>
                <p className="text-slate-500">ostatnia wpłata</p>
              </div>
            </div>
            <p className="mb-1 text-xs text-slate-500">
              {selected.member_code} · {selected.billing_mode === 'monthly' ? 'abonament miesięczny' : 'płatność za trening'}
            </p>
            {history === null ? <Spinner className="mx-auto my-6 h-6 w-6" /> : <TransactionList items={history} />}
          </>
        )}
      </Modal>
    </>
  );
}
