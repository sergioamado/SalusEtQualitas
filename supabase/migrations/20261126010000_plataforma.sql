-- =====================================================================
-- Gestão da plataforma (gerente do sistema)
--   - Planos e assinatura de cada clínica (cobrança manual)
--   - Pagamentos registrados e suspensão automática por atraso (pg_cron)
--   - Situação da clínica: teste, ativa, suspensa, cancelada
--   - Configurações de suporte e de cobrança
--   - Acessos ao link público (contador diário)
--   - Visão geral: consumo, movimento e saúde dos links
--   - Exclusão definitiva (chamada pela Edge Function admin-users)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Planos
-- ---------------------------------------------------------------------
create table if not exists plans (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(btrim(name)) between 2 and 60),
  description       text check (char_length(description) <= 300),
  price_monthly     numeric(10,2) not null default 0 check (price_monthly >= 0),
  max_professionals int check (max_professionals > 0),
  active            boolean not null default true,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);
alter table plans enable row level security;
drop policy if exists plans_select on plans;
create policy plans_select on plans for select to authenticated using (true);
drop policy if exists plans_admin on plans;
create policy plans_admin on plans for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

-- ---------------------------------------------------------------------
-- Assinatura e situação da clínica
-- ---------------------------------------------------------------------
alter table clinics
  add column if not exists status text not null default 'ativa'
    check (status in ('teste', 'ativa', 'suspensa', 'cancelada')),
  add column if not exists plan_id       uuid references plans (id) on delete set null,
  add column if not exists monthly_price numeric(10,2) check (monthly_price >= 0),
  add column if not exists due_day       smallint check (due_day between 1 and 28),
  add column if not exists next_due_date date,
  add column if not exists trial_ends_on date,
  add column if not exists suspended_at  timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists booking_before_suspension boolean;

-- Anotações internas do gerente do sistema (a clínica não vê).
create table if not exists platform_clinic_notes (
  clinic_id  uuid primary key references clinics (id) on delete cascade,
  notes      text check (char_length(notes) <= 4000),
  updated_at timestamptz not null default now()
);
alter table platform_clinic_notes enable row level security;
drop policy if exists notes_admin on platform_clinic_notes;
create policy notes_admin on platform_clinic_notes for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

-- Guarda: link (slug), assinatura e situação só mudam pelo gerente do sistema
-- (ou por rotinas do servidor, sem usuário logado). Suspensa não reativa o link.
create or replace function clinics_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_staff boolean := auth.uid() is not null and not is_platform_admin();
begin
  if v_staff and new.slug is distinct from old.slug then
    raise exception 'Somente o gerente do sistema pode alterar o link da clínica.';
  end if;
  if v_staff and (
       new.status is distinct from old.status
    or new.plan_id is distinct from old.plan_id
    or new.monthly_price is distinct from old.monthly_price
    or new.due_day is distinct from old.due_day
    or new.next_due_date is distinct from old.next_due_date
    or new.trial_ends_on is distinct from old.trial_ends_on
    or new.suspended_at is distinct from old.suspended_at
    or new.suspended_reason is distinct from old.suspended_reason
    or new.booking_before_suspension is distinct from old.booking_before_suspension) then
    raise exception 'BILLING_ADMIN_ONLY';
  end if;
  if v_staff and new.status in ('suspensa', 'cancelada') and new.public_booking_enabled then
    raise exception 'CLINIC_SUSPENDED';
  end if;
  return new;
end $$;

