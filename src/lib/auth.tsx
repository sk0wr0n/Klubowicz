'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from './supabase';
import { setNext } from './nav';
import type { Membership, Profile } from './types';

interface AuthState {
  configured: boolean | null;
  ready: boolean;
  session: Session | null;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  profileLoaded: boolean;
  memberships: Membership[];
  membershipsLoaded: boolean;
  refreshProfile: () => Promise<void>;
  refreshMemberships: () => Promise<Membership[]>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);

  useEffect(() => {
    const ok = isConfigured();
    setConfigured(ok);
    if (!ok) {
      setReady(true);
      return;
    }
    const sb = supabase();
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;

  const refreshProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setProfileLoaded(true);
      return;
    }
    const { data } = await supabase()
      .from('profiles')
      .select('id, full_name, avatar_url, is_superadmin')
      .eq('id', userId)
      .maybeSingle();
    setProfile((data as Profile | null) ?? null);
    setProfileLoaded(true);
  }, [userId]);

  const refreshMemberships = useCallback(async (): Promise<Membership[]> => {
    if (!userId) {
      setMemberships([]);
      setMembershipsLoaded(true);
      return [];
    }
    const { data, error } = await supabase().rpc('my_memberships');
    const list = error ? [] : ((data ?? []) as Membership[]);
    setMemberships(list);
    setMembershipsLoaded(true);
    return list;
  }, [userId]);

  useEffect(() => {
    setProfileLoaded(false);
    setMembershipsLoaded(false);
    if (userId) {
      void refreshProfile();
      void refreshMemberships();
    } else {
      setProfile(null);
      setMemberships([]);
      setProfileLoaded(true);
      setMembershipsLoaded(true);
    }
  }, [userId, refreshProfile, refreshMemberships]);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    setSession(null);
    if (typeof window !== 'undefined') window.location.href = '/login/';
  }, []);

  return (
    <AuthContext.Provider
      value={{
        configured,
        ready,
        session,
        userId,
        email: session?.user.email ?? null,
        profile,
        profileLoaded,
        memberships,
        membershipsLoaded,
        refreshProfile,
        refreshMemberships,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth musi być użyty wewnątrz AuthProvider');
  return ctx;
}

/** Przekierowuje niezalogowanych na /login/ (z zapamiętaniem strony docelowej). */
export function useRequireAuth(): { ok: boolean } {
  const { ready, session, configured } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (configured && ready && !session) {
      setNext(window.location.pathname + window.location.search);
      router.replace('/login/');
    }
  }, [configured, ready, session, router]);
  return { ok: Boolean(ready && session) };
}
