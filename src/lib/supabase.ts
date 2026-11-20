import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __KLUBOWICZ_CONFIG__?: {
      supabaseUrl?: string;
      supabasePublishableKey?: string;
      /** true = pokaż przycisk „Zaloguj przez Google” (wymaga konfiguracji Google w Supabase) */
      enableGoogle?: boolean;
      /** starsza nazwa pola – nadal obsługiwana */
      supabaseAnonKey?: string;
      appName?: string;
    };
  }
}

let client: SupabaseClient | null = null;

function isPlaceholder(v: string): boolean {
  return !v || v.includes('TWOJ') || v.includes('twoj');
}

/**
 * Konfiguracja Supabase:
 *  1) public/config.js (window.__KLUBOWICZ_CONFIG__) – edytowalny po wgraniu na OVH,
 *     klucz: publishable (sb_publishable_...) lub starszy "anon public",
 *  2) zmienne NEXT_PUBLIC_* wbudowane podczas `npm run build` (plik .env.local).
 */
export function getConfig(): { url: string; key: string } {
  const runtime = typeof window !== 'undefined' ? window.__KLUBOWICZ_CONFIG__ : undefined;
  const rUrl = (runtime?.supabaseUrl ?? '').trim();
  const rKey = (runtime?.supabasePublishableKey || runtime?.supabaseAnonKey || '').trim();
  if (!isPlaceholder(rUrl) && !isPlaceholder(rKey)) {
    return { url: rUrl.replace(/\/+$/, ''), key: rKey };
  }
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, ''),
    key: (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim(),
  };
}

export function isConfigured(): boolean {
  const { url, key } = getConfig();
  return !isPlaceholder(url) && !isPlaceholder(key) && /^https:\/\//.test(url);
}

/** Czy pokazywać logowanie przez Google (domyślnie wyłączone, dopóki nie jest skonfigurowane). */
export function isGoogleEnabled(): boolean {
  const runtime = typeof window !== 'undefined' ? window.__KLUBOWICZ_CONFIG__ : undefined;
  if (typeof runtime?.enableGoogle === 'boolean') return runtime.enableGoogle;
  return process.env.NEXT_PUBLIC_ENABLE_GOOGLE === 'true';
}

/** Klient Supabase (tylko w przeglądarce). */
export function supabase(): SupabaseClient {
  if (typeof window === 'undefined') {
    throw new Error('Klient Supabase jest dostępny tylko w przeglądarce.');
  }
  if (!client) {
    const { url, key } = getConfig();
    if (!isConfigured()) {
      throw new Error('Brak konfiguracji Supabase – uzupełnij plik config.js.');
    }
    client = createClient(url, key, {
      auth: {
        // 'implicit': link z e-maila działa w każdej przeglądarce (np. wbudowanej w aplikację pocztową),
        // a nie tylko w tej, w której poproszono o link (ograniczenie trybu PKCE).
        flowType: 'implicit',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'klubowicz-auth',
      },
    });
  }
  return client;
}

/** Czytelny komunikat błędu z Supabase/PostgREST/JS. */
export function errMsg(e: unknown): string {
  if (!e) return 'Nieznany błąd.';
  if (typeof e === 'string') return e;
  if (typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string };
    if (o.message) {
      if (o.message.includes('Failed to fetch')) return 'Brak połączenia z serwerem. Sprawdź internet.';
      if (o.message.includes('JWT expired')) return 'Sesja wygasła – zaloguj się ponownie.';
      return o.message;
    }
  }
  return 'Wystąpił nieoczekiwany błąd.';
}
