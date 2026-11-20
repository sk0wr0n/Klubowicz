const moneyFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

export function money(v: number | string | null | undefined): string {
  return moneyFmt.format(Number(v ?? 0));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatShortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Klucz dnia w czasie lokalnym: RRRR-MM-DD */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Bieżący okres rozliczeniowy RRRR-MM */
export function currentPeriod(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
}

export function monthLabel(d: Date): string {
  return d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
}

export function todayInput(): string {
  return dayKey(new Date());
}

/** Wartość dla <input type="date"> i <input type="time"> z ISO */
export function toDateInput(iso: string): string {
  return dayKey(new Date(iso));
}

export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Łączy lokalną datę i godzinę w ISO (UTC) */
export function localToIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}
