-- =====================================================================
-- Etapa 3a — Serviços: foto, vídeo do YouTube, ordem e permissões
--   * Cada serviço pode ter uma foto (Storage) e/ou um link do YouTube.
--   * Só o gerente da clínica (ou o gerente do sistema) cria/edita serviços.
--   * O portal recebe a foto e o vídeo de cada serviço.
-- =====================================================================

alter table procedures
  add column if not exists image_url  text,
  add column if not exists video_url  text,
  add column if not exists sort_order int not null default 0;

alter table procedures drop constraint if exists procedures_video_url_check;
alter table procedures add constraint procedures_video_url_check
  check (video_url is null or video_url ~ '^https://(www\.|m\.)?(youtube\.com|youtu\.be)/');

alter table procedures drop constraint if exists procedures_description_len;
alter table procedures add constraint procedures_description_len
  check (description is null or char_length(description) <= 600);

-- ---------------------------------------------------------------------
-- Permissões: a equipe lê; só quem gerencia a clínica altera.
-- ---------------------------------------------------------------------
drop policy if exists procedures_member on procedures;
drop policy if exists procedures_select on procedures;
drop policy if exists procedures_insert on procedures;
drop policy if exists procedures_update on procedures;
drop policy if exists procedures_delete on procedures;
create policy procedures_select on procedures for select to authenticated using (is_clinic_member(clinic_id));
create policy procedures_insert on procedures for insert to authenticated with check (can_manage_clinic(clinic_id));
create policy procedures_update on procedures for update to authenticated
  using (can_manage_clinic(clinic_id)) with check (can_manage_clinic(clinic_id));
create policy procedures_delete on procedures for delete to authenticated using (can_manage_clinic(clinic_id));

drop policy if exists procedure_rooms_member on procedure_rooms;
drop policy if exists procedure_rooms_select on procedure_rooms;
drop policy if exists procedure_rooms_write on procedure_rooms;
create policy procedure_rooms_select on procedure_rooms for select to authenticated
  using (exists (select 1 from procedures p where p.id = procedure_id and is_clinic_member(p.clinic_id)));
create policy procedure_rooms_write on procedure_rooms for all to authenticated
  using (exists (select 1 from procedures p where p.id = procedure_id and can_manage_clinic(p.clinic_id)))
  with check (exists (select 1 from procedures p where p.id = procedure_id and can_manage_clinic(p.clinic_id)));

drop policy if exists professional_procedures_member on professional_procedures;
drop policy if exists professional_procedures_select on professional_procedures;
drop policy if exists professional_procedures_write on professional_procedures;
create policy professional_procedures_select on professional_procedures for select to authenticated
  using (exists (select 1 from professionals p where p.id = professional_id and is_clinic_member(p.clinic_id)));
-- Profissional e serviço precisam ser da mesma clínica.
create policy professional_procedures_write on professional_procedures for all to authenticated
  using (exists (select 1 from professionals p where p.id = professional_id and can_manage_clinic(p.clinic_id)))
  with check (exists (
    select 1 from professionals p join procedures s on s.clinic_id = p.clinic_id
    where p.id = professional_id and s.id = procedure_id and can_manage_clinic(p.clinic_id)));

-- ---------------------------------------------------------------------
-- Portal: devolve foto e vídeo, na ordem definida pela clínica.
-- ---------------------------------------------------------------------
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
