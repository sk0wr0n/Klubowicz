'use client';

import { createContext, useContext } from 'react';
import type { ClubContextData, ClubMemberRow } from './types';

export interface ClubState {
  clubId: string;
  ctx: ClubContextData;
  members: ClubMemberRow[];
  memberMap: Record<string, ClubMemberRow>;
  isOwner: boolean;
  isStaff: boolean;
  suspended: boolean;
  reload: () => Promise<void>;
  reloadMembers: () => Promise<void>;
  nameOf: (userId: string) => string;
}

export const ClubContext = createContext<ClubState | null>(null);

export function useClub(): ClubState {
  const v = useContext(ClubContext);
  if (!v) throw new Error('useClub musi być użyty wewnątrz ClubShell');
  return v;
}
