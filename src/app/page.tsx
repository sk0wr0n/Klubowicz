'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { clubHref, setLastClub } from '@/lib/nav';
import { FullScreenLoader } from '@/components/ui';

/**
 * Inteligentny routing po zalogowaniu:
 *  - brak sesji              -> /login/
 *  - brak imienia i nazwiska -> /account/?first=1
 *  - 1 aktywny klub          -> od razu treningi tego klubu
 *  - 0 lub >1 klubów         -> /clubs/ (ekran wyboru / ekran powitalny)
 */
export default function HomePage() {
  const router = useRouter();
  const { ready, session, profile, profileLoaded, profileError, memberships, membershipsLoaded } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      router.replace('/login/');
      return;
    }
    if (!profileLoaded || !membershipsLoaded) return;
    if (!profileError && !profile?.full_name?.trim()) {
      router.replace('/account/?first=1');
      return;
    }
    const active = memberships.filter((m) => m.status === 'active');
    if (active.length === 1) {
      setLastClub(active[0].club_id);
      router.replace(clubHref(active[0].club_id));
    } else {
      router.replace('/clubs/');
    }
  }, [ready, session, profile, profileLoaded, profileError, memberships, membershipsLoaded, router]);

  return <FullScreenLoader />;
}
