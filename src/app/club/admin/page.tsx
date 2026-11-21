'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight, RefreshCw, Settings, Users } from 'lucide-react';
import { useClub } from '@/lib/club';
import { errMsg, supabase } from '@/lib/supabase';
import { clubHref, inviteLink } from '@/lib/nav';
import { money } from '@/lib/format';
import CopyField from '@/components/CopyField';
import OwnerGuard from '@/components/OwnerGuard';
import { useToast } from '@/components/Toast';
import { ConfirmModal, PageTitle } from '@/components/ui';

export default function AdminHubPage() {
  const { clubId, ctx, reload, isOwner } = useClub();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = ctx.pending_members ?? 0;

  const allTiles = [
    {
      href: clubHref(clubId, 'members'),
      icon: Users,
      owner: true,
      title: 'Członkowie',
      desc: pending > 0 ? `${pending} oczekuje na akceptację` : 'Akceptacja, role, tryby rozliczeń, aliasy',
      alert: pending > 0,
    },
    {
      href: clubHref(clubId, 'settings'),
      icon: Settings,
      owner: true,
      title: 'Ustawienia klubu',
      desc: `Składka ${money(ctx.club.monthly_fee_amount)} · trening ${money(ctx.club.single_training_fee_amount)}`,
    },
  ];

  const tiles = allTiles.filter((t) => isOwner || !('owner' in t && t.owner));

  async function regenerate() {
    setBusy(true);
    const { error } = await supabase().rpc('regenerate_invite_code', { p_club: clubId });
    setBusy(false);
    setConfirm(false);
    if (error) toast(errMsg(error), 'error');
    else {
      toast('Wygenerowano nowy link. Stary przestał działać.');
      await reload();
    }
  }

  return (
    <OwnerGuard back={false}>
      <PageTitle
        title="Zarządzanie klubem"
        subtitle={`${ctx.club.name} (${ctx.club.prefix}) · finanse klubu są w zakładce Finanse`}
      />

      <div className="flex flex-col gap-3">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href} className="card flex items-center gap-3 transition hover:border-indigo-300">
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                  t.alert ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'
                }`}
              >
                <Icon className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t.title}</span>
                <span className={`block text-xs ${t.alert ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{t.desc}</span>
              </span>
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </Link>
          );
        })}
      </div>

      {isOwner && (
      <div className="card mt-6 flex flex-col gap-3">
        <h2 className="font-semibold">Link zapraszający</h2>
        <p className="text-sm text-slate-500">
          Wyślij ten link nowym zawodnikom. Po zalogowaniu pojawią się w sekcji Członkowie jako oczekujący.
        </p>
        <CopyField label="Link" value={inviteLink(ctx.club.invite_code)} />
        <button className="btn btn-secondary" onClick={() => setConfirm(true)}>
          <RefreshCw className="h-4 w-4" /> Wygeneruj nowy link
        </button>
      </div>
      )}

      <ConfirmModal
        open={confirm}
        title="Nowy link zapraszający"
        message="Dotychczasowy link przestanie działać. Osoby już zapisane w klubie nie stracą dostępu."
        confirmText="Generuj"
        busy={busy}
        onConfirm={() => void regenerate()}
        onClose={() => setConfirm(false)}
      />
    </OwnerGuard>
  );
}
