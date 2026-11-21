'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check, ChevronDown, LayoutGrid, LogOut, ShieldCheck, Shirt, SquarePlus, User, Volleyball } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { clubHref, getLastClub, setLastClub } from '@/lib/nav';
import { ROLE_LABEL } from '@/lib/types';
import { Avatar } from './ui';
import { openInstallHelp } from './InstallHelp';
import { openPositionModal } from './Position';

export default function AppHeader({
  clubId,
  clubName,
  clubLogo,
}: {
  clubId?: string;
  clubName?: string;
  clubLogo?: string | null;
}) {
  const { profile, memberships, signOut } = useAuth();
  const [clubOpen, setClubOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const active = memberships.filter((m) => m.status === 'active');
  const canSwitch = active.length > 1 || Boolean(profile?.is_superadmin);
  // logo prowadzi do ekranu głównego klubu (ostatnio otwartego, jeśli jesteśmy poza klubem)
  const [homeHref, setHomeHref] = useState(clubId ? clubHref(clubId) : '/');
  useEffect(() => {
    if (clubId) {
      setHomeHref(clubHref(clubId));
      return;
    }
    const last = getLastClub();
    setHomeHref(last && active.some((m) => m.club_id === last) ? clubHref(last) : '/');
  }, [clubId, active]);

  return (
    <header className="pt-safe sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
        <div className="relative flex min-w-0 items-center gap-1">
          <Link
            href={homeHref}
            aria-label="Strona główna"
            className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg shadow-sm transition active:scale-95 ${
              clubLogo ? 'bg-white ring-1 ring-slate-200' : 'bg-indigo-600 text-white'
            }`}
          >
            {clubLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clubLogo} alt="" className="h-full w-full object-cover" />
            ) : (
              <Volleyball className="h-5 w-5" />
            )}
          </Link>
          {canSwitch ? (
            <button
              className="flex min-w-0 items-center gap-1 rounded-xl px-1.5 py-1 text-left hover:bg-slate-50"
              onClick={() => setClubOpen((v) => !v)}
              aria-haspopup="menu"
            >
              <span className="truncate font-semibold text-slate-900">{clubName ?? 'Klubowicz'}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          ) : (
            <Link href={homeHref} className="min-w-0 truncate rounded-xl px-1.5 py-1 font-semibold text-slate-900">
              {clubName ?? 'Klubowicz'}
            </Link>
          )}

          {clubOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setClubOpen(false)} />
              <div className="absolute left-0 top-12 z-50 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl" role="menu">
                <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Twoje kluby</p>
                {active.map((m) => (
                  <Link
                    key={m.club_id}
                    href={clubHref(m.club_id)}
                    onClick={() => {
                      setLastClub(m.club_id);
                      setClubOpen(false);
                    }}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-800">{m.club_name}</span>
                      <span className="block text-xs text-slate-500">
                        {m.prefix} · {ROLE_LABEL[m.role]}
                      </span>
                    </span>
                    {m.club_id === clubId && <Check className="h-4 w-4 text-indigo-600" />}
                  </Link>
                ))}
                <Link
                  href="/clubs/"
                  onClick={() => setClubOpen(false)}
                  className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  <LayoutGrid className="h-4 w-4" /> Wszystkie kluby
                </Link>
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button onClick={() => setUserOpen((v) => !v)} className="rounded-full" aria-label="Menu użytkownika">
            <Avatar name={profile?.full_name} url={profile?.avatar_url} />
          </button>
          {userOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserOpen(false)} />
              <div className="absolute right-0 top-12 z-50 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl" role="menu">
                <p className="truncate px-3 py-2 text-sm font-medium text-slate-800">{profile?.full_name ?? 'Mój profil'}</p>
                <Link
                  href="/account/"
                  onClick={() => setUserOpen(false)}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <User className="h-4 w-4" /> Moje konto
                </Link>
                <Link
                  href="/clubs/"
                  onClick={() => setUserOpen(false)}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <LayoutGrid className="h-4 w-4" /> Moje kluby
                </Link>
                {clubId && (
                  <button
                    onClick={() => {
                      setUserOpen(false);
                      openPositionModal();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Shirt className="h-4 w-4" /> Moja pozycja na boisku
                  </button>
                )}
                <button
                  onClick={() => {
                    setUserOpen(false);
                    openInstallHelp();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <SquarePlus className="h-4 w-4" /> Dodaj do ekranu głównego
                </button>
                {profile?.is_superadmin && (
                  <Link
                    href="/superadmin/"
                    onClick={() => setUserOpen(false)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50"
                  >
                    <ShieldCheck className="h-4 w-4" /> Panel Superadmina
                  </Link>
                )}
                <button
                  onClick={() => void signOut()}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" /> Wyloguj
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
