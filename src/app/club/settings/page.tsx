'use client';

import { useEffect, useState } from 'react';
import { ImagePlus, Save, Trash2, Volleyball } from 'lucide-react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import OwnerGuard from '@/components/OwnerGuard';
import { useToast } from '@/components/Toast';
import { PageTitle, Spinner } from '@/components/ui';

/** Wycina środek obrazka do kwadratu i zmniejsza do 512×512 (PNG). */
async function toSquarePng(file: File, size = 512): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Nie udało się wczytać obrazka.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, size, size);
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Błąd konwersji obrazka.'))), 'image/png')
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function LogoSection() {
  const { clubId, ctx, reload } = useClub();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const logo = ctx.club.logo_url ?? null;

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) {
      toast('Wybierz plik graficzny (PNG, JPG).', 'error');
      return;
    }
    setBusy(true);
    try {
      const blob = await toSquarePng(file);
      const path = `${clubId}/logo-${Date.now()}.png`;
      const sb = supabase();
      const { error: upErr } = await sb.storage.from('club-logos').upload(path, blob, {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data } = sb.storage.from('club-logos').getPublicUrl(path);
      const { error } = await sb.rpc('set_club_logo', { p_club: clubId, p_url: data.publicUrl });
      if (error) throw error;
      toast('Zapisano logo klubu.');
      await reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabase().rpc('set_club_logo', { p_club: clubId, p_url: null });
    setBusy(false);
    if (error) toast(errMsg(error), 'error');
    else {
      toast('Przywrócono domyślną ikonę.');
      await reload();
    }
  }

  return (
    <div className="card flex flex-col gap-3">
      <h2 className="font-semibold">Logo klubu</h2>
      <div className="flex items-center gap-4">
        <span
          className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow ${
            logo ? 'bg-white ring-1 ring-slate-200' : 'bg-indigo-600 text-white'
          }`}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Logo klubu" className="h-full w-full object-cover" />
          ) : (
            <Volleyball className="h-10 w-10" />
          )}
        </span>
        <div className="flex flex-col gap-2">
          <label className={`btn btn-secondary btn-sm cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            {busy ? <Spinner className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />} {logo ? 'Zmień logo' : 'Wgraj logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
          </label>
          {logo && (
            <button type="button" className="btn btn-ghost btn-sm text-red-600" disabled={busy} onClick={() => void remove()}>
              <Trash2 className="h-4 w-4" /> Przywróć piłkę
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Najlepiej kwadratowy obrazek (PNG/JPG). Wytniemy środek i zmniejszymy do 512×512. Logo pokaże się w nagłówku aplikacji
        u wszystkich członków klubu i jako ikona przy dodawaniu aplikacji do ekranu głównego iPhone’a.
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const { clubId, ctx, reload } = useClub();
  const toast = useToast();
  const c = ctx.club;
  const [name, setName] = useState(c.name);
  const [account, setAccount] = useState(c.bank_account ?? '');
  const [recipient, setRecipient] = useState(c.bank_recipient ?? '');
  const [monthly, setMonthly] = useState(String(c.monthly_fee_amount));
  const [single, setSingle] = useState(String(c.single_training_fee_amount));
  const [deadline, setDeadline] = useState(String(c.cancellation_deadline_hours));
  const [max, setMax] = useState(String(c.default_max_participants));
  const [location, setLocation] = useState(c.default_location ?? '');
  const [busy, setBusy] = useState(false);
  const lateOn = c.late_cancel_fee_enabled !== false;
  const [lateBusy, setLateBusy] = useState(false);

  async function toggleLate() {
    setLateBusy(true);
    const { error } = await supabase().rpc('set_late_cancel_fee', { p_club: clubId, p_enabled: !lateOn });
    setLateBusy(false);
    if (error) toast(errMsg(error), 'error');
    else {
      toast(lateOn ? 'Wyłączono opłatę za późne wypisanie.' : 'Włączono opłatę za późne wypisanie.');
      await reload();
    }
  }

  useEffect(() => {
    setName(c.name);
    setAccount(c.bank_account ?? '');
    setRecipient(c.bank_recipient ?? '');
    setMonthly(String(c.monthly_fee_amount));
    setSingle(String(c.single_training_fee_amount));
    setDeadline(String(c.cancellation_deadline_hours));
    setMax(String(c.default_max_participants));
    setLocation(c.default_location ?? '');
  }, [c]);

  const num = (v: string) => Number(v.replace(',', '.'));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const iban = account.replace(/\s/g, '');
    if (iban && !/^(PL)?\d{26}$/i.test(iban)) {
      toast('Numer konta powinien mieć 26 cyfr (opcjonalnie z prefiksem PL).', 'error');
      return;
    }
    setBusy(true);
    const { error } = await supabase().rpc('update_club_settings', {
      p_club: clubId,
      p_name: name,
      p_bank_account: account,
      p_bank_recipient: recipient,
      p_monthly_fee: num(monthly),
      p_single_fee: num(single),
      p_deadline_hours: Math.round(num(deadline)),
      p_default_max: Math.round(num(max)),
      p_default_location: location,
    });
    setBusy(false);
    if (error) toast(errMsg(error), 'error');
    else {
      toast('Zapisano ustawienia klubu.');
      await reload();
    }
  }

  return (
    <OwnerGuard>
      <PageTitle title="Ustawienia klubu" subtitle={`Prefiks kodów zawodników: ${c.prefix}`} />
      <div className="mb-4">
        <LogoSection />
      </div>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="card flex flex-col gap-3">
          <h2 className="font-semibold">Klub</h2>
          <div>
            <label className="label">Nazwa klubu</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Domyślne miejsce treningów</label>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <label className="label">Domyślny limit miejsc</label>
            <input className="input" type="number" min={1} max={500} value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
        </div>

        <div className="card flex flex-col gap-3">
          <h2 className="font-semibold">Stawki i zasady</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Składka miesięczna – wynajem sali (zł)</label>
              <input className="input" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </div>
            <div>
              <label className="label">Opłata za trening (zł)</label>
              <input className="input" inputMode="decimal" value={single} onChange={(e) => setSingle(e.target.value)} />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Opłata za późne wypisanie</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {lateOn
                    ? 'Włączona – kto wypisze się za późno, trafia na listę „wypisani po terminie”, a Opiekun może naliczyć opłatę.'
                    : 'Wyłączona – wypisanie zawsze bezpłatne. Płacą tylko osoby, którym Opiekun potwierdzi obecność.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={lateOn}
                disabled={lateBusy}
                onClick={() => void toggleLate()}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${lateOn ? 'bg-indigo-600' : 'bg-slate-300'}`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${lateOn ? 'left-[22px]' : 'left-0.5'}`}
                />
              </button>
            </div>
            {lateOn && (
              <div className="mt-3">
                <label className="label">Termin bezpłatnego wypisania (godziny przed treningiem)</label>
                <input className="input" type="number" min={0} max={336} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
            )}
          </div>
        </div>

        <div className="card flex flex-col gap-3">
          <h2 className="font-semibold">Konto bankowe klubu</h2>
          <div>
            <label className="label">Odbiorca przelewu</label>
            <input className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          </div>
          <div>
            <label className="label">Numer konta</label>
            <input
              className="input font-mono"
              placeholder="PL61 1090 1014 0000 0712 1981 2874"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </div>
        </div>

        <button className="btn btn-primary py-3" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Zapisz ustawienia
        </button>
      </form>
    </OwnerGuard>
  );
}
