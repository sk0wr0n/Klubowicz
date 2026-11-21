'use client';

import { useEffect, useState } from 'react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { POSITIONS, POSITION_CLASS, POSITION_LABEL, POSITION_SHORT, isPosition, type Position } from '@/lib/positions';
import { useToast } from './Toast';
import { Modal, Spinner } from './ui';

export const POSITION_MODAL_EVENT = 'klubowicz:position';

export function openPositionModal() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(POSITION_MODAL_EVENT));
}

/** Mały znaczek pozycji (np. „ROZ”) przy nazwisku. */
export function PositionBadge({ position, full = false }: { position: string | null | undefined; full?: boolean }) {
  if (!isPosition(position)) return null;
  return (
    <span className={`chip shrink-0 ${POSITION_CLASS[position]}`} title={POSITION_LABEL[position]}>
      {full ? POSITION_LABEL[position] : POSITION_SHORT[position]}
    </span>
  );
}

/** Wybór jednej z pięciu pozycji (kafelki). */
export function PositionPicker({ value, onChange }: { value: Position | null; onChange: (p: Position) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {POSITIONS.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm font-semibold transition ${
              active ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 bg-white hover:border-indigo-300'
            } ${p === 'libero' ? 'col-span-2' : ''}`}
          >
            <span className={`chip ${POSITION_CLASS[p]}`}>{POSITION_SHORT[p]}</span>
            {POSITION_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

/** Podsumowanie składu: ile osób na każdej pozycji. */
export function PositionSummary({ positions }: { positions: (string | null | undefined)[] }) {
  const counts = POSITIONS.map((p) => ({ p, n: positions.filter((x) => x === p).length }));
  const unknown = positions.filter((x) => !isPosition(x)).length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {counts.map(({ p, n }) => (
        <span key={p} className={`chip ${n ? POSITION_CLASS[p] : 'bg-slate-100 text-slate-400'}`}>
          {POSITION_LABEL[p]} {n}
        </span>
      ))}
      {unknown > 0 && <span className="chip bg-slate-100 text-slate-500">bez pozycji {unknown}</span>}
    </div>
  );
}

/** Okno „Moja pozycja” – otwierane z menu; pokazuje się samo, gdy pozycja nie jest ustawiona. */
export function MyPositionModal() {
  const { clubId, ctx, reload, reloadMembers } = useClub();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(isPosition(ctx.my_position) ? ctx.my_position : null);
  }, [ctx.my_position]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(POSITION_MODAL_EVENT, onOpen);
    let asked = false;
    try {
      asked = sessionStorage.getItem(`klubowicz.posAsked.${clubId}`) === '1';
    } catch {
      /* */
    }
    if (!ctx.my_position && ctx.my_role && !asked) {
      setOpen(true);
      try {
        sessionStorage.setItem(`klubowicz.posAsked.${clubId}`, '1');
      } catch {
        /* */
      }
    }
    return () => window.removeEventListener(POSITION_MODAL_EVENT, onOpen);
  }, [clubId, ctx.my_position, ctx.my_role]);

  async function save() {
    if (!value) return;
    setBusy(true);
    const { error } = await supabase().rpc('set_my_position', { p_club: clubId, p_position: value });
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    toast(`Zapisano pozycję: ${POSITION_LABEL[value]}.`);
    setOpen(false);
    await reload();
    await reloadMembers();
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Na jakiej pozycji grasz?"
      footer={
        <>
          <button className="btn btn-secondary" onClick={() => setOpen(false)}>
            {ctx.my_position ? 'Anuluj' : 'Później'}
          </button>
          <button className="btn btn-primary" disabled={!value || busy} onClick={() => void save()}>
            {busy && <Spinner className="h-4 w-4" />} Zapisz
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Pozycja będzie widoczna przy Twoim nazwisku na listach treningów – łatwiej będzie złożyć drużyny. Możesz ją zmienić
        w każdej chwili w menu pod awatarem.
      </p>
      <PositionPicker value={value} onChange={setValue} />
    </Modal>
  );
}
