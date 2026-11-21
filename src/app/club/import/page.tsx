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
  rememberAlias: boolean;
}

/** Z nadawcy przelewu („JAN KOWALSKI UL. LIPOWA 7 …”) wyciąga samo imię i nazwisko jako alias. */
function aliasFromSender(sender: string): string {
  const out: string[] = [];
  for (const tok of sender.trim().split(/\s+/)) {
    if (/\d/.test(tok) || /^(ul|al|os|pl|ulica|aleja)\.?$/i.test(tok)) break;
    out.push(tok);
    if (out.length >= 4) break;
  }
  return out
    .join(' ')
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    .trim();
}

const FIELDS: { key: keyof ColumnMap; label: string; required: boolean }[] = [
  { key: 'date', label: 'Data', required: true },
  { key: 'amount', label: 'Kwota', required: true },
  { key: 'title', label: 'Tytuł / opis', required: true },
  { key: 'sender', label: 'Nadawca', required: false },
  { key: 'account', label: 'Rachunek nadawcy', required: false },
  { key: 'balance', label: 'Saldo po operacji', required: false },
];

interface StmtRow {
  date: string;
  amount: number;
  title: string;
  sender: string;
  balance: number | null;
  hash: string;
}

export default function ImportPage() {
  const { clubId, ctx, suspended, reload } = useClub();
  const toast = useToast();
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [encoding, setEncoding] = useState<CsvEncoding>('auto');
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<{ encoding: string; delimiter: string; headerRow: number } | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [map, setMap] = useState<ColumnMap>({ date: -1, amount: -1, title: -1, sender: -1, account: -1, balance: -1 });
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [skippedOut, setSkippedOut] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stmt, setStmt] = useState<StmtRow[]>([]);
  const [closing, setClosing] = useState<{ date: string; balance: number } | null>(null);
  const [manualClosing, setManualClosing] = useState('');
  const [stmtSaved, setStmtSaved] = useState(false);

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
      setStmt([]);
      setClosing(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setWorking(true);
      const out: PreviewRow[] = [];
      const seen: Record<string, number> = {};
      let outgoing = 0;
      const st: StmtRow[] = [];
      const withBal: { date: string; i: number; balance: number }[] = [];
      let firstDate: string | null = null;
      let lastDate: string | null = null;
      for (let i = 0; i < dataRows.length; i++) {
        const r = dataRows[i];
        const amount = parseAmount(r[map.amount]);
        const date = parseDate(r[map.date]);
        if (amount === null || !date || amount === 0) continue;
        firstDate ??= date;
        lastDate = date;
        const title = r[map.title] ?? '';
        const sender = map.sender >= 0 ? (r[map.sender] ?? '') : '';
        const account = map.account >= 0 ? (r[map.account] ?? '').replace(/\s/g, '') : '';
        const balance = map.balance >= 0 ? parseAmount(r[map.balance]) : null;
        const base = `${date}|${amount.toFixed(2)}|${normalize(title)}|${normalize(sender)}|${account}`;
        seen[base] = (seen[base] ?? 0) + 1;
        const hash = await sha256(`${base}|#${seen[base]}`);
        st.push({ date, amount, title, sender, balance, hash });
        if (balance !== null) withBal.push({ date, i, balance });
        if (amount < 0) {
          outgoing++;
          continue;
        }
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
          rememberAlias: false,
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
      // saldo końcowe pliku: najnowsza operacja (banki sortują rosnąco albo malejąco)
      let close: { date: string; balance: number } | null = null;
      if (withBal.length) {
        const maxDate = withBal.reduce((m, x) => (x.date > m ? x.date : m), withBal[0].date);
        const sameDay = withBal.filter((x) => x.date === maxDate);
        const desc = firstDate !== null && lastDate !== null && firstDate > lastDate;
        const pick = desc ? sameDay[0] : sameDay[sameDay.length - 1];
        close = { date: maxDate, balance: pick.balance };
      }
      if (!cancelled) {
        setPreview(out);
        setSkippedOut(outgoing);
        setStmt(st);
        setClosing(close);
        setStmtSaved(false);
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

  const stmtMaxDate = stmt.reduce((m, x) => (x.date > m ? x.date : m), '');
  const stmtIn = stmt.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const stmtOut = -stmt.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);

  async function saveStatement(silent = false): Promise<boolean> {
    if (!stmt.length) return true;
    const manual = manualClosing.trim() ? parseAmount(manualClosing) : null;
    const closeBal = closing?.balance ?? manual;
    const { data, error } = await supabase().rpc('import_bank_statement', {
      p_club: clubId,
      p_rows: stmt,
      p_closing_date: closeBal !== null && closeBal !== undefined ? (closing?.date ?? stmtMaxDate) : null,
      p_closing_balance: closeBal ?? null,
    });
    if (error) {
      toast(errMsg(error), 'error');
      return false;
    }
    setStmtSaved(true);
    if (!silent) {
      const r = data as { inserted: number; skipped: number };
      toast(`Historia konta: zapisano ${r.inserted} operacji${r.skipped ? `, pominięto ${r.skipped} (już były)` : ''}.`);
    }
    return true;
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
    await saveStatement(true);

    // zapamiętaj nadawców ręcznie przypisanych przelewów jako aliasy zawodników
    const aliasAdds = new Map<string, Set<string>>();
    for (const p of toBook) {
      if (!p.rememberAlias || p.reason !== 'ręcznie') continue;
      const alias = aliasFromSender(p.sender);
      if (alias.length < 3) continue;
      if (!aliasAdds.has(p.userId)) aliasAdds.set(p.userId, new Set());
      aliasAdds.get(p.userId)!.add(alias);
    }
    let aliasCount = 0;
    for (const [uid, adds] of aliasAdds) {
      const m = members.find((x) => x.user_id === uid);
      if (!m) continue;
      const merged = Array.from(new Set([...(m.aliases ?? []), ...adds]));
      if (merged.length === (m.aliases ?? []).length) continue;
      const { error: aErr } = await supabase().rpc('set_member_aliases', { p_member_id: m.member_id, p_aliases: merged });
      if (!aErr) aliasCount += merged.length - (m.aliases ?? []).length;
    }

    toast(
      `Zaksięgowano ${res.inserted} wpłat${res.skipped ? `, pominięto ${res.skipped} (duplikaty)` : ''}.` +
        (aliasCount ? ` Zapamiętano nadawców: ${aliasCount}.` : '')
    );
    const booked = new Set(toBook.map((p) => p.hash));
    setPreview((prev) => prev.map((p) => (booked.has(p.hash) ? { ...p, duplicate: true, selected: false } : p)));
    await reload();
    const { data: fresh } = await supabase().rpc('admin_list_members', { p_club: clubId });
    setMembers(((fresh ?? []) as AdminMember[]).filter((m) => m.status !== 'pending'));
  }

  return (
    <OwnerGuard allowFinance>
      <PageTitle
        title="Import wyciągu CSV"
        subtitle="Plik jest analizowany w Twojej przeglądarce. Do bazy trafiają zatwierdzone wpłaty i historia operacji konta klubu (widoczna tylko dla Właściciela i Skarbnika)."
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

      {!working && stmt.length > 0 && (
        <div className="card mb-4 flex flex-col gap-2">
          <h2 className="font-semibold">Historia konta klubu</h2>
          <p className="text-sm text-slate-600">
            W pliku {stmt.length} operacji: wpływy <span className="font-semibold text-emerald-600">+{money(stmtIn)}</span>, wydatki{' '}
            <span className="font-semibold text-red-600">−{money(stmtOut)}</span>.
          </p>
          {closing ? (
            <p className="text-sm">
              Saldo na {formatDate(closing.date)}: <strong>{money(closing.balance)}</strong>
            </p>
          ) : (
            <div>
              <label className="label">Saldo na koniec wyciągu ({stmtMaxDate ? formatDate(stmtMaxDate) : '—'}) – opcjonalnie</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder="np. 2450,30 – z aplikacji banku"
                value={manualClosing}
                onChange={(e) => setManualClosing(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                W pliku nie ma kolumny z saldem. Wpisz stan konta, żeby aplikacja pokazywała saldo klubu.
              </p>
            </div>
          )}
          <button
            className="btn btn-secondary"
            disabled={busy || stmtSaved}
            onClick={() =>
              void (async () => {
                setBusy(true);
                await saveStatement();
                setBusy(false);
              })()
            }
          >
            {stmtSaved ? '✓ Historia zapisana' : `Zapisz historię konta (${stmt.length} operacji)`}
          </button>
          <p className="text-[11px] text-slate-500">
            Zapisuje się też automatycznie przy księgowaniu wpłat. Ponowny import tego samego pliku nie tworzy duplikatów.
          </p>
        </div>
      )}

      {!working && dataRows.length > 0 && preview.length === 0 && (
        <div className="card mb-4 text-sm text-slate-600">
          {map.date < 0 || map.amount < 0 || map.title < 0
            ? 'Wybierz powyżej kolumny Data, Kwota i Tytuł – wtedy pojawi się podgląd wpłat.'
            : `Nie znaleziono wpływów w tym pliku${skippedOut ? ` (pominięto ${skippedOut} wydatków)` : ''}. Sprawdź mapowanie kolumn.`}
        </div>
      )}

      {preview.length > 0 && !working && (() => {
        const unmatched = preview.filter((p) => !p.userId && !p.duplicate).length;
        const bookButton = (
          <button
            className="btn btn-primary w-full py-3"
            disabled={toBook.length === 0 || suspended || busy}
            onClick={() => setConfirm(true)}
          >
            <FileUp className="h-5 w-5" />
            {toBook.length > 0 ? `Zaksięguj ${toBook.length} wpłat (${money(toBookSum)})` : 'Zaznacz wpłaty do zaksięgowania'}
          </button>
        );
        return (
          <>
            <div className="card mb-3 flex flex-col gap-3">
              <div>
                <h2 className="font-semibold">Podgląd wpływów ({preview.length})</h2>
                <p className="text-xs text-slate-500">
                  Rozpoznane: {preview.filter((p) => p.userId && !p.duplicate).length} · do przypisania: {unmatched} · już
                  zaksięgowane: {preview.filter((p) => p.duplicate).length}
                  {skippedOut > 0 && ` · pominięto wydatków: ${skippedOut}`}
                </p>
              </div>
              {unmatched > 0 && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Przelewy oznaczone na pomarańczowo nie mają rozpoznanego zawodnika (np. brak kodu w tytule). Wybierz osobę z
                  listy „Przypisz do zawodnika” – albo zostaw nieprzypisane, jeśli to nie jest wpłata za treningi.
                </p>
              )}
              {bookButton}
            </div>

            <div className="card mb-3 p-0">
              <ul className="divide-y divide-slate-100">
                {preview.map((p) => {
                  const needs = !p.userId && !p.duplicate;
                  return (
                    <li
                      key={p.idx}
                      className={`flex flex-col gap-2 p-4 ${p.duplicate ? 'bg-slate-50 opacity-60' : needs ? 'bg-amber-50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-5 w-5 shrink-0 accent-indigo-600"
                          checked={p.selected}
                          disabled={p.duplicate || !p.userId}
                          onChange={(e) => update(p.idx, { selected: e.target.checked })}
                          aria-label="Księguj tę wpłatę"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium">{p.title || '(brak tytułu)'}</p>
                          <p className="break-words text-xs text-slate-500">
                            {formatDate(p.date)}
                            {p.sender && ` · ${p.sender}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-emerald-600">+{money(p.amount)}</span>
                      </div>

                      {p.duplicate ? (
                        <span className="chip ml-8 self-start bg-slate-200 text-slate-600">już zaksięgowane</span>
                      ) : (
                        <div className="ml-8 flex flex-col gap-1.5">
                          <label className={`text-xs font-semibold ${needs ? 'text-amber-800' : 'text-slate-500'}`}>
                            {needs ? 'Przypisz do zawodnika:' : 'Zawodnik:'}
                            {p.reason && (
                              <span className="chip ml-2 bg-emerald-100 font-medium text-emerald-700">
                                {p.reason === 'ręcznie' ? 'przypisano ręcznie' : `rozpoznano: ${p.reason}`}
                              </span>
                            )}
                          </label>
                          <select
                            className={`input py-2 text-sm ${needs ? 'border-amber-300' : ''}`}
                            value={p.userId}
                            onChange={(e) =>
                              update(p.idx, {
                                userId: e.target.value,
                                selected: Boolean(e.target.value),
                                reason: e.target.value ? 'ręcznie' : null,
                                rememberAlias: Boolean(e.target.value) && Boolean(aliasFromSender(p.sender)),
                              })
                            }
                          >
                            <option value="">— nie przypisuj —</option>
                            {members.map((m) => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.member_code} {m.full_name ?? m.email}
                              </option>
                            ))}
                          </select>
                          {p.reason === 'ręcznie' && aliasFromSender(p.sender) && (
                            <label className="flex items-center gap-2 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-indigo-600"
                                checked={p.rememberAlias}
                                onChange={(e) => update(p.idx, { rememberAlias: e.target.checked })}
                              />
                              Zapamiętaj nadawcę „{aliasFromSender(p.sender)}” – kolejne przelewy przypiszą się same
                            </label>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="mb-4">{bookButton}</div>
          </>
        );
      })()}

      <ConfirmModal
        open={confirm}
        title="Zaksięgować wpłaty?"
        message={
          <>
            Zostanie zaksięgowanych <strong>{toBook.length}</strong> wpłat na łączną kwotę <strong>{money(toBookSum)}</strong>.
            Zapiszemy też historię konta z pliku ({stmt.length} operacji). Ponowny import tego samego pliku nie spowoduje duplikatów.
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
