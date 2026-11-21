'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/format';
import type { BillingMode } from '@/lib/types';
import { Spinner } from './ui';

export interface BillingChange {
  id: string;
  old_mode: BillingMode | null;
  new_mode: BillingMode;
  changed_by: string | null;
  changed_at: string;
}

const SHORT: Record<BillingMode, string> = { monthly: 'Składka miesięczna', per_session: 'Za trening' };

/** Historia zmian trybu rozliczeń wybranego członka. */
export default function BillingModeHistory({
  clubId,
  userId,
  nameOf,
  refreshKey = 0,
}: {
  clubId: string;
  userId: string;
  nameOf?: (uid: string) => string;
  refreshKey?: number;
}) {
  const [items, setItems] = useState<BillingChange[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase()
      .from('billing_mode_changes')
      .select('id, old_mode, new_mode, changed_by, changed_at')
      .eq('club_id', clubId)
      .eq('user_id', userId)
      .order('changed_at', { ascending: false })
      .limit(30);
    setItems((data ?? []) as BillingChange[]);
  }, [clubId, userId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (items === null) return <Spinner className="my-3 h-5 w-5 text-slate-400" />;
  if (items.length === 0) return <p className="text-xs text-slate-400">Brak zapisanych zmian.</p>;

  const who = (c: BillingChange) => {
    if (!c.changed_by) return c.old_mode ? 'zmiana systemowa' : 'stan początkowy';
    if (c.changed_by === userId) return c.old_mode ? 'zmiana przez zawodnika' : 'wybór przy dołączeniu';
    return `zmiana przez ${nameOf ? nameOf(c.changed_by) : 'Właściciela'}`;
  };

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-slate-700">
            {c.old_mode ? (
              <>
                {SHORT[c.old_mode]} <ArrowRight className="h-3 w-3 text-slate-400" /> {SHORT[c.new_mode]}
              </>
            ) : (
              SHORT[c.new_mode]
            )}
          </span>
          <span className="text-right text-slate-500">
            {formatDateTime(c.changed_at)}
            <span className="block text-[11px] text-slate-400">{who(c)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
