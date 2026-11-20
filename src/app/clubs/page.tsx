'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Clock, ShieldCheck, Users, Volleyball } from 'lucide-react';
import { useAuth, useRequireAuth } from '@/lib/auth';
import { clubHref, setLastClub } from '@/lib/nav';
import { ROLE_LABEL } from '@/lib/types';
import AppHeader from '@/components/AppHeader';
import { EmptyState, FullScreenLoader, PageTitle } from '@/components/ui';

export default function ClubsPage() {
  const { ok } = useRequireAuth();
  const router = useRouter();
  const { profile, memberships, membershipsLoaded, refreshMemberships } = useAuth();
  const [code, setCode] = useState('');

  useEffect(() => {
    if (ok) void refreshMemberships();
  }, [ok, refreshMemberships]);

  if (!ok || !membershipsLoaded) return <FullScreenLoader />;

  const active = memberships.filter((m) => m.status === 'active');
  const pending = memberships.filter((m) => m.status === 'pending');

  function joinByCode(e: React.FormEvent) {
    e.preventDefault();
    let c = code.trim();
    const m = c.match(/\/join\/([^/?#]+)/);
    if (m) c = decodeURIComponent(m[1]);
    if (c) router.push(`/join/?code=${encodeURIComponent(c)}`);
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl p-4 pb-16">
        <PageTitle
          title={active.length ? 'Wybierz klub' : `Witaj${profile?.full_name ? ', ' + profile.full_name.split(' ')[0] : ''}!`}
          subtitle={active.length ? 'Należysz do kilku klubów – wybierz, z którym chcesz pracować.' : undefined}
        />

        {active.length > 0 && (
          <div className="flex flex-col gap-3">
            {active.map((m) => (
              <Link
                key={m.club_id}
                href={clubHref(m.club_id)}
                onClick={() => setLastClub(m.club_id)}
                className="card flex items-center gap-3 transition hover:border-indigo-300"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Volleyball className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{m.club_name}</span>
                  <span className="block text-xs text-slate-500">
                    {ROLE_LABEL[m.role]} · Twój kod: {m.member_code ?? '—'}
                    {m.subscription_status === 'suspended' && <span className="ml-1 text-red-600">· klub zawieszony</span>}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </Link>
            ))}
          </div>
        )}

        {active.length === 0 && (
          <EmptyState icon={<Users className="h-12 w-12" />} title="Nie należysz jeszcze do żadnego klubu">
            Poproś organizatora swojego klubu o <strong>link zapraszający</strong> i kliknij go – po akceptacji przez
            Właściciela klub pojawi się tutaj. Zakładanie nowych klubów jest dostępne wyłącznie dla administratora
            platformy.
          </EmptyState>
        )}

        {pending.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Oczekujące na akceptację</h2>
            <div className="flex flex-col gap-2">
              {pending.map((m) => (
                <div key={m.club_id} className="card flex items-center gap-3 border-amber-200 bg-amber-50">
                  <Clock className="h-5 w-5 text-amber-600" />
                  <span className="text-sm">
                    <strong>{m.club_name}</strong> – Właściciel klubu musi zaakceptować Twoje zgłoszenie.
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={joinByCode} className="card mt-6 flex flex-col gap-2">
          <label className="label" htmlFor="invite">
            Masz link lub kod zaproszenia?
          </label>
          <div className="flex gap-2">
            <input
              id="invite"
              className="input"
              placeholder="np. VCA-START2026 lub wklej link"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn btn-primary" disabled={!code.trim()}>
              Dołącz
            </button>
          </div>
        </form>

        {profile?.is_superadmin && (
          <Link href="/superadmin/" className="card mt-6 flex items-center gap-3 border-indigo-200 bg-indigo-50 text-indigo-800">
            <ShieldCheck className="h-6 w-6" />
            <span className="flex-1 font-semibold">Panel Superadmina – kluby i abonamenty</span>
            <ChevronRight className="h-5 w-5" />
          </Link>
        )}
      </main>
    </>
  );
}
