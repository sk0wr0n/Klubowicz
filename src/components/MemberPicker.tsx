'use client';

import { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useClub } from '@/lib/club';
import { normalize } from '@/lib/csv';
import { Avatar, Modal } from './ui';
import { PositionBadge } from './Position';

export default function MemberPicker({
  open,
  onClose,
  onPick,
  excludeIds,
  title = 'Dodaj osobę z klubu',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (userId: string) => void;
  excludeIds: string[];
  title?: string;
}) {
  const { members } = useClub();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const ex = new Set(excludeIds);
    const nq = normalize(q);
    return members.filter(
      (m) =>
        !ex.has(m.user_id) &&
        (!nq || normalize(`${m.profiles?.full_name ?? ''} ${m.member_code ?? ''}`).includes(nq))
    );
  }, [members, excludeIds, q]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <input className="input mb-3" placeholder="Szukaj po nazwisku lub kodzie…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Brak osób do dodania.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {list.map((m) => (
            <li key={m.user_id}>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-50"
                onClick={() => {
                  onPick(m.user_id);
                  setQ('');
                }}
              >
                <Avatar name={m.profiles?.full_name} url={m.profiles?.avatar_url} size="h-8 w-8" />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{m.profiles?.full_name ?? 'Bez nazwy'}</span>
                  <span className="block text-xs text-slate-500">
                    {m.member_code} · {m.billing_mode === 'per_session' ? 'płatność za trening' : 'składka miesięczna'}
                  </span>
                </span>
                <PositionBadge position={m.position} />
                <UserPlus className="h-4 w-4 text-indigo-600" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
