-- ============================================================================
-- MÓDULO PACIENTES — ETAPA 4: link da anamnese e instruções por serviço
-- ----------------------------------------------------------------------------
-- 1) public_clinic passa a devolver a "preparação" de cada serviço, para o
--    paciente ver logo depois de agendar (ex.: "venha sem maquiagem").
--    Os cuidados pós-atendimento NÃO vão para o público: a equipe envia depois.
-- 2) intake_links_status: a equipe vê se já mandou um link e se o paciente
--    respondeu (só datas e nome do modelo — nada das respostas).
-- ============================================================================

-- ---------------------------------------------------------------------
-- Portal público: mesma função de antes + 'prep_instructions' nos serviços
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
        'image_url', p.image_url, 'video_url', p.video_url,
        'prep_instructions', p.prep_instructions
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
-- Situação dos links de preenchimento de um paciente (últimos 5)
-- Qualquer membro da clínica (inclusive recepção, que é quem costuma enviar).
-- ---------------------------------------------------------------------
create or replace function intake_links_status(p_contact_id uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  ct contacts;
begin
  select * into ct from contacts where id = p_contact_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from clinic_members where clinic_id = ct.clinic_id and user_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if not clinic_has_module(ct.clinic_id, 'pacientes') then raise exception 'MODULE_DISABLED'; end if;
  return coalesce((
    select json_agg(x order by x.created_at desc) from (
      select l.created_at, l.expires_at, l.used_at, t.name as template_name
      from record_intake_links l
      left join record_templates t on t.id = l.template_id
      where l.contact_id = p_contact_id
      order by l.created_at desc
      limit 5
    ) x
  ), '[]'::json);
end $$;

revoke all on function intake_links_status(uuid) from public, anon;
grant execute on function intake_links_status(uuid) to authenticated;
