'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Users } from 'lucide-react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { normalize } from '@/lib/csv';
import { displayName, formatDate, money } from '@/lib/format';
import { ROLE_LABEL, type Role, type TeamMember, type Transaction } from '@/lib/types';
import BalanceUpdateInfo from '@/components/BalanceUpdateInfo';
import TransactionList from '@/components/TransactionList';
import { PositionBadges, PositionMultiPicker } from '@/components/Position';
import { isPosition } from '@/lib/positions';
import { useToast } from '@/components/Toast';
import { Avatar, EmptyState, ErrorBox, Modal, PageTitle, Spinner } from '@/components/ui';

interface Row {
  member_id: string;
  user_id: string;
  name: string;
  member_code: string | null;
  role: Role;
  avatar_url: string | null;
  // tylko sztab:
  billing_mode?: TeamMember['billing_mode'];
  balance?: number;
  last_payment_at?: string | null;
  last_present_at?: string | null;
}

interface PublicProfile {
  user_id: string;
  full_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  role: Role;
  position: string | null;
  positions: string[] | null;
  member_code: string | null;
  joined_at: string | null;
  last_present_at: string | null;
  year: Record<'visits' | 'cars' | 'beers' | 'mvp' | 'coach' | 'tournaments', number>;
  all: Record<'visits' | 'cars' | 'beers' | 'mvp' | 'coach' | 'tournaments', number>;
}

const STAT_TILES: { key: keyof PublicProfile['year']; label: string; emoji: string }[] = [
  { key: 'visits', label: 'treningów', emoji: '🏐' },
  { key: 'tournaments', label: 'turniejów', emoji: '🏆' },
  { key: 'mvp', label: 'razy MVP', emoji: '⭐' },
  { key: 'coach', label: 'razy trenerem', emoji: '📣' },
  { key: 'cars', label: 'autem', emoji: '🚗' },
  { key: 'beers', label: 'integracji', emoji: '🍺' },
];

