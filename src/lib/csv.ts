// Lokalny (w przeglądarce) parser wyciągów bankowych CSV.
// Plik NIE jest wysyłany na serwer – do bazy trafiają zatwierdzone wpłaty i (opcjonalnie) historia operacji konta klubu.

export type CsvEncoding = 'auto' | 'utf-8' | 'windows-1250';

export interface ColumnMap {
  date: number;
  amount: number;
  title: number;
  sender: number;
  account: number;
  balance: number;
}

export interface MatchCandidate {
  user_id: string;
  full_name: string | null;
  member_code: string | null;
  aliases: string[];
}

export interface MatchResult {
  user_id: string;
  reason: 'kod' | 'alias' | 'imię i nazwisko';
}

export async function decodeFile(file: File, encoding: CsvEncoding): Promise<{ text: string; encoding: string }> {
  const buf = await file.arrayBuffer();
  const strip = (t: string) => t.replace(/^﻿/, '');
  if (encoding === 'utf-8' || encoding === 'windows-1250') {
    return { text: strip(new TextDecoder(encoding).decode(buf)), encoding };
  }
  try {
    return { text: strip(new TextDecoder('utf-8', { fatal: true }).decode(buf)), encoding: 'utf-8' };
  } catch {
    return { text: strip(new TextDecoder('windows-1250').decode(buf)), encoding: 'windows-1250' };
  }
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 15);
  let best = ';';
  let bestScore = -1;
  for (const d of [';', ',', '\t']) {
    const counts = lines.map((l) => splitLineCount(l, d));
    const nonZero = counts.filter((c) => c > 0);
    const score = nonZero.length * 10 + (nonZero.length ? Math.min(...nonZero) : 0);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitLineCount(line: string, d: string): number {
  let inQ = false;
  let n = 0;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === d && !inQ) n++;
  }
  return n;
}

/** Parser CSV zgodny z RFC 4180 (cudzysłowy, podwójne cudzysłowy, nowe linie w polach). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
  return rows;
}

const HEADER_HINTS = /(data|date|kwota|amount|tytu|opis|nadawc|kontrahent|odbiorc|rachun|waluta|saldo)/i;

/** Banki często dodają kilka linii nagłówka (nazwa konta, okres) – znajdź właściwy wiersz z kolumnami. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const hits = rows[i].filter((c) => HEADER_HINTS.test(c)).length;
    if (hits >= 2 && rows[i].length >= 3) return i;
  }
  return 0;
}

export function guessColumns(headers: string[]): ColumnMap {
  const h = headers.map((x) => normalize(x));
  const find = (re: RegExp, exclude?: RegExp) => h.findIndex((x) => re.test(x) && !(exclude && exclude.test(x)));
  let date = find(/data operacji|data transakcji/);
  if (date < 0) date = find(/data ksiegowania|data waluty/);
  if (date < 0) date = find(/\bdata\b|date/);
  const amount = find(/kwota|amount|wartosc|uznanie/, /saldo|balance/);
  const title = find(/tytul|title|opis|description|szczegoly/);
  const sender = find(/nadawc|kontrahent|zleceniodawc|odbiorca|sender|payer|nazwa/);
  const account = find(/rachunek|konto|account|iban|numer/, /saldo/);
  const balance = find(/saldo|balance/);
  return { date, amount, title, sender, account, balance };
}

export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/[\s ]/g, '').replace(/PLN|zł|zl/gi, '').replace(/^\+/, '');
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Małe litery, bez polskich znaków, tylko litery/cyfry/spacje. */
export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function codeNumber(code: string | null): number | null {
  if (!code) return null;
  const m = code.match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Dopasowanie przelewu do zawodnika:
 *  1) kod zawodnika w tytule (np. VCA-04, VCA 4, vca04),
 *  2) alias (np. nazwisko partnera/rodzica),
 *  3) imię i nazwisko zawodnika (w dowolnej kolejności) w tytule lub nadawcy.
 * Zwraca wynik tylko przy jednoznacznym dopasowaniu.
 */
export function matchMember(
  title: string,
  sender: string,
  prefix: string,
  members: MatchCandidate[]
): MatchResult | null {
  const rawHay = `${title} ${sender}`;
  const codeRe = new RegExp(`(?:^|[^a-z0-9])${escapeRe(prefix.toLowerCase())}\\s*[-_/ ]?\\s*0*(\\d{1,4})(?![0-9])`, 'i');
  const cm = rawHay.toLowerCase().match(codeRe);
  if (cm) {
    const num = Number(cm[1]);
    const hits = members.filter((m) => codeNumber(m.member_code) === num);
    if (hits.length === 1) return { user_id: hits[0].user_id, reason: 'kod' };
  }

  const hay = ` ${normalize(rawHay)} `;

  const aliasHits = members.filter((m) =>
    (m.aliases ?? []).some((a) => {
      const n = normalize(a);
      return n.length >= 3 && hay.includes(` ${n} `);
    })
  );
  if (aliasHits.length === 1) return { user_id: aliasHits[0].user_id, reason: 'alias' };

  const nameHits = members.filter((m) => {
    const tokens = normalize(m.full_name).split(' ').filter((t) => t.length >= 2);
    if (tokens.length < 2) return false;
    return tokens.every((t) => hay.includes(` ${t} `));
  });
  if (nameHits.length === 1) return { user_id: nameHits[0].user_id, reason: 'imię i nazwisko' };

  return null;
}
