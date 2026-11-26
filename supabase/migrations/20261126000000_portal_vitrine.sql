-- =====================================================================
-- Portal com cara de site da clínica
--   clinics.about    : texto "Sobre a clínica"
--   clinics.gallery  : até 12 fotos do espaço [{url, caption}]
--   professionals.photo_url / bio : foto e mini apresentação da equipe
--   public_clinic passa a devolver esses campos.
-- =====================================================================

alter table clinics
  add column if not exists about   text check (char_length(about) <= 1500),
  add column if not exists gallery jsonb not null default '[]'::jsonb;

alter table clinics drop constraint if exists clinics_gallery_check;
alter table clinics add constraint clinics_gallery_check
  check (jsonb_typeof(gallery) = 'array' and jsonb_array_length(gallery) <= 12);

alter table professionals
  add column if not exists photo_url text,
  add column if not exists bio       text check (char_length(bio) <= 300);

-- ---------------------------------------------------------------------
-- save_professional: aceita photo_url e bio (ausente = não altera).
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
                               home_care_enabled, travel_buffer_min, photo_url, bio)
    values (v_clinic, v_name, nullif(btrim(p->>'specialty'), ''), nullif(p->>'color', ''),
            nullif(p->>'user_id', '')::uuid,
            coalesce((p->>'active')::boolean, true),
            coalesce((p->>'public_visible')::boolean, true),
            coalesce((p->>'home_care_enabled')::boolean, false),
            coalesce((p->>'travel_buffer_min')::int, 30),
            nullif(p->>'photo_url', ''),
            nullif(btrim(p->>'bio'), ''))
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
      travel_buffer_min = coalesce((p->>'travel_buffer_min')::int, travel_buffer_min),
      photo_url         = case when p ? 'photo_url' then nullif(p->>'photo_url', '') else photo_url end,
      bio               = case when p ? 'bio' then nullif(btrim(p->>'bio'), '') else bio end
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

-- ---------------------------------------------------------------------
-- Portal público: + about, gallery, email; profissionais com foto e bio.
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
