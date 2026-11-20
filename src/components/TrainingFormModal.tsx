'use client';

import { useEffect, useState } from 'react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { localToIso, toDateInput, toTimeInput, todayInput } from '@/lib/format';
import type { Training } from '@/lib/types';
import { useToast } from './Toast';
import { Modal, Spinner } from './ui';

export default function TrainingFormModal({
  open,
  onClose,
  onSaved,
  training,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  training?: Training | null;
  defaultDate?: string;
}) {
  const { clubId, ctx } = useClub();
  const toast = useToast();
  const [title, setTitle] = useState('Trening');
  const [date, setDate] = useState(todayInput());
  const [start, setStart] = useState('19:00');
  const [end, setEnd] = useState('21:00');
  const [location, setLocation] = useState('');
  const [max, setMax] = useState(14);
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (training) {
      setTitle(training.title);
      setDate(toDateInput(training.starts_at));
      setStart(toTimeInput(training.starts_at));
      setEnd(training.ends_at ? toTimeInput(training.ends_at) : '');
      setLocation(training.location ?? '');
      setMax(training.max_participants);
      setNotes(training.notes ?? '');
      setRepeat(1);
    } else {
      setTitle('Trening');
      setDate(defaultDate ?? todayInput());
      setStart('19:00');
      setEnd('21:00');
      setLocation(ctx.club.default_location ?? '');
      setMax(ctx.club.default_max_participants);
      setNotes('');
      setRepeat(1);
    }
  }, [open, training, defaultDate, ctx.club.default_location, ctx.club.default_max_participants]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const startsAt = localToIso(date, start);
    let endsAt: string | null = end ? localToIso(date, end) : null;
    if (endsAt && endsAt <= startsAt) {
      toast('Godzina zakończenia musi być późniejsza niż rozpoczęcia.', 'error');
      return;
    }
    if (!training && new Date(startsAt) < new Date(Date.now() - 3_600_000)) {
      toast('Termin treningu jest w przeszłości.', 'error');
      return;
    }
    setBusy(true);
    const base = {
      title: title.trim() || 'Trening',
      location: location.trim() || null,
      max_participants: Math.max(1, Number(max) || 1),
      notes: notes.trim() || null,
    };
    let error;
    if (training) {
      ({ error } = await supabase()
        .from('trainings')
        .update({ ...base, starts_at: startsAt, ends_at: endsAt })
        .eq('id', training.id));
    } else {
      const rows = [];
      for (let i = 0; i < Math.min(Math.max(repeat, 1), 26); i++) {
        const s = new Date(startsAt);
        s.setDate(s.getDate() + 7 * i);
        let en: Date | null = null;
        if (endsAt) {
          en = new Date(endsAt);
          en.setDate(en.getDate() + 7 * i);
        }
        rows.push({ ...base, club_id: clubId, starts_at: s.toISOString(), ends_at: en ? en.toISOString() : null });
      }
      ({ error } = await supabase().from('trainings').insert(rows));
      endsAt = null;
    }
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    toast(training ? 'Zapisano zmiany.' : repeat > 1 ? `Dodano ${repeat} treningów.` : 'Dodano trening.');
    onSaved();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={training ? 'Edytuj trening' : 'Nowy trening'}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" form="training-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Zapisz
          </button>
        </>
      }
    >
      <form id="training-form" onSubmit={save} className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Nazwa</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </div>
        <div className="col-span-2">
          <label className="label">Data</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className="label">Początek</label>
          <input type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <label className="label">Koniec</label>
          <input type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">Miejsce</label>
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Hala sportowa" />
        </div>
        <div>
          <label className="label">Limit miejsc</label>
          <input
            type="number"
            min={1}
            max={500}
            className="input"
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            required
          />
        </div>
        {!training && (
          <div>
            <label className="label">Powtórz co tydzień</label>
            <select className="input" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
              {[1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 26].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'tylko raz' : `${n} tygodni`}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="col-span-2">
          <label className="label">Notatka (opcjonalnie)</label>
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
