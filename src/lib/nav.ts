// Zapamiętanie strony docelowej na czas logowania (np. link zapraszający /join/KOD)
const NEXT_KEY = 'klubowicz.next';
const LAST_CLUB_KEY = 'klubowicz.lastClub';

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function setNext(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) return;
  safeStorage()?.setItem(NEXT_KEY, path);
}

/** Bezpieczna ścieżka względna (bez przekierowań na inne domeny). */
export function safePath(v: string | null | undefined): string | null {
  if (v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\')) return v;
  return null;
}

/** Odczyt bez usuwania – np. żeby dołączyć cel do linku w e-mailu. */
export function peekNext(): string | null {
  return safePath(safeStorage()?.getItem(NEXT_KEY) ?? null);
}

export function popNext(): string | null {
  const s = safeStorage();
  const v = s?.getItem(NEXT_KEY) ?? null;
  s?.removeItem(NEXT_KEY);
  if (v && v.startsWith('/') && !v.startsWith('//')) return v;
  return null;
}

export function setLastClub(id: string): void {
  safeStorage()?.setItem(LAST_CLUB_KEY, id);
}

export function getLastClub(): string | null {
  return safeStorage()?.getItem(LAST_CLUB_KEY) ?? null;
}

export function getPref(key: string, fallback: string): string {
  return safeStorage()?.getItem(`klubowicz.${key}`) ?? fallback;
}

export function setPref(key: string, value: string): void {
  safeStorage()?.setItem(`klubowicz.${key}`, value);
}

export function clubHref(clubId: string, sub = ''): string {
  return `/club/${sub ? sub + '/' : ''}?id=${encodeURIComponent(clubId)}`;
}

export function trainingHref(clubId: string, trainingId: string): string {
  return `/club/training/?id=${encodeURIComponent(clubId)}&t=${encodeURIComponent(trainingId)}`;
}

export function inviteLink(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/join/${encodeURIComponent(code)}`;
}
