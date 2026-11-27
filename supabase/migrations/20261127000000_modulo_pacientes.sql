-- =====================================================================
-- Módulo PACIENTES (acompanhamento e prontuário) — Etapa 1: banco e segurança
--
--   * Módulos vendidos à parte (adicionais da assinatura): tabela modules +
--     clinic_modules. O primeiro módulo é 'pacientes'.
--   * Modelos de ficha personalizáveis (record_templates): cada clínica monta
--     a sua anamnese / ficha de avaliação e o seu registro de atendimento.
--   * Registros (record_entries): anamneses e evoluções preenchidas. Depois de
--     ASSINADO, um registro nunca mais muda nem é apagado; correções viram
--     ADENDOS (record_addenda), com data e autor.
--   * Link de preenchimento (record_intake_links): a clínica manda um link e o
--     paciente responde a anamnese pelo celular, sem login.
--   * Preparação e cuidados por serviço (colunas novas em procedures).
--   * Registro de acesso (record_access_log): quem abriu cada ficha e quando.
--
-- QUEM VÊ O PRONTUÁRIO (regra combinada com o dono do produto):
--   - o DONO da clínica (papel 'admin' na clínica): tudo da clínica;
--   - o PROFISSIONAL: o histórico COMPLETO dos pacientes que ele atendeu
--     (tem/teve agendamento com ele, ou já escreveu um registro do paciente);
--   - recepção NÃO vê; e o GERENTE DO SISTEMA (A2) também NÃO vê — a A2 só
--     opera a plataforma, os dados de saúde pertencem à clínica (LGPD).
--
-- PARA ESTUDAR — por que tudo passa por funções (RPC) e não por tabelas?
--   As tabelas de registro têm RLS ligado e NENHUMA política: ninguém lê nem
--   grava direto. O app só usa as funções abaixo, que (1) conferem a permissão,
--   (2) validam os dados e (3) anotam o acesso no registro de auditoria.
--   Uma política RLS sozinha não consegue "anotar quem leu".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Módulos (adicionais pagos à parte)
-- ---------------------------------------------------------------------
create table if not exists modules (
  key           text primary key check (key ~ '^[a-z_]{3,40}$'),
  name          text not null check (char_length(btrim(name)) between 2 and 60),
  description   text check (char_length(description) <= 300),
  price_monthly numeric(10,2) not null default 0 check (price_monthly >= 0),
  active        boolean not null default true,
  sort_order    int not null default 0
);
alter table modules enable row level security;
drop policy if exists modules_select on modules;
create policy modules_select on modules for select to authenticated using (true);
drop policy if exists modules_admin on modules;
create policy modules_admin on modules for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

insert into modules (key, name, description, price_monthly, sort_order)
values ('pacientes', 'Pacientes e prontuário',
        'Ficha do paciente, anamnese personalizável, evolução, preparação e cuidados.', 0, 1)
on conflict (key) do nothing;

-- Quais módulos cada clínica contratou. Só o gerente do sistema liga/desliga.
create table if not exists clinic_modules (
  clinic_id     uuid not null references clinics (id) on delete cascade,
  module_key    text not null references modules (key) on delete cascade,
  -- Preço combinado com esta clínica (vazio = preço de tabela do módulo).
  price_monthly numeric(10,2) check (price_monthly >= 0),
  enabled_at    timestamptz not null default now(),
  primary key (clinic_id, module_key)
);
alter table clinic_modules enable row level security;
drop policy if exists clinic_modules_select on clinic_modules;
create policy clinic_modules_select on clinic_modules for select to authenticated
  using (is_clinic_member(clinic_id));
drop policy if exists clinic_modules_admin on clinic_modules;
create policy clinic_modules_admin on clinic_modules for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

create or replace function clinic_has_module(p_clinic_id uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clinic_modules cm join modules m on m.key = cm.module_key
    where cm.clinic_id = p_clinic_id and cm.module_key = p_key and m.active
  );
$$;

-- Vocabulário da clínica: 'saude' (paciente, anamnese, prontuário) ou
-- 'beleza' (cliente, ficha de avaliação, ficha técnica). Só muda o texto da tela.
alter table clinics
  add column if not exists record_vocabulary text not null default 'saude'
    check (record_vocabulary in ('saude', 'beleza'));

