-- =====================================================================
-- Etapa 5 — Dashboard (RF14)
--   clinic_dashboard(clinica, de, até [exclusivo], profissional?) devolve,
--   num JSON só: totais, situação, ociosidade, lista de espera, pacientes
--   frequentes, vendas (só para quem gerencia), convênio, canal e período.
--   clinic_idle_overview: ociosidade da semana, quinzena, mês e ano de uma data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ociosidade de um intervalo [p_from, p_to):
--   expediente (menos pausas e bloqueios) x minutos agendados (sem cancelados).
--   O expediente só conta a partir do cadastro da clínica e de cada profissional.
-- ---------------------------------------------------------------------
create or replace function _clinic_idle(p_clinic_id uuid, p_from date, p_to date, p_professional_id uuid)
returns json
language sql stable security definer set search_path = public as $$
  with
  c as (select * from clinics where id = p_clinic_id),
  pros as (
    select p.id, greatest((c.created_at at time zone c.timezone)::date,
                          (p.created_at at time zone c.timezone)::date) as since
    from professionals p, c
    where p.clinic_id = p_clinic_id and p.active
      and (p_professional_id is null or p.id = p_professional_id)
  ),
  days as (select d::date as d from generate_series(p_from, p_to - 1, interval '1 day') d),
  work as (
    select pr.id as pid, tstzrange((dd.d + w.start_time) at time zone c.timezone,
                                   (dd.d + w.end_time) at time zone c.timezone, '[)') as r
    from c, pros pr cross join days dd
    join working_hours w on w.professional_id = pr.id and w.weekday = extract(dow from dd.d)::int
    where dd.d >= pr.since
  ),
  brk as (
    select pr.id as pid, tstzrange((dd.d + b.start_time) at time zone c.timezone,
                                   (dd.d + b.end_time) at time zone c.timezone, '[)') as r
    from c, pros pr cross join days dd
    join professional_breaks b on b.professional_id = pr.id and b.weekday = extract(dow from dd.d)::int
    where dd.d >= pr.since
  ),
  m as (
    select
      coalesce((select sum(extract(epoch from upper(r) - lower(r))) from work), 0) / 60 as worked,
      coalesce((select sum(extract(epoch from upper(w.r * b.r) - lower(w.r * b.r)))
                from work w join brk b on b.pid = w.pid and w.r && b.r), 0) / 60 as breaks,
      coalesce((select sum(extract(epoch from upper(w.r * tstzrange(e.starts_at, e.ends_at, '[)'))
                                       - lower(w.r * tstzrange(e.starts_at, e.ends_at, '[)'))))
                from work w join schedule_events e
                  on e.clinic_id = p_clinic_id
                 and (e.professional_id = w.pid or (e.professional_id is null and e.room_id is null))
                 and w.r && tstzrange(e.starts_at, e.ends_at, '[)')), 0) / 60 as blocked,
      coalesce((select sum(extract(epoch from a.ends_at - a.starts_at))
                from appointments a, c
                where a.clinic_id = p_clinic_id and a.status <> 'cancelado'
                  and a.professional_id in (select id from pros)
                  and a.starts_at >= p_from::timestamp at time zone c.timezone
                  and a.starts_at <  p_to::timestamp at time zone c.timezone), 0) / 60 as booked
  )
  select json_build_object(
    'available_min', greatest(worked - breaks - blocked, 0)::int,
    'booked_min', booked::int,
    'idle_pct', case when worked - breaks - blocked > 0
                     then greatest(0, round(100 * (1 - booked / (worked - breaks - blocked))))::int end
  ) from m;
$$;

