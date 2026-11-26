-- =====================================================================
-- Proteção do link público de agendamento
--   - Limites por conexão (IP), por e-mail/telefone, por paciente e por clínica
--   - Registro de tentativas barradas (para o gerente do sistema)
--   - Captcha opcional (Cloudflare Turnstile) via Edge Function public-book
--   - Contador de acessos: 1 por conexão, por clínica, por dia
-- IPs, e-mails e telefones ficam só como hash (com chave secreta) e
-- são apagados após 7 dias (LGPD: minimização).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configurações (ajustáveis pelo gerente do sistema)
-- ---------------------------------------------------------------------
alter table platform_settings
  add column if not exists protect_ip_hour         int not null default 6  check (protect_ip_hour between 1 and 1000),
  add column if not exists protect_ip_day          int not null default 20 check (protect_ip_day between 1 and 5000),
  add column if not exists protect_contact_day     int not null default 4  check (protect_contact_day between 1 and 100),
  add column if not exists protect_active_per_contact int not null default 3 check (protect_active_per_contact between 1 and 50),
  add column if not exists protect_clinic_hour     int not null default 40 check (protect_clinic_hour between 1 and 5000),
  add column if not exists captcha_enabled         boolean not null default false,
  add column if not exists captcha_site_key        text;

-- ---------------------------------------------------------------------
-- Chave secreta para os hashes (fica no Vault)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'salus_rate_salt') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'salus_rate_salt',
                                'Chave dos hashes de proteção do link público');
  end if;
end $$;

create or replace function _rate_hash(p_value text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.digest(
    coalesce(p_value, '') || (select decrypted_secret from vault.decrypted_secrets where name = 'salus_rate_salt'),
    'sha256'), 'hex');
$$;
revoke all on function _rate_hash(text) from public, anon, authenticated;

-- IP de quem chamou a API (o Supabase recebe pelo Cloudflare: não dá para forjar).
create or replace function _client_ip() returns text
language sql stable as $$
  select nullif(btrim(coalesce(
    current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
    split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)
  )), '');
$$;

-- ---------------------------------------------------------------------
-- Registro de tentativas
-- ---------------------------------------------------------------------
create table if not exists public_rate_events (
  id        bigserial primary key,
  action    text not null,                 -- book | view
  key_hash  text not null,
  clinic_id uuid references clinics (id) on delete cascade,
  blocked   boolean not null default false,
  reason    text,
  at        timestamptz not null default now()
);
create index if not exists public_rate_events_key_idx on public_rate_events (action, key_hash, at desc);
create index if not exists public_rate_events_clinic_idx on public_rate_events (clinic_id, at desc);
create index if not exists public_rate_events_blocked_idx on public_rate_events (at desc) where blocked;
alter table public_rate_events enable row level security;  -- sem políticas: só funções do servidor

create or replace function _rate_count(p_action text, p_key text, p_since interval) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public_rate_events
  where action = p_action and key_hash = p_key and not blocked and at > now() - p_since;
$$;
revoke all on function _rate_count(text, text, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Agendamento público com limites
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'public_book'
             and pg_get_function_identity_arguments(oid) like 'p_slug text, p_procedure_id uuid, p_professional_id uuid, %')
     and not exists (select 1 from pg_proc where proname = '_public_book_core') then
    alter function public_book(text, uuid, uuid, timestamptz, appointment_modality, text, text, text, jsonb, boolean)
      rename to _public_book_core;
  end if;
end $$;
revoke all on function _public_book_core(text, uuid, uuid, timestamptz, appointment_modality, text, text, text, jsonb, boolean)
  from public, anon, authenticated;