-- ---------------------------------------------------------------------
-- 2. Quem pode ver os registros
-- ---------------------------------------------------------------------
-- Dono da clínica: papel 'admin' NA clínica (o gerente do sistema não conta).
create or replace function _is_clinic_owner(p_clinic_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clinic_members
    where clinic_id = p_clinic_id and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Profissional (cadastro em professionals ligado ao login) desta clínica.
create or replace function _my_professional_id(p_clinic_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from professionals p
  join clinic_members m on m.clinic_id = p.clinic_id and m.user_id = p.user_id
  where p.clinic_id = p_clinic_id and p.user_id = auth.uid()
  limit 1;
$$;

-- Pode ver o prontuário deste paciente?
--   dono: sempre; profissional: se atendeu (agendamento não cancelado com ele)
--   ou se já escreveu algum registro do paciente.
-- (plpgsql porque consulta record_entries, criada mais abaixo neste arquivo.)
create or replace function _can_view_records(p_clinic_id uuid, p_contact_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return _is_clinic_owner(p_clinic_id) or exists (
    select 1 from professionals p
    join clinic_members m on m.clinic_id = p.clinic_id and m.user_id = p.user_id
    where p.clinic_id = p_clinic_id and p.user_id = auth.uid()
      and (
        exists (select 1 from appointments a
                where a.contact_id = p_contact_id and a.professional_id = p.id
                  and a.status <> 'cancelado')
        or exists (select 1 from record_entries e
                   where e.contact_id = p_contact_id and e.created_by = auth.uid())
      )
  );
end $$;

-- ---------------------------------------------------------------------
-- 3. Modelos de ficha (personalizáveis por clínica)
--   fields = lista de perguntas, ex.:
--   [{"id":"dor","type":"scale","label":"Nível de dor","required":true},
--    {"id":"alergia","type":"yesno","label":"Tem alergia?"},
--    {"id":"qual","type":"text","label":"Qual?"}]
--   Tipos: section, text, textarea, yesno, choice, multi, scale, number, date.
-- ---------------------------------------------------------------------
create table if not exists record_templates (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics (id) on delete cascade,
  kind        text not null check (kind in ('anamnese', 'evolucao')),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  description text check (char_length(description) <= 500),
  fields      jsonb not null default '[]'
              check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 80),
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, clinic_id)
);
create index if not exists record_templates_clinic_idx on record_templates (clinic_id, kind, sort_order);
alter table record_templates enable row level security;

-- Modelos não são dados de saúde: toda a equipe vê (a recepção precisa
-- escolher o modelo ao mandar o link); só o gerente da clínica edita.
drop policy if exists record_templates_select on record_templates;
create policy record_templates_select on record_templates for select to authenticated
  using (is_clinic_member(clinic_id) and clinic_has_module(clinic_id, 'pacientes'));
drop policy if exists record_templates_write on record_templates;
create policy record_templates_write on record_templates for all to authenticated
  using (can_manage_clinic(clinic_id) and clinic_has_module(clinic_id, 'pacientes'))
  with check (can_manage_clinic(clinic_id) and clinic_has_module(clinic_id, 'pacientes'));

-- Confere o formato das perguntas (o app também confere, mas o banco é a palavra final).
create or replace function _valid_fields(p_fields jsonb) returns boolean
language plpgsql immutable as $$
declare
  f jsonb;
  v_ids text[] := '{}';
begin
  if jsonb_typeof(p_fields) <> 'array' then return false; end if;
  for f in select * from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(f) <> 'object'
       or coalesce(f->>'id', '') !~ '^[a-z0-9_]{1,40}$'
       or f->>'id' = any (v_ids)
       or coalesce(f->>'type', '') not in
          ('section', 'text', 'textarea', 'yesno', 'choice', 'multi', 'scale', 'number', 'date')
       or char_length(btrim(coalesce(f->>'label', ''))) not between 1 and 200 then
      return false;
    end if;
    if f->>'type' in ('choice', 'multi') and (
         jsonb_typeof(f->'options') is distinct from 'array'
         or jsonb_array_length(f->'options') not between 1 and 30) then
      return false;
    end if;
    v_ids := v_ids || (f->>'id');
  end loop;
  return true;
end $$;

alter table record_templates drop constraint if exists record_templates_fields_valid;
alter table record_templates add constraint record_templates_fields_valid check (_valid_fields(fields));

-- ---------------------------------------------------------------------
-- 4. Registros (anamneses e evoluções) + adendos
-- ---------------------------------------------------------------------
alter table contacts add column if not exists health_consent_at timestamptz;

create table if not exists record_entries (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics (id) on delete cascade,
  contact_id      uuid not null,
  kind            text not null check (kind in ('anamnese', 'evolucao')),
  template_id     uuid references record_templates (id) on delete set null,
  title           text not null check (char_length(btrim(title)) between 2 and 120),
  -- Cópia das perguntas no momento do preenchimento: se o modelo for editado
  -- depois, o registro antigo continua legível exatamente como foi respondido.
  fields          jsonb not null default '[]',
  answers         jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  notes           text check (char_length(notes) <= 10000),
  appointment_id  uuid references appointments (id) on delete set null,
  professional_id uuid references professionals (id) on delete set null,
  source          text not null default 'equipe' check (source in ('equipe', 'link')),
  status          text not null default 'rascunho' check (status in ('rascunho', 'assinado')),
  signed_at       timestamptz,
  signed_by       uuid references auth.users (id) on delete set null,
  signed_name     text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Sem "on delete cascade" no contato: um paciente com prontuário não pode ser
  -- apagado por engano (a exclusão da clínica inteira continua funcionando).
  foreign key (contact_id, clinic_id) references contacts (id, clinic_id),
  check (status = 'rascunho' or (signed_at is not null and signed_name is not null)),
  check (pg_column_size(answers) <= 200000)
);
create index if not exists record_entries_contact_idx on record_entries (contact_id, created_at desc);
create index if not exists record_entries_clinic_idx on record_entries (clinic_id, created_at desc);
create index if not exists record_entries_author_idx on record_entries (created_by, contact_id);

create table if not exists record_addenda (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references record_entries (id) on delete cascade,
  clinic_id   uuid not null references clinics (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 2 and 5000),
  author_name text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists record_addenda_entry_idx on record_addenda (entry_id, created_at);

-- Registro assinado não muda e não some. A exceção é o servidor sem usuário
-- logado (auth.uid() nulo), usado só na exclusão definitiva da clínica.
create or replace function record_entries_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Limpeza automática de vínculos (apagaram o agendamento, o profissional, o
  -- modelo ou o usuário): só zera a referência, o conteúdo fica intacto.
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['appointment_id', 'professional_id', 'template_id', 'signed_by', 'created_by', 'updated_at'])
       = (to_jsonb(old) - array['appointment_id', 'professional_id', 'template_id', 'signed_by', 'created_by', 'updated_at'])
     and (new.appointment_id is null or new.appointment_id = old.appointment_id)
     and (new.professional_id is null or new.professional_id = old.professional_id)
     and (new.template_id is null or new.template_id = old.template_id)
     and (new.signed_by is null or new.signed_by = old.signed_by)
     and (new.created_by is null or new.created_by = old.created_by)
     and old.status = 'assinado' then
    return new;
  end if;
  if old.status = 'assinado' then
    raise exception 'RECORD_SIGNED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists record_entries_guard on record_entries;
create trigger record_entries_guard before update or delete on record_entries
  for each row execute function record_entries_guard();

create or replace function record_addenda_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'UPDATE' and new.body = old.body and new.author_name = old.author_name
     and new.created_at = old.created_at and (new.created_by is null or new.created_by = old.created_by) then
    return new; -- usuário removido: só zera created_by
  end if;
  raise exception 'ADDENDUM_LOCKED';
end $$;
drop trigger if exists record_addenda_guard on record_addenda;
create trigger record_addenda_guard before update or delete on record_addenda
  for each row execute function record_addenda_guard();

-- ---------------------------------------------------------------------
-- 5. Registro de acesso (auditoria)
-- ---------------------------------------------------------------------
create table if not exists record_access_log (
  id         bigint generated always as identity primary key,
  clinic_id  uuid not null references clinics (id) on delete cascade,
  contact_id uuid not null,
  user_id    uuid references auth.users (id) on delete set null,
  user_name  text,
  action     text not null check (action in ('ver', 'criar', 'editar', 'assinar', 'adendo', 'excluir_rascunho', 'link')),
  entry_id   uuid,
  at         timestamptz not null default now()
);
create index if not exists record_access_log_contact_idx on record_access_log (contact_id, at desc);

-- Sem políticas = ninguém acessa direto; só as funções abaixo.
alter table record_entries    enable row level security;
alter table record_addenda    enable row level security;
alter table record_access_log enable row level security;

-- Nome de quem está agindo (para assinaturas e auditoria).
create or replace function _actor_name(p_clinic_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.name from professionals p where p.clinic_id = p_clinic_id and p.user_id = auth.uid() limit 1),
    (select nullif(btrim(u.raw_user_meta_data->>'full_name'), '') from auth.users u where u.id = auth.uid()),
    (select u.email from auth.users u where u.id = auth.uid()),
    'Equipe');
