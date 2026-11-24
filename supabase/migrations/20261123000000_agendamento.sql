-- =====================================================================
-- SalusEtQualitas — Módulo de Agendamento
-- Esquema completo (agenda interna + portal público + dashboard).
-- Segurança: RLS em todas as tabelas. O usuário anônimo (portal público)
-- NÃO acessa tabelas diretamente — só as funções public_* (RNF05/LGPD).
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type appointment_status as enum (
  'agendado', 'reservado', 'confirmado', 'nao_compareceu', 'concluido', 'cancelado'
);                                                        -- RF05
create type appointment_modality as enum ('clinica', 'residencial');   -- RF10
create type appointment_channel as enum (
  'interno', 'portal', 'whatsapp', 'telefone', 'instagram', 'outro'
);                                                        -- RF14 (por canal)
create type contact_status as enum ('lead', 'pre_cadastro', 'paciente'); -- RN01
create type event_kind as enum ('reuniao', 'feriado', 'folga', 'outro'); -- RF07
create type waitlist_status as enum ('aguardando', 'encaixado', 'desistiu'); -- RF06
create type member_role as enum ('admin', 'recepcao', 'profissional');

-- ---------------------------------------------------------------------
-- Clínica e equipe
-- ---------------------------------------------------------------------
create table clinics (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'), -- RF08
  name                   text not null,
  phone                  text,
  email                  text,
  address                text,
  timezone               text not null default 'America/Sao_Paulo',
  public_booking_enabled boolean not null default true,
  -- RN04: status de entrada dos agendamentos do portal
  public_booking_status  appointment_status not null default 'reservado'
                         check (public_booking_status in ('reservado', 'agendado')),
  slot_interval_min      int not null default 30 check (slot_interval_min between 5 and 240),
  min_notice_min         int not null default 120 check (min_notice_min >= 0),
  max_days_ahead         int not null default 60 check (max_days_ahead between 1 and 365),
  created_at             timestamptz not null default now()
);

