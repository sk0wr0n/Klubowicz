'use client';

import { useEffect, useState } from 'react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { todayInput } from '@/lib/format';
import type { Tournament } from '@/lib/types';
import { useToast } from './Toast';
import { Modal, Spinner } from './ui';

export default function TournamentFormModal({
  open,
  onClose,
  onSaved,
  tournament,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  tournament?: Tournament | null;
  defaultDate?: string;
}) {
  const { clubId, isStaff } = useClub();
  const toast = useToast();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [startsOn, setStartsOn] = useState(todayInput());
  const [endsOn, setEndsOn] = useState('');
  const [url, setUrl] = useState('');
  const [fee, setFee] = useState('');
  const [deadline, setDeadline] = useState(todayInput());
  const [notes, setNotes] = useState('');
  const [estCost, setEstCost] = useState('');
  const [costNotes, setCostNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const closed = tournament?.status === 'closed';
  const feeLocked = closed && !isStaff;

  useEffect(() => {
    if (!open) return;
    if (tournament) {
      setName(tournament.name);
      setLocation(tournament.location);
      setStartsOn(tournament.starts_on);
      setEndsOn(tournament.ends_on ?? '');
      setUrl(tournament.event_url ?? '');
      setFee(tournament.entry_fee != null ? String(tournament.entry_fee).replace('.', ',') : '');
      setDeadline(tournament.signup_deadline);
      setNotes(tournament.notes ?? '');
      setEstCost(tournament.est_cost_per_person != null ? String(tournament.est_cost_per_person).replace('.', ',') : '');
      setCostNotes(tournament.cost_notes ?? '');
    } else {
      const d = defaultDate ?? todayInput();
      setName('');
      setLocation('');
      setStartsOn(d);
      setEndsOn('');
      setUrl('');
      setFee('');
      setDeadline(d);
      setNotes('');
      setEstCost('');
      setCostNotes('');
    }
  }, [open, tournament, defaultDate]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const feeNum = fee.trim() === '' ? null : Number(fee.replace(',', '.').replace(/\s/g, ''));
    if (feeNum !== null && (Number.isNaN(feeNum) || feeNum < 0)) {
      toast('Wpisowe musi być liczbą (np. 300).', 'error');
      return;
    }
    const estNum = estCost.trim() === '' ? null : Number(estCost.replace(',', '.').replace(/\s/g, ''));
    if (estNum !== null && (Number.isNaN(estNum) || estNum < 0)) {
      toast('Przewidywany koszt musi być liczbą (np. 500).', 'error');
      return;
    }
    if (endsOn && endsOn < startsOn) {
      toast('Data końca jest przed datą początku.', 'error');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase().rpc('save_tournament', {
      p_club: clubId,
      p_id: tournament?.id ?? null,
      p_name: name,
      p_location: location,
      p_starts_on: startsOn,
      p_ends_on: endsOn || null,
      p_event_url: url,
      p_entry_fee: feeNum,
      p_signup_deadline: deadline,
      p_notes: notes,
      p_est_cost: estNum,
      p_cost_notes: costNotes,
    });
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      return;
    }
    toast(tournament ? 'Zapisano zmiany turnieju.' : 'Dodano turniej – jesteś na liście uczestników.');
    onClose();
    onSaved(String(data ?? tournament?.id));
  }

  return (
    <Modal open={open} onClose={onClose} title={tournament ? 'Edytuj turniej' : 'Nowy turniej'}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <div>
          <label className="label">Nazwa turnieju *</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Puchar Mazowsza 2026" />
        </div>
        <div>
          <label className="label">Gdzie *</label>
          <input className="input" required value={location} onChange={(e) => setLocation(e.target.value)} placeholder="np. Hala OSiR Ursus, Warszawa" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Kiedy (od) *</label>
            <input
              className="input"
              type="date"
              required
              value={startsOn}
              onChange={(e) => {
                setStartsOn(e.target.value);
                if (!tournament && deadline > e.target.value) setDeadline(e.target.value);
              }}
            />
          </div>
          <div>
            <label className="label">Do (opcjonalnie)</label>
            <input className="input" type="date" min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Zapisy do (termin zamknięcia) *</label>
          <input className="input" type="date" required value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div>
          <label className="label">Wpisowe za drużynę (zł)</label>
          <input
            className="input"
            inputMode="decimal"
            value={fee}
            disabled={feeLocked}
            onChange={(e) => setFee(e.target.value)}
            placeholder="np. 300 – można uzupełnić później"
          />
          <p className="mt-1 text-xs text-slate-500">
            {feeLocked
              ? 'Zapisy są zamknięte – kwotę wpisowego może zmienić tylko Opiekun.'
              : 'Opcjonalne, ale potrzebne do zamknięcia zapisów. Kwota zostanie podzielona po równo na zapisanych.'}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <label className="label">Przewidywany koszt na osobę – ok. (zł)</label>
          <input
            className="input"
            inputMode="decimal"
            value={estCost}
            onChange={(e) => setEstCost(e.target.value)}
            placeholder="np. 500 – wpisowe + nocleg itd."
          />
          <label className="label mt-2">Na co (opis kosztów)</label>
          <textarea
            className="input min-h-[60px]"
            maxLength={500}
            value={costNotes}
            onChange={(e) => setCostNotes(e.target.value)}
            placeholder="np. wpisowe ok. 50 zł, 3 noclegi 450 zł, wyżywienie w cenie"
          />
          <p className="mt-1 text-xs text-slate-500">Orientacyjnie, żeby każdy wiedział, na jaki wydatek się pisze. Nic nie nalicza.</p>
        </div>
        <div>
          <label className="label">Link do wydarzenia (opcjonalnie)</label>
          <input className="input" type="text" inputMode="url" autoCapitalize="none" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <label className="label">Notatki (opcjonalnie)</label>
          <textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. zbiórka, dojazd, nocleg" />
        </div>
        <button className="btn btn-primary py-3" disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />} {tournament ? 'Zapisz zmiany' : 'Dodaj turniej'}
        </button>
      </form>
    </Modal>
  );
}
