-- ============================================================================
-- MÓDULO PACIENTES — ETAPA 5: o módulo entra na cobrança
-- ----------------------------------------------------------------------------
-- platform_overview (painel do gerente do sistema) passa a mostrar, por clínica:
--   price          = valor do plano (ou o combinado), como antes;
--   modules        = módulos adicionais ligados, com o preço de cada um;
--   modules_price  = soma dos módulos;
--   total_price    = plano + módulos  -> é o que a clínica paga por mês.
-- A receita mensal prevista (mrr) passa a usar total_price, e o espaço usado
-- passa a contar também os anexos do prontuário (bucket clinic-records).
-- Ligar/desligar módulo e mudar preço já são protegidos pelas políticas
-- clinic_modules_admin e modules_admin (só o gerente do sistema).
-- ============================================================================

create or replace function platform_overview() returns json
language plpgsql stable security definer set search_path = public, storage, auth as $$
declare
  v_result json;
  v_grace  int;
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  select grace_days into v_grace from platform_settings where id = 1;

  with
  per as (
    select
      c.id, c.name, c.slug, c.status, c.created_at, c.public_booking_enabled,
      c.plan_id, p.name as plan_name, coalesce(c.monthly_price, p.price_monthly) as price,
      p.max_professionals, c.due_day, c.next_due_date, c.trial_ends_on, c.suspended_reason,
      c.google_notify_enabled,
      -- Módulos adicionais contratados (preço combinado ou de tabela).
      coalesce((select json_agg(json_build_object('key', m.key, 'name', m.name,
                                                  'price', coalesce(cm.price_monthly, m.price_monthly))
                                order by m.sort_order, m.name)
                from clinic_modules cm join modules m on m.key = cm.module_key
                where cm.clinic_id = c.id and m.active), '[]'::json) as modules,
      (select coalesce(sum(coalesce(cm.price_monthly, m.price_monthly)), 0)
         from clinic_modules cm join modules m on m.key = cm.module_key
        where cm.clinic_id = c.id and m.active) as modules_price,
      (select count(*) from appointments a where a.clinic_id = c.id) as appts_total,
      (select count(*) from appointments a where a.clinic_id = c.id and a.created_at >= now() - interval '30 days') as appts_30d,
      (select count(*) from appointments a where a.clinic_id = c.id and a.channel = 'portal'
                                             and a.created_at >= now() - interval '30 days') as portal_30d,
      (select count(*) from appointments a where a.clinic_id = c.id and a.starts_at >= now()
                                             and a.status <> 'cancelado') as upcoming,
      (select count(*) from contacts ct where ct.clinic_id = c.id) as contacts,
      (select count(*) from professionals pf where pf.clinic_id = c.id and pf.active) as professionals,
      (select count(*) from clinic_members m where m.clinic_id = c.id) as members,
      (select count(*) from procedures s where s.clinic_id = c.id and s.active and s.public_visible
          and exists (select 1 from professional_procedures pp join professionals pf on pf.id = pp.professional_id
                      where pp.procedure_id = s.id and pf.active and pf.public_visible)) as public_services,
      (select count(*) from professionals pf where pf.clinic_id = c.id and pf.active and pf.public_visible
          and exists (select 1 from working_hours w where w.professional_id = pf.id)) as pros_with_hours,
      (select coalesce(sum(views), 0) from portal_daily_stats s where s.clinic_id = c.id
                                                               and s.day >= current_date - 30) as views_30d,
      (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o
          where o.bucket_id in ('clinic-assets', 'clinic-records') and o.name like c.id::text || '/%') as storage_bytes,
      (select count(*) from appointments a where a.clinic_id = c.id and a.google_sync_error is not null
                                             and a.updated_at >= now() - interval '30 days') as google_errors_30d,
      (select max(u.last_sign_in_at) from clinic_members m join auth.users u on u.id = m.user_id
          where m.clinic_id = c.id) as last_sign_in,
      greatest(
        (select max(a.updated_at) from appointments a where a.clinic_id = c.id),
        (select max(ct.updated_at) from contacts ct where ct.clinic_id = c.id)) as last_activity,
      (select max(pay.paid_on) from clinic_payments pay where pay.clinic_id = c.id) as last_payment
    from clinics c
    left join plans p on p.id = c.plan_id
  ),
  enriched as (
    select per.*,
      coalesce(per.price, 0) + per.modules_price as total_price,
      case when per.next_due_date is not null and per.next_due_date < current_date
           then current_date - per.next_due_date else 0 end as days_overdue,
      array_remove(array[
        case when per.status in ('suspensa', 'cancelada') then 'Clínica ' || per.status end,
        case when per.status not in ('suspensa', 'cancelada') and not per.public_booking_enabled
             then 'Link desligado pela clínica' end,
        case when per.public_services = 0 then 'Nenhum serviço disponível no link' end,
        case when per.pros_with_hours = 0 then 'Nenhum profissional com horário' end,
        case when per.google_errors_30d > 0 then 'Erros na sincronização com o Google' end,
        case when per.max_professionals is not null and per.professionals > per.max_professionals
             then 'Acima do limite de profissionais do plano' end,
        case when per.status = 'ativa' and per.next_due_date is not null and per.next_due_date < current_date
             then 'Pagamento em atraso' end,
        case when per.status = 'ativa' and per.next_due_date is null
             and coalesce(per.price, 0) + per.modules_price > 0
             then 'Sem data de vencimento' end
      ], null) as problems
    from per
  )
  select json_build_object(
    'generated_at', now(),
    'grace_days', coalesce(v_grace, 7),
    'totals', json_build_object(
      'clinics', (select count(*) from clinics),
      'by_status', coalesce((select json_object_agg(status, n) from (select status, count(*) n from clinics group by 1) s), '{}'::json),
      'mrr', coalesce((select sum(total_price) from enriched where status = 'ativa'), 0),
      'received_month', coalesce((select sum(amount) from clinic_payments
                                  where date_trunc('month', paid_on) = date_trunc('month', current_date)), 0),
      'overdue', (select count(*) from enriched where status = 'ativa' and days_overdue > 0),
      'with_problems', (select count(*) from enriched where cardinality(problems) > 0),
      'appts_30d', (select coalesce(sum(appts_30d), 0) from enriched),
      'portal_30d', (select coalesce(sum(portal_30d), 0) from enriched),
      'views_30d', (select coalesce(sum(views_30d), 0) from enriched),
      'users', (select count(*) from auth.users),
      'db_bytes', pg_database_size(current_database()),
      'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects)
    ),
    'clinics', coalesce((select json_agg(e order by e.name) from enriched e), '[]'::json)
  ) into v_result;
  return v_result;
end $$;
revoke all on function platform_overview() from public, anon;
grant execute on function platform_overview() to authenticated;

-- ---------------------------------------------------------------------
-- Exclusão definitiva (só pela Edge Function, com service role)