create table clinic_members (
  clinic_id  uuid not null references clinics(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null default 'recepcao',
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table professionals (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references clinics(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  name              text not null,
  specialty         text,
  color             text,
  active            boolean not null default true,
  public_visible    boolean not null default true,
  home_care_enabled boolean not null default false,
  -- RN03: tempo de deslocamento (antes e depois) em atendimentos residenciais
  travel_buffer_min int not null default 30 check (travel_buffer_min between 0 and 240),
  created_at        timestamptz not null default now(),
  unique (id, clinic_id)
);

create table rooms (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);

create table procedures (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  name             text not null,
  description      text,
  duration_min     int not null check (duration_min between 5 and 720),
  price            numeric(10, 2),
  allows_clinic    boolean not null default true,
  allows_home_care boolean not null default false,
  requires_room    boolean not null default true,
  public_visible   boolean not null default true,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (id, clinic_id),
  check (allows_clinic or allows_home_care)
);

create table professional_procedures (
  professional_id uuid not null references professionals(id) on delete cascade,
  procedure_id    uuid not null references procedures(id) on delete cascade,
  primary key (professional_id, procedure_id)
);

-- Restringe em quais salas um procedimento pode ocorrer.
-- Sem linhas para o procedimento = qualquer sala ativa serve.
create table procedure_rooms (
  procedure_id uuid not null references procedures(id) on delete cascade,
  room_id      uuid not null references rooms(id) on delete cascade,
  primary key (procedure_id, room_id)
);

-- RF13: horário de trabalho (horário local da clínica; 0 = domingo)
create table working_hours (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  weekday         smallint not null check (weekday between 0 and 6),
  start_time      time not null,
  end_time        time not null,
  check (end_time > start_time)
);
create index on working_hours (professional_id, weekday);

-- RF13: pausas/intervalos recorrentes
create table professional_breaks (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  weekday         smallint not null check (weekday between 0 and 6),
  start_time      time not null,
  end_time        time not null,
  label           text,
  check (end_time > start_time)
);
create index on professional_breaks (professional_id, weekday);

-- ---------------------------------------------------------------------
-- Contatos / pacientes (RN01)
-- ---------------------------------------------------------------------
create table contacts (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  full_name   text not null,
  email       text,
  phone       text check (phone ~ '^\d{10,13}$'),   -- só dígitos
  status      contact_status not null default 'lead',
  insurance   text,                                 -- convênio (RF14)
  cep         text,
  street      text,
  number      text,
  complement  text,
  district    text,
  city        text,
  state       text,
  source      appointment_channel not null default 'interno',
  consent_at  timestamptz,                          -- aceite LGPD
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, clinic_id)
);
create unique index contacts_email_uq on contacts (clinic_id, lower(email)) where email is not null;
create unique index contacts_phone_uq on contacts (clinic_id, phone) where phone is not null;

-- ---------------------------------------------------------------------
-- Agendamentos
-- ---------------------------------------------------------------------
create table appointments (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  contact_id      uuid not null,
  professional_id uuid not null,
  procedure_id    uuid not null,
  room_id         uuid,
  modality        appointment_modality not null default 'clinica',
  status          appointment_status not null default 'agendado',
  channel         appointment_channel not null default 'interno',
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  -- Janela que o profissional fica ocupado (inclui deslocamento). Mantida por trigger.
  buffer_min      int not null default 0,
  busy_start      timestamptz not null,
  busy_end        timestamptz not null,
  insurance       text,
  price           numeric(10, 2),
  -- endereço do atendimento residencial (RF11)
  address_cep        text,
  address_street     text,
  address_number     text,
  address_complement text,
  address_district   text,
  address_city       text,
  address_state      text,
  notes           text,
  cancel_reason   text,                              -- RF03
  cancelled_at    timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  foreign key (contact_id, clinic_id)      references contacts(id, clinic_id),
  foreign key (professional_id, clinic_id) references professionals(id, clinic_id),
  foreign key (procedure_id, clinic_id)    references procedures(id, clinic_id),
  foreign key (room_id, clinic_id)         references rooms(id, clinic_id),
  check (ends_at > starts_at),
  check (modality = 'clinica' or (
    address_cep is not null and address_street is not null and address_number is not null
    and address_district is not null and address_city is not null and address_state is not null
  )),

  -- RNF03 / RN03: o banco recusa overbooking, mesmo em requisições simultâneas.
  constraint appointments_no_professional_overlap exclude using gist (
    professional_id with =, tstzrange(busy_start, busy_end, '[)') with &&
  ) where (status <> 'cancelado'),
  constraint appointments_no_room_overlap exclude using gist (
    room_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (room_id is not null and status <> 'cancelado')
);
create index on appointments (clinic_id, starts_at);
create index on appointments (contact_id);

create function appointments_before_write() returns trigger
language plpgsql set search_path = public as $$
declare
  v_duration int;
begin
  if new.ends_at is null or new.ends_at <= new.starts_at then
    select duration_min into v_duration from procedures where id = new.procedure_id;
    new.ends_at := new.starts_at + make_interval(mins => v_duration);
  end if;

  if new.modality = 'residencial' then
    select travel_buffer_min into new.buffer_min from professionals where id = new.professional_id;
    new.room_id := null;
  else
    new.buffer_min := 0;
  end if;
  new.buffer_min := coalesce(new.buffer_min, 0);
  new.busy_start := new.starts_at - make_interval(mins => new.buffer_min);
  new.busy_end   := new.ends_at   + make_interval(mins => new.buffer_min);

  if new.status = 'cancelado' and (tg_op = 'INSERT' or old.status <> 'cancelado') then
    new.cancelled_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger appointments_before_write
  before insert or update on appointments
  for each row execute function appointments_before_write();

-- ---------------------------------------------------------------------
-- RF07: Eventos / bloqueios
--   professional_id e room_id nulos = bloqueia a clínica inteira (feriado).
-- ---------------------------------------------------------------------
create table schedule_events (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  professional_id uuid,
  room_id         uuid,
  kind            event_kind not null default 'outro',
  title           text not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (professional_id, clinic_id) references professionals(id, clinic_id) on delete cascade,
  foreign key (room_id, clinic_id)         references rooms(id, clinic_id) on delete cascade,
  check (ends_at > starts_at)
);
create index on schedule_events (clinic_id, starts_at);

-- ---------------------------------------------------------------------
-- RF06: Lista de espera
-- ---------------------------------------------------------------------
create table waitlist (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  contact_id      uuid not null,
  professional_id uuid,
  procedure_id    uuid,
  desired_date    date,
  desired_from    time,
  desired_to      time,
  notes           text,
  status          waitlist_status not null default 'aguardando',
  created_at      timestamptz not null default now(),
  foreign key (contact_id, clinic_id)      references contacts(id, clinic_id) on delete cascade,
  foreign key (professional_id, clinic_id) references professionals(id, clinic_id),
  foreign key (procedure_id, clinic_id)    references procedures(id, clinic_id)
);
create index on waitlist (clinic_id, status);

-- =====================================================================
-- RLS — somente membros da clínica
-- =====================================================================
create function is_clinic_member(p_clinic_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clinic_members where clinic_id = p_clinic_id and user_id = auth.uid()
  );
$$;

alter table clinics                 enable row level security;
alter table clinic_members          enable row level security;
alter table professionals           enable row level security;
alter table rooms                   enable row level security;
alter table procedures              enable row level security;
alter table professional_procedures enable row level security;
alter table procedure_rooms         enable row level security;
alter table working_hours           enable row level security;
alter table professional_breaks     enable row level security;
alter table contacts                enable row level security;
alter table appointments            enable row level security;
alter table schedule_events         enable row level security;
alter table waitlist                enable row level security;

create policy clinics_select on clinics for select to authenticated using (is_clinic_member(id));
create policy clinics_update on clinics for update to authenticated
  using (is_clinic_member(id)) with check (is_clinic_member(id));

create policy members_select on clinic_members for select to authenticated
  using (is_clinic_member(clinic_id));

do $$
declare t text;
begin
  foreach t in array array['professionals', 'rooms', 'procedures', 'contacts',
                           'appointments', 'schedule_events', 'waitlist'] loop
    execute format(
      'create policy %1$s_member on %1$I for all to authenticated
         using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id))', t);
  end loop;

  foreach t in array array['professional_procedures', 'working_hours', 'professional_breaks'] loop
    execute format(
      'create policy %1$s_member on %1$I for all to authenticated
         using (exists (select 1 from professionals p
                        where p.id = professional_id and is_clinic_member(p.clinic_id)))
         with check (exists (select 1 from professionals p
                        where p.id = professional_id and is_clinic_member(p.clinic_id)))', t);
  end loop;
end $$;

create policy procedure_rooms_member on procedure_rooms for all to authenticated
  using (exists (select 1 from procedures p where p.id = procedure_id and is_clinic_member(p.clinic_id)))
  with check (exists (select 1 from procedures p where p.id = procedure_id and is_clinic_member(p.clinic_id)));

-- =====================================================================
-- Disponibilidade (RF13 + RN03)
-- =====================================================================

-- Verifica se um horário é livre para um profissional.
-- Devolve o_ok e, quando o procedimento precisa de sala na clínica, a sala escolhida.
create function _check_slot(
  p_clinic_id   uuid,
  p_timezone    text,
  p_prof_id     uuid,
  p_buffer_min  int,
  p_proc_id     uuid,
  p_duration    int,
  p_needs_room  boolean,
  p_modality    appointment_modality,
  p_start       timestamptz,
  out o_ok      boolean,
  out o_room_id uuid
)
language plpgsql stable set search_path = public as $$
declare
  v_end       timestamptz := p_start + make_interval(mins => p_duration);
  v_buf       int := case when p_modality = 'residencial' then p_buffer_min else 0 end;
  v_busy      tstzrange;
  v_slot      tstzrange := tstzrange(p_start, v_end, '[)');
  v_local     timestamp := p_start at time zone p_timezone;
  v_day       date := v_local::date;
  v_off_start interval := v_local - v_day;
  v_off_end   interval := (v_end at time zone p_timezone) - v_day;
  v_dow       int := extract(dow from v_day)::int;
begin
  o_ok := false;
  o_room_id := null;
  v_busy := tstzrange(p_start - make_interval(mins => v_buf), v_end + make_interval(mins => v_buf), '[)');

  -- dentro de um bloco de trabalho
  if not exists (
    select 1 from working_hours w
    where w.professional_id = p_prof_id and w.weekday = v_dow
      and w.start_time::interval <= v_off_start and w.end_time::interval >= v_off_end
  ) then return; end if;

  -- fora das pausas
  if exists (
    select 1 from professional_breaks b
    where b.professional_id = p_prof_id and b.weekday = v_dow
      and b.start_time::interval < v_off_end and b.end_time::interval > v_off_start
  ) then return; end if;

  -- sem bloqueios do profissional ou da clínica inteira
  if exists (
    select 1 from schedule_events e
    where e.clinic_id = p_clinic_id
      and (e.professional_id = p_prof_id or (e.professional_id is null and e.room_id is null))
      and tstzrange(e.starts_at, e.ends_at, '[)') && v_busy
  ) then return; end if;

  -- sem outro agendamento (considerando o deslocamento)
  if exists (
    select 1 from appointments a
    where a.professional_id = p_prof_id and a.status <> 'cancelado'
      and tstzrange(a.busy_start, a.busy_end, '[)') && v_busy
  ) then return; end if;

  -- sala livre (atendimento na clínica)
  if p_modality = 'clinica' and p_needs_room then
    select r.id into o_room_id
    from rooms r
    where r.clinic_id = p_clinic_id and r.active
      and (
        not exists (select 1 from procedure_rooms pr where pr.procedure_id = p_proc_id)
        or exists (select 1 from procedure_rooms pr where pr.procedure_id = p_proc_id and pr.room_id = r.id)
      )
      and not exists (
        select 1 from appointments a
        where a.room_id = r.id and a.status <> 'cancelado'
          and tstzrange(a.starts_at, a.ends_at, '[)') && v_slot
      )
      and not exists (
        select 1 from schedule_events e
        where e.room_id = r.id and tstzrange(e.starts_at, e.ends_at, '[)') && v_slot
      )
    order by r.name
    limit 1;
    if o_room_id is null then return; end if;
  end if;

  o_ok := true;
end $$;

-- =====================================================================
-- API pública (portal do paciente, sem login) — RF08..RF12, RN01, RN03, RN04
-- =====================================================================

-- Dados públicos da clínica: serviços e profissionais visíveis.
create function public_clinic(p_slug text) returns json
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

-- Horários livres de um dia (data local da clínica).
-- p_professional_id nulo = qualquer profissional habilitado.
create function public_available_slots(
  p_slug            text,
  p_procedure_id    uuid,
  p_modality        appointment_modality,
  p_date            date,
  p_professional_id uuid default null
)
returns table (starts_at timestamptz, professional_id uuid, professional_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  c       clinics;
  pr      procedures;
  prof    professionals;
  w       working_hours;
  t       interval;
  v_start timestamptz;
  v_min   timestamptz;
  v_today date;
  chk     record;
begin
  select * into c from clinics where slug = p_slug and public_booking_enabled;
  if not found then raise exception 'CLINIC_NOT_FOUND'; end if;

  select * into pr from procedures
  where id = p_procedure_id and clinic_id = c.id and active and public_visible;
  if not found then raise exception 'PROCEDURE_NOT_FOUND'; end if;

  if (p_modality = 'clinica' and not pr.allows_clinic)
     or (p_modality = 'residencial' and not pr.allows_home_care) then
    raise exception 'MODALITY_NOT_ALLOWED';
  end if;

  v_today := (now() at time zone c.timezone)::date;
  if p_date < v_today or p_date > v_today + c.max_days_ahead then return; end if;
  v_min := now() + make_interval(mins => c.min_notice_min);

  for prof in
    select p.* from professionals p
    join professional_procedures pp on pp.professional_id = p.id and pp.procedure_id = pr.id
    where p.clinic_id = c.id and p.active and p.public_visible
      and (p_professional_id is null or p.id = p_professional_id)
      and (p_modality = 'clinica' or p.home_care_enabled)
  loop
    for w in
      select * from working_hours wh
      where wh.professional_id = prof.id and wh.weekday = extract(dow from p_date)::int
      order by wh.start_time
    loop
      t := w.start_time::interval;
      while t + make_interval(mins => pr.duration_min) <= w.end_time::interval loop
        v_start := (p_date + t) at time zone c.timezone;
        if v_start >= v_min then
          select * into chk from _check_slot(
            c.id, c.timezone, prof.id, prof.travel_buffer_min, pr.id,
            pr.duration_min, pr.requires_room, p_modality, v_start);
          if chk.o_ok then
            starts_at := v_start;
            professional_id := prof.id;
            professional_name := prof.name;
            return next;
          end if;
        end if;
        t := t + make_interval(mins => c.slot_interval_min);
      end loop;
    end loop;
  end loop;
end $$;

-- Confirma o agendamento do portal.
create function public_book(
  p_slug            text,
  p_procedure_id    uuid,
  p_professional_id uuid,
  p_starts_at       timestamptz,
  p_modality        appointment_modality,
  p_full_name       text,
  p_email           text,
  p_phone           text,
  p_address         jsonb default null,
  p_consent         boolean default false
)
returns json
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  c          clinics;
  pr         procedures;
  prof       professionals;
  chk        record;
  v_name     text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_email    text := lower(trim(coalesce(p_email, '')));
  v_phone    text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_cep      text;
  v_contact  uuid;
  v_appt     appointments;
begin
  if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED'; end if;

  select * into c from clinics where slug = p_slug and public_booking_enabled;
  if not found then raise exception 'CLINIC_NOT_FOUND'; end if;

  select * into pr from procedures
  where id = p_procedure_id and clinic_id = c.id and active and public_visible;
  if not found then raise exception 'PROCEDURE_NOT_FOUND'; end if;

  if (p_modality = 'clinica' and not pr.allows_clinic)
     or (p_modality = 'residencial' and not pr.allows_home_care) then
    raise exception 'MODALITY_NOT_ALLOWED';
  end if;

  select p.* into prof from professionals p
  where p.id = p_professional_id and p.clinic_id = c.id and p.active and p.public_visible
    and (p_modality = 'clinica' or p.home_care_enabled)
    and exists (select 1 from professional_procedures pp
                where pp.professional_id = p.id and pp.procedure_id = pr.id);
  if not found then raise exception 'PROFESSIONAL_NOT_FOUND'; end if;

  -- RF09: dados essenciais
  if length(v_name) < 3 or position(' ' in v_name) = 0 or length(v_name) > 150 then
    raise exception 'INVALID_NAME';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'INVALID_EMAIL';
  end if;
  if length(v_phone) not between 10 and 13 then raise exception 'INVALID_PHONE'; end if;

  -- RF11: endereço obrigatório no residencial
  if p_modality = 'residencial' then
    v_cep := regexp_replace(coalesce(p_address->>'cep', ''), '\D', '', 'g');
    if length(v_cep) <> 8
       or coalesce(trim(p_address->>'street'), '') = ''
       or coalesce(trim(p_address->>'number'), '') = ''
       or coalesce(trim(p_address->>'district'), '') = ''
       or coalesce(trim(p_address->>'city'), '') = ''
       or coalesce(trim(p_address->>'state'), '') !~ '^[A-Za-z]{2}$' then
      raise exception 'INVALID_ADDRESS';
    end if;
  end if;

  if p_starts_at < now() + make_interval(mins => c.min_notice_min)
     or p_starts_at > now() + make_interval(days => c.max_days_ahead + 1) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- Serializa reservas da mesma clínica para escolher sala sem corrida.
  perform pg_advisory_xact_lock(hashtextextended(c.id::text, 0));

  select * into chk from _check_slot(
    c.id, c.timezone, prof.id, prof.travel_buffer_min, pr.id,
    pr.duration_min, pr.requires_room, p_modality, p_starts_at);
  if not chk.o_ok then raise exception 'SLOT_UNAVAILABLE'; end if;

  -- RN01: match de contato por e-mail, depois por telefone
  select id into v_contact from contacts
  where clinic_id = c.id and lower(email) = v_email limit 1;
  if v_contact is null then
    select id into v_contact from contacts
    where clinic_id = c.id and phone = v_phone limit 1;
  end if;

  if v_contact is null then
    insert into contacts (clinic_id, full_name, email, phone, status, source, consent_at,
                          cep, street, number, complement, district, city, state)
    values (c.id, v_name, v_email, v_phone, 'lead', 'portal', now(),
            v_cep, p_address->>'street', p_address->>'number', p_address->>'complement',
            p_address->>'district', p_address->>'city', upper(p_address->>'state'))
    returning id into v_contact;
  else
    -- Não sobrescreve dados já curados pela recepção; só completa o que falta.
    update contacts set
      email      = coalesce(email, v_email),
      phone      = coalesce(phone, case when not exists (
                     select 1 from contacts o where o.clinic_id = c.id and o.phone = v_phone
                   ) then v_phone end),
      consent_at = coalesce(consent_at, now()),
      updated_at = now()
    where id = v_contact;
  end if;

  begin
    insert into appointments (
      clinic_id, contact_id, professional_id, procedure_id, room_id, modality,
      status, channel, starts_at, ends_at, price,
      address_cep, address_street, address_number, address_complement,
      address_district, address_city, address_state
    ) values (
      c.id, v_contact, prof.id, pr.id, chk.o_room_id, p_modality,
      c.public_booking_status, 'portal', p_starts_at,
      p_starts_at + make_interval(mins => pr.duration_min), pr.price,
      v_cep, p_address->>'street', p_address->>'number', p_address->>'complement',
      p_address->>'district', p_address->>'city', upper(p_address->>'state')
    )
    returning * into v_appt;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  return json_build_object(
    'appointment_id',    v_appt.id,
    'status',            v_appt.status,
    'starts_at',         v_appt.starts_at,
    'ends_at',           v_appt.ends_at,
    'modality',          v_appt.modality,
    'procedure_name',    pr.name,
    'professional_name', prof.name,
    'clinic_name',       c.name,
    'clinic_phone',      c.phone,
    'clinic_address',    c.address
  );
end $$;

-- ---------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------
revoke all on function _check_slot(uuid, text, uuid, int, uuid, int, boolean, appointment_modality, timestamptz)
  from public, anon, authenticated;
revoke all on function appointments_before_write() from public, anon, authenticated;
revoke all on function public_clinic(text) from public;
revoke all on function public_available_slots(text, uuid, appointment_modality, date, uuid) from public;
revoke all on function public_book(text, uuid, uuid, timestamptz, appointment_modality, text, text, text, jsonb, boolean)
  from public;

grant execute on function public_clinic(text) to anon, authenticated;
grant execute on function public_available_slots(text, uuid, appointment_modality, date, uuid)
  to anon, authenticated;
grant execute on function public_book(text, uuid, uuid, timestamptz, appointment_modality, text, text, text, jsonb, boolean)
  to anon, authenticated;

-- RNF03: agenda interna e dashboard recebem mudanças em tempo real
alter publication supabase_realtime add table appointments, schedule_events, waitlist;
