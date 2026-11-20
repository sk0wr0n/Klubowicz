'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Ban, Building2, CalendarDays, CircleCheck, Pencil, Plus, Receipt, ShieldCheck, Unlock, UserPlus } from 'lucide-react';
import { useAuth, useRequireAuth } from '@/lib/auth';
import { errMsg, supabase } from '@/lib/supabase';
import { currentPeriod, formatDate, money, periodLabel } from '@/lib/format';
import { clubHref, inviteLink } from '@/lib/nav';
import { PLAN_LABEL, SUB_LABEL, type PlanCode, type PlatformInvoice, type SaClub } from '@/lib/types';
import AppHeader from '@/components/AppHeader';
import CopyField from '@/components/CopyField';
import { useToast } from '@/components/Toast';
import { ConfirmModal, EmptyState, ErrorBox, FullScreenLoader, Modal, PageTitle, Spinner } from '@/components/ui';

const PLAN_AMOUNT: Record<PlanCode, number> = { FREE: 0, CLUB_50: 50, CLUB_100: 100, CUSTOM: 0 };

interface PlatformSettings {
  platform_name: string;
  bank_account: string | null;
  bank_recipient: string | null;
  contact_email: string | null;
}

type Pending = { kind: 'charge' | 'paid' | 'suspend' | 'unlock'; club: SaClub } | null;

