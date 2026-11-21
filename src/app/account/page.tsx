'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Bell, LogOut, Save, Shirt } from 'lucide-react';
import { POSITION_LABEL, isPosition, type Position } from '@/lib/positions';
import { PositionMultiPicker } from '@/components/Position';
import { useAuth, useRequireAuth } from '@/lib/auth';
import { errMsg, supabase } from '@/lib/supabase';
import AppHeader from '@/components/AppHeader';
import { useToast } from '@/components/Toast';
import { Avatar, FullScreenLoader, PageTitle, Spinner } from '@/components/ui';

function PositionsSection() {
  const { userId, memberships } = useAuth();
  const toast = useToast();
  const clubs = memberships.filter((m) => m.status === 'active');
  const [values, setValues] = useState<Record<string, Position[]>>({});
  const [saved, setSaved] = useState<Record<string, Position[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void supabase()
      .from('club_members')
      .select('club_id, position, positions')
      .eq('user_id', userId)
      .then(({ data }) => {
        const map: Record<string, Position[]> = {};
        for (const r of (data ?? []) as { club_id: string; position: string | null; positions: string[] | null }[]) {
          const list = r.positions?.length ? r.positions : r.position ? [r.position] : [];
          map[r.club_id] = list.filter(isPosition);
        }
        setValues(map);
        setSaved(map);
        setLoaded(true);
      });
  }, [userId]);

  if (clubs.length === 0) return null;

  async function save(clubId: string) {
    const v = values[clubId] ?? [];
    if (!v.length) return;
    setBusy(clubId);
    const { error } = await supabase().rpc('set_my_positions', { p_club: clubId, p_positions: v });
    setBusy(null);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    setSaved((s) => ({ ...s, [clubId]: v }));
    toast(`Zapisano: ${v.map((p) => POSITION_LABEL[p]).join(', ')}.`);
  }

  return (
    <section className="card mt-6 flex flex-col gap-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Shirt className="h-5 w-5 text-indigo-600" /> Pozycje na boisku
      </h2>
      {!loaded ? (
        <Spinner className="h-5 w-5 text-slate-400" />
      ) : (
        clubs.map((c) => {
          const v = values[c.club_id] ?? [];
          const changed = v.join(',') !== (saved[c.club_id] ?? []).join(',');
          return (
            <div key={c.club_id} className="flex flex-col gap-2">
              {clubs.length > 1 && <p className="text-sm font-medium text-slate-600">{c.club_name}</p>}
              <PositionMultiPicker value={v} onChange={(p) => setValues((s) => ({ ...s, [c.club_id]: p }))} />
              <button className="btn btn-primary" disabled={!v.length || !changed || busy !== null} onClick={() => void save(c.club_id)}>
                {busy === c.club_id ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}{' '}
                {!v.length ? 'Wybierz pozycję' : changed ? 'Zapisz pozycje' : 'Pozycje zapisane'}
              </button>
            </div>
          );
        })
      )}
    </section>
  );
}

function NotificationsSection() {
  const { userId, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const on = profile?.email_notifications !== false;

  async function toggle() {
    setBusy(true);
    const { error } = await supabase().from('profiles').update({ email_notifications: !on }).eq('id', userId!);
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    await refreshProfile();
    toast(on ? 'Wyłączono powiadomienia e-mail.' : 'Włączono powiadomienia e-mail.');
  }

  return (
    <section className="card mt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Bell className="h-5 w-5 text-indigo-600" /> Powiadomienia e-mail
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Mail tylko wtedy, gdy coś się dzieje: naliczono Ci opłatę (z saldem i danymi do przelewu, gdy jest minus), a dla
            Właściciela – gdy ktoś chce dołączyć do klubu.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={() => void toggle()}
          className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
    </section>
  );
}

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

  // Ekran „Uzupełnij profil” tylko wtedy, gdy naprawdę brakuje imienia i nazwiska
  useEffect(() => {
    if (first && profileLoaded && profile?.full_name?.trim()) router.replace('/');
  }, [first, profileLoaded, profile, router]);

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
    router.replace('/');
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl p-4 pb-16">
        {!first && (
          <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> Wróć
          </Link>
        )}
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

        {!first && <PositionsSection />}
        {!first && <NotificationsSection />}

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