$$;

create or replace function _log_record(p_clinic_id uuid, p_contact_id uuid, p_action text, p_entry_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into record_access_log (clinic_id, contact_id, user_id, user_name, action, entry_id)
  values (p_clinic_id, p_contact_id, auth.uid(), _actor_name(p_clinic_id), p_action, p_entry_id);
$$;

-- Guarda só as respostas das perguntas existentes e confere as obrigatórias.
-- Devolve as respostas limpas ou levanta 'REQUIRED_FIELD:<id>' / 'INVALID_ANSWER:<id>'.
create or replace function _clean_answers(p_fields jsonb, p_answers jsonb, p_check_required boolean)
returns jsonb language plpgsql immutable as $$
declare
  f      jsonb;
  v      jsonb;
  v_out  jsonb := '{}';
  v_type text;
  v_id   text;
begin
  for f in select * from jsonb_array_elements(coalesce(p_fields, '[]')) loop
    v_type := f->>'type';
    v_id := f->>'id';
    if v_type = 'section' then continue; end if;
    v := coalesce(p_answers, '{}')->v_id;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then
      if p_check_required and coalesce((f->>'required')::boolean, false) then
        raise exception 'REQUIRED_FIELD:%', v_id;
      end if;
      continue;
    end if;
    if (v_type in ('text', 'textarea', 'choice', 'date') and jsonb_typeof(v) <> 'string')
       or (v_type = 'yesno' and jsonb_typeof(v) <> 'boolean')
       or (v_type in ('scale', 'number') and jsonb_typeof(v) <> 'number')
       or (v_type = 'multi' and jsonb_typeof(v) <> 'array')
       or (v_type = 'textarea' and char_length(v #>> '{}') > 5000)
       or (v_type = 'text' and char_length(v #>> '{}') > 500)
       or (v_type = 'scale' and (v::numeric < 0 or v::numeric > 10))
       or (v_type = 'choice' and not (f->'options') ? (v #>> '{}'))
       or (v_type = 'date' and (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'INVALID_ANSWER:%', v_id;
    end if;
    -- múltipla escolha: cada item marcado precisa ser uma das opções
    if v_type = 'multi' and exists (
         select 1 from jsonb_array_elements(v) x
         where jsonb_typeof(x) <> 'string' or not (f->'options') ? (x #>> '{}')) then
      raise exception 'INVALID_ANSWER:%', v_id;
    end if;
    v_out := v_out || jsonb_build_object(v_id, v);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 6. Funções do prontuário (usadas pelo painel)
-- ---------------------------------------------------------------------

-- Abre a ficha de um paciente: dados, registros (com adendos) e, para o dono,
-- o histórico de acessos. Anota o acesso.
create or replace function patient_record(p_contact_id uuid) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  ct contacts;
  v_owner boolean;
begin
  select * into ct from contacts where id = p_contact_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_owner := _is_clinic_owner(ct.clinic_id);
  -- Sem o módulo, o dono ainda consegue LER (os dados são da clínica); ninguém grava.
  if not (clinic_has_module(ct.clinic_id, 'pacientes') or v_owner) then raise exception 'MODULE_DISABLED'; end if;
  if not _can_view_records(ct.clinic_id, p_contact_id) then raise exception 'FORBIDDEN'; end if;

  perform _log_record(ct.clinic_id, p_contact_id, 'ver', null);

  return json_build_object(
    'contact', json_build_object(
      'id', ct.id, 'full_name', ct.full_name, 'email', ct.email, 'phone', ct.phone,
      'status', ct.status, 'insurance', ct.insurance, 'notes', ct.notes,
      'health_consent_at', ct.health_consent_at, 'created_at', ct.created_at),
    'is_owner', v_owner,
    'can_write', clinic_has_module(ct.clinic_id, 'pacientes'),
    'entries', coalesce((
      select json_agg(json_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'template_id', e.template_id,
        'fields', e.fields, 'answers', e.answers, 'notes', e.notes,
        'appointment_id', e.appointment_id, 'professional_id', e.professional_id,
        'source', e.source, 'status', e.status, 'signed_at', e.signed_at, 'signed_name', e.signed_name,
        'mine', e.created_by = auth.uid(), 'created_at', e.created_at, 'updated_at', e.updated_at,
        'addenda', coalesce((
          select json_agg(json_build_object('id', a.id, 'body', a.body, 'author_name', a.author_name,
                                            'created_at', a.created_at) order by a.created_at)
          from record_addenda a where a.entry_id = e.id), '[]'::json)
      ) order by e.created_at desc)
      from record_entries e
      where e.contact_id = p_contact_id
        -- rascunho é visível só para quem escreveu (e para o dono)
        and (e.status = 'assinado' or e.created_by = auth.uid() or v_owner)
    ), '[]'::json),
    'appointments', coalesce((
      select json_agg(json_build_object(
        'id', a.id, 'starts_at', a.starts_at, 'status', a.status, 'modality', a.modality,
        'procedure_name', pr.name, 'professional_name', pf.name) order by a.starts_at desc)
      from appointments a
      join procedures pr on pr.id = a.procedure_id
      join professionals pf on pf.id = a.professional_id
      where a.contact_id = p_contact_id), '[]'::json),
    'access_log', case when v_owner then coalesce((
      select json_agg(json_build_object('user_name', l.user_name, 'action', l.action, 'at', l.at) order by l.at desc)
      from (select * from record_access_log where contact_id = p_contact_id order by at desc limit 100) l
    ), '[]'::json) end
  );
end $$;

-- Cria ou edita um registro (rascunho) e, se p_sign, assina.
create or replace function save_record_entry(
  p_id             uuid,
  p_contact_id     uuid,
  p_kind           text,
  p_template_id    uuid,
  p_title          text,
  p_answers        jsonb,
  p_notes          text default null,
  p_appointment_id uuid default null,
  p_sign           boolean default false
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  ct   contacts;
  e    record_entries;
  t    record_templates;
  v_fields jsonb;
  v_answers jsonb;
begin
  select * into ct from contacts where id = p_contact_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not clinic_has_module(ct.clinic_id, 'pacientes') then raise exception 'MODULE_DISABLED'; end if;
  -- Para registrar, precisa ser o dono ou um profissional da clínica.
  if not (_is_clinic_owner(ct.clinic_id) or _my_professional_id(ct.clinic_id) is not null) then
    raise exception 'FORBIDDEN';
  end if;
  -- Profissional que nunca atendeu o paciente só pode escrever se estiver
  -- registrando um atendimento dele (agendamento com ele).
  if not _can_view_records(ct.clinic_id, p_contact_id) and not exists (
       select 1 from appointments a where a.id = p_appointment_id and a.contact_id = p_contact_id
         and a.professional_id = _my_professional_id(ct.clinic_id)) then
    raise exception 'FORBIDDEN';
  end if;
  if p_appointment_id is not null and not exists (
       select 1 from appointments a where a.id = p_appointment_id and a.contact_id = p_contact_id) then
    raise exception 'INVALID_APPOINTMENT';
  end if;

  if p_id is null then
    if p_kind not in ('anamnese', 'evolucao') then raise exception 'INVALID_KIND'; end if;
    if p_template_id is not null then
      select * into t from record_templates where id = p_template_id and clinic_id = ct.clinic_id;
      if not found then raise exception 'TEMPLATE_NOT_FOUND'; end if;
      v_fields := t.fields;
    else
      v_fields := '[]';
    end if;
    v_answers := _clean_answers(v_fields, p_answers, p_sign);
    insert into record_entries (clinic_id, contact_id, kind, template_id, title, fields, answers, notes,
                                appointment_id, professional_id, created_by)
    values (ct.clinic_id, p_contact_id, p_kind, p_template_id,
            coalesce(nullif(btrim(p_title), ''), t.name, 'Registro'), v_fields, v_answers,
            nullif(btrim(coalesce(p_notes, '')), ''), p_appointment_id,
            _my_professional_id(ct.clinic_id), auth.uid())
    returning * into e;
    perform _log_record(ct.clinic_id, p_contact_id, 'criar', e.id);
  else
    select * into e from record_entries where id = p_id and contact_id = p_contact_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if e.status = 'assinado' then raise exception 'RECORD_SIGNED'; end if;
    if e.created_by is distinct from auth.uid() and not _is_clinic_owner(ct.clinic_id) then
      raise exception 'FORBIDDEN';
    end if;
    v_answers := _clean_answers(e.fields, p_answers, p_sign);
    update record_entries set
      title = coalesce(nullif(btrim(p_title), ''), e.title),
      answers = v_answers,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      appointment_id = coalesce(p_appointment_id, e.appointment_id)
    where id = e.id
    returning * into e;
    perform _log_record(ct.clinic_id, p_contact_id, 'editar', e.id);
  end if;

  if p_sign then
    update record_entries set status = 'assinado', signed_at = now(), signed_by = auth.uid(),
                              signed_name = _actor_name(ct.clinic_id)
    where id = e.id;
    perform _log_record(ct.clinic_id, p_contact_id, 'assinar', e.id);
  end if;
  return e.id;
end $$;

-- Apaga um RASCUNHO (assinado não pode — o gatilho também barra).
create or replace function delete_record_draft(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  e record_entries;
begin
  select * into e from record_entries where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if e.status = 'assinado' then raise exception 'RECORD_SIGNED'; end if;
  if e.created_by is distinct from auth.uid() and not _is_clinic_owner(e.clinic_id) then
    raise exception 'FORBIDDEN';
  end if;
  delete from record_entries where id = p_id;
  perform _log_record(e.clinic_id, e.contact_id, 'excluir_rascunho', p_id);
end $$;

-- Adendo: a forma correta de corrigir/complementar um registro assinado.
create or replace function add_record_addendum(p_entry_id uuid, p_body text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  e record_entries;
  v_id uuid;
begin
  select * into e from record_entries where id = p_entry_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not clinic_has_module(e.clinic_id, 'pacientes') then raise exception 'MODULE_DISABLED'; end if;
  if not _can_view_records(e.clinic_id, e.contact_id)
     or not (_is_clinic_owner(e.clinic_id) or _my_professional_id(e.clinic_id) is not null) then
    raise exception 'FORBIDDEN';
  end if;
  if e.status <> 'assinado' then raise exception 'NOT_SIGNED'; end if;
  insert into record_addenda (entry_id, clinic_id, body, author_name, created_by)
  values (e.id, e.clinic_id, btrim(p_body), _actor_name(e.clinic_id), auth.uid())
  returning id into v_id;
  perform _log_record(e.clinic_id, e.contact_id, 'adendo', e.id);
  return v_id;
end $$;

-- Registra o consentimento do paciente para dados de saúde (LGPD, art. 11).
create or replace function set_health_consent(p_contact_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  ct contacts;
begin
  select * into ct from contacts where id = p_contact_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not _can_view_records(ct.clinic_id, p_contact_id) then raise exception 'FORBIDDEN'; end if;
  update contacts set health_consent_at = coalesce(health_consent_at, now()) where id = p_contact_id;
end $$;

-- ---------------------------------------------------------------------
-- 7. Link de preenchimento da anamnese (paciente sem login)
--   Guardamos só o HASH do código: quem vê o banco não consegue usar o link.
-- ---------------------------------------------------------------------
create table if not exists record_intake_links (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics (id) on delete cascade,
  contact_id  uuid not null,
  template_id uuid not null,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  entry_id    uuid references record_entries (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (contact_id, clinic_id) references contacts (id, clinic_id) on delete cascade,
  foreign key (template_id, clinic_id) references record_templates (id, clinic_id) on delete cascade
);
create index if not exists record_intake_links_contact_idx on record_intake_links (contact_id, created_at desc);
alter table record_intake_links enable row level security;

create or replace function _intake_hash(p_token text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- A equipe (inclusive a recepção) gera o link; quem responde é o paciente.
-- A recepção gera mas NÃO consegue ler a resposta depois.
create or replace function create_intake_link(p_contact_id uuid, p_template_id uuid, p_days int default 7)
returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  ct contacts;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_expires timestamptz := now() + make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30));
begin
  select * into ct from contacts where id = p_contact_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from clinic_members where clinic_id = ct.clinic_id and user_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if not clinic_has_module(ct.clinic_id, 'pacientes') then raise exception 'MODULE_DISABLED'; end if;
  if not exists (select 1 from record_templates where id = p_template_id and clinic_id = ct.clinic_id
                 and kind = 'anamnese' and active) then
    raise exception 'TEMPLATE_NOT_FOUND';
  end if;
  insert into record_intake_links (clinic_id, contact_id, template_id, token_hash, expires_at, created_by)
  values (ct.clinic_id, p_contact_id, p_template_id, _intake_hash(v_token), v_expires, auth.uid());
  perform _log_record(ct.clinic_id, p_contact_id, 'link', null);
  return json_build_object('token', v_token, 'expires_at', v_expires);
end $$;

-- O paciente abre o link: vê a marca da clínica, o primeiro nome e as perguntas.
create or replace function public_intake(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  l record_intake_links;
begin
  select * into l from record_intake_links where token_hash = _intake_hash(p_token);
  if not found then raise exception 'INTAKE_NOT_FOUND'; end if;
  if l.used_at is not null then raise exception 'INTAKE_USED'; end if;
  if l.expires_at < now() then raise exception 'INTAKE_EXPIRED'; end if;
  if not clinic_has_module(l.clinic_id, 'pacientes') then raise exception 'INTAKE_NOT_FOUND'; end if;
  return (
    select json_build_object(
      'clinic', json_build_object('name', c.name, 'logo_url', c.logo_url, 'primary_color', c.primary_color,
                                  'secondary_color', c.secondary_color, 'font_family', c.font_family,
                                  'vocabulary', c.record_vocabulary),
      'first_name', split_part(ct.full_name, ' ', 1),
      'title', t.name,
      'description', t.description,
      'fields', t.fields,
      'expires_at', l.expires_at)
    from clinics c, contacts ct, record_templates t
    where c.id = l.clinic_id and ct.id = l.contact_id and t.id = l.template_id
  );
end $$;

-- O paciente envia as respostas: vira um registro ASSINADO pelo próprio paciente.
create or replace function public_intake_submit(p_token text, p_answers jsonb, p_consent boolean)
returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  l record_intake_links;
  t record_templates;
  ct contacts;
  v_answers jsonb;
  v_entry uuid;
begin
  if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED'; end if;
  select * into l from record_intake_links where token_hash = _intake_hash(p_token) for update;
  if not found then raise exception 'INTAKE_NOT_FOUND'; end if;
  if l.used_at is not null then raise exception 'INTAKE_USED'; end if;
  if l.expires_at < now() then raise exception 'INTAKE_EXPIRED'; end if;
  if not clinic_has_module(l.clinic_id, 'pacientes') then raise exception 'INTAKE_NOT_FOUND'; end if;

  select * into t from record_templates where id = l.template_id;
  select * into ct from contacts where id = l.contact_id;
  v_answers := _clean_answers(t.fields, p_answers, true);

  insert into record_entries (clinic_id, contact_id, kind, template_id, title, fields, answers,
                              source, status, signed_at, signed_name)
  values (l.clinic_id, l.contact_id, 'anamnese', t.id, t.name, t.fields, v_answers,
          'link', 'assinado', now(), ct.full_name || ' (pelo link)')
  returning id into v_entry;

  update record_intake_links set used_at = now(), entry_id = v_entry where id = l.id;
  update contacts set health_consent_at = coalesce(health_consent_at, now()) where id = l.contact_id;
  insert into record_access_log (clinic_id, contact_id, user_name, action, entry_id)
  values (l.clinic_id, l.contact_id, ct.full_name || ' (paciente)', 'criar', v_entry);
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 8. Preparação e cuidados por serviço
-- ---------------------------------------------------------------------
alter table procedures
  add column if not exists prep_instructions   text check (char_length(prep_instructions) <= 3000),
  add column if not exists care_instructions   text check (char_length(care_instructions) <= 3000),
  add column if not exists anamnese_template_id uuid references record_templates (id) on delete set null;

-- ---------------------------------------------------------------------
-- 9. Fotos e anexos do prontuário: armazenamento PRIVADO
--   Caminho: clinic-records/<clinic_id>/<contact_id>/<arquivo>
--   Sem link público: o app pede um link temporário (createSignedUrl).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-records', 'clinic-records', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create or replace function _storage_can_view_record(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_clinic uuid;
  v_contact uuid;
begin
  if array_length(v_parts, 1) is distinct from 2 then return false; end if;
  begin
    v_clinic := v_parts[1]::uuid;
    v_contact := v_parts[2]::uuid;
  exception when others then return false;
  end;
  return exists (select 1 from contacts where id = v_contact and clinic_id = v_clinic)
     and clinic_has_module(v_clinic, 'pacientes')
     and _can_view_records(v_clinic, v_contact);
end $$;

drop policy if exists clinic_records_select on storage.objects;
create policy clinic_records_select on storage.objects for select to authenticated
  using (bucket_id = 'clinic-records' and public._storage_can_view_record(name));
drop policy if exists clinic_records_insert on storage.objects;
create policy clinic_records_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinic-records' and public._storage_can_view_record(name));
-- Sem update/delete: arquivo do prontuário não é trocado nem apagado pela equipe.

-- ---------------------------------------------------------------------
-- 10. Exclusão definitiva da clínica (gerente do sistema): inclui o módulo
-- ---------------------------------------------------------------------
create or replace function admin_purge_clinic(p_clinic_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from record_intake_links where clinic_id = p_clinic_id;
  delete from record_addenda where clinic_id = p_clinic_id;
  delete from record_entries where clinic_id = p_clinic_id;
  delete from record_access_log where clinic_id = p_clinic_id;
  delete from appointments where clinic_id = p_clinic_id;
  delete from waitlist where clinic_id = p_clinic_id;
  delete from schedule_events where clinic_id = p_clinic_id;
  delete from clinics where id = p_clinic_id;
end $$;

-- ---------------------------------------------------------------------
-- 11. Permissões
-- ---------------------------------------------------------------------
revoke all on function clinic_has_module(uuid, text) from public, anon;
grant execute on function clinic_has_module(uuid, text) to authenticated;

revoke all on function _is_clinic_owner(uuid) from public, anon, authenticated;
revoke all on function _my_professional_id(uuid) from public, anon, authenticated;
revoke all on function _can_view_records(uuid, uuid) from public, anon, authenticated;
revoke all on function _actor_name(uuid) from public, anon, authenticated;
revoke all on function _log_record(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function _clean_answers(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function _intake_hash(text) from public, anon, authenticated;
revoke all on function record_entries_guard() from public, anon, authenticated;
revoke all on function record_addenda_guard() from public, anon, authenticated;
-- Usadas por políticas RLS (precisam ser executáveis por quem está logado):
grant execute on function _valid_fields(jsonb) to authenticated;
revoke all on function _storage_can_view_record(text) from public, anon;
grant execute on function _storage_can_view_record(text) to authenticated;

revoke all on function patient_record(uuid) from public, anon;
revoke all on function save_record_entry(uuid, uuid, text, uuid, text, jsonb, text, uuid, boolean) from public, anon;
revoke all on function delete_record_draft(uuid) from public, anon;
revoke all on function add_record_addendum(uuid, text) from public, anon;
revoke all on function set_health_consent(uuid) from public, anon;
revoke all on function create_intake_link(uuid, uuid, int) from public, anon;
grant execute on function patient_record(uuid) to authenticated;
grant execute on function save_record_entry(uuid, uuid, text, uuid, text, jsonb, text, uuid, boolean) to authenticated;
grant execute on function delete_record_draft(uuid) to authenticated;
grant execute on function add_record_addendum(uuid, text) to authenticated;
grant execute on function set_health_consent(uuid) to authenticated;
grant execute on function create_intake_link(uuid, uuid, int) to authenticated;

revoke all on function public_intake(text) from public;
revoke all on function public_intake_submit(text, jsonb, boolean) from public;
grant execute on function public_intake(text) to anon, authenticated;
grant execute on function public_intake_submit(text, jsonb, boolean) to anon, authenticated;

revoke all on function admin_purge_clinic(uuid) from public, anon, authenticated;
grant execute on function admin_purge_clinic(uuid) to service_role;