/** Zawodnicy klubu: profile dla wszystkich; salda i historia wpłat tylko dla Opiekuna/Skarbnika/Właściciela. */
export default function TeamPage() {
  const { clubId, isStaff, members, memberMap, reloadMembers } = useClub();
  const toast = useToast();
  const [staffList, setStaffList] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'debt'>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [history, setHistory] = useState<Transaction[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('team_overview', { p_club: clubId });
    if (error) setError(errMsg(error));
    else setStaffList((data ?? []) as TeamMember[]);
    setLoading(false);
  }, [clubId]);

  useEffect(() => {
    if (isStaff) void load();
    else setLoading(false);
  }, [isStaff, load]);

  const rows: Row[] = useMemo(() => {
    if (isStaff) {
      return staffList.map((m) => {
        const mm = memberMap[m.user_id];
        return {
          member_id: m.member_id,
          user_id: m.user_id,
          name: displayName(m.full_name, mm?.profiles?.nickname),
          member_code: m.member_code,
          role: m.role,
          avatar_url: mm?.profiles?.avatar_url ?? null,
          billing_mode: m.billing_mode,
          balance: Number(m.balance),
          last_payment_at: m.last_payment_at,
          last_present_at: m.last_present_at,
        };
      });
    }
    return members.map((m) => ({
      member_id: m.id,
      user_id: m.user_id,
      name: displayName(m.profiles?.full_name, m.profiles?.nickname),
      member_code: m.member_code,
      role: m.role,
      avatar_url: m.profiles?.avatar_url ?? null,
    }));
  }, [isStaff, staffList, members, memberMap]);

  async function openMember(r: Row) {
    setSelected(r);
    setProfile(null);
    setHistory(null);
    const sb = supabase();
    const prof = sb.rpc('member_public_profile', { p_club: clubId, p_user: r.user_id });
    if (isStaff) {
      const { data, error } = await sb.rpc('member_history', { p_club: clubId, p_user: r.user_id });
      if (error) setError(errMsg(error));
      setHistory((data ?? []) as Transaction[]);
    }
    const { data: p, error: pe } = await prof;
    if (pe) toast(errMsg(pe), 'error');
    else setProfile(p as PublicProfile);
  }

  const visible = useMemo(() => {
    const nq = normalize(q);
    return rows.filter(
      (m) =>
        (filter === 'all' || (m.balance ?? 0) < 0) &&
        (!nq || normalize(`${m.name} ${m.member_code ?? ''}`).includes(nq))
    );
  }, [rows, filter, q]);

  const inDebt = rows.filter((m) => (m.balance ?? 0) < 0).length;
  const sel = selected ? memberMap[selected.user_id] : undefined;

  return (
    <>
      <PageTitle
        title="Zespół"
        subtitle={
          isStaff
            ? `Członków: ${rows.length}${inDebt ? ` · do zapłaty ma ${inDebt} os.` : ' · wszyscy rozliczeni'}`
            : `Zawodników w klubie: ${rows.length} · stuknij, aby zobaczyć profil`
        }
      />
      {error && <ErrorBox message={error} />}
      {isStaff && <BalanceUpdateInfo className="mb-3" />}

      <div className="mb-3 flex flex-col gap-2">
        <input className="input" placeholder="Szukaj po nazwisku lub ksywce…" value={q} onChange={(e) => setQ(e.target.value)} />
        {isStaff && (
          <div className="flex gap-2">
            <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('all')}>
              Wszyscy
            </button>
            <button className={`btn btn-sm ${filter === 'debt' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('debt')}>
              Do zapłaty ({inDebt})
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <Spinner className="mx-auto my-8 h-6 w-6 text-indigo-600" />
      ) : visible.length === 0 ? (
        <EmptyState icon={<Users className="h-12 w-12" />} title="Brak osób">
          {q ? 'Nikt nie pasuje do wyszukiwania.' : 'W klubie nie ma jeszcze aktywnych członków.'}
        </EmptyState>
      ) : (
        <div className="card p-0">
          <ul className="divide-y divide-slate-100">
            {visible.map((m) => {
              const mm = memberMap[m.user_id];
              const b = m.balance ?? 0;
              return (
                <li key={m.member_id}>
                  <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" onClick={() => void openMember(m)}>
                    <Avatar name={m.name} url={m.avatar_url} size="h-10 w-10" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.name} <span className="text-xs font-normal text-slate-400">{m.member_code}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                        <PositionBadges positions={mm?.positions} primary={mm?.position} />
                        {m.role !== 'member' && <span className="chip bg-sky-100 text-sky-700">{ROLE_LABEL[m.role]}</span>}
                        {isStaff && (
                          <span className={`chip ${m.billing_mode === 'monthly' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                            {m.billing_mode === 'monthly' ? 'składka mies.' : 'za trening'}
                          </span>
                        )}
                        {isStaff && m.last_present_at && <span>ost. obecność {formatDate(m.last_present_at)}</span>}
                      </span>
                    </span>
                    {isStaff && (
                      <span className="text-right">
                        <span className={`block text-sm font-semibold ${b < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(b)}</span>
                        <span className="block text-[10px] text-slate-400">{b < 0 ? 'do zapłaty' : b > 0 ? 'nadpłata' : 'rozliczony'}</span>
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Modal open={selected !== null} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected && (
          <>
            <div className="mb-4 flex items-center gap-4">
              <Avatar name={selected.name} url={selected.avatar_url} size="h-20 w-20" />
              <div className="min-w-0">
                <p className="text-lg font-bold leading-tight">{selected.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {ROLE_LABEL[selected.role]}
                  {selected.member_code && ` · ${selected.member_code}`}
                  {profile?.joined_at && ` · w klubie od ${formatDate(profile.joined_at)}`}
                </p>
                <div className="mt-1.5">
                  <PositionBadges positions={sel?.positions} primary={sel?.position} />
                </div>
              </div>
            </div>

            {profile === null ? (
              <Spinner className="mx-auto my-4 h-6 w-6" />
            ) : (
              <>
                <p className="label">Ten rok</p>
                <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                  {STAT_TILES.map((t) => (
                    <div key={t.key} className="rounded-xl bg-indigo-50 p-2">
                      <p className="text-lg font-bold text-indigo-700">{profile.year[t.key]}</p>
                      <p className="text-[11px] text-slate-500">
                        {t.emoji} {t.label}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mb-4 text-xs text-slate-500">
                  Od początku: {profile.all.visits} treningów · {profile.all.tournaments} turniejów · {profile.all.mvp}× MVP ·{' '}
                  {profile.all.coach}× trenerem
                  {profile.last_present_at && ` · ostatnio na treningu ${formatDate(profile.last_present_at)}`}
                </p>
              </>
            )}

            {isStaff && (
              <>
                <div className="mb-3 border-t border-slate-100 pt-3">
                  <p className="label">Pozycje na boisku</p>
                  <PositionMultiPicker
                    value={((sel?.positions?.length ? sel?.positions : sel?.position ? [sel.position] : []) ?? []).filter(isPosition)}
                    onChange={(v) =>
                      void (async () => {
                        const { error } = await supabase().rpc('set_member_positions', {
                          p_member_id: selected.member_id,
                          p_positions: v,
                        });
                        if (error) toast(errMsg(error), 'error');
                        else await reloadMembers();
                      })()
                    }
                  />
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-center text-xs">
                  <div className={`rounded-xl p-2 ${(selected.balance ?? 0) < 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                    <p className={`text-lg font-bold ${(selected.balance ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {money(selected.balance ?? 0)}
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
                  {selected.billing_mode === 'monthly' ? 'Składka miesięczna (wynajem sali)' : 'Płatność za trening'} · widoczne tylko
                  dla sztabu
                </p>
                {history === null ? <Spinner className="mx-auto my-6 h-6 w-6" /> : <TransactionList items={history} />}
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