-- Muda a situação cuidando do link público (desliga ao suspender, restaura ao reativar).
create or replace function _set_clinic_status(p_clinic_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c clinics;
begin
  select * into c from clinics where id = p_clinic_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_status not in ('teste', 'ativa', 'suspensa', 'cancelada') then raise exception 'INVALID_STATUS'; end if;

  if p_status in ('suspensa', 'cancelada') then
    update clinics set
      status = p_status,
      booking_before_suspension = case when c.status in ('suspensa', 'cancelada')
                                       then c.booking_before_suspension else c.public_booking_enabled end,
      public_booking_enabled = false,
      suspended_at = coalesce(case when c.status in ('suspensa', 'cancelada') then c.suspended_at end, now()),
      suspended_reason = nullif(btrim(coalesce(p_reason, '')), '')
    where id = p_clinic_id;
  else
    update clinics set
      status = p_status,
      public_booking_enabled = case when c.status in ('suspensa', 'cancelada')
                                    then coalesce(c.booking_before_suspension, true) else c.public_booking_enabled end,
      booking_before_suspension = null,
      suspended_at = null,
      suspended_reason = null
    where id = p_clinic_id;
  end if;
end $$;
revoke all on function _set_clinic_status(uuid, text, text) from public, anon, authenticated;

create or replace function admin_set_clinic_status(p_clinic_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  perform _set_clinic_status(p_clinic_id, p_status, p_reason);
end $$;
revoke all on function admin_set_clinic_status(uuid, text, text) from public, anon;
grant execute on function admin_set_clinic_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Pagamentos
-- ---------------------------------------------------------------------
create table if not exists clinic_payments (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics (id) on delete cascade,
  amount     numeric(10,2) not null check (amount > 0),
  paid_on    date not null default current_date,
  reference  text check (char_length(reference) <= 40),
  method     text not null default 'pix'
             check (method in ('pix', 'transferencia', 'boleto', 'cartao', 'dinheiro', 'outro')),
  notes      text check (char_length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists clinic_payments_clinic_idx on clinic_payments (clinic_id, paid_on desc);
alter table clinic_payments enable row level security;
drop policy if exists payments_select on clinic_payments;
create policy payments_select on clinic_payments for select to authenticated
  using (is_platform_admin() or can_manage_clinic(clinic_id));
drop policy if exists payments_admin on clinic_payments;
create policy payments_admin on clinic_payments for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

-- Próximo vencimento: um mês depois, no dia de vencimento combinado.
create or replace function _next_due(p_from date, p_due_day int) returns date
language sql immutable as $$
  select case when p_due_day is null then (p_from + interval '1 month')::date
         else make_date(extract(year from p_from + interval '1 month')::int,
                        extract(month from p_from + interval '1 month')::int,
                        p_due_day) end;
$$;

-- Registra um pagamento; por padrão avança o vencimento e reativa se estava suspensa por atraso.
create or replace function admin_register_payment(
  p_clinic_id uuid,
  p_amount    numeric,
  p_paid_on   date default current_date,
  p_method    text default 'pix',
  p_reference text default null,
  p_notes     text default null,
  p_advance   boolean default true
) returns json language plpgsql security definer set search_path = public as $$
declare
  c      clinics;
  v_id   uuid;
  v_next date;
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  select * into c from clinics where id = p_clinic_id;
  if not found then raise exception 'NOT_FOUND'; end if;

  insert into clinic_payments (clinic_id, amount, paid_on, method, reference, notes)
  values (p_clinic_id, p_amount, coalesce(p_paid_on, current_date), coalesce(p_method, 'pix'),
          nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;

  v_next := c.next_due_date;
  if p_advance then
    v_next := _next_due(coalesce(c.next_due_date, coalesce(p_paid_on, current_date)), c.due_day);
    update clinics set next_due_date = v_next where id = p_clinic_id;
  end if;

  if c.status = 'suspensa' and coalesce(c.suspended_reason, '') in ('Pagamento em atraso', 'Período de teste encerrado') then
    perform _set_clinic_status(p_clinic_id, 'ativa', null);
  elsif c.status = 'teste' then
    perform _set_clinic_status(p_clinic_id, 'ativa', null);
  end if;

  return json_build_object('payment_id', v_id, 'next_due_date', v_next);
end $$;
revoke all on function admin_register_payment(uuid, numeric, date, text, text, text, boolean) from public, anon;
grant execute on function admin_register_payment(uuid, numeric, date, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Configurações da plataforma (uma linha só)
-- ---------------------------------------------------------------------
create table if not exists platform_settings (
  id                   int primary key default 1 check (id = 1),
  product_name         text not null default 'Salus Et Qualitas',
  support_email        text,
  support_whatsapp     text,
  support_phone        text,
  support_hours        text check (char_length(support_hours) <= 120),
  support_message      text check (char_length(support_message) <= 500),
  billing_pix_key      text,
  billing_beneficiary  text,
  billing_instructions text check (char_length(billing_instructions) <= 1000),
  grace_days           int not null default 7 check (grace_days between 0 and 60),
  remind_days          int not null default 5 check (remind_days between 0 and 30),
  updated_at           timestamptz not null default now()
);
insert into platform_settings (id) values (1) on conflict (id) do nothing;
alter table platform_settings enable row level security;
drop policy if exists settings_select on platform_settings;
create policy settings_select on platform_settings for select to authenticated using (true);
drop policy if exists settings_admin on platform_settings;
create policy settings_admin on platform_settings for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

-- Contato de suporte também na tela de login (sem usuário logado).
create or replace function public_support() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'product_name', product_name, 'email', support_email, 'whatsapp', support_whatsapp,
    'phone', support_phone, 'hours', support_hours, 'message', support_message)
  from platform_settings where id = 1;
$$;
revoke all on function public_support() from public;
grant execute on function public_support() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Acessos ao link público (contador diário, sem dados pessoais)
-- ---------------------------------------------------------------------
create table if not exists portal_daily_stats (
  clinic_id uuid not null references clinics (id) on delete cascade,
  day       date not null,
  views     int not null default 0,
  primary key (clinic_id, day)
);
alter table portal_daily_stats enable row level security;
drop policy if exists stats_select on portal_daily_stats;
create policy stats_select on portal_daily_stats for select to authenticated
  using (is_platform_admin() or is_clinic_member(clinic_id));

create or replace function public_track_view(p_slug text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from clinics where slug = p_slug;
  if v_id is null then return; end if;
  insert into portal_daily_stats (clinic_id, day, views)
  values (v_id, (now() at time zone 'America/Sao_Paulo')::date, 1)
  on conflict (clinic_id, day) do update set views = portal_daily_stats.views + 1;
end $$;
revoke all on function public_track_view(text) from public;
grant execute on function public_track_view(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Rotina diária: suspende por atraso ou fim do teste
-- ---------------------------------------------------------------------
create or replace function platform_billing_tick() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_grace int;
  r       record;
  n       int := 0;
begin
  select grace_days into v_grace from platform_settings where id = 1;
  for r in
    select id, case when status = 'teste' then 'Período de teste encerrado' else 'Pagamento em atraso' end as reason
    from clinics
    where (status = 'ativa' and next_due_date is not null and next_due_date + coalesce(v_grace, 7) < current_date)
       or (status = 'teste' and trial_ends_on is not null and trial_ends_on + coalesce(v_grace, 7) < current_date)
  loop
    perform _set_clinic_status(r.id, 'suspensa', r.reason);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function platform_billing_tick() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'salus-billing-tick';
-- 09:15 UTC = 06:15 em Brasília
select cron.schedule('salus-billing-tick', '15 9 * * *', 'select public.platform_billing_tick()');

-- ---------------------------------------------------------------------
-- Visão geral do gerente do sistema
-- ---------------------------------------------------------------------
create or replace function platform_overview() returns json
language plpgsql stable security definer set search_path = public, storage, auth as $$
declare
  v_result json;
  v_grace  int;
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  select grace_days into v_grace from platform_settings where id = 1;

  with
  per as (
    select
      c.id, c.name, c.slug, c.status, c.created_at, c.public_booking_enabled,
      c.plan_id, p.name as plan_name, coalesce(c.monthly_price, p.price_monthly) as price,
      p.max_professionals, c.due_day, c.next_due_date, c.trial_ends_on, c.suspended_reason,
      c.google_notify_enabled,
      (select count(*) from appointments a where a.clinic_id = c.id) as appts_total,
      (select count(*) from appointments a where a.clinic_id = c.id and a.created_at >= now() - interval '30 days') as appts_30d,
      (select count(*) from appointments a where a.clinic_id = c.id and a.channel = 'portal'
                                             and a.created_at >= now() - interval '30 days') as portal_30d,
      (select count(*) from appointments a where a.clinic_id = c.id and a.starts_at >= now()
                                             and a.status <> 'cancelado') as upcoming,
      (select count(*) from contacts ct where ct.clinic_id = c.id) as contacts,
      (select count(*) from professionals pf where pf.clinic_id = c.id and pf.active) as professionals,
      (select count(*) from clinic_members m where m.clinic_id = c.id) as members,
      (select count(*) from procedures s where s.clinic_id = c.id and s.active and s.public_visible
          and exists (select 1 from professional_procedures pp join professionals pf on pf.id = pp.professional_id
                      where pp.procedure_id = s.id and pf.active and pf.public_visible)) as public_services,
      (select count(*) from professionals pf where pf.clinic_id = c.id and pf.active and pf.public_visible
          and exists (select 1 from working_hours w where w.professional_id = pf.id)) as pros_with_hours,
      (select coalesce(sum(views), 0) from portal_daily_stats s where s.clinic_id = c.id
                                                               and s.day >= current_date - 30) as views_30d,
      (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o
          where o.bucket_id = 'clinic-assets' and o.name like c.id::text || '/%') as storage_bytes,
      (select count(*) from appointments a where a.clinic_id = c.id and a.google_sync_error is not null
                                             and a.updated_at >= now() - interval '30 days') as google_errors_30d,
      (select max(u.last_sign_in_at) from clinic_members m join auth.users u on u.id = m.user_id
          where m.clinic_id = c.id) as last_sign_in,
      greatest(
        (select max(a.updated_at) from appointments a where a.clinic_id = c.id),
        (select max(ct.updated_at) from contacts ct where ct.clinic_id = c.id)) as last_activity,
      (select max(pay.paid_on) from clinic_payments pay where pay.clinic_id = c.id) as last_payment
    from clinics c
    left join plans p on p.id = c.plan_id
  ),
  enriched as (
    select per.*,
      case when per.next_due_date is not null and per.next_due_date < current_date
           then current_date - per.next_due_date else 0 end as days_overdue,
      array_remove(array[
        case when per.status in ('suspensa', 'cancelada') then 'Clínica ' || per.status end,
        case when per.status not in ('suspensa', 'cancelada') and not per.public_booking_enabled
             then 'Link desligado pela clínica' end,
        case when per.public_services = 0 then 'Nenhum serviço disponível no link' end,
        case when per.pros_with_hours = 0 then 'Nenhum profissional com horário' end,
        case when per.google_errors_30d > 0 then 'Erros na sincronização com o Google' end,
        case when per.max_professionals is not null and per.professionals > per.max_professionals
             then 'Acima do limite de profissionais do plano' end,
        case when per.status = 'ativa' and per.next_due_date is not null and per.next_due_date < current_date
             then 'Pagamento em atraso' end,
        case when per.status = 'ativa' and per.next_due_date is null and coalesce(per.price, 0) > 0
             then 'Sem data de vencimento' end
      ], null) as problems
    from per
  )
  select json_build_object(
    'generated_at', now(),
    'grace_days', coalesce(v_grace, 7),
    'totals', json_build_object(
      'clinics', (select count(*) from clinics),
      'by_status', coalesce((select json_object_agg(status, n) from (select status, count(*) n from clinics group by 1) s), '{}'::json),
      'mrr', coalesce((select sum(price) from enriched where status = 'ativa'), 0),
      'received_month', coalesce((select sum(amount) from clinic_payments
                                  where date_trunc('month', paid_on) = date_trunc('month', current_date)), 0),
      'overdue', (select count(*) from enriched where status = 'ativa' and days_overdue > 0),
      'with_problems', (select count(*) from enriched where cardinality(problems) > 0),
      'appts_30d', (select coalesce(sum(appts_30d), 0) from enriched),
      'portal_30d', (select coalesce(sum(portal_30d), 0) from enriched),
      'views_30d', (select coalesce(sum(views_30d), 0) from enriched),
      'users', (select count(*) from auth.users),
      'db_bytes', pg_database_size(current_database()),
      'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects)
    ),
    'clinics', coalesce((select json_agg(e order by e.name) from enriched e), '[]'::json)
  ) into v_result;
  return v_result;
end $$;
revoke all on function platform_overview() from public, anon;
grant execute on function platform_overview() to authenticated;

-- ---------------------------------------------------------------------
-- Exclusão definitiva (só pela Edge Function, com service role)
-- ---------------------------------------------------------------------
create or replace function admin_purge_clinic(p_clinic_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from appointments where clinic_id = p_clinic_id;
  delete from waitlist where clinic_id = p_clinic_id;
  delete from schedule_events where clinic_id = p_clinic_id;
  delete from clinics where id = p_clinic_id;
end $$;
revoke all on function admin_purge_clinic(uuid) from public, anon, authenticated;
grant execute on function admin_purge_clinic(uuid) to service_role;
