-- =====================================================================
--  KLUBOWICZ – platforma wieloklubowa (multi-tenant) dla amatorskich klubów
--  Plik: database/schema.sql
--
--  JEDNORAZOWY skrypt do uruchomienia w Supabase:
--  Dashboard -> SQL Editor -> New query -> wklej całość -> Run
--
--  Ten plik NIE jest częścią aplikacji WWW. Nie wgrywaj go na serwer OVH.
--
--  Zawartość:
--   1. Tabele + indeksy
--   2. Funkcje pomocnicze (role, uprawnienia, status subskrypcji)
--   3. Triggery (profil po rejestracji, kody zawodników, ochrona danych)
--   4. Polityki RLS (izolacja klubów)
--   5. Funkcje RPC (zapisy, kolejka rezerwowa, rozliczenia, import, superadmin)
--   6. Uprawnienia (GRANT/REVOKE)
--   7. Dane startowe: klub „VolleyClub Alternatywa” (prefiks VCA)
--
--  Skrypt można uruchomić ponownie (np. po aktualizacji) – używa
--  IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
-- =====================================================================

-- =====================================================================
-- 1. TABELE
-- =====================================================================

-- Profil użytkownika (1:1 z auth.users). Brak haseł – logowanie Google/Magic Link.
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  full_name     text,
  avatar_url    text,
  is_superadmin boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Kluby (tenanci)
create table if not exists public.clubs (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null check (char_length(name) between 2 and 120),
  prefix                      text not null unique check (prefix ~ '^[A-Z]{2,6}$'),
  invite_code                 text not null unique,
  bank_account                text,
  bank_recipient              text,
  monthly_fee_amount          numeric(10,2) not null default 0 check (monthly_fee_amount >= 0),
  single_training_fee_amount  numeric(10,2) not null default 0 check (single_training_fee_amount >= 0),
  cancellation_deadline_hours integer not null default 24 check (cancellation_deadline_hours between 0 and 336),
  default_max_participants    integer not null default 14 check (default_max_participants between 1 and 500),
  default_location            text,
  member_seq                  integer not null default 0,
  pending_owner_email         text,
  created_by                  uuid references public.profiles (id) on delete set null,
  created_at                  timestamptz not null default now()
);

-- Automatyczne naliczanie składek miesięcznych (1. dnia miesiąca, harmonogram pg_cron)
alter table public.clubs add column if not exists auto_monthly_fee boolean not null default false;
-- Opłata za późne wypisanie z treningu (można wyłączyć – wtedy wypisanie zawsze bezpłatne)
alter table public.clubs add column if not exists late_cancel_fee_enabled boolean not null default true;
alter table public.clubs add column if not exists auto_monthly_fee_from text
  check (auto_monthly_fee_from is null or auto_monthly_fee_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Członkostwo w klubie + rola w klubie (kolumna position dodawana niżej – ALTER dla istniejących baz)
create table if not exists public.club_members (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null default 'member'   check (role in ('owner', 'caretaker', 'member')),
  status       text not null default 'pending'  check (status in ('pending', 'active', 'removed')),
  billing_mode text not null default 'per_session' check (billing_mode in ('monthly', 'per_session')),
  member_code  text,
  aliases      text[] not null default '{}',
  joined_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (club_id, user_id),
  unique (club_id, member_code)
);
create index if not exists club_members_user_idx on public.club_members (user_id, status);
-- Pozycja na boisku (siatkówka): rozgrywający, przyjmujący, atakujący, środkowy, libero
alter table public.club_members add column if not exists position text
  check (position is null or position in ('setter', 'outside', 'opposite', 'middle', 'libero'));
create index if not exists club_members_club_idx on public.club_members (club_id, status);

-- Treningi
create table if not exists public.trainings (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references public.clubs (id) on delete cascade,
  title            text not null default 'Trening' check (char_length(title) between 1 and 120),
  location         text,
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  max_participants integer not null default 14 check (max_participants between 1 and 500),
  notes            text,
  status           text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'settled')),
  settled_at       timestamptz,
  settled_by       uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists trainings_club_start_idx on public.trainings (club_id, starts_at);

