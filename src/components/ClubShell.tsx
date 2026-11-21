'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, Settings, Trophy, Users, Wallet } from 'lucide-react';
import { useRequireAuth } from '@/lib/auth';
import { ClubContext, type ClubState } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { clubHref, setLastClub } from '@/lib/nav';
import { displayName } from '@/lib/format';
import type { ClubContextData, ClubMemberRow } from '@/lib/types';
import AppHeader from './AppHeader';
import SubscriptionBanner from './SubscriptionBanner';
import { MyPositionModal } from './Position';
import { ErrorBox, FullScreenLoader } from './ui';

export default function ClubShell({ children }: { children: ReactNode }) {
  const { ok } = useRequireAuth();
  const clubId = useSearchParams().get('id') ?? '';
  const pathname = usePathname();
  const router = useRouter();
  const [ctx, setCtx] = useState<ClubContextData | null>(null);
  const [members, setMembers] = useState<ClubMemberRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!clubId) return;
    const { data, error } = await supabase().rpc('club_context', { p_club: clubId });
    if (error) {
      // brak dostępu (np. zgłoszenie czeka na akceptację albo stary link do cudzego klubu) –
      // wracamy na start, który pokaże właściwy ekran (oczekiwanie, wybór klubu, uzupełnienie profilu)
      if ((error as { code?: string }).code === '42501') {
        router.replace('/');
        return;
      }
      setError(errMsg(error));
      return;
    }
    setError(null);
    setLastClub(clubId);
    setCtx(data as ClubContextData);
  }, [clubId, router]);

  const reloadMembers = useCallback(async () => {
    if (!clubId) return;
    const { data } = await supabase()
      .from('club_members')
      .select('id, user_id, role, status, billing_mode, member_code, position, positions, profiles(full_name, avatar_url, nickname)')
      .eq('club_id', clubId)
      .eq('status', 'active');
    const rows = ((data ?? []) as unknown as ClubMemberRow[]).sort((a, b) =>
      (a.profiles?.full_name ?? '').localeCompare(b.profiles?.full_name ?? '', 'pl')
    );
    setMembers(rows);
  }, [clubId]);

  useEffect(() => {
    if (!ok) return;
    if (!clubId) {
      setError('Nie wybrano klubu.');
      return;
    }
    setCtx(null);
    void reload();
    void reloadMembers();
  }, [ok, clubId, reload, reloadMembers]);

  const value = useMemo<ClubState | null>(() => {
    if (!ctx) return null;
    const memberMap: Record<string, ClubMemberRow> = {};
    for (const m of members) memberMap[m.user_id] = m;
    return {
      clubId,
      ctx,
      members,
      memberMap,
      isOwner: ctx.my_role === 'owner',
      isStaff: ctx.my_role === 'owner' || ctx.my_role === 'caretaker' || ctx.my_role === 'treasurer',
      isFinance: ctx.my_role === 'owner' || ctx.my_role === 'treasurer',
      suspended: ctx.subscription_status === 'suspended',
      reload,
      reloadMembers,
      nameOf: (uid: string) => displayName(memberMap[uid]?.profiles?.full_name, memberMap[uid]?.profiles?.nickname),
    };
  }, [ctx, members, clubId, reload, reloadMembers]);

  // Logo klubu jako ikona karty i ikona „Dodaj do ekranu początkowego” (iPhone czyta ją z bieżącej strony)
  const logo = ctx?.club.logo_url ?? null;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const set = (rel: string, href: string) => {
      document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`).forEach((l) => (l.href = href));
    };
    set('apple-touch-icon', logo ?? '/icons/apple-touch-icon.png');
    set('icon', logo ?? '/icons/icon-192.png');
  }, [logo]);

  if (!ok) return <FullScreenLoader />;
  if (error) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
          <ErrorBox message={error} />
          <Link href="/clubs/" className="btn btn-secondary">
            Wróć do listy klubów
          </Link>
        </main>
      </>
    );
  }
  if (!value) return <FullScreenLoader />;

  const nav = [
    { href: clubHref(clubId), match: '/club/', label: 'Zapisy', icon: CalendarDays, show: true },
    { href: clubHref(clubId, 'team'), match: '/club/team/', label: 'Zespół', icon: Users, show: true },
    { href: clubHref(clubId, 'stats'), match: '/club/stats/', label: 'Statystyki', icon: Trophy, show: true },
    { href: clubHref(clubId, 'finance'), match: '/club/finance/', label: 'Finanse', icon: Wallet, show: true },
    { href: clubHref(clubId, 'admin'), match: '/club/admin/', label: 'Zarządzanie', icon: Settings, show: value.isOwner || value.isFinance },
  ].filter((n) => n.show);

  const isActive = (match: string) =>
    match === '/club/'
      ? pathname === '/club/' || pathname === '/club' || pathname.startsWith('/club/training')
      : pathname.startsWith(match) ||
        (match === '/club/admin/' && /^\/club\/(members|payments|import|settings)/.test(pathname));

  return (
    <ClubContext.Provider value={value}>
      <AppHeader clubId={clubId} clubName={value.ctx.club.name} clubLogo={value.ctx.club.logo_url} />
      <SubscriptionBanner />
      <MyPositionModal />
      <main className="mx-auto max-w-3xl p-4 pb-28">{children}</main>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = isActive(n.match);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium ${
                  active ? 'text-indigo-600' : 'text-slate-500'
                }`}
              >
                <Icon className="h-6 w-6" />
                {n.label}
                {n.match === '/club/admin/' && (value.ctx.pending_members ?? 0) > 0 && (
                  <span className="absolute right-1/2 top-1 translate-x-5 rounded-full bg-red-500 px-1.5 text-[10px] text-white">
                    {value.ctx.pending_members}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </ClubContext.Provider>
  );
}
