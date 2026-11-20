'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export default function CopyField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* brak dostępu do schowka */
    }
  }
  return (
    <div>
      <p className="label">{label}</p>
      <button
        type="button"
        onClick={() => void copy()}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100"
      >
        <span className={`min-w-0 break-all text-sm text-slate-800 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</span>
        {copied ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <Copy className="h-4 w-4 shrink-0 text-slate-400" />}
      </button>
    </div>
  );
}
