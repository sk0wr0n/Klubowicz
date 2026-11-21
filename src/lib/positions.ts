export type Position = 'setter' | 'outside' | 'opposite' | 'middle' | 'libero';

/** Kolejność jak na boisku: rozgrywający, przyjmujący, atakujący, środkowy, libero. */
export const POSITIONS: Position[] = ['setter', 'outside', 'opposite', 'middle', 'libero'];

export const POSITION_LABEL: Record<Position, string> = {
  setter: 'Rozgrywający',
  outside: 'Przyjmujący',
  opposite: 'Atakujący',
  middle: 'Środkowy',
  libero: 'Libero',
};

export const POSITION_SHORT: Record<Position, string> = {
  setter: 'ROZ',
  outside: 'PRZ',
  opposite: 'ATA',
  middle: 'ŚR',
  libero: 'LIB',
};

export const POSITION_CLASS: Record<Position, string> = {
  setter: 'bg-violet-100 text-violet-700',
  outside: 'bg-sky-100 text-sky-700',
  opposite: 'bg-rose-100 text-rose-700',
  middle: 'bg-emerald-100 text-emerald-700',
  libero: 'bg-amber-100 text-amber-800',
};

export function isPosition(v: unknown): v is Position {
  return typeof v === 'string' && (POSITIONS as string[]).includes(v);
}