-- Confere os limites; devolve o código do bloqueio (ou null) e registra a tentativa barrada.
create or replace function _public_book_guard(p_ip text, p_clinic_id uuid, p_email text, p_phone text)
returns text language plpgsql security definer set search_path = public as $$
declare
  s        platform_settings;
  v_ip     text := _rate_hash('ip:' || coalesce(p_ip, 'desconhecido'));
  v_email  text := _rate_hash('em:' || lower(btrim(coalesce(p_email, ''))));
  v_phone  text := _rate_hash('ph:' || regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'));
  v_reason text;
  v_active int;
begin
  select * into s from platform_settings where id = 1;

  if _rate_count('book', v_ip, interval '1 hour') >= s.protect_ip_hour
     or _rate_count('book', v_ip, interval '1 day') >= s.protect_ip_day then
    v_reason := 'RATE_LIMITED';
  elsif _rate_count('book', v_email, interval '1 day') >= s.protect_contact_day
     or _rate_count('book', v_phone, interval '1 day') >= s.protect_contact_day then
    v_reason := 'CONTACT_LIMIT';
  elsif (select count(*) from public_rate_events
         where action = 'book' and clinic_id = p_clinic_id and not blocked
           and at > now() - interval '1 hour') >= s.protect_clinic_hour then
    v_reason := 'CLINIC_BUSY';
  else
    select count(*) into v_active
    from appointments a join contacts ct on ct.id = a.contact_id
    where a.clinic_id = p_clinic_id
      and a.starts_at > now()
      and a.status in ('reservado', 'agendado', 'confirmado')
      and (lower(ct.email) = lower(btrim(coalesce(p_email, '')))
           or ct.phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'));
    if v_active >= s.protect_active_per_contact then v_reason := 'TOO_MANY_ACTIVE'; end if;
  end if;

  if v_reason is not null then
    insert into public_rate_events (action, key_hash, clinic_id, blocked, reason)
    values ('book', v_ip, p_clinic_id, true, v_reason);
  end if;
  return v_reason;
end $$;
revoke all on function _public_book_guard(text, uuid, text, text) from public, anon, authenticated;

-- Limites + agendamento. Bloqueio volta como {"error": "..."} (não como exceção),
-- para o registro da tentativa barrada não ser desfeito.
create or replace function _public_book_guarded(
  p_ip text, p_slug text, p_procedure_id uuid, p_professional_id uuid, p_starts_at timestamptz,
  p_modality appointment_modality, p_full_name text, p_email text, p_phone text, p_address jsonb, p_consent boolean
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_clinic uuid;
  v_block  text;
  v_result json;
begin
  select id into v_clinic from clinics where slug = p_slug and public_booking_enabled;
  if v_clinic is not null then
    v_block := _public_book_guard(p_ip, v_clinic, p_email, p_phone);
    if v_block is not null then return json_build_object('error', v_block); end if;
  end if;

  v_result := _public_book_core(p_slug, p_procedure_id, p_professional_id, p_starts_at, p_modality,
                                p_full_name, p_email, p_phone, p_address, p_consent);

  insert into public_rate_events (action, key_hash, clinic_id) values
    ('book', _rate_hash('ip:' || coalesce(p_ip, 'desconhecido')), v_clinic),
    ('book', _rate_hash('em:' || lower(btrim(coalesce(p_email, '')))), v_clinic),
    ('book', _rate_hash('ph:' || regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')), v_clinic);
  return v_result;
end $$;
revoke all on function _public_book_guarded(text, text, uuid, uuid, timestamptz, appointment_modality, text, text, text, jsonb, boolean)
  from public, anon, authenticated;

-- Chamada direta pelo site (sem captcha).
create or replace function public_book(
  p_slug text, p_procedure_id uuid, p_professional_id uuid, p_starts_at timestamptz,
  p_modality appointment_modality, p_full_name text, p_email text, p_phone text, p_address jsonb, p_consent boolean
) returns json language plpgsql security definer set search_path = public as $$
begin
  if (select captcha_enabled from platform_settings where id = 1) then
    return json_build_object('error', 'CAPTCHA_REQUIRED');
  end if;
  return _public_book_guarded(_client_ip(), p_slug, p_procedure_id, p_professional_id, p_starts_at, p_modality,
                              p_full_name, p_email, p_phone, p_address, p_consent);
end $$;
revoke all on function public_book(text, uuid, uuid, timestamptz, appointment_modality, text, text, text, jsonb, boolean) from public;
grant execute on function public_book(text, uuid, uuid, timestamptz, appointment_modality, text, text, text, jsonb, boolean)
  to anon, authenticated;

-- Chamada pela Edge Function public-book depois de validar o captcha (só service_role).
create or replace function public_book_verified(
  p_ip text, p_slug text, p_procedure_id uuid, p_professional_id uuid, p_starts_at timestamptz,
  p_modality appointment_modality, p_full_name text, p_email text, p_phone text, p_address jsonb, p_consent boolean
) returns json language sql security definer set search_path = public as $$
  select _public_book_guarded(p_ip, p_slug, p_procedure_id, p_professional_id, p_starts_at, p_modality,
                              p_full_name, p_email, p_phone, p_address, p_consent);
$$;
revoke all on function public_book_verified(text, text, uuid, uuid, timestamptz, appointment_modality, text, text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public_book_verified(text, text, uuid, uuid, timestamptz, appointment_modality, text, text, text, jsonb, boolean)
  to service_role;

-- ---------------------------------------------------------------------
-- Acessos ao link: uma vez por conexão, por clínica, por dia
-- ---------------------------------------------------------------------
create or replace function public_track_view(p_slug text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id  uuid;
  v_key text;
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select id into v_id from clinics where slug = p_slug;
  if v_id is null then return; end if;
  v_key := _rate_hash('ip:' || coalesce(_client_ip(), 'desconhecido') || ':' || v_day);
  if exists (select 1 from public_rate_events where action = 'view' and key_hash = v_key and clinic_id = v_id) then
    return;
  end if;
  insert into public_rate_events (action, key_hash, clinic_id) values ('view', v_key, v_id);
  insert into portal_daily_stats (clinic_id, day, views) values (v_id, v_day, 1)
  on conflict (clinic_id, day) do update set views = portal_daily_stats.views + 1;
end $$;
revoke all on function public_track_view(text) from public;
grant execute on function public_track_view(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Portal: chave pública do captcha (quando ligado)
-- ---------------------------------------------------------------------
create or replace function public_clinic(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', c.id,
    'slug', c.slug,
    'name', c.name,
    'phone', c.phone,
    'email', c.email,
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
    'about', c.about,
    'gallery', c.gallery,
    'captcha_site_key', (select case when s.captcha_enabled then s.captcha_site_key end
                         from platform_settings s where s.id = 1),
    'procedures', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'description', p.description,
        'duration_min', p.duration_min, 'price', p.price,
        'allows_clinic', p.allows_clinic, 'allows_home_care', p.allows_home_care,
        'image_url', p.image_url, 'video_url', p.video_url
      ) order by p.sort_order, p.name)
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
        'photo_url', pf.photo_url, 'bio', pf.bio,
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
-- Painel do gerente do sistema: tentativas barradas
-- ---------------------------------------------------------------------
create or replace function platform_protection_stats() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  return json_build_object(
    'blocked_24h', (select count(*) from public_rate_events where blocked and at > now() - interval '1 day'),
    'blocked_7d',  (select count(*) from public_rate_events where blocked and at > now() - interval '7 days'),
    'bookings_24h', (select count(*) / 3 from public_rate_events where action = 'book' and not blocked
                     and at > now() - interval '1 day'),
    'by_reason', coalesce((select json_object_agg(reason, n) from (
        select reason, count(*) n from public_rate_events
        where blocked and at > now() - interval '7 days' group by reason) r), '{}'::json),
    'by_clinic', coalesce((select json_agg(x order by x.n desc) from (
        select c.name, c.slug, count(*) n from public_rate_events e join clinics c on c.id = e.clinic_id
        where e.blocked and e.at > now() - interval '7 days' group by c.name, c.slug order by count(*) desc limit 5) x),
      '[]'::json)
  );
end $$;
revoke all on function platform_protection_stats() from public, anon;
grant execute on function platform_protection_stats() to authenticated;

-- ---------------------------------------------------------------------
-- Limpeza diária (LGPD): apaga registros com mais de 7 dias
-- ---------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'salus-rate-cleanup';
select cron.schedule('salus-rate-cleanup', '30 9 * * *',
  $$delete from public.public_rate_events where at < now() - interval '7 days'$$);
