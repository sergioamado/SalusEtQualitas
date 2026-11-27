// ============================================================================
// API DO PRONTUÁRIO — ponte entre as telas e as funções do banco
// ----------------------------------------------------------------------------
// Todas as leituras e gravações passam por funções (rpc) que conferem a
// permissão e anotam o acesso (veja a migration 20261127000000_modulo_pacientes).
// Aqui só chamamos essas funções e traduzimos os códigos de erro.
// ============================================================================
import { supabase } from '@/lib/supabase';

import type { Answers, FormField, RecordTemplate, TemplateKind } from './types';

export type PatientListItem = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  last_visit: string | null;
  next_visit: string | null;
  /** Pode abrir o prontuário? (dono, ou profissional que atendeu) */
  can_view: boolean;
  entries: number | null;
  has_intake: boolean | null;
  /** Atendido por mim (profissional). */
  mine: boolean;
};

export type Addendum = { id: string; body: string; author_name: string; created_at: string };

export type RecordEntry = {
  id: string;
  kind: TemplateKind;
  title: string;
  template_id: string | null;
  fields: FormField[];
  answers: Answers;
  notes: string | null;
  appointment_id: string | null;
  professional_id: string | null;
  source: 'equipe' | 'link';
  status: 'rascunho' | 'assinado';
  signed_at: string | null;
  signed_name: string | null;
  /** Fui eu que escrevi? */
  mine: boolean;
  created_at: string;
  updated_at: string;
  addenda: Addendum[];
};

export type PatientAppointment = {
  id: string;
  starts_at: string;
  status: string;
  modality: string;
  procedure_name: string;
  professional_name: string;
};

export type PatientRecord = {
  contact: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    status: string;
    insurance: string | null;
    notes: string | null;
    health_consent_at: string | null;
    created_at: string;
  };
  is_owner: boolean;
  can_write: boolean;
  entries: RecordEntry[];
  appointments: PatientAppointment[];
  /** Só o dono da clínica recebe. */
  access_log: { user_name: string | null; action: string; at: string }[] | null;
};

const ERRORS: Record<string, string> = {
  FORBIDDEN: 'Você não tem acesso a este prontuário. Só o dono da clínica e os profissionais que atenderam este paciente podem abrir.',
  MODULE_DISABLED: 'O módulo Pacientes não está ativo para esta clínica.',
  NOT_FOUND: 'Registro não encontrado.',
  RECORD_SIGNED: 'Este registro já foi assinado e não pode ser alterado. Use “Adicionar adendo”.',
  NOT_SIGNED: 'Assine o registro antes de adicionar um adendo.',
  TEMPLATE_NOT_FOUND: 'Este modelo de ficha não existe mais.',
  INVALID_APPOINTMENT: 'O atendimento escolhido não é deste paciente.',
  REQUIRED_FIELD: 'Há perguntas obrigatórias sem resposta.',
  INVALID_ANSWER: 'Alguma resposta está em formato inválido.',
};

export class RecordError extends Error {
  constructor(
    public code: string,
    /** Para REQUIRED_FIELD / INVALID_ANSWER: id da pergunta. */
    public fieldId?: string,
  ) {
    super(ERRORS[code] ?? 'Não foi possível concluir agora. Verifique sua conexão e tente novamente.');
  }
}

function toError(error: { message?: string }): RecordError {
  const msg = error.message ?? '';
  const field = msg.match(/(REQUIRED_FIELD|INVALID_ANSWER):(\w+)/);
  if (field) return new RecordError(field[1], field[2]);
  const code = Object.keys(ERRORS).find((k) => msg.includes(k));
  return new RecordError(code ?? 'UNKNOWN');
}

export async function listPatients(clinicId: string, search: string): Promise<PatientListItem[]> {
  const { data, error } = await supabase.rpc('record_patient_list', { p_clinic_id: clinicId, p_search: search || null });
  if (error) throw toError(error);
  return (data ?? []) as PatientListItem[];
}

export async function fetchRecord(contactId: string): Promise<PatientRecord> {
  const { data, error } = await supabase.rpc('patient_record', { p_contact_id: contactId });
  if (error) throw toError(error);
  return data as PatientRecord;
}

export async function fetchActiveTemplates(clinicId: string): Promise<RecordTemplate[]> {
  const { data, error } = await supabase
    .from('record_templates')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('active', true)
    .order('sort_order')
    .order('name');
  if (error) throw toError(error);
  return (data ?? []) as RecordTemplate[];
}

export async function saveEntry(input: {
  id: string | null;
  contactId: string;
  kind: TemplateKind;
  templateId: string | null;
  title: string;
  answers: Answers;
  notes: string;
  appointmentId: string | null;
  sign: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('save_record_entry', {
    p_id: input.id,
    p_contact_id: input.contactId,
    p_kind: input.kind,
    p_template_id: input.templateId,
    p_title: input.title,
    p_answers: input.answers,
    p_notes: input.notes,
    p_appointment_id: input.appointmentId,
    p_sign: input.sign,
  });
  if (error) throw toError(error);
  return data as string;
}

export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_record_draft', { p_id: id });
  if (error) throw toError(error);
}

export async function addAddendum(entryId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('add_record_addendum', { p_entry_id: entryId, p_body: body });
  if (error) throw toError(error);
}

export async function registerConsent(contactId: string): Promise<void> {
  const { error } = await supabase.rpc('set_health_consent', { p_contact_id: contactId });
  if (error) throw toError(error);
}

export const ACTION_LABEL: Record<string, string> = {
  ver: 'abriu a ficha',
  criar: 'criou um registro',
  editar: 'editou um rascunho',
  assinar: 'assinou um registro',
  adendo: 'adicionou um adendo',
  excluir_rascunho: 'excluiu um rascunho',
  link: 'gerou um link de preenchimento',
};
