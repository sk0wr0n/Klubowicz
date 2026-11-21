'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Volleyball } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { errMsg, isGoogleEnabled, supabase } from '@/lib/supabase';
import { peekNext, popNext } from '@/lib/nav';
import { ErrorBox, Spinner } from '@/components/ui';
import { openInstallHelp } from '@/components/InstallHelp';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { ready, session } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    setGoogle(isGoogleEnabled());
  }, []);

  useEffect(() => {
    if (ready && session) router.replace(popNext() ?? '/');
  }, [ready, session, router]);

  // Cel po zalogowaniu (np. /join/?code=VCA-…) jedzie w samym linku z e-maila,
  // więc działa także wtedy, gdy link zostanie otwarty w innej przeglądarce lub na innym urządzeniu.
  const redirectTo = () => {
    const next = peekNext();
    return `${window.location.origin}/auth/callback/${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  };

  async function loginGoogle() {
    setError(null);
    setBusy(true);
    const { error } = await supabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo(), queryParams: { prompt: 'select_account' } },
    });
    if (error) {
      setError(errMsg(error));
      setBusy(false);
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(errMsg(error));
    else setSent(true);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase().auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.replace(/\s/g, ''),
      type: 'email',
    });
    setBusy(false);
    if (error) setError('Nieprawidłowy lub wygasły kod. Sprawdź, czy to kod z najnowszej wiadomości, albo wyślij nowy.');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg">
          <Volleyball className="h-9 w-9" />
        </span>
        <h1 className="text-2xl font-bold">Klubowicz</h1>
        <p className="text-sm text-slate-500">Zapisy na treningi i rozliczenia Twojego klubu</p>
      </div>

      <div className="card flex flex-col gap-4">
        {error && <ErrorBox message={error} />}

        {!sent ? (
          <>
            {google && (
              <>
                <button className="btn btn-secondary w-full py-3" onClick={loginGoogle} disabled={busy}>
                  <GoogleIcon /> Zaloguj przez Google
                </button>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" /> lub kod na e-mail{' '}
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
              </>
            )}
            <form onSubmit={sendLink} className="flex flex-col gap-3">
              <div>
                <label className="label" htmlFor="email">
                  Adres e-mail
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  className="input"
                  placeholder="jan.kowalski@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button className="btn btn-primary w-full py-3" disabled={busy || !email}>
                {busy ? <Spinner className="h-4 w-4" /> : <Mail className="h-4 w-4" />} Wyślij kod na e-mail
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Wysłaliśmy kod na <strong>{email}</strong>. Skopiuj go z wiadomości i wpisz poniżej – zalogujesz się tutaj, także
              w aplikacji na ekranie głównym telefonu. Jeśli prosisz o kod kilka razy, działa tylko <strong>najnowszy</strong>.
              Sprawdź też folder Spam.
            </div>
            <form onSubmit={verifyCode} className="flex flex-col gap-3">
              <div>
                <label className="label" htmlFor="code">
                  Kod z e-maila
                </label>
                <input
                  id="code"
                  className="input text-center text-lg tracking-[0.4em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={10}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <button className="btn btn-primary w-full py-3" disabled={busy || code.replace(/\s/g, '').length < 6}>
                {busy && <Spinner className="h-4 w-4" />} Zaloguj kodem
              </button>
            </form>
            <button className="btn btn-ghost" onClick={() => { setSent(false); setCode(''); }}>
              Zmień adres / wyślij nowy kod
            </button>
            <p className="text-center text-[11px] text-slate-400">
              Jeśli w wiadomości jest też link – możesz go kliknąć, ale otworzy się w przeglądarce, nie w aplikacji.
            </p>
          </>
        )}
      </div>

      <button className="text-center text-sm font-medium text-indigo-600" onClick={openInstallHelp}>
        📲 Jak dodać aplikację do ekranu głównego telefonu?
      </button>

      <p className="text-center text-xs text-slate-400">
        Nie przechowujemy haseł. Logowanie odbywa się jednorazowym kodem wysyłanym na e-mail.
      </p>
    </main>
  );
}