revoke all on function _clinic_idle(uuid, date, date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Ociosidade da semana, quinzena, mês e ano que contêm a data de referência.
--   Quinzena: dias 1–15 ou 16 ao fim do mês.
-- ---------------------------------------------------------------------
create or replace function clinic_idle_overview(p_clinic_id uuid, p_ref date, p_professional_id uuid default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_week  date := date_trunc('week', p_ref)::date;
  v_month date := date_trunc('month', p_ref)::date;
  v_q1    date := case when extract(day from p_ref) <= 15 then v_month else v_month + 15 end;
  v_q2    date := case when extract(day from p_ref) <= 15 then v_month + 15 else (v_month + interval '1 month')::date end;
  v_year  date := date_trunc('year', p_ref)::date;
begin
  if not is_clinic_member(p_clinic_id) then raise exception 'FORBIDDEN'; end if;
  return json_build_array(
    json_build_object('key', 'week',  'from', v_week,  'to', v_week + 7,
                      'idle', _clinic_idle(p_clinic_id, v_week, v_week + 7, p_professional_id)),
    json_build_object('key', 'fortnight', 'from', v_q1, 'to', v_q2,
                      'idle', _clinic_idle(p_clinic_id, v_q1, v_q2, p_professional_id)),
    json_build_object('key', 'month', 'from', v_month, 'to', (v_month + interval '1 month')::date,
                      'idle', _clinic_idle(p_clinic_id, v_month, (v_month + interval '1 month')::date, p_professional_id)),
    json_build_object('key', 'year',  'from', v_year,  'to', (v_year + interval '1 year')::date,
                      'idle', _clinic_idle(p_clinic_id, v_year, (v_year + interval '1 year')::date, p_professional_id))
  );
end $$;

revoke all on function clinic_idle_overview(uuid, date, uuid) from public, anon;
grant execute on function clinic_idle_overview(uuid, date, uuid) to authenticated;

create or replace function clinic_dashboard(
  p_clinic_id       uuid,
  p_from            date,
  p_to              date,
  p_professional_id uuid default null
) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  c          clinics;
  v_from     timestamptz;
  v_to       timestamptz;
  v_days     int := p_to - p_from;
  v_bucket   text;
  v_manage   boolean;
  v_result   json;
begin
  if not is_clinic_member(p_clinic_id) then raise exception 'FORBIDDEN'; end if;
  if p_to <= p_from or v_days > 400 then raise exception 'INVALID_RANGE'; end if;
  select * into c from clinics where id = p_clinic_id;
  v_from   := p_from::timestamp at time zone c.timezone;
  v_to     := p_to::timestamp at time zone c.timezone;
  v_bucket := case when v_days <= 62 then 'day' when v_days <= 186 then 'week' else 'month' end;
  v_manage := can_manage_clinic(p_clinic_id);

  with
  appts as (
    select a.*, (a.starts_at at time zone c.timezone)::date as local_day
    from appointments a
    where a.clinic_id = p_clinic_id
      and a.starts_at >= v_from and a.starts_at < v_to
      and (p_professional_id is null or a.professional_id = p_professional_id)
  ),
  live as (select * from appts where status <> 'cancelado'),
  -- Período anterior de mesmo tamanho, para comparação.
  prev as (
    select count(*) as total from appointments a
    where a.clinic_id = p_clinic_id and a.status <> 'cancelado'
      and a.starts_at >= v_from - (v_to - v_from) and a.starts_at < v_from
      and (p_professional_id is null or a.professional_id = p_professional_id)
  )
  select json_build_object(
    'range', json_build_object('from', p_from, 'to', p_to, 'bucket', v_bucket),
    'total',          (select count(*) from live),
    'total_previous', (select total from prev),
    'cancelled',      (select count(*) from appts where status = 'cancelado'),
    'by_status', coalesce((
      select json_object_agg(status, n) from (select status, count(*) as n from appts group by status) s
    ), '{}'::json),
    'idle', _clinic_idle(p_clinic_id, p_from, p_to, p_professional_id),
    'waitlist', json_build_object(
      'waiting', (select count(*) from waitlist w where w.clinic_id = p_clinic_id and w.status = 'aguardando'
                   and (p_professional_id is null or w.professional_id is null or w.professional_id = p_professional_id)),
      'added',   (select count(*) from waitlist w where w.clinic_id = p_clinic_id
                   and w.created_at >= v_from and w.created_at < v_to
                   and (p_professional_id is null or w.professional_id is null or w.professional_id = p_professional_id)),
      'fitted',  (select count(*) from waitlist w where w.clinic_id = p_clinic_id and w.status = 'encaixado'
                   and w.created_at >= v_from - interval '60 days' and w.created_at < v_to
                   and (p_professional_id is null or w.professional_id is null or w.professional_id = p_professional_id))
    ),
    'frequent_patients', coalesce((
      select json_agg(x order by x.n desc, x.full_name) from (
        select ct.id, ct.full_name, ct.phone, count(*) as n, max(l.starts_at) as last_at
        from live l join contacts ct on ct.id = l.contact_id
        group by ct.id, ct.full_name, ct.phone
        having count(*) >= 2
        order by count(*) desc, ct.full_name
        limit 8
      ) x
    ), '[]'::json),
    'sales', case when v_manage then json_build_object(
      'done',     coalesce((select sum(price) from live where status = 'concluido'), 0),
      'expected', coalesce((select sum(price) from live where status in ('agendado', 'confirmado', 'reservado')), 0),
      'no_show',  coalesce((select sum(price) from live where status = 'nao_compareceu'), 0),
      'by_procedure', coalesce((
        select json_agg(x order by x.total desc) from (
          select p.name, count(*) as n, coalesce(sum(l.price), 0) as total
          from live l join procedures p on p.id = l.procedure_id
          where l.status = 'concluido'
          group by p.name order by total desc limit 8
        ) x
      ), '[]'::json)
    ) end,
    'by_insurance', coalesce((
      select json_agg(x order by x.n desc) from (
        select coalesce(nullif(btrim(insurance), ''), 'Particular') as label, count(*) as n
        from live group by 1 order by 2 desc limit 8
      ) x
    ), '[]'::json),
    'by_channel', coalesce((
      select json_agg(x order by x.n desc) from (
        select channel::text as label, count(*) as n from live group by 1 order by 2 desc
      ) x
    ), '[]'::json),
    'by_period', coalesce((
      select json_agg(x order by x.bucket) from (
        select date_trunc(v_bucket, l.local_day::timestamp)::date as bucket, count(*) as n
        from live l group by 1
      ) x
    ), '[]'::json)
  ) into v_result;

  return v_result;
end $$;

revoke all on function clinic_dashboard(uuid, date, date, uuid) from public, anon;
grant execute on function clinic_dashboard(uuid, date, date, uuid) to authenticated;