export default function SuperadminPage() {
  const { ok } = useRequireAuth();
  const { profile, profileLoaded } = useAuth();
  const toast = useToast();
  const [clubs, setClubs] = useState<SaClub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState(currentPeriod());
  const [pending, setPending] = useState<Pending>(null);
  const [chargeAll, setChargeAll] = useState(false);

  // Nowy klub
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cPrefix, setCPrefix] = useState('');
  const [cOwner, setCOwner] = useState('');
  const [cPlan, setCPlan] = useState<PlanCode>('CLUB_50');
  const [cAmount, setCAmount] = useState('50');

  // Edycja abonamentu
  const [editClub, setEditClub] = useState<SaClub | null>(null);
  const [ePlan, setEPlan] = useState<PlanCode>('FREE');
  const [eAmount, setEAmount] = useState('0');
  const [eGrace, setEGrace] = useState('7');
  const [eSuspend, setESuspend] = useState('14');

  // Właściciel
  const [ownerClub, setOwnerClub] = useState<SaClub | null>(null);
  const [ownerEmail, setOwnerEmail] = useState('');

  // Faktury
  const [invClub, setInvClub] = useState<SaClub | null>(null);
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);

  // Ustawienia platformy
  const [ps, setPs] = useState<PlatformSettings>({ platform_name: 'Klubowicz', bank_account: '', bank_recipient: '', contact_email: '' });

  const load = useCallback(async () => {
    const sb = supabase();
    const [{ data, error }, { data: settings }] = await Promise.all([
      sb.rpc('sa_list_clubs'),
      sb.from('platform_settings').select('platform_name, bank_account, bank_recipient, contact_email').eq('id', 1).maybeSingle(),
    ]);
    if (error) setError(errMsg(error));
    else setClubs((data ?? []) as SaClub[]);
    if (settings) setPs(settings as PlatformSettings);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (ok && profile?.is_superadmin) void load();
  }, [ok, profile, load]);

  if (!ok || !profileLoaded) return <FullScreenLoader />;
  if (!profile?.is_superadmin) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-3xl p-4">
          <EmptyState title="Brak dostępu">Panel dostępny wyłącznie dla Superadmina platformy.</EmptyState>
        </main>
      </>
    );
  }

  async function rpc(fn: string, args: Record<string, unknown>, okMsg?: string): Promise<unknown> {
    setBusy(true);
    const { data, error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) {
      toast(errMsg(error), 'error');
      throw error;
    }
    if (okMsg) toast(okMsg);
    await load();
    return data;
  }

  async function createClub(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = (await rpc('sa_create_club', {
        p_name: cName,
        p_prefix: cPrefix,
        p_owner_email: cOwner,
        p_plan: cPlan,
        p_monthly_amount: Number(cAmount.replace(',', '.')),
      })) as { owner: string };
      toast(
        res.owner === 'assigned'
          ? 'Utworzono klub i przypisano Właściciela.'
          : res.owner === 'pending'
            ? 'Utworzono klub. Właściciel zostanie przypisany automatycznie przy pierwszym logowaniu tym e-mailem.'
            : 'Utworzono klub.'
      );
      setCreateOpen(false);
      setCName('');
      setCPrefix('');
      setCOwner('');
    } catch {
      /* */
    }
  }

  async function runPending() {
    if (!pending) return;
    const id = pending.club.club_id;
    try {
      if (pending.kind === 'charge') {
        const r = (await rpc('sa_charge_month', { p_club: id, p_period: period })) as string;
        toast(
          r === 'charged'
            ? `Naliczono opłatę za ${periodLabel(period)}.`
            : r === 'exists'
              ? 'Opłata za ten miesiąc była już naliczona.'
              : 'Klub ma plan darmowy – nic nie naliczono.',
          r === 'charged' ? 'success' : 'info'
        );
      } else if (pending.kind === 'paid') {
        await rpc('sa_mark_paid', { p_club: id }, 'Oznaczono jako opłacone. Klub jest aktywny.');
      } else if (pending.kind === 'suspend') {
        await rpc('sa_set_status', { p_club: id, p_status: 'suspended' }, 'Klub zawieszony.');
      } else {
        await rpc('sa_set_status', { p_club: id, p_status: 'active' }, 'Klub odblokowany (7 dni ochrony przed auto-zawieszeniem).');
      }
      setPending(null);
    } catch {
      /* */
    }
  }

  async function runChargeAll() {
    try {
      const n = (await rpc('sa_charge_all', { p_period: period })) as number;
      toast(`Naliczono opłaty dla ${n} klubów za ${periodLabel(period)}.`);
      setChargeAll(false);
    } catch {
      /* */
    }
  }

  function openEdit(c: SaClub) {
    setEditClub(c);
    setEPlan(c.plan);
    setEAmount(String(c.monthly_amount));
    setEGrace(String(c.grace_period_days));
    setESuspend(String(c.suspend_after_days));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editClub) return;
    try {
      await rpc(
        'sa_update_subscription',
        {
          p_club: editClub.club_id,
          p_plan: ePlan,
          p_monthly_amount: Number(eAmount.replace(',', '.')),
          p_grace: Number(eGrace),
          p_suspend: Number(eSuspend),
        },
        'Zapisano abonament.'
      );
      setEditClub(null);
    } catch {
      /* */
    }
  }

  async function saveOwner(e: React.FormEvent) {
    e.preventDefault();
    if (!ownerClub) return;
    try {
      const r = (await rpc('sa_assign_owner', { p_club: ownerClub.club_id, p_email: ownerEmail })) as string;
      toast(r === 'assigned' ? 'Przypisano Właściciela.' : 'Użytkownik jeszcze się nie logował – zostanie przypisany przy pierwszym logowaniu.');
      setOwnerClub(null);
      setOwnerEmail('');
    } catch {
      /* */
    }
  }

  async function openInvoices(c: SaClub) {
    setInvClub(c);
    const { data } = await supabase()
      .from('platform_invoices')
      .select('id, club_id, period, amount, status, issued_at, paid_at')
      .eq('club_id', c.club_id)
      .order('period', { ascending: false });
    setInvoices((data ?? []) as PlatformInvoice[]);
  }

  async function voidInvoice(id: string) {
    try {
      await rpc('sa_void_invoice', { p_invoice: id }, 'Anulowano naliczenie.');
      if (invClub) await openInvoices(invClub);
    } catch {
      /* */
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase()
      .from('platform_settings')
      .update({ ...ps, updated_at: new Date().toISOString() })
      .eq('id', 1);
    setBusy(false);
    if (error) toast(errMsg(error), 'error');
    else toast('Zapisano dane platformy.');
  }

  const mrr = clubs.reduce((s, c) => s + Number(c.monthly_amount), 0);
  const debt = clubs.reduce((s, c) => s + Number(c.unpaid_amount), 0);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl p-4 pb-16">
        <PageTitle
          title="Panel Superadmina"
          subtitle={`Klubów: ${clubs.length} · przychód miesięczny: ${money(mrr)} · zaległości: ${money(debt)}`}
          action={
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Nowy klub
            </button>
          }
        />
        {error && <ErrorBox message={error} />}

        <div className="card mb-4 flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <label className="label">Okres rozliczeniowy</label>
            <input type="month" className="input" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <button className="btn btn-secondary" onClick={() => setChargeAll(true)} disabled={busy || !period}>
            <CalendarDays className="h-4 w-4" /> Nalicz miesiąc wszystkim płatnym
          </button>
        </div>

        {loading ? (
          <Spinner className="mx-auto my-8 h-6 w-6 text-indigo-600" />
        ) : (
          <div className="flex flex-col gap-3">
            {clubs.map((c) => (
              <div key={c.club_id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      <Building2 className="h-4 w-4 text-indigo-600" /> {c.name}
                      <span className="text-xs font-normal text-slate-400">{c.prefix}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Właściciel: {c.owners ?? (c.pending_owner_email ? `${c.pending_owner_email} (czeka na 1. logowanie)` : '— brak —')}
                    </p>
                    <p className="text-xs text-slate-500">
                      Członkowie: {c.active_members} aktywnych, {c.pending_members} oczekujących · od {formatDate(c.created_at)}
                    </p>
                  </div>
                  <span
                    className={`chip shrink-0 ${
                      c.status === 'active'
                        ? 'bg-emerald-100 text-emerald-700'
                        : c.status === 'past_due'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {SUB_LABEL[c.status]}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-slate-50 p-2">
                    <p className="font-semibold text-slate-800">{PLAN_LABEL[c.plan]}</p>
                    <p className="text-slate-500">{money(c.monthly_amount)}/mies.</p>
                  </div>
                  <div className={`rounded-xl p-2 ${Number(c.unpaid_amount) > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <p className={`font-semibold ${Number(c.unpaid_amount) > 0 ? 'text-red-600' : 'text-slate-800'}`}>
                      {money(c.unpaid_amount)}
                    </p>
                    <p className="text-slate-500">zaległe ({c.unpaid_count})</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-2">
                    <p className="font-semibold text-slate-800">{c.last_paid_at ? formatDate(c.last_paid_at) : '—'}</p>
                    <p className="text-slate-500">ostatnia wpłata</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => setPending({ kind: 'charge', club: c })} disabled={busy}>
                    <CalendarDays className="h-3.5 w-3.5" /> Nalicz miesiąc
                  </button>
                  <button className="btn btn-success btn-sm" onClick={() => setPending({ kind: 'paid', club: c })} disabled={busy}>
                    <CircleCheck className="h-3.5 w-3.5" /> Oznacz jako opłacone
                  </button>
                  {c.status === 'suspended' ? (
                    <button className="btn btn-primary btn-sm" onClick={() => setPending({ kind: 'unlock', club: c })} disabled={busy}>
                      <Unlock className="h-3.5 w-3.5" /> Odblokuj klub
                    </button>
                  ) : (
                    <button className="btn btn-danger btn-sm" onClick={() => setPending({ kind: 'suspend', club: c })} disabled={busy}>
                      <Ban className="h-3.5 w-3.5" /> Zawieś klub
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" /> Abonament
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setOwnerClub(c)}>
                    <UserPlus className="h-3.5 w-3.5" /> Właściciel
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void openInvoices(c)}>
                    <Receipt className="h-3.5 w-3.5" /> Naliczenia
                  </button>
                  <Link href={clubHref(c.club_id)} className="btn btn-ghost btn-sm">
                    Otwórz klub
                  </Link>
                </div>
              </div>
            ))}
            {clubs.length === 0 && <EmptyState title="Brak klubów">Utwórz pierwszy klub przyciskiem „Nowy klub”.</EmptyState>}
          </div>
        )}

        <form onSubmit={saveSettings} className="card mt-6 flex flex-col gap-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-5 w-5 text-indigo-600" /> Dane platformy (do przelewów za aplikację)
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Nazwa platformy</label>
              <input className="input" value={ps.platform_name} onChange={(e) => setPs({ ...ps, platform_name: e.target.value })} />
            </div>
            <div>
              <label className="label">E-mail kontaktowy</label>
              <input
                className="input"
                type="email"
                value={ps.contact_email ?? ''}
                onChange={(e) => setPs({ ...ps, contact_email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Odbiorca przelewu</label>
              <input className="input" value={ps.bank_recipient ?? ''} onChange={(e) => setPs({ ...ps, bank_recipient: e.target.value })} />
            </div>
            <div>
              <label className="label">Numer konta</label>
              <input
                className="input font-mono"
                value={ps.bank_account ?? ''}
                onChange={(e) => setPs({ ...ps, bank_account: e.target.value })}
              />
            </div>
          </div>
          <button className="btn btn-primary self-start" disabled={busy}>
            Zapisz dane platformy
          </button>
        </form>
      </main>

      {/* Nowy klub */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Utwórz nowy klub i przypisz Właściciela"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
              Anuluj
            </button>
            <button className="btn btn-primary" form="create-club" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} Utwórz klub
            </button>
          </>
        }
      >
        <form id="create-club" onSubmit={createClub} className="flex flex-col gap-3">
          <div>
            <label className="label">Nazwa klubu</label>
            <input className="input" required value={cName} onChange={(e) => setCName(e.target.value)} placeholder="np. Siatkarskie Środy" />
          </div>
          <div>
            <label className="label">Prefiks kodów (2–6 liter)</label>
            <input
              className="input uppercase"
              required
              pattern="[A-Za-z]{2,6}"
              value={cPrefix}
              onChange={(e) => setCPrefix(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              placeholder="np. SSR"
            />
          </div>
          <div>
            <label className="label">E-mail Właściciela klubu</label>
            <input className="input" type="email" value={cOwner} onChange={(e) => setCOwner(e.target.value)} placeholder="organizator@gmail.com" />
            <p className="mt-1 text-xs text-slate-500">
              Jeśli ta osoba jeszcze się nie logowała, zostanie Właścicielem automatycznie przy pierwszym logowaniu.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Plan</label>
              <select
                className="input"
                value={cPlan}
                onChange={(e) => {
                  const p = e.target.value as PlanCode;
                  setCPlan(p);
                  if (p !== 'CUSTOM') setCAmount(String(PLAN_AMOUNT[p]));
                }}
              >
                {(Object.keys(PLAN_LABEL) as PlanCode[]).map((p) => (
                  <option key={p} value={p}>
                    {PLAN_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Kwota / mies. (zł)</label>
              <input
                className="input"
                inputMode="decimal"
                value={cAmount}
                disabled={cPlan !== 'CUSTOM'}
                onChange={(e) => setCAmount(e.target.value)}
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Edycja abonamentu */}
      <Modal
        open={editClub !== null}
        onClose={() => setEditClub(null)}
        title={`Abonament: ${editClub?.name ?? ''}`}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditClub(null)}>
              Anuluj
            </button>
            <button className="btn btn-primary" form="edit-sub" disabled={busy}>
              Zapisz
            </button>
          </>
        }
      >
        <form id="edit-sub" onSubmit={saveEdit} className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Plan</label>
            <select
              className="input"
              value={ePlan}
              onChange={(e) => {
                const p = e.target.value as PlanCode;
                setEPlan(p);
                if (p !== 'CUSTOM') setEAmount(String(PLAN_AMOUNT[p]));
              }}
            >
              {(Object.keys(PLAN_LABEL) as PlanCode[]).map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Kwota / mies.</label>
            <input className="input" value={eAmount} disabled={ePlan !== 'CUSTOM'} onChange={(e) => setEAmount(e.target.value)} />
          </div>
          <div>
            <label className="label">Okres karencji (dni)</label>
            <input className="input" type="number" min={0} max={90} value={eGrace} onChange={(e) => setEGrace(e.target.value)} />
          </div>
          <div>
            <label className="label">Zawieś po (dniach)</label>
            <input className="input" type="number" min={1} max={180} value={eSuspend} onChange={(e) => setESuspend(e.target.value)} />
          </div>
          <p className="col-span-2 text-xs text-slate-500">
            Po upływie karencji klub otrzymuje status „Zaległość” (baner dla Właściciela), a po „Zawieś po” – automatyczne
            zawieszenie.
          </p>
        </form>
      </Modal>

      {/* Właściciel */}
      <Modal
        open={ownerClub !== null}
        onClose={() => setOwnerClub(null)}
        title={`Właściciel: ${ownerClub?.name ?? ''}`}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOwnerClub(null)}>
              Anuluj
            </button>
            <button className="btn btn-primary" form="owner-form" disabled={busy}>
              Przypisz
            </button>
          </>
        }
      >
        <form id="owner-form" onSubmit={saveOwner} className="flex flex-col gap-3">
          <div>
            <label className="label">E-mail użytkownika</label>
            <input className="input" type="email" required value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          </div>
          {ownerClub && <CopyField label="Link zapraszający klubu" value={inviteLink(ownerClub.invite_code)} />}
        </form>
      </Modal>

      {/* Naliczenia */}
      <Modal open={invClub !== null} onClose={() => setInvClub(null)} title={`Naliczenia: ${invClub?.name ?? ''}`}>
        {invoices.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Brak naliczeń.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1">
                  <p className="text-sm font-medium capitalize">{periodLabel(i.period)}</p>
                  <p className="text-xs text-slate-500">
                    naliczono {formatDate(i.issued_at)}
                    {i.paid_at && ` · opłacono ${formatDate(i.paid_at)}`}
                  </p>
                </div>
                <span className="text-sm font-semibold">{money(i.amount)}</span>
                <span
                  className={`chip ${
                    i.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : i.status === 'void' ? 'bg-slate-100 text-slate-500' : 'bg-red-100 text-red-700'
                  }`}
                >
                  {i.status === 'paid' ? 'opłacone' : i.status === 'void' ? 'anulowane' : 'nieopłacone'}
                </span>
                {i.status === 'unpaid' && (
                  <button className="btn btn-ghost btn-sm text-red-600" onClick={() => void voidInvoice(i.id)} disabled={busy}>
                    Anuluj
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmModal
        open={pending !== null}
        title={
          pending?.kind === 'charge'
            ? 'Naliczyć opłatę?'
            : pending?.kind === 'paid'
              ? 'Oznaczyć jako opłacone?'
              : pending?.kind === 'suspend'
                ? 'Zawiesić klub?'
                : 'Odblokować klub?'
        }
        danger={pending?.kind === 'suspend'}
        message={
          pending?.kind === 'charge' ? (
            <>
              Klub <strong>{pending.club.name}</strong> zostanie obciążony kwotą <strong>{money(pending.club.monthly_amount)}</strong> za{' '}
              <strong>{periodLabel(period)}</strong>.
            </>
          ) : pending?.kind === 'paid' ? (
            <>
              Wszystkie nieopłacone naliczenia klubu <strong>{pending.club.name}</strong> ({money(pending.club.unpaid_amount)}) zostaną
              oznaczone jako opłacone, a klub – odblokowany.
            </>
          ) : pending?.kind === 'suspend' ? (
            <>
              W klubie <strong>{pending.club.name}</strong> zostaną zablokowane zapisy, rozliczenia treningów i import CSV.
            </>
          ) : (
            <>
              Klub <strong>{pending?.club.name}</strong> zostanie odblokowany. Przez 7 dni nie zostanie automatycznie zawieszony, nawet
              przy zaległościach.
            </>
          )
        }
        confirmText="Potwierdź"
        busy={busy}
        onConfirm={() => void runPending()}
        onClose={() => setPending(null)}
      />
      <ConfirmModal
        open={chargeAll}
        title="Naliczyć opłaty wszystkim?"
        message={
          <>
            Każdy klub z płatnym planem otrzyma naliczenie za <strong>{periodLabel(period)}</strong> (kluby z istniejącym naliczeniem za
            ten miesiąc zostaną pominięte).
          </>
        }
        confirmText="Nalicz"
        busy={busy}
        onConfirm={() => void runChargeAll()}
        onClose={() => setChargeAll(false)}
      />
    </>
  );
}
