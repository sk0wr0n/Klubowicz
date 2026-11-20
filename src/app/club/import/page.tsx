'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileUp, Upload } from 'lucide-react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { formatDate, money } from '@/lib/format';
import {
  decodeFile,
  detectDelimiter,
  findHeaderRow,
  guessColumns,
  matchMember,
  normalize,
  parseAmount,
  parseCsv,
  parseDate,
  sha256,
  type ColumnMap,
  type CsvEncoding,
} from '@/lib/csv';
import type { AdminMember } from '@/lib/types';
import OwnerGuard from '@/components/OwnerGuard';
import { useToast } from '@/components/Toast';
import { ConfirmModal, ErrorBox, PageTitle, Spinner } from '@/components/ui';

interface PreviewRow {
  idx: number;
  date: string;
  amount: number;
  title: string;
  sender: string;
  hash: string;
  userId: string;
  reason: string | null;
  duplicate: boolean;
  selected: boolean;
}

const FIELDS: { key: keyof ColumnMap; label: string; required: boolean }[] = [
  { key: 'date', label: 'Data', required: true },
  { key: 'amount', label: 'Kwota', required: true },
  { key: 'title', label: 'Tytuł / opis', required: true },
  { key: 'sender', label: 'Nadawca', required: false },
  { key: 'account', label: 'Rachunek nadawcy', required: false },
];

