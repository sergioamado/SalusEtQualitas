-- =====================================================================
-- SalusEtQualitas — Etapa 2
--  * Gerente do sistema (admin da plataforma) vê e administra todas as clínicas
--  * Clínicas isoladas entre si (já garantido por RLS via clinic_members)
--  * Identidade visual editável: cores, fonte, logomarca e foto de fundo
--  * Integração com Google Agenda (gatilho -> Edge Function)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Gerente do sistema
-- ---------------------------------------------------------------------
create table platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;

create function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create policy platform_admins_select on platform_admins for select to authenticated
  using (user_id = auth.uid() or is_platform_admin());

-- Membro da clínica OU gerente do sistema. Todas as políticas da etapa 1
-- usam esta função, então o admin passa a enxergar tudo automaticamente.
create or replace function is_clinic_member(p_clinic_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists (
    select 1 from clinic_members where clinic_id = p_clinic_id and user_id = auth.uid()
  );
$$;

-- Gerente da clínica (papel 'admin' na clínica) OU gerente do sistema.
create function can_manage_clinic(p_clinic_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists (
    select 1 from clinic_members
    where clinic_id = p_clinic_id and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Só o gerente da clínica (ou do sistema) altera os dados da clínica.
drop policy clinics_update on clinics;
create policy clinics_update on clinics for update to authenticated
  using (can_manage_clinic(id)) with check (can_manage_clinic(id));
create policy clinics_insert on clinics for insert to authenticated with check (is_platform_admin());
create policy clinics_delete on clinics for delete to authenticated using (is_platform_admin());

-- Equipe: leitura pela clínica; alterações pelo gerente da clínica ou do sistema
-- (a criação de usuários com senha é feita pela Edge Function admin-users).
create policy members_manage on clinic_members for all to authenticated
  using (can_manage_clinic(clinic_id)) with check (can_manage_clinic(clinic_id));

-- O link público (slug) só muda pelo gerente do sistema.
create function clinics_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.slug is distinct from old.slug and not is_platform_admin() then
    raise exception 'Somente o gerente do sistema pode alterar o link da clínica.';
  end if;
  return new;
end $$;
create trigger clinics_guard before update on clinics
  for each row execute function clinics_guard();

-- ---------------------------------------------------------------------
-- Identidade visual e contato
-- ---------------------------------------------------------------------
alter table clinics
  add column logo_url        text,
  add column cover_url       text,
  add column primary_color   text not null default '#0E7C74' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column secondary_color text not null default '#13201F' check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column font_family     text not null default 'system'
                             check (font_family in ('system', 'inter', 'poppins', 'montserrat', 'lora', 'playfair')),
  add column welcome_message text check (char_length(welcome_message) <= 280),
  add column whatsapp        text,
  add column instagram       text,
  -- Google Agenda
  add column google_notify_enabled boolean not null default false,
  add column google_calendar_id    text;

alter table appointments
  add column google_event_id   text,
  add column google_synced_at  timestamptz,
  add column google_sync_error text;

-- Portal público passa a receber a identidade visual.
create or replace function public_clinic(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', c.id,
    'slug', c.slug,
    'name', c.name,
    'phone', c.phone,
    'address', c.address,
    'timezone', c.timezone,
    'max_days_ahead', c.max_days_ahead,
    'auto_confirm', c.public_booking_status = 'agendado',
    'logo_url', c.logo_url,
    'cover_url', c.cover_url,
    'primary_color', c.primary_color,
    'secondary_color', c.secondary_color,
    'font_family', c.font_family,
    'welcome_message', c.welcome_message,
    'whatsapp', c.whatsapp,
    'instagram', c.instagram,
    'procedures', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'description', p.description,
        'duration_min', p.duration_min, 'price', p.price,
        'allows_clinic', p.allows_clinic, 'allows_home_care', p.allows_home_care
      ) order by p.name)
      from procedures p
      where p.clinic_id = c.id and p.active and p.public_visible
        and exists (
          select 1 from professional_procedures pp
          join professionals pf on pf.id = pp.professional_id
          where pp.procedure_id = p.id and pf.active and pf.public_visible
        )
    ), '[]'::json),
    'professionals', coalesce((
      select json_agg(json_build_object(
        'id', pf.id, 'name', pf.name, 'specialty', pf.specialty,
        'home_care_enabled', pf.home_care_enabled,
        'procedure_ids', coalesce((
          select json_agg(pp.procedure_id) from professional_procedures pp
          where pp.professional_id = pf.id
        ), '[]'::json)
      ) order by pf.name)
      from professionals pf
      where pf.clinic_id = c.id and pf.active and pf.public_visible
    ), '[]'::json)
  )
  from clinics c
  where c.slug = p_slug and c.public_booking_enabled;
$$;

-- ---------------------------------------------------------------------
-- Fotos (logomarca e fundo) — Storage
--   Caminho: clinic-assets/<clinic_id>/<arquivo>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-assets', 'clinic-assets', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy clinic_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinic-assets' and exists (
    select 1 from public.clinics c
    where c.id::text = (storage.foldername(objects.name))[1] and public.can_manage_clinic(c.id)));
create policy clinic_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'clinic-assets' and exists (
    select 1 from public.clinics c
    where c.id::text = (storage.foldername(objects.name))[1] and public.can_manage_clinic(c.id)));
create policy clinic_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'clinic-assets' and exists (
    select 1 from public.clinics c
    where c.id::text = (storage.foldername(objects.name))[1] and public.can_manage_clinic(c.id)));

-- ---------------------------------------------------------------------
-- Google Agenda: a cada agendamento novo/alterado, chama a Edge Function.
-- Requer dois segredos no Vault (veja README):
--   salus_functions_url  = https://<projeto>.supabase.co/functions/v1
--   salus_webhook_secret = um texto aleatório (igual ao segredo da função)
-- ---------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create function notify_google_calendar() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_enabled boolean;
  v_url     text;
  v_secret  text;
begin
  select google_notify_enabled and coalesce(google_calendar_id, '') <> ''
    into v_enabled from clinics where id = new.clinic_id;
  if not coalesce(v_enabled, false) then return new; end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'salus_functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'salus_webhook_secret';
  if v_url is null or v_secret is null then return new; end if;

  perform net.http_post(
    url     := v_url || '/google-calendar-sync',
    body    := jsonb_build_object('appointment_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret)
  );
  return new;
exception when others then
  -- Falha na notificação nunca impede o agendamento.
  return new;
end $$;

create trigger appointments_google_sync
  after insert or update of status, starts_at, ends_at, professional_id, procedure_id, modality, room_id
  on appointments
  for each row execute function notify_google_calendar();

revoke all on function notify_google_calendar() from public, anon, authenticated;
revoke all on function clinics_guard() from public, anon, authenticated;
