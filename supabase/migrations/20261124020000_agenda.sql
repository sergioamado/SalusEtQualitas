-- =====================================================================
-- Etapa 4 — Agenda interna (RF01–RF07, RNF04)
--   * staff_upsert_contact: acha o paciente por e-mail/telefone (RN01) ou cria.
--   * staff_save_appointment: cria, edita e remarca (inclusive ao arrastar),
--     com verificação de conflito. Fora do expediente, na pausa ou num bloqueio
--     a equipe pode "encaixar" confirmando (force = true). Choque com outro
--     agendamento do profissional ou falta de sala nunca passa (RN03/RNF03).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Verificação de horário para a equipe.
--   o_hard: impede sempre    — PROFESSIONAL_BUSY, NO_ROOM
--   o_soft: pede confirmação — OUTSIDE_HOURS, BREAK, BLOCKED
-- ---------------------------------------------------------------------
create or replace function _staff_slot_check(
  p_clinic_id   uuid,
  p_timezone    text,
  p_prof_id     uuid,
  p_buffer_min  int,
  p_proc_id     uuid,
  p_duration    int,
  p_needs_room  boolean,
  p_modality    appointment_modality,
  p_start       timestamptz,
  p_exclude_id  uuid,
  p_prefer_room uuid,
  out o_hard    text,
  out o_soft    text,
  out o_room_id uuid
)
language plpgsql stable set search_path = public as $$
declare
  v_end       timestamptz := p_start + make_interval(mins => p_duration);
  v_buf       int := case when p_modality = 'residencial' then coalesce(p_buffer_min, 0) else 0 end;
  v_busy      tstzrange;
  v_slot      tstzrange := tstzrange(p_start, v_end, '[)');
  v_local     timestamp := p_start at time zone p_timezone;
  v_day       date := v_local::date;
  v_off_start interval := v_local - v_day;
  v_off_end   interval := (v_end at time zone p_timezone) - v_day;
  v_dow       int := extract(dow from v_day)::int;
begin
  v_busy := tstzrange(p_start - make_interval(mins => v_buf), v_end + make_interval(mins => v_buf), '[)');

  if exists (
    select 1 from appointments a
    where a.professional_id = p_prof_id and a.status <> 'cancelado'
      and a.id is distinct from p_exclude_id
      and tstzrange(a.busy_start, a.busy_end, '[)') && v_busy
  ) then
    o_hard := 'PROFESSIONAL_BUSY';
    return;
  end if;

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
          and a.id is distinct from p_exclude_id
          and tstzrange(a.starts_at, a.ends_at, '[)') && v_slot
      )
      and not exists (
        select 1 from schedule_events e
        where e.room_id = r.id and tstzrange(e.starts_at, e.ends_at, '[)') && v_slot
      )
    order by (r.id = p_prefer_room) desc nulls last, r.name
    limit 1;
    if o_room_id is null then
      o_hard := 'NO_ROOM';
      return;
    end if;
  end if;

  if exists (
    select 1 from schedule_events e
    where e.clinic_id = p_clinic_id
      and (e.professional_id = p_prof_id or (e.professional_id is null and e.room_id is null))
      and tstzrange(e.starts_at, e.ends_at, '[)') && v_busy
  ) then
    o_soft := 'BLOCKED';
  elsif not exists (
    select 1 from working_hours w
    where w.professional_id = p_prof_id and w.weekday = v_dow
      and w.start_time::interval <= v_off_start and w.end_time::interval >= v_off_end
  ) then
    o_soft := 'OUTSIDE_HOURS';
  elsif exists (
    select 1 from professional_breaks b
    where b.professional_id = p_prof_id and b.weekday = v_dow
      and b.start_time::interval < v_off_end and b.end_time::interval > v_off_start
  ) then
    o_soft := 'BREAK';
  end if;
end $$;

revoke all on function _staff_slot_check(uuid, text, uuid, int, uuid, int, boolean, appointment_modality, timestamptz, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Paciente (RN01): reaproveita o cadastro pelo e-mail ou telefone.
--   p = { full_name, phone?, email?, channel? }
-- ---------------------------------------------------------------------
create or replace function staff_upsert_contact(p_clinic_id uuid, p jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name    text := regexp_replace(btrim(coalesce(p->>'full_name', '')), '\s+', ' ', 'g');
  v_email   text := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  v_phone   text := nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), '');
  v_contact uuid;
