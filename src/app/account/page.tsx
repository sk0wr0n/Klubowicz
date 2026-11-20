'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogOut, Save } from 'lucide-react';
import { useAuth, useRequireAuth } from '@/lib/auth';
import { errMsg, supabase } from '@/lib/supabase';
import AppHeader from '@/components/AppHeader';
import { useToast } from '@/components/Toast';
import { Avatar, FullScreenLoader, PageTitle, Spinner } from '@/components/ui';

function AccountInner() {
  const { ok } = useRequireAuth();
  const router = useRouter();
  const first = useSearchParams().get('first') === '1';
  const toast = useToast();
  const { profile, profileLoaded, email, userId, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profileLoaded) setName(profile?.full_name ?? '');
  }, [profileLoaded, profile]);

  if (!ok || !profileLoaded) return <FullScreenLoader />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = name.trim().replace(/\s+/g, ' ');
    if (v.split(' ').length < 2) {
      toast('Podaj imię i nazwisko (potrzebne do rozpoznawania przelewów).', 'error');
      return;
    }
    setBusy(true);
    const { error } = await supabase().from('profiles').update({ full_name: v }).eq('id', userId!);
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    await refreshProfile();
    toast('Zapisano profil.');
    if (first) router.replace('/');
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl p-4 pb-16">
        <PageTitle
          title={first ? 'Uzupełnij profil' : 'Moje konto'}
          subtitle={first ? 'Podaj imię i nazwisko – zobaczą je osoby z Twojego klubu na listach treningów.' : undefined}
        />
        <form onSubmit={save} className="card flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={name || profile?.full_name} url={profile?.avatar_url} size="h-14 w-14" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{name || 'Bez nazwy'}</p>
              <p className="truncate text-sm text-slate-500">{email}</p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="name">
              Imię i nazwisko
            </label>
            <input
              id="name"
              className="input"
              required
              autoComplete="name"
              placeholder="Jan Kowalski"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Zapisz
          </button>
        </form>

        {!first && (
          <button className="btn btn-secondary mt-6 w-full text-red-600" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" /> Wyloguj
          </button>
        )}
      </main>
    </>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <AccountInner />
    </Suspense>
  );
}
