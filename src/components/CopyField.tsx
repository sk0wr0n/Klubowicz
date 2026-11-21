'use client';

import { Check, Copy } from 'lucide-react';
import { useRef, useState } from 'react';

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // starsze przeglądarki / brak uprawnień – klasyczna metoda
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function CopyField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    const ok = await writeClipboard(value);
    setState(ok ? 'copied' : 'error');
    if (ok && 'vibrate' in navigator) {
      try {
        navigator.vibrate(30);
      } catch {
        /* */
      }
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  const copied = state === 'copied';
  return (
    <div>
      <p className="label">{label}</p>
      <div className="relative">
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Skopiuj: ${label}`}
          className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
            copied ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 active:bg-slate-200'
          }`}
        >
          <span className={`min-w-0 break-all text-sm text-slate-800 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</span>
          {copied ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700">
              <Check className="h-4 w-4" /> Skopiowano
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600">
              <Copy className="h-4 w-4" /> Kopiuj
            </span>
          )}
        </button>
        {state !== 'idle' && (
          <div
            role="status"
            className={`pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-lg ${
              copied ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          >
            {copied ? '✓ Skopiowano do schowka' : 'Nie udało się skopiować – przytrzymaj i skopiuj ręcznie'}
            <span
              className={`absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 ${
                copied ? 'bg-emerald-600' : 'bg-red-600'
              }`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
