-- =====================================================================
-- Etapa 3b — Profissionais, horários (RF13) e salas
--   * Um profissional pode estar ligado a um login da clínica (user_id).
--     Em clínicas pequenas, a gerente é também a recepção e a profissional:
--     ela tem o papel 'admin' em clinic_members E um perfil em professionals.
--   * save_professional grava perfil + serviços + horários + pausas de uma vez.
--   * A equipe lê; só quem gerencia a clínica altera.
-- =====================================================================

-- Um login vira no máximo um profissional por clínica.
create unique index if not exists professionals_clinic_user_key
  on professionals (clinic_id, user_id) where user_id is not null;

-- O login ligado precisa ser membro da clínica.
create or replace function professionals_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and not exists (
    select 1 from clinic_members m where m.clinic_id = new.clinic_id and m.user_id = new.user_id
  ) then
    raise exception 'USER_NOT_MEMBER' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists professionals_guard on professionals;
create trigger professionals_guard before insert or update of user_id, clinic_id on professionals
  for each row execute function professionals_guard();

-- Se o login sair da clínica, o perfil de profissional continua (com o histórico), só sem login.
create or replace function clinic_members_unlink_professional() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update professionals set user_id = null where clinic_id = old.clinic_id and user_id = old.user_id;
  return old;
end $$;

drop trigger if exists clinic_members_unlink_professional on clinic_members;
create trigger clinic_members_unlink_professional after delete on clinic_members
  for each row execute function clinic_members_unlink_professional();

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['professionals', 'rooms'] loop
    execute format('drop policy if exists %1$s_member on %1$I', t);
    execute format('drop policy if exists %1$s_select on %1$I', t);
    execute format('drop policy if exists %1$s_insert on %1$I', t);
    execute format('drop policy if exists %1$s_update on %1$I', t);
    execute format('drop policy if exists %1$s_delete on %1$I', t);
    execute format('create policy %1$s_select on %1$I for select to authenticated using (is_clinic_member(clinic_id))', t);
    execute format('create policy %1$s_insert on %1$I for insert to authenticated with check (can_manage_clinic(clinic_id))', t);
    execute format('create policy %1$s_update on %1$I for update to authenticated
                      using (can_manage_clinic(clinic_id)) with check (can_manage_clinic(clinic_id))', t);
    execute format('create policy %1$s_delete on %1$I for delete to authenticated using (can_manage_clinic(clinic_id))', t);
  end loop;

  foreach t in array array['working_hours', 'professional_breaks'] loop
    execute format('drop policy if exists %1$s_member on %1$I', t);
    execute format('drop policy if exists %1$s_select on %1$I', t);
    execute format('drop policy if exists %1$s_write on %1$I', t);
    execute format(
      'create policy %1$s_select on %1$I for select to authenticated
         using (exists (select 1 from professionals p where p.id = professional_id and is_clinic_member(p.clinic_id)))', t);
    execute format(
      'create policy %1$s_write on %1$I for all to authenticated
         using (exists (select 1 from professionals p where p.id = professional_id and can_manage_clinic(p.clinic_id)))
         with check (exists (select 1 from professionals p where p.id = professional_id and can_manage_clinic(p.clinic_id)))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- save_professional: cria/atualiza tudo numa transação só.
--   security invoker => as políticas acima continuam valendo.
--   p = {
--     id?, clinic_id, name, specialty?, color?, user_id?, active?, public_visible?,
--     home_care_enabled?, travel_buffer_min?,
--     procedure_ids?: uuid[]            (ausente = não mexe)
--     hours?:  [{weekday, start, end}]  (ausente = não mexe)
--     breaks?: [{weekday, start, end, label?}]
--   }
-- ---------------------------------------------------------------------
create or replace function save_professional(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id     uuid := nullif(p->>'id', '')::uuid;
  v_clinic uuid := (p->>'clinic_id')::uuid;
  v_name   text := btrim(coalesce(p->>'name', ''));
  r        jsonb;
begin
  if char_length(v_name) < 2 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into professionals (clinic_id, name, specialty, color, user_id, active, public_visible,
                               home_care_enabled, travel_buffer_min)
    values (v_clinic, v_name, nullif(btrim(p->>'specialty'), ''), nullif(p->>'color', ''),
            nullif(p->>'user_id', '')::uuid,
            coalesce((p->>'active')::boolean, true),
            coalesce((p->>'public_visible')::boolean, true),
            coalesce((p->>'home_care_enabled')::boolean, false),
            coalesce((p->>'travel_buffer_min')::int, 30))
    returning id into v_id;
  else
    update professionals set
      name              = v_name,
      specialty         = nullif(btrim(p->>'specialty'), ''),
      color             = nullif(p->>'color', ''),
      user_id           = nullif(p->>'user_id', '')::uuid,
      active            = coalesce((p->>'active')::boolean, active),
      public_visible    = coalesce((p->>'public_visible')::boolean, public_visible),
      home_care_enabled = coalesce((p->>'home_care_enabled')::boolean, home_care_enabled),
      travel_buffer_min = coalesce((p->>'travel_buffer_min')::int, travel_buffer_min)
    where id = v_id and clinic_id = v_clinic;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  if p ? 'procedure_ids' then
    delete from professional_procedures where professional_id = v_id;
    insert into professional_procedures (professional_id, procedure_id)
    select v_id, s.id from procedures s
    where s.clinic_id = v_clinic
      and s.id in (select (jsonb_array_elements_text(p->'procedure_ids'))::uuid);
  end if;

  if p ? 'hours' then
    delete from working_hours where professional_id = v_id;
    for r in select * from jsonb_array_elements(p->'hours') loop
      insert into working_hours (professional_id, weekday, start_time, end_time)
      values (v_id, (r->>'weekday')::smallint, (r->>'start')::time, (r->>'end')::time);
    end loop;
  end if;

  if p ? 'breaks' then
    delete from professional_breaks where professional_id = v_id;
    for r in select * from jsonb_array_elements(p->'breaks') loop
      insert into professional_breaks (professional_id, weekday, start_time, end_time, label)
      values (v_id, (r->>'weekday')::smallint, (r->>'start')::time, (r->>'end')::time,
              nullif(r->>'label', ''));
    end loop;
  end if;

  return v_id;
end $$;

revoke all on function save_professional(jsonb) from public, anon;
grant execute on function save_professional(jsonb) to authenticated;