export default function ImportPage() {
  const { clubId, ctx, suspended, reload } = useClub();
  const toast = useToast();
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [encoding, setEncoding] = useState<CsvEncoding>('auto');
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<{ encoding: string; delimiter: string; headerRow: number } | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [map, setMap] = useState<ColumnMap>({ date: -1, amount: -1, title: -1, sender: -1, account: -1 });
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [skippedOut, setSkippedOut] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase()
      .rpc('admin_list_members', { p_club: clubId })
      .then(({ data }) => setMembers(((data ?? []) as AdminMember[]).filter((m) => m.status !== 'pending')));
  }, [clubId]);

  const readFile = useCallback(async (f: File, enc: CsvEncoding) => {
    setError(null);
    setPreview([]);
    try {
      const { text, encoding: used } = await decodeFile(f, enc);
      const delimiter = detectDelimiter(text);
      const rows = parseCsv(text, delimiter);
      if (rows.length < 2) throw new Error('Plik nie zawiera danych.');
      const headerRow = findHeaderRow(rows);
      const hdr = rows[headerRow];
      setHeaders(hdr);
      setDataRows(rows.slice(headerRow + 1).filter((r) => r.length >= 2));
      setMap(guessColumns(hdr));
      setInfo({ encoding: used, delimiter, headerRow });
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    if (file) void readFile(file, encoding);
  }, [file, encoding, readFile]);

  const candidates = useMemo(
    () =>
      members.map((m) => ({
        user_id: m.user_id,
        full_name: m.full_name,
        member_code: m.member_code,
        aliases: m.aliases ?? [],
      })),
    [members]
  );

  // Budowa podglądu: tylko wpływy (kwota > 0), dopasowanie, hash, wykrywanie duplikatów
  useEffect(() => {
    if (!dataRows.length || map.date < 0 || map.amount < 0 || map.title < 0) {
      setPreview([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setWorking(true);
      const out: PreviewRow[] = [];
      const seen: Record<string, number> = {};
      let outgoing = 0;
      for (let i = 0; i < dataRows.length; i++) {
        const r = dataRows[i];
        const amount = parseAmount(r[map.amount]);
        const date = parseDate(r[map.date]);
        if (amount === null || !date) continue;
        if (amount <= 0) {
          outgoing++;
          continue;
        }
        const title = r[map.title] ?? '';
        const sender = map.sender >= 0 ? (r[map.sender] ?? '') : '';
        const account = map.account >= 0 ? (r[map.account] ?? '').replace(/\s/g, '') : '';
        const base = `${date}|${amount.toFixed(2)}|${normalize(title)}|${normalize(sender)}|${account}`;
        seen[base] = (seen[base] ?? 0) + 1;
        const hash = await sha256(`${base}|#${seen[base]}`);
        const m = matchMember(title, sender, ctx.club.prefix, candidates);
        out.push({
          idx: i,
          date,
          amount,
          title,
          sender,
          hash,
          userId: m?.user_id ?? '',
          reason: m?.reason ?? null,
          duplicate: false,
          selected: Boolean(m),
        });
      }
      const { data } = await supabase().rpc('check_bank_hashes', {
        p_club: clubId,
        p_hashes: out.map((o) => o.hash),
      });
      const existing = new Set<string>(((data ?? []) as unknown[]).map((x) => String(x)));
      for (const o of out) {
        if (existing.has(o.hash)) {
          o.duplicate = true;
          o.selected = false;
        }
      }
      if (!cancelled) {
        setPreview(out);
        setSkippedOut(outgoing);
        setWorking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataRows, map, candidates, ctx.club.prefix, clubId]);

  const toBook = preview.filter((p) => p.selected && p.userId && !p.duplicate);
  const toBookSum = toBook.reduce((s, p) => s + p.amount, 0);

  function update(idx: number, patch: Partial<PreviewRow>) {
    setPreview((prev) => prev.map((p) => (p.idx === idx ? { ...p, ...patch } : p)));
  }

  async function book() {
    setBusy(true);
    const rows = toBook.map((p) => ({
      user_id: p.userId,
      amount: p.amount,
      date: p.date,
      title: p.title,
      sender: p.sender,
      hash: p.hash,
    }));
    const { data, error } = await supabase().rpc('import_bank_payments', { p_club: clubId, p_rows: rows });
    setBusy(false);
    setConfirm(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    const res = data as { inserted: number; skipped: number };
    toast(`Zaksięgowano ${res.inserted} wpłat${res.skipped ? `, pominięto ${res.skipped} (duplikaty)` : ''}.`);
    const booked = new Set(toBook.map((p) => p.hash));
    setPreview((prev) => prev.map((p) => (booked.has(p.hash) ? { ...p, duplicate: true, selected: false } : p)));
    await reload();
    const { data: fresh } = await supabase().rpc('admin_list_members', { p_club: clubId });
    setMembers(((fresh ?? []) as AdminMember[]).filter((m) => m.status !== 'pending'));
  }

  return (
    <OwnerGuard>
      <PageTitle
        title="Import wyciągu CSV"
        subtitle="Plik jest analizowany wyłącznie w Twojej przeglądarce – do bazy trafiają tylko zatwierdzone wpłaty."
      />
      {suspended && <ErrorBox message="Import jest zablokowany – klub jest zawieszony." />}

      <div className="card mb-4 flex flex-col gap-3">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-6 text-center hover:border-indigo-300">
          <Upload className="h-8 w-8 text-indigo-500" />
          <span className="text-sm font-medium">{file ? file.name : 'Wybierz plik CSV z banku'}</span>
          <span className="text-xs text-slate-500">UTF-8 lub Windows-1250, separator „;” lub „,”</span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={suspended}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Kodowanie</label>
            <select className="input" value={encoding} onChange={(e) => setEncoding(e.target.value as CsvEncoding)}>
              <option value="auto">Automatycznie</option>
              <option value="utf-8">UTF-8</option>
              <option value="windows-1250">Windows-1250 (polskie banki)</option>
            </select>
          </div>
          {info && (
            <div className="text-xs text-slate-500">
              <p className="label">Wykryto</p>
              <p>
                {info.encoding}, separator „{info.delimiter === '\t' ? 'TAB' : info.delimiter}”, nagłówek w wierszu{' '}
                {info.headerRow + 1}, wierszy: {dataRows.length}
              </p>
            </div>
          )}
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {headers.length > 0 && (
        <div className="card mb-4">
          <h2 className="mb-2 font-semibold">Mapowanie kolumn</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="label">
                  {f.label}
                  {f.required && ' *'}
                </label>
                <select
                  className="input"
                  value={map[f.key]}
                  onChange={(e) => setMap((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                >
                  <option value={-1}>— brak —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Kolumna ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {working && <Spinner className="mx-auto my-6 h-6 w-6 text-indigo-600" />}

      {preview.length > 0 && !working && (
        <div className="card mb-24 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
            <div>
              <h2 className="font-semibold">Podgląd wpływów ({preview.length})</h2>
              <p className="text-xs text-slate-500">
                Dopasowano: {preview.filter((p) => p.userId).length} · duplikaty: {preview.filter((p) => p.duplicate).length}
                {skippedOut > 0 && ` · pominięto wydatków: ${skippedOut}`}
              </p>
            </div>
          </div>
          <ul className="divide-y divide-slate-100">
            {preview.map((p) => (
              <li key={p.idx} className={`flex flex-col gap-2 p-4 ${p.duplicate ? 'bg-slate-50 opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 accent-indigo-600"
                    checked={p.selected}
                    disabled={p.duplicate || !p.userId}
                    onChange={(e) => update(p.idx, { selected: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{p.title || '(brak tytułu)'}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(p.date)}
                      {p.sender && ` · ${p.sender}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-600">+{money(p.amount)}</span>
                </div>
                <div className="flex items-center gap-2 pl-8">
                  <select
                    className="input py-1.5 text-sm"
                    value={p.userId}
                    disabled={p.duplicate}
                    onChange={(e) => update(p.idx, { userId: e.target.value, selected: Boolean(e.target.value), reason: e.target.value ? 'ręcznie' : null })}
                  >
                    <option value="">— nie przypisano —</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.member_code} {m.full_name ?? m.email}
                      </option>
                    ))}
                  </select>
                  {p.duplicate ? (
                    <span className="chip shrink-0 bg-slate-200 text-slate-600">już zaksięgowane</span>
                  ) : p.reason ? (
                    <span className="chip shrink-0 bg-emerald-100 text-emerald-700">{p.reason}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-20 px-4">
          <div className="mx-auto max-w-3xl">
            <button
              className="btn btn-primary w-full py-3 shadow-lg"
              disabled={toBook.length === 0 || suspended || busy}
              onClick={() => setConfirm(true)}
            >
              <FileUp className="h-5 w-5" /> Zaksięguj {toBook.length} wpłat ({money(toBookSum)})
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirm}
        title="Zaksięgować wpłaty?"
        message={
          <>
            Zostanie zaksięgowanych <strong>{toBook.length}</strong> wpłat na łączną kwotę <strong>{money(toBookSum)}</strong>.
            Ponowny import tego samego pliku nie spowoduje duplikatów.
          </>
        }
        confirmText="Zaksięguj"
        busy={busy}
        onConfirm={() => void book()}
        onClose={() => setConfirm(false)}
      />
    </OwnerGuard>
  );
}
