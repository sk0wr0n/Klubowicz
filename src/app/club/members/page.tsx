'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, UserCheck, X } from 'lucide-react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { money } from '@/lib/format';
import { BILLING_LABEL, ROLE_LABEL, type AdminMember, type BillingMode } from '@/lib/types';
import BillingModeHistory from '@/components/BillingModeHistory';
import { PositionBadge } from '@/components/Position';
import { POSITIONS, POSITION_LABEL } from '@/lib/positions';
import OwnerGuard from '@/components/OwnerGuard';
import { useToast } from '@/components/Toast';
import { Avatar, ConfirmModal, ErrorBox, PageTitle, Spinner } from '@/components/ui';

export default function MembersPage() {
  const { clubId, reload: reloadCtx, reloadMembers, nameOf, memberMap } = useClub();
  const [historyKey, setHistoryKey] = useState(0);
  const toast = useToast();
  const [list, setList] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'reject' | 'remove'; m: AdminMember } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('admin_list_members', { p_club: clubId });
    if (error) setError(errMsg(error));
    else setList((data ?? []) as AdminMember[]);
    setLoading(false);
  }, [clubId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return false;
    }
    toast(ok);
    setHistoryKey((k) => k + 1);
    await load();
    await reloadMembers();
    await reloadCtx();
    return true;
  }

  const pending = list.filter((m) => m.status === 'pending');
  const active = list.filter((m) => m.status === 'active');
  const removed = list.filter((m) => m.status === 'removed');

  function toggle(m: AdminMember) {
    if (openId === m.member_id) setOpenId(null);
    else {
      setOpenId(m.member_id);
      setAliasDraft((m.aliases ?? []).join(', '));
    }
  }

  return (
    <OwnerGuard>
      <PageTitle title="Członkowie" subtitle={`Aktywnych: ${active.length}`} />
      {error && <ErrorBox message={error} />}
      {loading && <Spinner className="mx-auto my-8 h-6 w-6 text-indigo-600" />}

      {pending.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-red-600">Oczekujący na akceptację ({pending.length})</h2>
          <div className="flex flex-col gap-2">
            {pending.map((m) => (
              <div key={m.member_id} className="card flex items-center gap-3 border-amber-200">
                <Avatar name={m.full_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.full_name ?? 'Bez nazwy'}</p>
                  <p className="truncate text-xs text-slate-500">{m.email}</p>
                </div>
                <button
                  className="btn btn-success btn-sm"
                  disabled={busy}
                  onClick={() => void call('approve_member', { p_member_id: m.member_id }, 'Zaakceptowano członka.')}
                >
                  <UserCheck className="h-4 w-4" /> Akceptuj
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => setConfirm({ kind: 'reject', m })}
                  aria-label="Odrzuć"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        {active.map((m) => {
          const expanded = openId === m.member_id;
          return (
            <div key={m.member_id} className="card p-0">
              <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => toggle(m)}>
                <Avatar name={m.full_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.full_name ?? 'Bez nazwy'} <span className="text-xs font-normal text-slate-400">{m.member_code}</span>
                  </p>
                  <p className="flex flex-wrap gap-1 text-xs">
                    <span
                      className={`chip ${
                        m.role === 'owner'
                          ? 'bg-indigo-100 text-indigo-700'
                          : m.role === 'caretaker'
                            ? 'bg-sky-100 text-sky-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {ROLE_LABEL[m.role]}
                    </span>
                    <span className="chip bg-slate-100 text-slate-600">
                      {m.billing_mode === 'monthly' ? 'abonament' : 'za trening'}
                    </span>
                    <PositionBadge position={memberMap[m.user_id]?.position} />
                  </p>
                </div>
                <span className={`text-sm font-semibold ${Number(m.balance) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {money(m.balance)}
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
              </button>

              {expanded && (
                <div className="flex flex-col gap-4 border-t border-slate-100 p-4">
                  <p className="text-xs text-slate-500">{m.email}</p>

                  <div>
                    <label className="label">Pozycja na boisku</label>
                    <select
                      className="input"
                      value={memberMap[m.user_id]?.position ?? ''}
                      disabled={busy}
                      onChange={(e) =>
                        void call(
                          'set_member_position',
                          { p_member_id: m.member_id, p_position: e.target.value || null },
                          'Zmieniono pozycję.'
                        )
                      }
                    >
                      <option value="">— nie wybrano —</option>
                      {POSITIONS.map((p) => (
                        <option key={p} value={p}>
                          {POSITION_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">Tryb rozliczeń</label>
                    <select
                      className="input"
                      value={m.billing_mode}
                      disabled={busy}
                      onChange={(e) =>
                        void call(
                          'set_member_billing',
                          { p_member_id: m.member_id, p_mode: e.target.value as BillingMode },
                          'Zmieniono tryb rozliczeń.'
                        )
                      }
                    >
                      {(Object.keys(BILLING_LABEL) as BillingMode[]).map((k) => (
                        <option key={k} value={k}>
                          {BILLING_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <details className="rounded-xl bg-slate-50 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                      Historia zmian trybu rozliczeń
                    </summary>
                    <div className="mt-2">
                      <BillingModeHistory clubId={clubId} userId={m.user_id} nameOf={nameOf} refreshKey={historyKey} />
                    </div>
                  </details>

                  {m.role !== 'owner' && (
                    <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                      <span>
                        <span className="block text-sm font-medium">Opiekun klubu / Trener</span>
                        <span className="block text-xs text-slate-500">
                          Może tworzyć treningi, sprawdzać obecność i rozliczać treningi. Nie widzi finansów klubu.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        className="h-6 w-6 accent-indigo-600"
                        checked={m.role === 'caretaker'}
                        disabled={busy}
                        onChange={(e) =>
                          void call(
                            'set_member_role',
                            { p_member_id: m.member_id, p_role: e.target.checked ? 'caretaker' : 'member' },
                            e.target.checked ? 'Nadano rolę Opiekuna.' : 'Odebrano rolę Opiekuna.'
                          )
                        }
                      />
                    </label>
                  )}

                  <div>
                    <label className="label">Aliasy do rozpoznawania przelewów</label>
                    <input
                      className="input"
                      placeholder="np. Anna Kowalska, Kowalski Piotr"
                      value={aliasDraft}
                      onChange={(e) => setAliasDraft(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Oddziel przecinkami. Przydatne, gdy za zawodnika płaci rodzic lub partner.
                    </p>
                    <button
                      className="btn btn-secondary btn-sm mt-2"
                      disabled={busy}
                      onClick={() =>
                        void call(
                          'set_member_aliases',
                          {
                            p_member_id: m.member_id,
                            p_aliases: aliasDraft
                              .split(',')
                              .map((a) => a.trim())
                              .filter(Boolean),
                          },
                          'Zapisano aliasy.'
                        )
                      }
                    >
                      Zapisz aliasy
                    </button>
                  </div>

                  {m.role !== 'owner' && (
                    <button className="btn btn-ghost self-start text-red-600" onClick={() => setConfirm({ kind: 'remove', m })}>
                      Usuń z klubu
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {removed.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Byli członkowie / odrzuceni</h2>
          <div className="flex flex-col gap-2">
            {removed.map((m) => (
              <div key={m.member_id} className="card flex items-center gap-3 opacity-70">
                <Avatar name={m.full_name} size="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{m.full_name ?? m.email}</p>
                  <p className="text-xs text-slate-500">Saldo: {money(m.balance)}</p>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => void call('approve_member', { p_member_id: m.member_id }, 'Przywrócono członka.')}
                >
                  Przywróć
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <ConfirmModal
        open={confirm !== null}
        title={confirm?.kind === 'reject' ? 'Odrzucić zgłoszenie?' : 'Usunąć z klubu?'}
        danger
        message={
          <>
            <strong>{confirm?.m.full_name ?? confirm?.m.email}</strong>{' '}
            {confirm?.kind === 'reject'
              ? 'nie zostanie dodany do klubu.'
              : 'straci dostęp do klubu i zostanie wypisany z przyszłych treningów. Historia finansowa zostanie zachowana.'}
          </>
        }
        confirmText={confirm?.kind === 'reject' ? 'Odrzuć' : 'Usuń'}
        busy={busy}
        onConfirm={() => {
          if (!confirm) return;
          void call('remove_member', { p_member_id: confirm.m.member_id }, 'Gotowe.').then(() => setConfirm(null));
        }}
        onClose={() => setConfirm(null)}
      />
    </OwnerGuard>
  );
}