-- Zapisy na trening (lista główna / rezerwowa FIFO / późne wypisanie)
create table if not exists public.training_signups (
  id             uuid primary key default gen_random_uuid(),
  training_id    uuid not null references public.trainings (id) on delete cascade,
  club_id        uuid not null references public.clubs (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  status         text not null check (status in ('main', 'reserve', 'late_cancel')),
  has_car        boolean not null default false,
  wants_beer     boolean not null default false,
  added_by_staff boolean not null default false,
  signed_up_at   timestamptz not null default clock_timestamp(),
  updated_at     timestamptz not null default now(),
  unique (training_id, user_id)
);
create index if not exists training_signups_queue_idx on public.training_signups (training_id, status, signed_up_at);
create index if not exists training_signups_user_idx on public.training_signups (user_id);

-- Faktyczna obecność (zapisywana przy rozliczeniu treningu)
create table if not exists public.training_attendance (
  training_id uuid not null references public.trainings (id) on delete cascade,
  club_id     uuid not null references public.clubs (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  present     boolean not null,
  marked_by   uuid references public.profiles (id) on delete set null,
  marked_at   timestamptz not null default now(),
  primary key (training_id, user_id)
);

-- Księga finansowa zawodnika w klubie.
-- amount > 0 = wpłata / uznanie, amount < 0 = obciążenie.
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  amount      numeric(10,2) not null check (amount <> 0),
  type        text not null check (type in ('payment', 'monthly_fee', 'session_fee', 'late_cancel_fee', 'adjustment')),
  description text,
  training_id uuid references public.trainings (id) on delete set null,
  period      text check (period is null or period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  bank_hash   text,
  booked_at   date not null default current_date,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists transactions_member_idx on public.transactions (club_id, user_id, booked_at desc);
-- Ochrona przed podwójnym naliczeniem składki miesięcznej
create unique index if not exists transactions_monthly_uniq
  on public.transactions (club_id, user_id, period) where type = 'monthly_fee';
-- Ochrona przed podwójnym obciążeniem za ten sam trening
create unique index if not exists transactions_session_uniq
  on public.transactions (training_id, user_id, type) where type in ('session_fee', 'late_cancel_fee');
-- Ochrona przed duplikatami z importu CSV
create unique index if not exists transactions_bank_hash_uniq
  on public.transactions (club_id, bank_hash) where bank_hash is not null;

-- Saldo zawodnika (widok liczony z księgi; respektuje RLS wywołującego)
create or replace view public.member_balances
with (security_invoker = true) as
  select club_id, user_id, coalesce(sum(amount), 0)::numeric(12,2) as balance
  from public.transactions
  group by club_id, user_id;

-- Abonament klubu za korzystanie z platformy
create table if not exists public.platform_subscriptions (
  club_id            uuid primary key references public.clubs (id) on delete cascade,
  plan               text not null default 'FREE' check (plan in ('FREE', 'CLUB_50', 'CLUB_100', 'CUSTOM')),
  monthly_amount     numeric(10,2) not null default 0 check (monthly_amount >= 0),
  grace_period_days  integer not null default 7  check (grace_period_days between 0 and 90),
  suspend_after_days integer not null default 14 check (suspend_after_days between 1 and 180),
  status             text not null default 'active' check (status in ('active', 'past_due', 'suspended')),
  unlock_until       timestamptz,
  updated_at         timestamptz not null default now()
);

-- Miesięczne naliczenia opłaty platformowej
create table if not exists public.platform_invoices (
  id        uuid primary key default gen_random_uuid(),
  club_id   uuid not null references public.clubs (id) on delete cascade,
  period    text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount    numeric(10,2) not null check (amount >= 0),
  status    text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  issued_at timestamptz not null default now(),
  paid_at   timestamptz,
  note      text,
  unique (club_id, period)
);
create index if not exists platform_invoices_status_idx on public.platform_invoices (club_id, status);

-- Ustawienia platformy (jeden wiersz) – dane do przelewu za aplikację
create table if not exists public.platform_settings (
  id             integer primary key default 1 check (id = 1),
  platform_name  text not null default 'Klubowicz',
  bank_account   text,
  bank_recipient text,
  contact_email  text,
  updated_at     timestamptz not null default now()
);

-- =====================================================================
-- 2. FUNKCJE POMOCNICZE (używane w RLS i RPC)
-- =====================================================================

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false);
$$;

-- Rola zalogowanego użytkownika w klubie (tylko aktywne członkostwo), inaczej NULL
create or replace function public.club_role(p_club uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from public.club_members m
  where m.club_id = p_club and m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function public.is_club_member(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.club_role(p_club) is not null;
$$;

create or replace function public.is_club_staff(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.club_role(p_club) in ('owner', 'caretaker'), false);
$$;

create or replace function public.is_club_owner(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.club_role(p_club) = 'owner', false);
$$;

-- Czy zalogowany użytkownik może widzieć profil danej osoby
-- (wspólny klub, gdzie oboje są aktywni, albo jestem właścicielem jej klubu)
create or replace function public.shares_club_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.club_members me
    join public.club_members other on other.club_id = me.club_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and other.user_id = p_user
      and (other.status = 'active' or me.role = 'owner')
  );
$$;

create or replace function public._require_uid()
returns uuid language plpgsql stable set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Musisz być zalogowany.' using errcode = '28000';
  end if;
  return v;
end $$;

create or replace function public._require_owner(p_club uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := public._require_uid();
begin
  if not public.is_club_owner(p_club) then
    raise exception 'Tę operację może wykonać tylko Właściciel klubu.' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function public._require_staff(p_club uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := public._require_uid();
begin
  if not public.is_club_staff(p_club) then
    raise exception 'Tę operację może wykonać tylko Opiekun lub Właściciel klubu.' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function public._require_superadmin()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := public._require_uid();
begin
  if not public.is_superadmin() then
    raise exception 'Brak uprawnień Superadmina.' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function public._gen_invite_code(p_prefix text)
returns text language sql volatile set search_path = public as $$
  select p_prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

create or replace function public._current_period()
returns text language sql stable set search_path = public as $$
  select to_char(now() at time zone 'Europe/Warsaw', 'YYYY-MM');
$$;

-- Przelicza status subskrypcji na podstawie najstarszej nieopłaconej faktury.
--   dni zaległości >= grace_period_days  -> past_due
--   dni zaległości >= suspend_after_days -> suspended
-- Ręczne zawieszenie przez Superadmina pozostaje w mocy.
-- Ręczne odblokowanie (unlock_until w przyszłości) chroni przed automatycznym zawieszeniem.
create or replace function public._refresh_subscription(p_club uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  s        public.platform_subscriptions%rowtype;
  v_oldest timestamptz;
  v_days   integer;
  v_new    text;
begin
  select * into s from public.platform_subscriptions where club_id = p_club for update;
  if not found then
    return 'active';
  end if;

  select min(issued_at) into v_oldest
  from public.platform_invoices
  where club_id = p_club and status = 'unpaid' and amount > 0;

  if v_oldest is null then
    v_new := case when s.status = 'past_due' then 'active' else s.status end;
  else
    v_days := floor(extract(epoch from (now() - v_oldest)) / 86400)::int;
    if s.unlock_until is not null and s.unlock_until > now() then
      v_new := case when v_days >= s.grace_period_days then 'past_due' else 'active' end;
    elsif v_days >= s.suspend_after_days then
      v_new := 'suspended';
    elsif v_days >= s.grace_period_days then
      v_new := case when s.status = 'suspended' then 'suspended' else 'past_due' end;
    else
      v_new := s.status;
    end if;
  end if;

  if v_new is distinct from s.status then
    update public.platform_subscriptions set status = v_new, updated_at = now() where club_id = p_club;
  end if;
  return v_new;
end $$;

-- Blokada operacji w zawieszonym klubie
create or replace function public._assert_club_not_suspended(p_club uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if public._refresh_subscription(p_club) = 'suspended' then
    raise exception 'Klub jest zawieszony z powodu nieopłaconej subskrypcji platformy. Skontaktuj się z Właścicielem klubu.'
      using errcode = 'P0001';
  end if;
end $$;

-- Przesuwa kolejkę rezerwową (FIFO) na wolne miejsca listy głównej
create or replace function public._rebalance_training(p_training uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_max   integer;
  v_main  integer;
  v_moved integer := 0;
  r       record;
begin
  select max_participants into v_max from public.trainings where id = p_training for update;
  if not found then return 0; end if;

  select count(*) into v_main from public.training_signups
  where training_id = p_training and status = 'main';

  for r in
    select id from public.training_signups
    where training_id = p_training and status = 'reserve'
    order by signed_up_at, id
    limit greatest(v_max - v_main, 0)
  loop
    update public.training_signups set status = 'main', updated_at = now() where id = r.id;
    v_moved := v_moved + 1;
  end loop;
  return v_moved;
end $$;

-- =====================================================================
-- 3. TRIGGERY
-- =====================================================================

-- Profil po rejestracji + automatyczne przypisanie Właściciela,
-- jeśli Superadmin utworzył klub na e-mail osoby, która jeszcze się nie logowała
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    lower(new.email),
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.club_members (club_id, user_id, role, status, billing_mode)
  select c.id, new.id, 'owner', 'active', 'monthly'
  from public.clubs c
  where c.pending_owner_email is not null and lower(c.pending_owner_email) = lower(new.email)
  on conflict (club_id, user_id) do update set role = 'owner', status = 'active';

  update public.clubs set pending_owner_email = null
  where pending_owner_email is not null and lower(pending_owner_email) = lower(new.email);

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Ochrona profilu: nikt poza Superadminem (lub SQL Editorem) nie zmieni flagi is_superadmin ani e-maila
create or replace function public.protect_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_superadmin() then
    new.is_superadmin := old.is_superadmin;
    new.email := old.email;
  end if;
  new.id := old.id;
  return new;
end $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile();

-- Unikalny kod zawodnika (np. VCA-01) nadawany przy aktywacji członkostwa
create or replace function public.assign_member_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prefix text;
  v_seq    integer;
begin
  if new.status = 'active' then
    new.joined_at := coalesce(new.joined_at, now());
    if new.member_code is null then
      update public.clubs set member_seq = member_seq + 1
      where id = new.club_id
      returning prefix, member_seq into v_prefix, v_seq;
      new.member_code := v_prefix || '-' ||
        case when v_seq < 100 then lpad(v_seq::text, 2, '0') else v_seq::text end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists club_members_code on public.club_members;
create trigger club_members_code
  before insert or update on public.club_members
  for each row execute function public.assign_member_code();

-- Treningi: autor, wymuszony status przy tworzeniu, blokada edycji rozliczonych
create or replace function public.trainings_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if coalesce(current_setting('app.bypass_training_guard', true), '') <> 'on' then
      new.status := 'scheduled';
      new.settled_at := null;
      new.settled_by := null;
    end if;
    return new;
  end if;

  -- UPDATE
  new.club_id := old.club_id;
  if coalesce(current_setting('app.bypass_training_guard', true), '') = 'on' then
    return new;
  end if;
  if old.status = 'settled' then
    raise exception 'Rozliczonego treningu nie można edytować.';
  end if;
  if new.status = 'settled' then
    raise exception 'Trening rozlicza się przyciskiem „Zatwierdź obecność i rozlicz trening”.';
  end if;
  new.settled_at := old.settled_at;
  new.settled_by := old.settled_by;
  return new;
end $$;

drop trigger if exists trainings_guard on public.trainings;
create trigger trainings_guard
  before insert or update on public.trainings
  for each row execute function public.trainings_before_write();

-- Po zwiększeniu limitu miejsc – automatyczne przesunięcie rezerwy
create or replace function public.trainings_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.max_participants > old.max_participants and new.status = 'scheduled' then
    perform public._rebalance_training(new.id);
  end if;
  return null;
end $$;

drop trigger if exists trainings_rebalance on public.trainings;
create trigger trainings_rebalance
  after update of max_participants on public.trainings
  for each row execute function public.trainings_after_update();

-- Głosowanie na trenera treningu (anonimowe; jeden głos na osobę na trening)
create table if not exists public.training_coach_votes (
  training_id  uuid not null references public.trainings (id) on delete cascade,
  club_id      uuid not null references public.clubs (id) on delete cascade,
  voter_id     uuid not null references public.profiles (id) on delete cascade,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  voted_at     timestamptz not null default now(),
  primary key (training_id, voter_id),
  check (voter_id <> candidate_id)
);
create index if not exists training_coach_votes_candidate_idx on public.training_coach_votes (training_id, candidate_id);

-- Głosowanie na MVP treningu (po rozpoczęciu, do 7 dni)
create table if not exists public.training_mvp_votes (
  training_id  uuid not null references public.trainings (id) on delete cascade,
  club_id      uuid not null references public.clubs (id) on delete cascade,
  voter_id     uuid not null references public.profiles (id) on delete cascade,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  voted_at     timestamptz not null default now(),
  primary key (training_id, voter_id),
  check (voter_id <> candidate_id)
);
create index if not exists training_mvp_votes_candidate_idx on public.training_mvp_votes (training_id, candidate_id);

-- Historia zmian trybu rozliczeń (abonament / za trening) – zapisywana automatycznie
create table if not exists public.billing_mode_changes (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  old_mode   text check (old_mode in ('monthly', 'per_session')),
  new_mode   text not null check (new_mode in ('monthly', 'per_session')),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists billing_mode_changes_member_idx
  on public.billing_mode_changes (club_id, user_id, changed_at desc);

create or replace function public.log_billing_mode_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.billing_mode_changes (club_id, user_id, old_mode, new_mode, changed_by)
    values (new.club_id, new.user_id, null, new.billing_mode, auth.uid());
  elsif new.billing_mode is distinct from old.billing_mode then
    insert into public.billing_mode_changes (club_id, user_id, old_mode, new_mode, changed_by)
    values (new.club_id, new.user_id, old.billing_mode, new.billing_mode, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists club_members_billing_log on public.club_members;
create trigger club_members_billing_log
  after insert or update of billing_mode on public.club_members
  for each row execute function public.log_billing_mode_change();

-- =====================================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================================

alter table public.profiles               enable row level security;
alter table public.clubs                  enable row level security;
alter table public.club_members           enable row level security;
alter table public.trainings              enable row level security;
alter table public.training_signups       enable row level security;
alter table public.training_attendance    enable row level security;
alter table public.transactions           enable row level security;
alter table public.platform_subscriptions enable row level security;
alter table public.platform_invoices      enable row level security;
alter table public.platform_settings      enable row level security;
alter table public.billing_mode_changes   enable row level security;
alter table public.training_coach_votes   enable row level security;
alter table public.training_mvp_votes     enable row level security;

-- TRAINING_MVP_VOTES: każdy widzi tylko swój głos; wyniki przez RPC mvp_votes
drop policy if exists training_mvp_votes_select on public.training_mvp_votes;
create policy training_mvp_votes_select on public.training_mvp_votes for select to authenticated
  using (voter_id = auth.uid());

-- TRAINING_COACH_VOTES: każdy widzi tylko swój głos; wyniki (bez nazwisk głosujących) przez RPC coach_votes
drop policy if exists training_coach_votes_select on public.training_coach_votes;
create policy training_coach_votes_select on public.training_coach_votes for select to authenticated
  using (voter_id = auth.uid());

-- BILLING_MODE_CHANGES: własna historia; Opiekun/Właściciel – historia członków klubu
drop policy if exists billing_mode_changes_select on public.billing_mode_changes;
create policy billing_mode_changes_select on public.billing_mode_changes for select to authenticated
  using (user_id = auth.uid() or public.is_club_staff(club_id) or public.is_superadmin());

-- PROFILES: własny profil, osoby z moich klubów, Superadmin – wszystko
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_superadmin() or public.shares_club_with(id));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- CLUBS: tylko aktywni członkowie danego klubu (i Superadmin). Zapis wyłącznie przez RPC.
drop policy if exists clubs_select on public.clubs;
create policy clubs_select on public.clubs for select to authenticated
  using (public.is_club_member(id) or public.is_superadmin());

-- CLUB_MEMBERS: własne członkostwa, aktywni członkowie moich klubów, Właściciel widzi też oczekujących
drop policy if exists club_members_select on public.club_members;
create policy club_members_select on public.club_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_club_owner(club_id)
    or (status = 'active' and public.is_club_member(club_id))
    or public.is_superadmin()
  );

-- TRAININGS: odczyt – członkowie klubu; tworzenie/edycja/usuwanie – Opiekun i Właściciel
drop policy if exists trainings_select on public.trainings;
create policy trainings_select on public.trainings for select to authenticated
  using (public.is_club_member(club_id) or public.is_superadmin());

drop policy if exists trainings_insert on public.trainings;
create policy trainings_insert on public.trainings for insert to authenticated
  with check (public.is_club_staff(club_id));

drop policy if exists trainings_update on public.trainings;
create policy trainings_update on public.trainings for update to authenticated
  using (public.is_club_staff(club_id) and status <> 'settled')
  with check (public.is_club_staff(club_id) and status in ('scheduled', 'cancelled'));

drop policy if exists trainings_delete on public.trainings;
create policy trainings_delete on public.trainings for delete to authenticated
  using (public.is_club_staff(club_id) and status <> 'settled');

-- TRAINING_SIGNUPS: odczyt – członkowie klubu.
-- Zapis WYŁĄCZNIE przez RPC (join_training/leave_training/staff_add_signup...),
-- które sprawdzają auth.uid() = user_id, limity miejsc, kolejkę FIFO i status subskrypcji.
drop policy if exists training_signups_select on public.training_signups;
create policy training_signups_select on public.training_signups for select to authenticated
  using (public.is_club_member(club_id) or public.is_superadmin());

-- TRAINING_ATTENDANCE: odczyt – członkowie klubu; zapis tylko przez settle_training
drop policy if exists training_attendance_select on public.training_attendance;
create policy training_attendance_select on public.training_attendance for select to authenticated
  using (public.is_club_member(club_id) or public.is_superadmin());

-- TRANSACTIONS: zawodnik – tylko własne; Właściciel – całego klubu. Zapis tylko przez RPC.
-- Opiekun widzi salda i historię zespołu wyłącznie przez RPC team_overview / member_history (odczyt).
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions for select to authenticated
  using (user_id = auth.uid() or public.is_club_owner(club_id) or public.is_superadmin());

-- PLATFORM_SUBSCRIPTIONS / INVOICES: Superadmin + Właściciel własnego klubu (odczyt)
drop policy if exists platform_subscriptions_select on public.platform_subscriptions;
create policy platform_subscriptions_select on public.platform_subscriptions for select to authenticated
  using (public.is_superadmin() or public.is_club_owner(club_id));

drop policy if exists platform_invoices_select on public.platform_invoices;
create policy platform_invoices_select on public.platform_invoices for select to authenticated
  using (public.is_superadmin() or public.is_club_owner(club_id));

-- PLATFORM_SETTINGS: odczyt – zalogowani; zmiana – Superadmin
drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select on public.platform_settings for select to authenticated
  using (true);

drop policy if exists platform_settings_update on public.platform_settings;
create policy platform_settings_update on public.platform_settings for update to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- =====================================================================
-- 5. FUNKCJE RPC
-- =====================================================================

-- ---------- Użytkownik / członkostwa ----------

create or replace function public.my_memberships()
returns table (
  club_id uuid, club_name text, prefix text, role text, status text,
  member_code text, subscription_status text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.prefix, m.role, m.status, m.member_code,
         coalesce(s.status, 'active')
  from public.club_members m
  join public.clubs c on c.id = m.club_id
  left join public.platform_subscriptions s on s.club_id = c.id
  where m.user_id = auth.uid() and m.status in ('pending', 'active')
  order by c.name;
$$;

-- Informacje o klubie z zaproszenia (przed dołączeniem): nazwa i stawki do wyboru trybu rozliczeń
create or replace function public.invite_info(p_code text)
returns table (club_id uuid, club_name text, monthly_fee_amount numeric, single_training_fee_amount numeric, my_status text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public._require_uid();
begin
  return query
    select c.id, c.name, c.monthly_fee_amount, c.single_training_fee_amount,
           (select m.status from public.club_members m where m.club_id = c.id and m.user_id = v_uid)
    from public.clubs c
    where c.invite_code = upper(trim(p_code));
  if not found then
    raise exception 'Nieprawidłowy lub nieaktualny link zapraszający.';
  end if;
end $$;

-- Dołączenie do klubu z wyborem trybu rozliczeń i pozycji na boisku
drop function if exists public.join_club_by_code(text);
drop function if exists public.join_club_by_code(text, text);
create or replace function public.join_club_by_code(p_code text, p_billing_mode text default null, p_position text default null)
returns table (club_id uuid, club_name text, status text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := public._require_uid();
  v_club public.clubs%rowtype;
  v_status text;
  v_mode text := nullif(trim(coalesce(p_billing_mode, '')), '');
  v_pos  text := nullif(trim(coalesce(p_position, '')), '');
begin
  if v_mode is not null and v_mode not in ('monthly', 'per_session') then
    raise exception 'Nieprawidłowy tryb rozliczeń.';
  end if;
  if v_pos is not null and v_pos not in ('setter', 'outside', 'opposite', 'middle', 'libero') then
    raise exception 'Nieprawidłowa pozycja.';
  end if;
  select * into v_club from public.clubs where invite_code = upper(trim(p_code));
  if not found then
    raise exception 'Nieprawidłowy lub nieaktualny link zapraszający.';
  end if;

  insert into public.club_members (club_id, user_id, role, status, billing_mode, position)
  values (v_club.id, v_uid, 'member', 'pending', coalesce(v_mode, 'per_session'), v_pos)
  on conflict on constraint club_members_club_id_user_id_key do update
    set status = case when public.club_members.status = 'removed' then 'pending'
                      else public.club_members.status end,
        billing_mode = case when public.club_members.status in ('pending', 'removed') and v_mode is not null
                            then v_mode else public.club_members.billing_mode end,
        position = coalesce(v_pos, public.club_members.position)
  returning public.club_members.status into v_status;

  return query select v_club.id, v_club.name, v_status;
end $$;

-- Zawodnik ustawia swoją pozycję
create or replace function public.set_my_position(p_club uuid, p_position text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public._require_uid();
begin
  if p_position is not null and p_position not in ('setter', 'outside', 'opposite', 'middle', 'libero') then
    raise exception 'Nieprawidłowa pozycja.';
  end if;
  update public.club_members set position = p_position
  where club_id = p_club and user_id = v_uid and status in ('active', 'pending');
  if not found then
    raise exception 'Nie jesteś członkiem tego klubu.' using errcode = '42501';
  end if;
end $$;

-- Opiekun/Właściciel poprawia pozycję członka
create or replace function public.set_member_position(p_member_id uuid, p_position text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_club uuid;
begin
  select club_id into v_club from public.club_members where id = p_member_id;
  if v_club is null then raise exception 'Nie znaleziono członka.'; end if;
  perform public._require_staff(v_club);
  if p_position is not null and p_position not in ('setter', 'outside', 'opposite', 'middle', 'libero') then
    raise exception 'Nieprawidłowa pozycja.';
  end if;
  update public.club_members set position = p_position where id = p_member_id;
end $$;

-- Zawodnik sam zmienia swój tryb rozliczeń (zmiana od razu, zapis w historii przez trigger)
create or replace function public.set_my_billing_mode(p_club uuid, p_mode text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public._require_uid();
begin
  if p_mode not in ('monthly', 'per_session') then
    raise exception 'Nieprawidłowy tryb rozliczeń.';
  end if;
  update public.club_members set billing_mode = p_mode
  where club_id = p_club and user_id = v_uid and status in ('active', 'pending');
  if not found then
    raise exception 'Nie jesteś członkiem tego klubu.' using errcode = '42501';
  end if;
end $$;

-- Kontekst klubu dla aplikacji (rola, ustawienia, status subskrypcji, baner zaległości)
create or replace function public.club_context(p_club uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid    uuid := public._require_uid();
  v_member public.club_members%rowtype;
  v_club   public.clubs%rowtype;
  v_sub    public.platform_subscriptions%rowtype;
  v_status text;
  v_is_sa  boolean := public.is_superadmin();
  v_result jsonb;
  v_unpaid numeric := 0;
  v_unpaid_count integer := 0;
  v_ps     public.platform_settings%rowtype;
  v_pending integer := 0;
begin
  select * into v_member from public.club_members
  where club_id = p_club and user_id = v_uid and status = 'active';
  if not found and not v_is_sa then
    raise exception 'Nie masz dostępu do tego klubu.' using errcode = '42501';
  end if;

  select * into v_club from public.clubs where id = p_club;
  if not found then
    raise exception 'Klub nie istnieje.';
  end if;

  v_status := public._refresh_subscription(p_club);
  select * into v_sub from public.platform_subscriptions where club_id = p_club;

  v_result := jsonb_build_object(
    'club', jsonb_build_object(
      'id', v_club.id,
      'name', v_club.name,
      'prefix', v_club.prefix,
      'invite_code', v_club.invite_code,
      'bank_account', v_club.bank_account,
      'bank_recipient', v_club.bank_recipient,
      'monthly_fee_amount', v_club.monthly_fee_amount,
      'single_training_fee_amount', v_club.single_training_fee_amount,
      'cancellation_deadline_hours', v_club.cancellation_deadline_hours,
      'late_cancel_fee_enabled', v_club.late_cancel_fee_enabled,
      'default_max_participants', v_club.default_max_participants,
      'default_location', v_club.default_location
    ),
    'my_role', v_member.role,
    'my_member_id', v_member.id,
    'my_member_code', v_member.member_code,
    'my_billing_mode', v_member.billing_mode,
    'my_position', v_member.position,
    'subscription_status', v_status,
    'is_superadmin', v_is_sa,
    -- kiedy ostatnio księgowano wpłaty/korekty (import CSV lub ręcznie) i do jakiego dnia sięga import z banku
    'balances_updated_at', (select max(t.created_at) from public.transactions t
                            where t.club_id = p_club and t.type in ('payment', 'adjustment')),
    'last_import_at', (select max(t.created_at) from public.transactions t
                       where t.club_id = p_club and t.bank_hash is not null),
    'bank_data_until', (select max(t.booked_at) from public.transactions t
                        where t.club_id = p_club and t.bank_hash is not null)
  );

  if v_member.role = 'owner' or v_is_sa then
    select coalesce(sum(amount), 0), count(*) into v_unpaid, v_unpaid_count
    from public.platform_invoices where club_id = p_club and status = 'unpaid';
    select * into v_ps from public.platform_settings where id = 1;
    select count(*) into v_pending from public.club_members where club_id = p_club and status = 'pending';
    v_result := v_result || jsonb_build_object(
      'platform', jsonb_build_object(
        'plan', coalesce(v_sub.plan, 'FREE'),
        'monthly_amount', coalesce(v_sub.monthly_amount, 0),
        'unpaid_amount', v_unpaid,
        'unpaid_count', v_unpaid_count,
        'grace_period_days', coalesce(v_sub.grace_period_days, 7),
        'suspend_after_days', coalesce(v_sub.suspend_after_days, 14),
        'bank_account', v_ps.bank_account,
        'bank_recipient', v_ps.bank_recipient,
        'platform_name', coalesce(v_ps.platform_name, 'Klubowicz'),
        'contact_email', v_ps.contact_email
      ),
      'pending_members', v_pending
    );
  end if;

  return v_result;
end $$;

-- ---------- Zarządzanie członkami (Właściciel) ----------

create or replace function public.admin_list_members(p_club uuid)
returns table (
  member_id uuid, user_id uuid, full_name text, email text, role text, status text,
  billing_mode text, member_code text, aliases text[], balance numeric,
  joined_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_owner(p_club);
  return query
    select m.id, m.user_id, p.full_name, p.email, m.role, m.status, m.billing_mode,
           m.member_code, m.aliases,
           coalesce((select sum(t.amount) from public.transactions t
                     where t.club_id = m.club_id and t.user_id = m.user_id), 0)::numeric,
           m.joined_at, m.created_at
    from public.club_members m
    join public.profiles p on p.id = m.user_id
    where m.club_id = p_club
    order by case m.status when 'pending' then 0 when 'active' then 1 else 2 end,
             p.full_name nulls last, p.email;
end $$;

create or replace function public.approve_member(p_member_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_club uuid;
begin
  select club_id into v_club from public.club_members where id = p_member_id;
  if v_club is null then raise exception 'Nie znaleziono członka.'; end if;
  perform public._require_owner(v_club);
  update public.club_members set status = 'active' where id = p_member_id and status in ('pending', 'removed');
end $$;

create or replace function public.remove_member(p_member_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  m public.club_members%rowtype;
  r record;
begin
  select * into m from public.club_members where id = p_member_id;
  if not found then raise exception 'Nie znaleziono członka.'; end if;
  perform public._require_owner(m.club_id);
  if m.role = 'owner' then
    raise exception 'Nie można usunąć Właściciela klubu.';
  end if;

  update public.club_members set status = 'removed', role = 'member' where id = p_member_id;

  -- usuń z przyszłych treningów i przesuń rezerwę
  for r in
    select s.training_id from public.training_signups s
    join public.trainings t on t.id = s.training_id
    where s.user_id = m.user_id and s.club_id = m.club_id
      and t.status = 'scheduled' and t.starts_at > now()
  loop
    delete from public.training_signups where training_id = r.training_id and user_id = m.user_id;
    perform public._rebalance_training(r.training_id);
  end loop;
end $$;

create or replace function public.set_member_role(p_member_id uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m public.club_members%rowtype;
begin
  select * into m from public.club_members where id = p_member_id;
  if not found then raise exception 'Nie znaleziono członka.'; end if;
  perform public._require_owner(m.club_id);
  if p_role not in ('caretaker', 'member') then
    raise exception 'Właściciel może nadać tylko rolę Opiekuna lub Zawodnika.';
  end if;
  if m.role = 'owner' then
    raise exception 'Nie można zmienić roli Właściciela.';
  end if;
  if m.status <> 'active' then
    raise exception 'Rolę można nadać tylko aktywnemu członkowi.';
  end if;
  update public.club_members set role = p_role where id = p_member_id;
end $$;

create or replace function public.set_member_billing(p_member_id uuid, p_mode text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_club uuid;
begin
  select club_id into v_club from public.club_members where id = p_member_id;
  if v_club is null then raise exception 'Nie znaleziono członka.'; end if;
  perform public._require_owner(v_club);
  if p_mode not in ('monthly', 'per_session') then
    raise exception 'Nieprawidłowy tryb rozliczeń.';
  end if;
  update public.club_members set billing_mode = p_mode where id = p_member_id;
end $$;

create or replace function public.set_member_aliases(p_member_id uuid, p_aliases text[])
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_club uuid;
begin
  select club_id into v_club from public.club_members where id = p_member_id;
  if v_club is null then raise exception 'Nie znaleziono członka.'; end if;
  perform public._require_owner(v_club);
  update public.club_members
  set aliases = coalesce((
    select array_agg(distinct trim(a)) from unnest(coalesce(p_aliases, '{}')) a
    where trim(a) <> ''
  ), '{}')
  where id = p_member_id;
end $$;

-- ---------- Ustawienia klubu (Właściciel) ----------

create or replace function public.update_club_settings(
  p_club uuid,
  p_name text,
  p_bank_account text,
  p_bank_recipient text,
  p_monthly_fee numeric,
  p_single_fee numeric,
  p_deadline_hours integer,
  p_default_max integer,
  p_default_location text
)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._require_owner(p_club);
  update public.clubs set
    name = coalesce(nullif(trim(p_name), ''), name),
    bank_account = nullif(trim(p_bank_account), ''),
    bank_recipient = nullif(trim(p_bank_recipient), ''),
    monthly_fee_amount = coalesce(p_monthly_fee, monthly_fee_amount),
    single_training_fee_amount = coalesce(p_single_fee, single_training_fee_amount),
    cancellation_deadline_hours = coalesce(p_deadline_hours, cancellation_deadline_hours),
    default_max_participants = coalesce(p_default_max, default_max_participants),
    default_location = nullif(trim(p_default_location), '')
  where id = p_club;
end $$;

create or replace function public.regenerate_invite_code(p_club uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_code text;
begin
  perform public._require_owner(p_club);
  update public.clubs set invite_code = public._gen_invite_code(prefix)
  where id = p_club returning invite_code into v_code;
  return v_code;
end $$;

-- ---------- Treningi: głosowanie na trenera ----------

-- Oddanie / zmiana / wycofanie (p_candidate = null) głosu na trenera treningu
create or replace function public.vote_coach(p_training uuid, p_candidate uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public._require_uid();
  t     public.trainings%rowtype;
begin
  select * into t from public.trainings where id = p_training;
  if not found then raise exception 'Trening nie istnieje.'; end if;
  if not public.is_club_member(t.club_id) then
    raise exception 'Nie jesteś aktywnym członkiem tego klubu.' using errcode = '42501';
  end if;
  if t.status <> 'scheduled' or t.starts_at <= now() then
    raise exception 'Głosowanie na trenera jest już zamknięte.';
  end if;
  if not exists (select 1 from public.training_signups
                 where training_id = p_training and user_id = v_uid and status in ('main', 'reserve')) then
    raise exception 'Najpierw zapisz się na trening, aby głosować.';
  end if;

  if p_candidate is null then
    delete from public.training_coach_votes where training_id = p_training and voter_id = v_uid;
    return;
  end if;
  if p_candidate = v_uid then
    raise exception 'Nie można głosować na siebie.';
  end if;
  if not exists (select 1 from public.training_signups
                 where training_id = p_training and user_id = p_candidate and status = 'main') then
    raise exception 'Można głosować tylko na osoby z listy głównej treningu.';
  end if;

  insert into public.training_coach_votes (training_id, club_id, voter_id, candidate_id)
  values (p_training, t.club_id, v_uid, p_candidate)
  on conflict (training_id, voter_id) do update
    set candidate_id = excluded.candidate_id, voted_at = now();
end $$;

-- Wyniki głosowania: liczba głosów na kandydata + czy to mój głos.
-- Liczą się głosy osób nadal zapisanych, oddane na osoby nadal na liście głównej.
create or replace function public.coach_votes(p_training uuid)
returns table (candidate_id uuid, votes integer, is_my_vote boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := public._require_uid();
  v_club uuid;
begin
  select club_id into v_club from public.trainings where id = p_training;
  if v_club is null or not (public.is_club_member(v_club) or public.is_superadmin()) then
    raise exception 'Nie masz dostępu do tego treningu.' using errcode = '42501';
  end if;
  return query
    select v.candidate_id, count(*)::int, bool_or(v.voter_id = v_uid)
    from public.training_coach_votes v
    join public.training_signups c on c.training_id = v.training_id and c.user_id = v.candidate_id and c.status = 'main'
    join public.training_signups s on s.training_id = v.training_id and s.user_id = v.voter_id
                                  and s.status in ('main', 'reserve')
    where v.training_id = p_training
    group by v.candidate_id
    order by count(*) desc;
end $$;

-- Kto „był na treningu”: po sprawdzeniu obecności – obecni; wcześniej – lista główna
create or replace function public._mvp_eligible(p_training uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.training_attendance a where a.training_id = p_training)
      then exists (select 1 from public.training_attendance a
                   where a.training_id = p_training and a.user_id = p_user and a.present)
    else exists (select 1 from public.training_signups s
                 where s.training_id = p_training and s.user_id = p_user and s.status = 'main')
  end;
$$;

create or replace function public.vote_mvp(p_training uuid, p_candidate uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public._require_uid();
  t     public.trainings%rowtype;
begin
  select * into t from public.trainings where id = p_training;
  if not found then raise exception 'Trening nie istnieje.'; end if;
  if not public.is_club_member(t.club_id) then
    raise exception 'Nie jesteś aktywnym członkiem tego klubu.' using errcode = '42501';
  end if;
  if t.status = 'cancelled' then raise exception 'Trening został odwołany.'; end if;
  if t.starts_at > now() then raise exception 'Głosowanie na MVP otwiera się po rozpoczęciu treningu.'; end if;
  if now() > t.starts_at + interval '7 days' then raise exception 'Głosowanie na MVP jest już zamknięte.'; end if;
  if not public._mvp_eligible(p_training, v_uid) then
    raise exception 'Na MVP mogą głosować tylko osoby, które były na treningu.';
  end if;
  if p_candidate is null then
    delete from public.training_mvp_votes where training_id = p_training and voter_id = v_uid;
    return;
  end if;
  if p_candidate = v_uid then raise exception 'Nie można głosować na siebie.'; end if;
  if not public._mvp_eligible(p_training, p_candidate) then
    raise exception 'Można głosować tylko na osoby, które były na treningu.';
  end if;
  insert into public.training_mvp_votes (training_id, club_id, voter_id, candidate_id)
  values (p_training, t.club_id, v_uid, p_candidate)
  on conflict (training_id, voter_id) do update set candidate_id = excluded.candidate_id, voted_at = now();
end $$;

create or replace function public.mvp_votes(p_training uuid)
returns table (candidate_id uuid, votes integer, is_my_vote boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := public._require_uid();
  v_club uuid;
begin
  select club_id into v_club from public.trainings where id = p_training;
  if v_club is null or not (public.is_club_member(v_club) or public.is_superadmin()) then
    raise exception 'Nie masz dostępu do tego treningu.' using errcode = '42501';
  end if;
  return query
    select v.candidate_id, count(*)::int, bool_or(v.voter_id = v_uid)
    from public.training_mvp_votes v
    where v.training_id = p_training
      and public._mvp_eligible(p_training, v.candidate_id)
      and public._mvp_eligible(p_training, v.voter_id)
    group by v.candidate_id
    order by count(*) desc;
end $$;

-- Właściciel włącza/wyłącza opłatę za późne wypisanie
create or replace function public.set_late_cancel_fee(p_club uuid, p_enabled boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._require_owner(p_club);
  update public.clubs set late_cancel_fee_enabled = coalesce(p_enabled, true) where id = p_club;
  if not coalesce(p_enabled, true) then
    -- dotychczasowe „wypisane po terminie” w nadchodzących treningach – zwykłe wypisanie
    delete from public.training_signups s
    using public.trainings t
    where t.id = s.training_id and t.club_id = p_club and t.status = 'scheduled' and s.status = 'late_cancel';
  end if;
end $$;

-- ---------- Treningi: zapisy ----------

create or replace function public.join_training(p_training uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid    uuid := public._require_uid();
  t        public.trainings%rowtype;
  s        public.training_signups%rowtype;
  v_exists boolean;
  v_main   integer;
  v_status text;
begin
  -- blokada wiersza treningu serializuje równoległe zapisy (brak wyścigów o ostatnie miejsce)
  select * into t from public.trainings where id = p_training for update;
  if not found then raise exception 'Trening nie istnieje.'; end if;
  if not public.is_club_member(t.club_id) then
    raise exception 'Nie jesteś aktywnym członkiem tego klubu.' using errcode = '42501';
  end if;
  perform public._assert_club_not_suspended(t.club_id);
  if t.status <> 'scheduled' then raise exception 'Zapisy na ten trening są zamknięte.'; end if;
  if t.starts_at <= now() then raise exception 'Trening już się rozpoczął – poproś Opiekuna o dopisanie.'; end if;

  select * into s from public.training_signups where training_id = p_training and user_id = v_uid;
  v_exists := found;
  if v_exists and s.status in ('main', 'reserve') then
    return s.status;
  end if;

  select count(*) into v_main from public.training_signups
  where training_id = p_training and status = 'main';
  v_status := case when v_main < t.max_participants then 'main' else 'reserve' end;

  if v_exists then
    update public.training_signups
    set status = v_status, signed_up_at = clock_timestamp(), added_by_staff = false, updated_at = now()
    where id = s.id;
  else
    insert into public.training_signups (training_id, club_id, user_id, status)
    values (p_training, t.club_id, v_uid, v_status);
  end if;
  return v_status;
end $$;

create or replace function public.leave_training(p_training uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid      uuid := public._require_uid();
  t          public.trainings%rowtype;
  s          public.training_signups%rowtype;
  v_deadline integer;
  v_mode     text;
  v_result   text;
begin
  select * into t from public.trainings where id = p_training for update;
  if not found then raise exception 'Trening nie istnieje.'; end if;
  if not public.is_club_member(t.club_id) then
    raise exception 'Nie jesteś aktywnym członkiem tego klubu.' using errcode = '42501';
  end if;
  perform public._assert_club_not_suspended(t.club_id);
  if t.status <> 'scheduled' then raise exception 'Ten trening jest zamknięty.'; end if;
  if t.starts_at <= now() then raise exception 'Trening już się rozpoczął – skontaktuj się z Opiekunem.'; end if;

  select * into s from public.training_signups where training_id = p_training and user_id = v_uid;
  if not found or s.status = 'late_cancel' then
    return 'none';
  end if;

  select case when c.late_cancel_fee_enabled then c.cancellation_deadline_hours else null end
    into v_deadline from public.clubs c where c.id = t.club_id;
  select m.billing_mode into v_mode from public.club_members m where m.club_id = t.club_id and m.user_id = v_uid;

  if v_deadline is not null and s.status = 'main' and v_mode = 'per_session'
     and now() > t.starts_at - make_interval(hours => v_deadline) then
    update public.training_signups set status = 'late_cancel', has_car = false, wants_beer = false, updated_at = now()
    where id = s.id;
    v_result := 'late_cancel';
  else
    delete from public.training_signups where id = s.id;
    v_result := 'removed';
  end if;

  if s.status = 'main' then
    perform public._rebalance_training(p_training);
  end if;
  return v_result;
end $$;

create or replace function public.set_signup_flags(p_training uuid, p_has_car boolean, p_wants_beer boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_uid uuid := public._require_uid();
begin
  update public.training_signups
  set has_car = coalesce(p_has_car, has_car),
      wants_beer = coalesce(p_wants_beer, wants_beer),
      updated_at = now()
  where training_id = p_training and user_id = v_uid and status in ('main', 'reserve');
  if not found then
    raise exception 'Najpierw zapisz się na trening.';
  end if;
end $$;

-- Opiekun/Właściciel: dopisanie osoby, która przyszła na halę, a nie zapisała się w aplikacji
create or replace function public.staff_add_signup(p_training uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare t public.trainings%rowtype;
begin
  select * into t from public.trainings where id = p_training for update;
  if not found then raise exception 'Trening nie istnieje.'; end if;
  perform public._require_staff(t.club_id);
  perform public._assert_club_not_suspended(t.club_id);
  if t.status <> 'scheduled' then raise exception 'Trening jest już rozliczony lub odwołany.'; end if;
  if not exists (select 1 from public.club_members where club_id = t.club_id and user_id = p_user and status = 'active') then
    raise exception 'Ta osoba nie jest aktywnym członkiem klubu.';
  end if;

  insert into public.training_signups (training_id, club_id, user_id, status, added_by_staff)
  values (p_training, t.club_id, p_user, 'main', true)
  on conflict (training_id, user_id) do update
    set status = 'main', added_by_staff = true, updated_at = now();
end $$;

create or replace function public.staff_remove_signup(p_training uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  t public.trainings%rowtype;
  v_was text;
begin
  select * into t from public.trainings where id = p_training for update;
  if not found then raise exception 'Trening nie istnieje.'; end if;
  perform public._require_staff(t.club_id);
  if t.status <> 'scheduled' then raise exception 'Trening jest już rozliczony lub odwołany.'; end if;
  delete from public.training_signups where training_id = p_training and user_id = p_user
  returning status into v_was;
  if v_was = 'main' and t.starts_at > now() then
    perform public._rebalance_training(p_training);
  end if;
end $$;

-- Opiekun/Właściciel: zatwierdzenie obecności i rozliczenie treningu.
-- Obciąża WSZYSTKICH faktycznie obecnych graczy w trybie per_session
-- (zapisanych samodzielnie i dopisanych na hali) oraz – opcjonalnie – osoby,
-- które wypisały się po terminie (p_charge_late).
create or replace function public.settle_training(
  p_training uuid,
  p_present uuid[],
  p_charge_late uuid[] default '{}'
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid     uuid := public._require_uid();
  t         public.trainings%rowtype;
  v_fee     numeric;
  v_label   text;
  v_day     date;
  v_charged integer := 0;
  v_late    integer := 0;
  v_present uuid[] := coalesce(p_present, '{}');
  v_late_ids uuid[] := coalesce(p_charge_late, '{}');
begin
  select * into t from public.trainings where id = p_training for update;
  if not found then raise exception 'Trening nie istnieje.'; end if;
  perform public._require_staff(t.club_id);
  perform public._assert_club_not_suspended(t.club_id);
  if t.status = 'settled' then raise exception 'Ten trening został już rozliczony.'; end if;
  if t.status = 'cancelled' then raise exception 'Odwołanego treningu nie można rozliczyć.'; end if;

  if exists (
    select 1 from unnest(v_present) u
    where not exists (select 1 from public.club_members m
                      where m.club_id = t.club_id and m.user_id = u and m.status = 'active')
  ) then
    raise exception 'Lista obecności zawiera osoby spoza aktywnych członków klubu.';
  end if;

  perform set_config('app.bypass_training_guard', 'on', true);

  -- obecni, którzy nie byli zapisani („zapominalscy”) trafiają na listę główną
  insert into public.training_signups (training_id, club_id, user_id, status, added_by_staff)
  select t.id, t.club_id, u, 'main', true from (select distinct unnest(v_present) as u) x
  on conflict (training_id, user_id) do update
    set status = 'main', updated_at = now()
    where public.training_signups.status <> 'main';

  delete from public.training_attendance where training_id = t.id;

  insert into public.training_attendance (training_id, club_id, user_id, present, marked_by)
  select t.id, t.club_id, u, true, v_uid from (select distinct unnest(v_present) as u) x;

  insert into public.training_attendance (training_id, club_id, user_id, present, marked_by)
  select t.id, t.club_id, s.user_id, false, v_uid
  from public.training_signups s
  where s.training_id = t.id and s.status in ('main', 'reserve', 'late_cancel')
    and not (s.user_id = any (v_present))
  on conflict do nothing;

  select single_training_fee_amount into v_fee from public.clubs where id = t.club_id;
  if not (select c.late_cancel_fee_enabled from public.clubs c where c.id = t.club_id) then
    v_late_ids := '{}';
  end if;
  v_day := (t.starts_at at time zone 'Europe/Warsaw')::date;
  v_label := t.title || ' ' || to_char(t.starts_at at time zone 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI');

  if v_fee > 0 then
    insert into public.transactions (club_id, user_id, amount, type, description, training_id, booked_at, created_by)
    select t.club_id, m.user_id, -v_fee, 'session_fee', v_label, t.id, v_day, v_uid
    from public.club_members m
    where m.club_id = t.club_id and m.status = 'active' and m.billing_mode = 'per_session'
      and m.user_id = any (v_present)
    on conflict do nothing;
    get diagnostics v_charged = row_count;

    insert into public.transactions (club_id, user_id, amount, type, description, training_id, booked_at, created_by)
    select t.club_id, s.user_id, -v_fee, 'late_cancel_fee', 'Późne wypisanie: ' || v_label, t.id, v_day, v_uid
    from public.training_signups s
    join public.club_members m on m.club_id = s.club_id and m.user_id = s.user_id
    where s.training_id = t.id and s.status = 'late_cancel'
      and m.billing_mode = 'per_session'
      and s.user_id = any (v_late_ids)
      and not (s.user_id = any (v_present))
    on conflict do nothing;
    get diagnostics v_late = row_count;
  end if;

  update public.trainings set status = 'settled', settled_at = now(), settled_by = v_uid where id = t.id;

  return jsonb_build_object(
    'present', coalesce(array_length(v_present, 1), 0),
    'charged', v_charged,
    'late_charged', v_late,
    'fee', v_fee,
    'total', (v_charged + v_late) * v_fee
  );
end $$;

-- ---------- Statystyki klubu (widoczne dla wszystkich aktywnych członków) ----------

-- Rankingi TOP 10: obecności na treningach, przyjazdy autem, integracje (piwo), najwyższe saldo.
-- Liczone z zatwierdzonej obecności (training_attendance.present = true).
-- Zwraca tylko czołówkę (saldo: wyłącznie dodatnie) + statystyki wywołującego – bez pełnej listy sald.
create or replace function public.club_stats(p_club uuid, p_from timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public._require_uid();
  v     jsonb;
begin
  if not public.is_club_member(p_club) and not public.is_superadmin() then
    raise exception 'Nie masz dostępu do tego klubu.' using errcode = '42501';
  end if;

  with present as (
    select a.user_id, coalesce(s.has_car, false) as has_car, coalesce(s.wants_beer, false) as wants_beer
    from public.training_attendance a
    join public.trainings t on t.id = a.training_id
    left join public.training_signups s on s.training_id = a.training_id and s.user_id = a.user_id
    where a.club_id = p_club and a.present and (p_from is null or t.starts_at >= p_from)
  ),
  coach_tally as (
    select v.training_id, v.candidate_id, count(*) as n
    from public.training_coach_votes v
    join public.trainings t on t.id = v.training_id
    join public.training_signups c on c.training_id = v.training_id and c.user_id = v.candidate_id and c.status = 'main'
    join public.training_signups s on s.training_id = v.training_id and s.user_id = v.voter_id and s.status in ('main', 'reserve')
    where v.club_id = p_club and t.status <> 'cancelled' and t.starts_at <= now()
      and (p_from is null or t.starts_at >= p_from)
    group by v.training_id, v.candidate_id
  ),
  coach_wins as (
    select x.candidate_id as user_id from coach_tally x
    where x.n = (select max(y.n) from coach_tally y where y.training_id = x.training_id)
  ),
  mvp_tally as (
    select v.training_id, v.candidate_id, count(*) as n
    from public.training_mvp_votes v
    join public.trainings t on t.id = v.training_id
    where v.club_id = p_club and t.status <> 'cancelled'
      and (p_from is null or t.starts_at >= p_from)
      and public._mvp_eligible(v.training_id, v.candidate_id)
      and public._mvp_eligible(v.training_id, v.voter_id)
    group by v.training_id, v.candidate_id
  ),
  mvp_wins as (
    select x.candidate_id as user_id from mvp_tally x
    where x.n = (select max(y.n) from mvp_tally y where y.training_id = x.training_id)
  ),
  base as (
    select m.user_id, p.full_name, m.member_code,
           (select count(*) from present x where x.user_id = m.user_id)::int as visits,
           (select count(*) from present x where x.user_id = m.user_id and x.has_car)::int as cars,
           (select count(*) from present x where x.user_id = m.user_id and x.wants_beer)::int as beers,
           (select count(*) from coach_wins w where w.user_id = m.user_id)::int as coach,
           (select count(*) from mvp_wins w where w.user_id = m.user_id)::int as mvp,
           coalesce((select sum(t.amount) from public.transactions t
                     where t.club_id = p_club and t.user_id = m.user_id), 0)::numeric as balance
    from public.club_members m
    join public.profiles p on p.id = m.user_id
    where m.club_id = p_club and m.status = 'active'
  ),
  ranked as (
    select b.*,
           rank() over (order by b.visits desc)  as r_visits,
           rank() over (order by b.cars desc)    as r_cars,
           rank() over (order by b.beers desc)   as r_beers,
           rank() over (order by b.balance desc) as r_balance,
           rank() over (order by b.coach desc)   as r_coach,
           rank() over (order by b.mvp desc)     as r_mvp
    from base b
  )
  select jsonb_build_object(
    'visits', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'full_name', x.full_name,
                 'member_code', x.member_code, 'value', x.visits, 'rank', x.r_visits) order by x.r_visits, x.full_name)
               from (select * from ranked where visits > 0 order by r_visits, full_name limit 10) x), '[]'::jsonb),
    'cars', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'full_name', x.full_name,
                 'member_code', x.member_code, 'value', x.cars, 'rank', x.r_cars) order by x.r_cars, x.full_name)
               from (select * from ranked where cars > 0 order by r_cars, full_name limit 10) x), '[]'::jsonb),
    'beers', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'full_name', x.full_name,
                 'member_code', x.member_code, 'value', x.beers, 'rank', x.r_beers) order by x.r_beers, x.full_name)
               from (select * from ranked where beers > 0 order by r_beers, full_name limit 10) x), '[]'::jsonb),
    'coach', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'full_name', x.full_name,
                 'member_code', x.member_code, 'value', x.coach, 'rank', x.r_coach) order by x.r_coach, x.full_name)
               from (select * from ranked where coach > 0 order by r_coach, full_name limit 10) x), '[]'::jsonb),
    'mvp', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'full_name', x.full_name,
                 'member_code', x.member_code, 'value', x.mvp, 'rank', x.r_mvp) order by x.r_mvp, x.full_name)
               from (select * from ranked where mvp > 0 order by r_mvp, full_name limit 10) x), '[]'::jsonb),
    'balance', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'full_name', x.full_name,
                 'member_code', x.member_code, 'value', x.balance, 'rank', x.r_balance) order by x.r_balance, x.full_name)
               from (select * from ranked where balance > 0 order by r_balance, full_name limit 10) x), '[]'::jsonb),
    'me', (select jsonb_build_object('visits', r.visits, 'cars', r.cars, 'beers', r.beers, 'balance', r.balance,
                  'r_visits', r.r_visits, 'r_cars', r.r_cars, 'r_beers', r.r_beers, 'r_balance', r.r_balance,
                  'coach', r.coach, 'mvp', r.mvp, 'r_coach', r.r_coach, 'r_mvp', r.r_mvp)
           from ranked r where r.user_id = v_uid),
    'members', (select count(*) from base),
    'trainings', (select count(*) from public.trainings t
                  where t.club_id = p_club and t.status = 'settled' and (p_from is null or t.starts_at >= p_from))
  ) into v;

  return v;
end $$;

-- ---------- Zespół: składy i salda (Opiekun + Właściciel, tylko odczyt) ----------

-- Lista aktywnych członków klubu z saldem, trybem rozliczeń i ostatnią wpłatą.
-- Bez e-maili i aliasów (te widzi tylko Właściciel w admin_list_members).
create or replace function public.team_overview(p_club uuid)
returns table (
  member_id uuid, user_id uuid, full_name text, member_code text, role text,
  billing_mode text, balance numeric, last_payment_at date, last_present_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_staff(p_club);
  return query
    select m.id, m.user_id, p.full_name, m.member_code, m.role, m.billing_mode,
           coalesce((select sum(t.amount) from public.transactions t
                     where t.club_id = m.club_id and t.user_id = m.user_id), 0)::numeric,
           (select max(t.booked_at) from public.transactions t
             where t.club_id = m.club_id and t.user_id = m.user_id and t.type = 'payment'),
           (select max(tr.starts_at) from public.training_attendance a
              join public.trainings tr on tr.id = a.training_id
             where a.club_id = m.club_id and a.user_id = m.user_id and a.present)
    from public.club_members m
    join public.profiles p on p.id = m.user_id
    where m.club_id = p_club and m.status = 'active'
    order by p.full_name nulls last;
end $$;

-- Historia wpłat i obciążeń wybranego członka (Opiekun + Właściciel, tylko odczyt)
create or replace function public.member_history(p_club uuid, p_user uuid)
returns table (
  id uuid, amount numeric, type text, description text, booked_at date, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_staff(p_club);
  return query
    select t.id, t.amount, t.type, t.description, t.booked_at, t.created_at
    from public.transactions t
    where t.club_id = p_club and t.user_id = p_user
    order by t.booked_at desc, t.created_at desc;
end $$;

-- ---------- Automatyczne składki (harmonogram) ----------

-- Systemowe naliczenie składek – wywoływane przez pg_cron, niedostępne dla użytkowników
create or replace function public._system_charge_monthly_fees(p_period text default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_period text := coalesce(p_period, to_char(now() at time zone 'Europe/Warsaw', 'YYYY-MM'));
  v_total integer := 0;
  v_n integer;
  c record;
begin
  for c in
    select * from public.clubs
    where auto_monthly_fee and monthly_fee_amount > 0
      and (auto_monthly_fee_from is null or v_period >= auto_monthly_fee_from)
  loop
    if public._refresh_subscription(c.id) = 'suspended' then
      continue;
    end if;
    insert into public.transactions (club_id, user_id, amount, type, description, period, booked_at, created_by)
    select c.id, m.user_id, -c.monthly_fee_amount, 'monthly_fee',
           'Składka za wynajem sali gimnastycznej ' || substr(v_period, 6, 2) || '/' || substr(v_period, 1, 4),
           v_period, to_date(v_period || '-01', 'YYYY-MM-DD'), null
    from public.club_members m
    where m.club_id = c.id and m.status = 'active' and m.billing_mode = 'monthly'
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end $$;

-- ---------- Finanse klubu (Właściciel) ----------

create or replace function public.charge_monthly_fees(p_club uuid, p_period text)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid   uuid := public._require_owner(p_club);
  v_fee   numeric;
  v_count integer;
begin
  perform public._assert_club_not_suspended(p_club);
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Nieprawidłowy okres (oczekiwano RRRR-MM).';
  end if;
  select monthly_fee_amount into v_fee from public.clubs where id = p_club;
  if coalesce(v_fee, 0) <= 0 then
    raise exception 'Ustaw najpierw kwotę składki miesięcznej w ustawieniach klubu.';
  end if;

  insert into public.transactions (club_id, user_id, amount, type, description, period, booked_at, created_by)
  select p_club, m.user_id, -v_fee, 'monthly_fee',
         'Składka za wynajem sali gimnastycznej ' || substr(p_period, 6, 2) || '/' || substr(p_period, 1, 4),
         p_period, to_date(p_period || '-01', 'YYYY-MM-DD'), v_uid
  from public.club_members m
  where m.club_id = p_club and m.status = 'active' and m.billing_mode = 'monthly'
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.add_manual_transaction(
  p_club uuid, p_user uuid, p_amount numeric, p_type text, p_description text, p_date date
)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public._require_owner(p_club);
  v_id  uuid;
begin
  perform public._assert_club_not_suspended(p_club);
  if p_type not in ('payment', 'adjustment') then
    raise exception 'Ręcznie można dodać tylko wpłatę lub korektę.';
  end if;
  if p_amount is null or p_amount = 0 then raise exception 'Kwota nie może być zerowa.'; end if;
  if p_type = 'payment' and p_amount < 0 then raise exception 'Wpłata musi być dodatnia.'; end if;
  if not exists (select 1 from public.club_members where club_id = p_club and user_id = p_user) then
    raise exception 'Ta osoba nie należy do klubu.';
  end if;
  insert into public.transactions (club_id, user_id, amount, type, description, booked_at, created_by)
  values (p_club, p_user, round(p_amount, 2), p_type,
          coalesce(nullif(trim(p_description), ''), case when p_type = 'payment' then 'Wpłata' else 'Korekta' end),
          coalesce(p_date, current_date), v_uid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_transaction(p_tx uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_club uuid;
begin
  select club_id into v_club from public.transactions where id = p_tx;
  if v_club is null then raise exception 'Nie znaleziono transakcji.'; end if;
  perform public._require_owner(v_club);
  delete from public.transactions where id = p_tx;
end $$;

-- Import CSV: sprawdzenie, które hashe już zaksięgowano (podgląd przed importem)
create or replace function public.check_bank_hashes(p_club uuid, p_hashes text[])
returns setof text language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_owner(p_club);
  return query select t.bank_hash from public.transactions t
               where t.club_id = p_club and t.bank_hash = any (coalesce(p_hashes, '{}'));
end $$;

-- Import CSV: księgowanie zatwierdzonych wpłat.
-- p_rows: [{ "user_id": uuid, "amount": 150.00, "date": "2026-11-05", "title": "...", "sender": "...", "hash": "..." }]
create or replace function public.import_bank_payments(p_club uuid, p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid      uuid := public._require_owner(p_club);
  r          jsonb;
  v_inserted integer := 0;
  v_skipped  integer := 0;
  v_amount   numeric;
  v_user     uuid;
  v_n        integer;
begin
  perform public._assert_club_not_suspended(p_club);
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Nieprawidłowe dane importu.'; end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    v_user := (r ->> 'user_id')::uuid;
    v_amount := round((r ->> 'amount')::numeric, 2);
    if v_amount is null or v_amount <= 0 or coalesce(r ->> 'hash', '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if not exists (select 1 from public.club_members where club_id = p_club and user_id = v_user) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.transactions (club_id, user_id, amount, type, description, bank_hash, booked_at, created_by)
    values (
      p_club, v_user, v_amount, 'payment',
      left('Przelew: ' || coalesce(r ->> 'title', '') ||
           case when coalesce(r ->> 'sender', '') <> '' then ' (' || (r ->> 'sender') || ')' else '' end, 300),
      r ->> 'hash',
      coalesce((r ->> 'date')::date, current_date),
      v_uid
    )
    on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_inserted := v_inserted + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end $$;

-- ---------- Panel Superadmina ----------

create or replace function public._assign_owner(p_club uuid, p_email text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid;
begin
  if coalesce(trim(p_email), '') = '' then
    return 'none';
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    update public.clubs set pending_owner_email = lower(trim(p_email)) where id = p_club;
    return 'pending';
  end if;
  insert into public.club_members (club_id, user_id, role, status, billing_mode)
  values (p_club, v_user, 'owner', 'active', 'monthly')
  on conflict (club_id, user_id) do update set role = 'owner', status = 'active';
  return 'assigned';
end $$;

create or replace function public.sa_create_club(
  p_name text,
  p_prefix text,
  p_owner_email text,
  p_plan text,
  p_monthly_amount numeric
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid    uuid := public._require_superadmin();
  v_prefix text := upper(trim(p_prefix));
  v_id     uuid;
  v_owner  text;
begin
  if v_prefix !~ '^[A-Z]{2,6}$' then
    raise exception 'Prefiks musi mieć 2–6 wielkich liter (np. VCA).';
  end if;
  if exists (select 1 from public.clubs where prefix = v_prefix) then
    raise exception 'Prefiks % jest już zajęty.', v_prefix;
  end if;
  if p_plan not in ('FREE', 'CLUB_50', 'CLUB_100', 'CUSTOM') then
    raise exception 'Nieznany plan.';
  end if;

  insert into public.clubs (name, prefix, invite_code, created_by)
  values (trim(p_name), v_prefix, public._gen_invite_code(v_prefix), v_uid)
  returning id into v_id;

  insert into public.platform_subscriptions (club_id, plan, monthly_amount)
  values (v_id, p_plan, coalesce(p_monthly_amount,
    case p_plan when 'CLUB_50' then 50 when 'CLUB_100' then 100 else 0 end));

  v_owner := public._assign_owner(v_id, p_owner_email);
  return jsonb_build_object('club_id', v_id, 'owner', v_owner);
end $$;

create or replace function public.sa_assign_owner(p_club uuid, p_email text)
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._require_superadmin();
  return public._assign_owner(p_club, p_email);
end $$;

create or replace function public.sa_list_clubs()
returns table (
  club_id uuid, name text, prefix text, invite_code text, created_at timestamptz,
  plan text, monthly_amount numeric, status text, grace_period_days integer,
  suspend_after_days integer, unlock_until timestamptz,
  unpaid_amount numeric, unpaid_count integer, last_paid_at timestamptz,
  active_members integer, pending_members integer, owners text, pending_owner_email text
)
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._require_superadmin();
  perform public._refresh_subscription(c.id) from public.clubs c;
  return query
    select c.id, c.name, c.prefix, c.invite_code, c.created_at,
           coalesce(s.plan, 'FREE'), coalesce(s.monthly_amount, 0), coalesce(s.status, 'active'),
           coalesce(s.grace_period_days, 7), coalesce(s.suspend_after_days, 14), s.unlock_until,
           coalesce((select sum(i.amount) from public.platform_invoices i
                     where i.club_id = c.id and i.status = 'unpaid'), 0)::numeric,
           (select count(*) from public.platform_invoices i
             where i.club_id = c.id and i.status = 'unpaid')::int,
           (select max(i.paid_at) from public.platform_invoices i where i.club_id = c.id),
           (select count(*) from public.club_members m where m.club_id = c.id and m.status = 'active')::int,
           (select count(*) from public.club_members m where m.club_id = c.id and m.status = 'pending')::int,
           (select string_agg(coalesce(p.full_name, p.email) || ' <' || p.email || '>', ', ')
              from public.club_members m join public.profiles p on p.id = m.user_id
             where m.club_id = c.id and m.role = 'owner' and m.status = 'active'),
           c.pending_owner_email
    from public.clubs c
    left join public.platform_subscriptions s on s.club_id = c.id
    order by c.created_at;
end $$;

create or replace function public.sa_update_subscription(
  p_club uuid, p_plan text, p_monthly_amount numeric, p_grace integer, p_suspend integer
)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._require_superadmin();
  if p_plan not in ('FREE', 'CLUB_50', 'CLUB_100', 'CUSTOM') then raise exception 'Nieznany plan.'; end if;
  insert into public.platform_subscriptions (club_id, plan, monthly_amount, grace_period_days, suspend_after_days)
  values (p_club, p_plan, coalesce(p_monthly_amount, 0), coalesce(p_grace, 7), coalesce(p_suspend, 14))
  on conflict (club_id) do update set
    plan = excluded.plan,
    monthly_amount = excluded.monthly_amount,
    grace_period_days = excluded.grace_period_days,
    suspend_after_days = excluded.suspend_after_days,
    updated_at = now();
  perform public._refresh_subscription(p_club);
end $$;

create or replace function public.sa_charge_month(p_club uuid, p_period text default null)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_period text := coalesce(nullif(trim(p_period), ''), public._current_period());
  v_amount numeric;
  v_n      integer;
begin
  perform public._require_superadmin();
  if v_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Nieprawidłowy okres.'; end if;
  select monthly_amount into v_amount from public.platform_subscriptions where club_id = p_club;
  if coalesce(v_amount, 0) <= 0 then
    return 'free';
  end if;
  insert into public.platform_invoices (club_id, period, amount)
  values (p_club, v_period, v_amount)
  on conflict (club_id, period) do nothing;
  get diagnostics v_n = row_count;
  perform public._refresh_subscription(p_club);
  return case when v_n > 0 then 'charged' else 'exists' end;
end $$;

create or replace function public.sa_charge_all(p_period text default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  r record;
  v_count integer := 0;
begin
  perform public._require_superadmin();
  for r in select club_id from public.platform_subscriptions where monthly_amount > 0
  loop
    if public.sa_charge_month(r.club_id, p_period) = 'charged' then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

create or replace function public.sa_mark_paid(p_club uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_n integer;
begin
  perform public._require_superadmin();
  update public.platform_invoices set status = 'paid', paid_at = now()
  where club_id = p_club and status = 'unpaid';
  get diagnostics v_n = row_count;
  update public.platform_subscriptions set status = 'active', unlock_until = null, updated_at = now()
  where club_id = p_club;
  return v_n;
end $$;

-- 'suspended' = ręczne zawieszenie; 'active' = odblokowanie (7 dni ochrony przed auto-zawieszeniem)
create or replace function public.sa_set_status(p_club uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._require_superadmin();
  if p_status = 'suspended' then
    update public.platform_subscriptions set status = 'suspended', unlock_until = null, updated_at = now()
    where club_id = p_club;
  elsif p_status = 'active' then
    update public.platform_subscriptions set status = 'active', unlock_until = now() + interval '7 days', updated_at = now()
    where club_id = p_club;
  else
    raise exception 'Dozwolone statusy: active, suspended.';
  end if;
end $$;

create or replace function public.sa_void_invoice(p_invoice uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_club uuid;
begin
  perform public._require_superadmin();
  update public.platform_invoices set status = 'void' where id = p_invoice and status = 'unpaid'
  returning club_id into v_club;
  if v_club is not null then perform public._refresh_subscription(v_club); end if;
end $$;

-- =====================================================================
-- 6. UPRAWNIENIA
--   * anon (niezalogowany) nie ma dostępu do niczego.
--   * authenticated: odczyt wybranych kolumn (RLS filtruje wiersze),
--     wszystkie zapisy finansowe i zapisy na treningi tylko przez RPC.
-- =====================================================================

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- profiles: e-mail ukryty przed innymi członkami (dostępny dla Właściciela/Superadmina przez RPC)
grant select (id, full_name, avatar_url, is_superadmin, created_at) on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- clubs: bez pending_owner_email i licznika
grant select (id, name, prefix, invite_code, bank_account, bank_recipient, monthly_fee_amount,
              single_training_fee_amount, cancellation_deadline_hours, late_cancel_fee_enabled,
              default_max_participants, default_location, created_at)
  on public.clubs to authenticated;

-- club_members: bez aliasów (aliasy widzi tylko Właściciel przez admin_list_members)
grant select (id, club_id, user_id, role, status, billing_mode, member_code, position, joined_at, created_at)
  on public.club_members to authenticated;

grant select on public.trainings to authenticated;
grant insert (club_id, title, location, starts_at, ends_at, max_participants, notes) on public.trainings to authenticated;
grant update (title, location, starts_at, ends_at, max_participants, notes, status) on public.trainings to authenticated;
grant delete on public.trainings to authenticated;

grant select on public.training_signups to authenticated;
grant select on public.training_attendance to authenticated;
grant select on public.transactions to authenticated;
grant select on public.member_balances to authenticated;
grant select on public.platform_subscriptions to authenticated;
grant select on public.platform_invoices to authenticated;
grant select on public.platform_settings to authenticated;
grant select on public.billing_mode_changes to authenticated;
grant select on public.training_mvp_votes to authenticated;
grant select on public.training_coach_votes to authenticated;
grant update (platform_name, bank_account, bank_recipient, contact_email, updated_at) on public.platform_settings to authenticated;

-- funkcje używane w politykach RLS
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.club_role(uuid) to authenticated;
grant execute on function public.is_club_member(uuid) to authenticated;
grant execute on function public.is_club_staff(uuid) to authenticated;
grant execute on function public.is_club_owner(uuid) to authenticated;
grant execute on function public.shares_club_with(uuid) to authenticated;

-- publiczne RPC (każda sama sprawdza uprawnienia)
grant execute on function public.my_memberships() to authenticated;
grant execute on function public.invite_info(text) to authenticated;
grant execute on function public.join_club_by_code(text, text, text) to authenticated;
grant execute on function public.set_my_position(uuid, text) to authenticated;
grant execute on function public.vote_coach(uuid, uuid) to authenticated;
grant execute on function public.coach_votes(uuid) to authenticated;
grant execute on function public.vote_mvp(uuid, uuid) to authenticated;
grant execute on function public.mvp_votes(uuid) to authenticated;
grant execute on function public.set_member_position(uuid, text) to authenticated;
grant execute on function public.set_my_billing_mode(uuid, text) to authenticated;
grant execute on function public.club_context(uuid) to authenticated;
grant execute on function public.admin_list_members(uuid) to authenticated;
grant execute on function public.approve_member(uuid) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, text) to authenticated;
grant execute on function public.set_member_billing(uuid, text) to authenticated;
grant execute on function public.set_member_aliases(uuid, text[]) to authenticated;
grant execute on function public.update_club_settings(uuid, text, text, text, numeric, numeric, integer, integer, text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.set_late_cancel_fee(uuid, boolean) to authenticated;
grant execute on function public.join_training(uuid) to authenticated;
grant execute on function public.leave_training(uuid) to authenticated;
grant execute on function public.set_signup_flags(uuid, boolean, boolean) to authenticated;
grant execute on function public.staff_add_signup(uuid, uuid) to authenticated;
grant execute on function public.staff_remove_signup(uuid, uuid) to authenticated;
grant execute on function public.settle_training(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.club_stats(uuid, timestamptz) to authenticated;
grant execute on function public.team_overview(uuid) to authenticated;
grant execute on function public.member_history(uuid, uuid) to authenticated;
grant execute on function public.charge_monthly_fees(uuid, text) to authenticated;
grant execute on function public.add_manual_transaction(uuid, uuid, numeric, text, text, date) to authenticated;
grant execute on function public.delete_transaction(uuid) to authenticated;
grant execute on function public.check_bank_hashes(uuid, text[]) to authenticated;
grant execute on function public.import_bank_payments(uuid, jsonb) to authenticated;
grant execute on function public.sa_create_club(text, text, text, text, numeric) to authenticated;
grant execute on function public.sa_assign_owner(uuid, text) to authenticated;
grant execute on function public.sa_list_clubs() to authenticated;
grant execute on function public.sa_update_subscription(uuid, text, numeric, integer, integer) to authenticated;
grant execute on function public.sa_charge_month(uuid, text) to authenticated;
grant execute on function public.sa_charge_all(text) to authenticated;
grant execute on function public.sa_mark_paid(uuid) to authenticated;
grant execute on function public.sa_set_status(uuid, text) to authenticated;
grant execute on function public.sa_void_invoice(uuid) to authenticated;

-- Harmonogram: 1. dnia miesiąca o 05:00 UTC (06:00 zimą / 07:00 latem w Polsce)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'klubowicz-monthly-fees';
    perform cron.schedule('klubowicz-monthly-fees', '0 5 1 * *', 'select public._system_charge_monthly_fees()');
  end if;
end $$;

-- Realtime (opcjonalnie): odświeżanie listy zapisów na żywo. Bezpieczne – Realtime respektuje RLS.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.training_signups;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- =====================================================================
-- 7. DANE STARTOWE – VolleyClub Alternatywa (VCA)
-- =====================================================================

insert into public.platform_settings (id, platform_name, bank_account, bank_recipient, contact_email)
values (1, 'Klubowicz', null, null, null)
on conflict (id) do nothing;

insert into public.clubs (
  name, prefix, invite_code, bank_account, bank_recipient,
  monthly_fee_amount, single_training_fee_amount, cancellation_deadline_hours,
  default_max_participants, default_location
)
values (
  'VolleyClub Alternatywa', 'VCA', 'VCA-START2026',
  'PL61 1090 1014 0000 0712 1981 2874', 'VolleyClub Alternatywa',
  150.00, 40.00, 24, 14, 'Hala sportowa – ul. Sportowa 1'
)
on conflict (prefix) do nothing;

insert into public.platform_subscriptions (club_id, plan, monthly_amount)
select id, 'FREE', 0 from public.clubs where prefix = 'VCA'
on conflict (club_id) do nothing;

-- Przykładowe treningi: najbliższe 4 tygodnie, wtorki i czwartki 19:00–21:00 (czas polski)
insert into public.trainings (club_id, title, location, starts_at, ends_at, max_participants)
select c.id,
       'Trening siatkówki',
       c.default_location,
       ((d::date + time '19:00') at time zone 'Europe/Warsaw'),
       ((d::date + time '21:00') at time zone 'Europe/Warsaw'),
       c.default_max_participants
from public.clubs c,
     generate_series(current_date + 1, current_date + 28, interval '1 day') d
where c.prefix = 'VCA'
  and extract(isodow from d) in (2, 4)
  and not exists (select 1 from public.trainings t where t.club_id = c.id);

select 'Klubowicz: schemat zainstalowany poprawnie. Klub VCA, link zapraszający: /join/VCA-START2026' as status;