begin
  if not is_clinic_member(p_clinic_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 150 then raise exception 'INVALID_NAME'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL'; end if;
  if v_phone is not null and length(v_phone) not between 10 and 13 then raise exception 'INVALID_PHONE'; end if;

  if v_email is not null then
    select id into v_contact from contacts where clinic_id = p_clinic_id and lower(email) = v_email limit 1;
  end if;
  if v_contact is null and v_phone is not null then
    select id into v_contact from contacts where clinic_id = p_clinic_id and phone = v_phone limit 1;
  end if;

  if v_contact is null then
    insert into contacts (clinic_id, full_name, email, phone, status, source)
    values (p_clinic_id, v_name, v_email, v_phone, 'pre_cadastro',
            coalesce(nullif(p->>'channel', '')::appointment_channel, 'interno'))
    returning id into v_contact;
  else
    -- Completa o que falta, sem sobrescrever o que a recepção já cadastrou.
    update contacts set
      email = coalesce(email, case when v_email is not null and not exists (
                select 1 from contacts o where o.clinic_id = p_clinic_id and lower(o.email) = v_email
              ) then v_email end),
      phone = coalesce(phone, case when v_phone is not null and not exists (
                select 1 from contacts o where o.clinic_id = p_clinic_id and o.phone = v_phone
              ) then v_phone end),
      updated_at = now()
    where id = v_contact;
  end if;
  return v_contact;
end $$;

revoke all on function staff_upsert_contact(uuid, jsonb) from public, anon;
grant execute on function staff_upsert_contact(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Criar / editar / remarcar agendamento pela equipe.
--   p = {
--     id?, clinic_id,
--     contact_id? | contact?: {full_name, phone?, email?},
--     professional_id?, procedure_id?, starts_at?, duration_min?, modality?,
--     status?, channel?, notes?, price?, room_id?, insurance?,
--     address?: {cep, street, number, complement?, district, city, state},
--     force?: boolean      -- confirma encaixe fora do expediente/pausa/bloqueio
--   }
--   Campos ausentes na edição mantêm o valor atual (arrastar envia só id,
--   starts_at e professional_id).
-- ---------------------------------------------------------------------
create or replace function staff_save_appointment(p jsonb) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_clinic   uuid := (p->>'clinic_id')::uuid;
  v_id       uuid := nullif(p->>'id', '')::uuid;
  c          clinics;
  cur        appointments;
  pr         procedures;
  prof       professionals;
  chk        record;
  v_contact  uuid;
  v_modality appointment_modality;
  v_status   appointment_status;
  v_channel  appointment_channel;
  v_start    timestamptz;
  v_duration int;
  v_addr     jsonb;
  v_cep      text;
  v_room     uuid;
  v_appt     appointments;
begin
  if v_clinic is null or not is_clinic_member(v_clinic) then raise exception 'FORBIDDEN'; end if;
  select * into c from clinics where id = v_clinic;

  if v_id is not null then
    select * into cur from appointments where id = v_id and clinic_id = v_clinic for update;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;

  select * into pr from procedures
  where id = coalesce(nullif(p->>'procedure_id', '')::uuid, cur.procedure_id) and clinic_id = v_clinic;
  if not found then raise exception 'PROCEDURE_NOT_FOUND'; end if;

  select * into prof from professionals
  where id = coalesce(nullif(p->>'professional_id', '')::uuid, cur.professional_id) and clinic_id = v_clinic;
  if not found then raise exception 'PROFESSIONAL_NOT_FOUND'; end if;

  v_modality := coalesce(nullif(p->>'modality', '')::appointment_modality, cur.modality, 'clinica');
  if (v_modality = 'clinica' and not pr.allows_clinic)
     or (v_modality = 'residencial' and not pr.allows_home_care) then
    raise exception 'MODALITY_NOT_ALLOWED';
  end if;
  if v_modality = 'residencial' and not prof.home_care_enabled then
    raise exception 'PROFESSIONAL_NO_HOME_CARE';
  end if;

  v_status  := coalesce(nullif(p->>'status', '')::appointment_status, cur.status, 'agendado');
  v_channel := coalesce(nullif(p->>'channel', '')::appointment_channel, cur.channel, 'interno');
  v_start   := coalesce(nullif(p->>'starts_at', '')::timestamptz, cur.starts_at);
  if v_start is null then raise exception 'INVALID_START'; end if;
  v_duration := coalesce(
    nullif(p->>'duration_min', '')::int,
    case when cur.id is not null then (extract(epoch from cur.ends_at - cur.starts_at) / 60)::int end,
    pr.duration_min);
  if v_duration not between 5 and 720 then raise exception 'INVALID_DURATION'; end if;

  -- Paciente
  if nullif(p->>'contact_id', '') is not null then
    select id into v_contact from contacts where id = (p->>'contact_id')::uuid and clinic_id = v_clinic;
    if v_contact is null then raise exception 'CONTACT_NOT_FOUND'; end if;
  elsif p ? 'contact' then
    v_contact := staff_upsert_contact(v_clinic, (p->'contact') || jsonb_build_object('channel', v_channel));
  else
    v_contact := cur.contact_id;
  end if;
  if v_contact is null then raise exception 'CONTACT_REQUIRED'; end if;

  -- Endereço (RF11)
  if v_modality = 'residencial' then
    if p ? 'address' then
      v_addr := p->'address';
    elsif cur.id is not null and cur.modality = 'residencial' then
      v_addr := jsonb_build_object('cep', cur.address_cep, 'street', cur.address_street, 'number', cur.address_number,
        'complement', cur.address_complement, 'district', cur.address_district, 'city', cur.address_city,
        'state', cur.address_state);
    else
      -- Usa o endereço do cadastro do paciente, se houver.
      select jsonb_build_object('cep', cep, 'street', street, 'number', number, 'complement', complement,
        'district', district, 'city', city, 'state', state) into v_addr
      from contacts where id = v_contact;
    end if;
    v_cep := regexp_replace(coalesce(v_addr->>'cep', ''), '\D', '', 'g');
    if length(v_cep) <> 8
       or coalesce(btrim(v_addr->>'street'), '') = ''
       or coalesce(btrim(v_addr->>'number'), '') = ''
       or coalesce(btrim(v_addr->>'district'), '') = ''
       or coalesce(btrim(v_addr->>'city'), '') = ''
       or coalesce(btrim(v_addr->>'state'), '') !~ '^[A-Za-z]{2}$' then
      raise exception 'INVALID_ADDRESS';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_clinic::text, 0));

  v_room := null;
  if v_status <> 'cancelado' then
    select * into chk from _staff_slot_check(
      v_clinic, c.timezone, prof.id, prof.travel_buffer_min, pr.id, v_duration, pr.requires_room,
      v_modality, v_start, v_id, coalesce(nullif(p->>'room_id', '')::uuid, cur.room_id));
    if chk.o_hard is not null then raise exception '%', chk.o_hard; end if;
    if chk.o_soft is not null and not coalesce((p->>'force')::boolean, false) then
      raise exception 'NEEDS_CONFIRM:%', chk.o_soft;
    end if;
    v_room := chk.o_room_id;
  else
    v_room := cur.room_id;
  end if;

  begin
    if v_id is null then
      insert into appointments (
        clinic_id, contact_id, professional_id, procedure_id, room_id, modality, status, channel,
        starts_at, ends_at, price, insurance, notes, created_by,
        address_cep, address_street, address_number, address_complement,
        address_district, address_city, address_state
      ) values (
        v_clinic, v_contact, prof.id, pr.id, v_room, v_modality, v_status, v_channel,
        v_start, v_start + make_interval(mins => v_duration),
        coalesce(nullif(p->>'price', '')::numeric, pr.price),
        nullif(btrim(p->>'insurance'), ''), nullif(btrim(p->>'notes'), ''), auth.uid(),
        v_cep, v_addr->>'street', v_addr->>'number', nullif(v_addr->>'complement', ''),
        v_addr->>'district', v_addr->>'city', upper(v_addr->>'state')
      ) returning * into v_appt;
    else
      update appointments set
        contact_id = v_contact, professional_id = prof.id, procedure_id = pr.id, room_id = v_room,
        modality = v_modality, status = v_status, channel = v_channel,
        starts_at = v_start, ends_at = v_start + make_interval(mins => v_duration),
        price     = case when p ? 'price' then nullif(p->>'price', '')::numeric else price end,
        insurance = case when p ? 'insurance' then nullif(btrim(p->>'insurance'), '') else insurance end,
        notes     = case when p ? 'notes' then nullif(btrim(p->>'notes'), '') else notes end,
        cancel_reason = case when v_status = 'cancelado'
                          then coalesce(nullif(btrim(p->>'cancel_reason'), ''), cancel_reason) else null end,
        address_cep = v_cep, address_street = v_addr->>'street', address_number = v_addr->>'number',
        address_complement = nullif(v_addr->>'complement', ''), address_district = v_addr->>'district',
        address_city = v_addr->>'city', address_state = upper(v_addr->>'state')
      where id = v_id
      returning * into v_appt;
    end if;
  exception when exclusion_violation then
    raise exception 'PROFESSIONAL_BUSY';
  end;

  return json_build_object('id', v_appt.id, 'room_id', v_appt.room_id, 'status', v_appt.status);
end $$;

revoke all on function staff_save_appointment(jsonb) from public, anon;
grant execute on function staff_save_appointment(jsonb) to authenticated;
