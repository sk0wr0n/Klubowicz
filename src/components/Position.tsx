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

/** Wybór kilku pozycji – kolejność stuknięć, pierwsza = główna. */
export function PositionMultiPicker({ value, onChange }: { value: Position[]; onChange: (p: Position[]) => void }) {
  function toggle(p: Position) {
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {POSITIONS.map((p) => {
          const idx = value.indexOf(p);
          const active = idx >= 0;
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-3 text-left text-[13px] font-semibold transition ${
                active ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 bg-white hover:border-indigo-300'
              } ${p === 'libero' ? 'col-span-2' : ''}`}
            >
              <span className={`chip ${POSITION_CLASS[p]}`}>{POSITION_SHORT[p]}</span>
              <span className="min-w-0 flex-1 truncate">{POSITION_LABEL[p]}</span>
              {active && (
                <span
                  className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold ${
                    idx === 0 ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700'
                  }`}
                  title={idx === 0 ? 'pozycja główna' : `${idx + 1}. pozycja`}
                >
                  {idx === 0 ? '★' : idx + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        Możesz zaznaczyć kilka. Pierwsza zaznaczona (★) to pozycja główna – przy zapisie na trening lub turniej wybierzesz,
        na której grasz tym razem.
      </p>
    </div>
  );
}

/** Wszystkie pozycje zawodnika (główna pierwsza). */
export function PositionBadges({ positions, primary }: { positions?: string[] | null; primary?: string | null }) {
  const list = (positions?.length ? positions : primary ? [primary] : []).filter(isPosition);
  if (!list.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((p, i) => (
        <span key={p} className={`chip ${POSITION_CLASS[p]} ${i > 0 ? 'opacity-70' : ''}`} title={POSITION_LABEL[p]}>
          {POSITION_SHORT[p]}
        </span>
      ))}
    </span>
  );
}

/** Okno: na jakiej pozycji gram na tym treningu / turnieju. */
export function EventPositionModal({
  open,
  title,
  personName,
  memberPositions,
  current,
  busy,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  personName?: string;
  memberPositions: string[];
  current: string | null;
  busy?: boolean;
  onPick: (p: Position) => void;
  onClose: () => void;
}) {
  const mine = memberPositions.filter(isPosition);
  const others = POSITIONS.filter((p) => !mine.includes(p));
  const tile = (p: Position) => (
    <button
      key={p}
      type="button"
      disabled={busy}
      onClick={() => onPick(p)}
      className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm font-semibold transition ${
        current === p ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 bg-white hover:border-indigo-300'
      }`}
    >
      <span className={`chip ${POSITION_CLASS[p]}`}>{POSITION_SHORT[p]}</span>
      {POSITION_LABEL[p]}
    </button>
  );
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {personName && <p className="mb-3 text-sm text-slate-600">{personName}</p>}
      {mine.length > 0 && (
        <>
          <p className="label">{personName ? 'Pozycje zawodnika' : 'Twoje pozycje'}</p>
          <div className="mb-3 grid grid-cols-2 gap-2">{mine.map(tile)}</div>
        </>
      )}
      {others.length > 0 && (
        <>
          <p className="label">Inne</p>
          <div className="grid grid-cols-2 gap-2">{others.map(tile)}</div>
        </>
      )}
      {busy && <Spinner className="mx-auto mt-3 h-5 w-5" />}
    </Modal>
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
  const { clubId, ctx, reload, reloadMembers, memberMap } = useClub();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Position[]>([]);
  const [busy, setBusy] = useState(false);

  const myId = ctx.my_member_id;
  const myPositions = Object.values(memberMap).find((m) => m.id === myId)?.positions;
  useEffect(() => {
    const list = (myPositions?.length ? myPositions : ctx.my_position ? [ctx.my_position] : []).filter(isPosition);
    setValue(list);
  }, [ctx.my_position, myPositions]);

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
    if (!value.length) return;
    setBusy(true);
    const { error } = await supabase().rpc('set_my_positions', { p_club: clubId, p_positions: value });
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    toast(`Zapisano: ${value.map((p) => POSITION_LABEL[p]).join(', ')}.`);
    setOpen(false);
    await reload();
    await reloadMembers();
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Na jakich pozycjach grasz?"
      footer={
        <>
          <button className="btn btn-secondary" onClick={() => setOpen(false)}>
            {ctx.my_position ? 'Anuluj' : 'Później'}
          </button>
          <button className="btn btn-primary" disabled={!value.length || busy} onClick={() => void save()}>
            {busy && <Spinner className="h-4 w-4" />} Zapisz
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Pozycje będą widoczne przy Twoim nazwisku na listach treningów – łatwiej będzie złożyć drużyny. Możesz je zmienić
        w każdej chwili w menu pod awatarem.
      </p>
      <PositionMultiPicker value={value} onChange={setValue} />
    </Modal>
  );
}
