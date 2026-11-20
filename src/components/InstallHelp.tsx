'use client';

import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Modal } from './ui';

type Platform = 'ios' | 'android' | 'desktop';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const OPEN_EVENT = 'klubowicz:install-help';
const DISMISS_KEY = 'klubowicz.installBannerDismissed';
let deferredPrompt: BeforeInstallPromptEvent | null = null;

/** Otwiera okno z instrukcją instalacji (z dowolnego miejsca aplikacji). */
export function openInstallHelp() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
        {n}
      </span>
      <span className="text-sm leading-relaxed text-slate-700">{children}</span>
    </li>
  );
}

function IosSteps() {
  return (
    <>
      <p className="mb-3 text-sm font-semibold text-slate-800">iPhone / iPad</p>
      <ol className="flex flex-col gap-3">
        <Step n={1}>
          Otwórz tę stronę w przeglądarce <strong>Safari</strong> (w Chrome na iPhonie też działa – ikona udostępniania jest
          w pasku adresu).
        </Step>
        <Step n={2}>
          Stuknij przycisk <strong>Udostępnij</strong>{' '}
          <Share className="inline h-4 w-4 -translate-y-0.5 text-indigo-600" /> – kwadrat ze strzałką w górę, na dole lub na
          górze ekranu.
        </Step>
        <Step n={3}>
          Przewiń listę w dół i wybierz <strong>„Do ekranu początkowego”</strong>{' '}
          <SquarePlus className="inline h-4 w-4 -translate-y-0.5 text-indigo-600" />.
        </Step>
        <Step n={4}>
          Stuknij <strong>Dodaj</strong> w prawym górnym rogu. Ikona Klubowicza pojawi się na ekranie głównym.
        </Step>
      </ol>
    </>
  );
}

function AndroidSteps() {
  return (
    <>
      <p className="mb-3 text-sm font-semibold text-slate-800">Android</p>
      <ol className="flex flex-col gap-3">
        <Step n={1}>
          Otwórz tę stronę w przeglądarce <strong>Chrome</strong>.
        </Step>
        <Step n={2}>
          Stuknij menu <strong>⋮</strong> (trzy kropki) w prawym górnym rogu.
        </Step>
        <Step n={3}>
          Wybierz <strong>„Zainstaluj aplikację”</strong> albo <strong>„Dodaj do ekranu głównego”</strong>.
        </Step>
        <Step n={4}>
          Potwierdź <strong>Zainstaluj</strong> / <strong>Dodaj</strong>. Ikona Klubowicza pojawi się na ekranie głównym.
        </Step>
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        Samsung Internet: menu <strong>≡</strong> → „Dodaj stronę do” → „Ekran startowy”.
      </p>
    </>
  );
}

/** Okno z instrukcją – montowane raz w aplikacji, otwierane przez openInstallHelp(). */
export function InstallHelpRoot() {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>('desktop');
  const [canPrompt, setCanPrompt] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(isStandalone());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };
    const onOpen = () => setOpen(true);
    const onInstalled = () => {
      setInstalled(true);
      setCanPrompt(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  async function installNow() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    setCanPrompt(false);
    if (choice.outcome === 'accepted') setOpen(false);
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Dodaj Klubowicza do ekranu głównego">
      {installed ? (
        <p className="text-sm text-slate-700">
          Aplikacja jest już zainstalowana – korzystasz z niej z ekranu głównego. 👍
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-slate-600">
            Aplikacja otworzy się jak zwykła apka – na pełnym ekranie, bez paska przeglądarki, z ikoną na telefonie.
          </p>
          {canPrompt && (
            <button className="btn btn-primary py-3" onClick={() => void installNow()}>
              <Download className="h-5 w-5" /> Zainstaluj teraz
            </button>
          )}
          {platform === 'ios' && <IosSteps />}
          {platform === 'android' && <AndroidSteps />}
          {platform === 'desktop' && (
            <>
              <p className="text-sm text-slate-600">
                Otwórz tę stronę na telefonie, aby dodać ją do ekranu głównego. Poniżej instrukcje dla obu systemów.
              </p>
              <IosSteps />
              <AndroidSteps />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Baner zachęcający do instalacji – widoczny tylko w przeglądarce (nie w zainstalowanej apce), można go zamknąć. */
export function InstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      /* brak dostępu do pamięci */
    }
    setShow(!isStandalone() && !dismissed && detectPlatform() !== 'desktop');
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* */
    }
    setShow(false);
  }

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-3">
      <SquarePlus className="h-6 w-6 shrink-0 text-indigo-600" />
      <button className="flex-1 text-left text-sm text-indigo-900" onClick={openInstallHelp}>
        <strong>Dodaj Klubowicza do ekranu głównego</strong>
        <span className="block text-xs text-indigo-700">Stuknij, aby zobaczyć jak – zajmie to 10 sekund.</span>
      </button>
      <button className="rounded-lg p-1 text-indigo-400 hover:bg-indigo-100" onClick={dismiss} aria-label="Zamknij">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
