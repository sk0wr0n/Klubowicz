'use client';

import { useEffect, useState } from 'react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { displayName, formatDate } from '@/lib/format';
import { ROLE_LABEL, type Role } from '@/lib/types';
import { PositionBadges } from '@/components/Position';
import { Avatar, Modal, Spinner } from '@/components/ui';

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

/** Profil zawodnika (bez finansów) – otwierany po stuknięciu w osobę na liście zapisów. */
export default function MemberProfileModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { clubId, memberMap } = useClub();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setProfile(null);
    setError(null);
    void supabase()
      .rpc('member_public_profile', { p_club: clubId, p_user: userId })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setError(errMsg(error));
        else setProfile(data as PublicProfile);
      });
    return () => {
      alive = false;
    };
  }, [clubId, userId]);

  const m = userId ? memberMap[userId] : undefined;
  const fullName = profile?.full_name ?? m?.profiles?.full_name ?? null;
  const nick = profile?.nickname ?? m?.profiles?.nickname ?? null;
  const name = displayName(fullName, nick);
  const role = (profile?.role ?? m?.role ?? 'member') as Role;

  return (
    <Modal open={userId !== null} onClose={onClose} title={name}>
      {userId && (
        <>
          <div className="mb-4 flex items-center gap-4">
            <Avatar name={fullName} url={profile?.avatar_url ?? m?.profiles?.avatar_url} size="h-20 w-20" />
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight">{name}</p>
              {fullName && fullName.trim() !== name && <p className="text-sm font-medium text-slate-600">{fullName}</p>}
              <p className="mt-0.5 text-xs text-slate-500">
                {ROLE_LABEL[role]}
                {(profile?.member_code ?? m?.member_code) && ` · ${profile?.member_code ?? m?.member_code}`}
                {profile?.joined_at && ` · w klubie od ${formatDate(profile.joined_at)}`}
              </p>
              <div className="mt-1.5">
                <PositionBadges positions={m?.positions ?? profile?.positions} primary={m?.position ?? profile?.position} />
              </div>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : profile === null ? (
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
              <p className="text-xs text-slate-500">
                Od początku: {profile.all.visits} treningów · {profile.all.tournaments} turniejów · {profile.all.mvp}× MVP ·{' '}
                {profile.all.coach}× trenerem
                {profile.last_present_at && ` · ostatnio na treningu ${formatDate(profile.last_present_at)}`}
              </p>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
