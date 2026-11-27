-- =====================================================================
-- Módulo Pacientes — Etapa 3: lista de pacientes do painel
--
-- Uma lista só, com três "visões" conforme quem pede:
--   - dono da clínica: todos os pacientes, com o resumo do prontuário;
--   - profissional: todos os pacientes, mas o resumo do prontuário (nº de
--     registros, se tem anamnese) só aparece para quem ele atendeu;
--   - recepção: todos os pacientes, sem nenhum dado do prontuário.
-- Nome, telefone e agenda a recepção já vê hoje (tabela contacts); o que
-- é protegido aqui é só o que vem do prontuário.
-- =====================================================================

create or replace function record_patient_list(p_clinic_id uuid, p_search text default null, p_limit int default 200)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner boolean := _is_clinic_owner(p_clinic_id);
  v_prof uuid := _my_professional_id(p_clinic_id);
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
begin
  if not exists (select 1 from clinic_members where clinic_id = p_clinic_id and user_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if not clinic_has_module(p_clinic_id, 'pacientes') then raise exception 'MODULE_DISABLED'; end if;

  return coalesce((
    select json_agg(row_to_json(x) order by x.last_visit desc nulls last, x.full_name)
    from (
      select
        ct.id, ct.full_name, ct.phone, ct.email, ct.status,
        (select max(a.starts_at) from appointments a
          where a.contact_id = ct.id and a.status <> 'cancelado' and a.starts_at <= now()) as last_visit,
        (select min(a.starts_at) from appointments a
          where a.contact_id = ct.id and a.status <> 'cancelado' and a.starts_at > now()) as next_visit,
        v.can_view,
        case when v.can_view then (select count(*) from record_entries e
                                   where e.contact_id = ct.id and e.status = 'assinado') end as entries,
        case when v.can_view then exists (select 1 from record_entries e
                                          where e.contact_id = ct.id and e.kind = 'anamnese' and e.status = 'assinado') end as has_intake,
        -- atendido por mim? (para o profissional filtrar "meus pacientes")
        v_prof is not null and exists (select 1 from appointments a
                                       where a.contact_id = ct.id and a.professional_id = v_prof
                                         and a.status <> 'cancelado') as mine
      from contacts ct
      cross join lateral (
        select case when v_owner then true
                    when v_prof is null then false
                    else _can_view_records(p_clinic_id, ct.id) end as can_view
      ) v
      where ct.clinic_id = p_clinic_id
        and (v_q is null
             or ct.full_name ilike '%' || v_q || '%'
             or ct.email ilike '%' || v_q || '%'
             or (length(v_digits) >= 4 and ct.phone like '%' || v_digits || '%'))
      order by last_visit desc nulls last, full_name
      limit least(greatest(coalesce(p_limit, 200), 1), 500)
    ) x
  ), '[]'::json);
end $$;

revoke all on function record_patient_list(uuid, text, int) from public, anon;
grant execute on function record_patient_list(uuid, text, int) to authenticated;
