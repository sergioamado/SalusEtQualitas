import { supabase } from '@/lib/supabase';
import { fromLocal } from '@/lib/tz';

export type Status = 'agendado' | 'reservado' | 'confirmado' | 'nao_compareceu' | 'concluido' | 'cancelado';
export type Modality = 'clinica' | 'residencial';
export type Channel = 'interno' | 'portal' | 'whatsapp' | 'telefone' | 'instagram' | 'outro';
export type EventKind = 'reuniao' | 'feriado' | 'folga' | 'outro';

export const STATUS_LABEL: Record<Status, string> = {
  reservado: 'Aguardando aprovação',
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  nao_compareceu: 'Não compareceu',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};
export const STATUS_ORDER: Status[] = ['reservado', 'agendado', 'confirmado', 'concluido', 'nao_compareceu', 'cancelado'];
export const STATUS_COLOR: Record<Status, string> = {
  reservado: '#D97706',
  agendado: '#2563EB',
  confirmado: '#16A34A',
  concluido: '#64748B',
  nao_compareceu: '#DC2626',
  cancelado: '#94A3B8',
};
export const CHANNEL_LABEL: Record<Channel, string> = {
  interno: 'Recepção',
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  portal: 'Link de agendamento',
  outro: 'Outro',
};
export const EVENT_LABEL: Record<EventKind, string> = {
  reuniao: 'Reunião',
  feriado: 'Feriado',
  folga: 'Folga',
  outro: 'Outro',
};

export type AgendaAppointment = {
  id: string;
  status: Status;
  modality: Modality;
  channel: Channel;
  starts_at: string;
  ends_at: string;
  busy_start: string;
  busy_end: string;
  notes: string | null;
  price: number | null;
  insurance: string | null;
  cancel_reason: string | null;
  google_sync_error: string | null;
  professional_id: string;
  procedure_id: string;
  room_id: string | null;
  contact_id: string;
  address_cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  contact: { id: string; full_name: string; phone: string | null; email: string | null; status: string } | null;
};

export type AgendaEvent = {
  id: string;
  kind: EventKind;
  title: string;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  professional_id: string | null;
  room_id: string | null;
};

export type AgendaProfessional = {
  id: string;
  name: string;
  color: string | null;
  active: boolean;
  user_id: string | null;
  home_care_enabled: boolean;
};
export type AgendaProcedure = {
  id: string;
  name: string;
  duration_min: number;
  price: number | null;
  allows_clinic: boolean;
  allows_home_care: boolean;
  active: boolean;
};
export type AgendaRoom = { id: string; name: string; active: boolean };
export type HoursRow = { professional_id: string; weekday: number; start_time: string; end_time: string };

/** Cadastros que a agenda usa (mudam pouco). */
export type AgendaSetup = {
  professionals: AgendaProfessional[];
  procedures: AgendaProcedure[];
  rooms: AgendaRoom[];
  hours: HoursRow[];
  breaks: HoursRow[];
  /** procedure_id -> professional_ids */
  profsByProcedure: Record<string, string[]>;
};

const APPOINTMENT_SELECT = `
  id, status, modality, channel, starts_at, ends_at, busy_start, busy_end, notes, price, insurance,
  cancel_reason, google_sync_error, professional_id, procedure_id, room_id, contact_id,
  address_cep, address_street, address_number, address_complement, address_district, address_city, address_state,
  contact:contacts!appointments_contact_id_clinic_id_fkey ( id, full_name, phone, email, status )
`;

export async function loadSetup(clinicId: string): Promise<AgendaSetup> {
  const [p, s, r] = await Promise.all([
    supabase.from('professionals').select('id,name,color,active,user_id,home_care_enabled').eq('clinic_id', clinicId).order('name'),
    supabase
      .from('procedures')
      .select('id,name,duration_min,price,allows_clinic,allows_home_care,active')
      .eq('clinic_id', clinicId)
      .order('sort_order')
      .order('name'),
    supabase.from('rooms').select('id,name,active').eq('clinic_id', clinicId).order('name'),
  ]);
  const error = p.error ?? s.error ?? r.error;
  if (error) throw new Error(error.message);
  const ids = (p.data ?? []).map((x) => x.id as string);
  let hours: HoursRow[] = [];
  let breaks: HoursRow[] = [];
  const profsByProcedure: Record<string, string[]> = {};
  if (ids.length) {
    const [h, b, pp] = await Promise.all([
      supabase.from('working_hours').select('professional_id,weekday,start_time,end_time').in('professional_id', ids),
      supabase.from('professional_breaks').select('professional_id,weekday,start_time,end_time').in('professional_id', ids),
      supabase.from('professional_procedures').select('professional_id,procedure_id').in('professional_id', ids),
    ]);
    const e2 = h.error ?? b.error ?? pp.error;
    if (e2) throw new Error(e2.message);
    hours = (h.data ?? []) as HoursRow[];
    breaks = (b.data ?? []) as HoursRow[];
    for (const row of pp.data ?? []) (profsByProcedure[row.procedure_id] ??= []).push(row.professional_id);
  }
  return {
    professionals: (p.data ?? []) as AgendaProfessional[],
    procedures: (s.data ?? []) as AgendaProcedure[],
    rooms: (r.data ?? []) as AgendaRoom[],
    hours,
    breaks,
    profsByProcedure,
  };
}

/** Agendamentos e bloqueios entre duas datas locais (inclusive). */
export async function loadRange(clinicId: string, timeZone: string, firstDay: string, lastDayExclusive: string) {
  const from = fromLocal(firstDay, 0, timeZone);
  const to = fromLocal(lastDayExclusive, 0, timeZone);
  const [a, e, w] = await Promise.all([
    supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('clinic_id', clinicId)
      .lt('busy_start', to)
      .gt('busy_end', from)
      .order('starts_at'),
    supabase
      .from('schedule_events')
      .select('id,kind,title,starts_at,ends_at,notes,professional_id,room_id')
      .eq('clinic_id', clinicId)
      .lt('starts_at', to)
      .gt('ends_at', from)
      .order('starts_at'),
    supabase
      .from('waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('status', 'aguardando'),
  ]);
  const error = a.error ?? e.error;
  if (error) throw new Error(error.message);
  return {
    appointments: (a.data ?? []) as unknown as AgendaAppointment[],
    events: (e.data ?? []) as AgendaEvent[],
    waitlistCount: w.count ?? 0,
  };
}

// ---------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------

export type SoftReason = 'OUTSIDE_HOURS' | 'BREAK' | 'BLOCKED';
export const SOFT_MESSAGE: Record<SoftReason, string> = {
  OUTSIDE_HOURS: 'Esse horário está fora do expediente do profissional.',
  BREAK: 'Esse horário cai na pausa do profissional (ex.: almoço).',
  BLOCKED: 'Há um bloqueio na agenda nesse horário (reunião, folga ou feriado).',
};

const ERRORS: Record<string, string> = {
  FORBIDDEN: 'Você não tem acesso a esta clínica.',
  NOT_FOUND: 'Agendamento não encontrado.',
  PROCEDURE_NOT_FOUND: 'Escolha o serviço.',
  PROFESSIONAL_NOT_FOUND: 'Escolha o profissional.',
  MODALITY_NOT_ALLOWED: 'Este serviço não é oferecido nesse local (clínica/residencial).',
  PROFESSIONAL_NO_HOME_CARE: 'Este profissional não faz atendimento residencial.',
  INVALID_START: 'Escolha o dia e o horário.',
  INVALID_DURATION: 'Duração entre 5 e 720 minutos.',
  CONTACT_NOT_FOUND: 'Paciente não encontrado.',
  CONTACT_REQUIRED: 'Escolha ou cadastre o paciente.',
  INVALID_NAME: 'Informe o nome do paciente.',
  INVALID_EMAIL: 'E-mail do paciente inválido.',
  INVALID_PHONE: 'Telefone do paciente inválido. Use DDD + número.',
  INVALID_ADDRESS: 'Atendimento residencial: preencha CEP, rua, número, bairro, cidade e UF.',
  PROFESSIONAL_BUSY: 'O profissional já tem outro atendimento nesse horário.',
  NO_ROOM: 'Não há sala livre nesse horário para este serviço.',
};

export class SaveError extends Error {
  constructor(
    message: string,
    public soft?: SoftReason,
  ) {
    super(message);
  }
}

export type SavePayload = {
  id?: string;
  clinic_id: string;
  contact_id?: string;
  contact?: { full_name: string; phone?: string | null; email?: string | null };
  professional_id?: string;
  procedure_id?: string;
  starts_at?: string;
  duration_min?: number;
  modality?: Modality;
  status?: Status;
  channel?: Channel;
  notes?: string | null;
  price?: number | null;
  insurance?: string | null;
  cancel_reason?: string | null;
  address?: Record<string, string>;
  force?: boolean;
};

export async function saveAppointment(payload: SavePayload): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('staff_save_appointment', { p: payload });
  if (error) {
    const soft = error.message.match(/NEEDS_CONFIRM:(\w+)/)?.[1] as SoftReason | undefined;
    if (soft) throw new SaveError(SOFT_MESSAGE[soft] ?? 'Confirme o encaixe.', soft);
    const code = Object.keys(ERRORS).find((k) => error.message.includes(k));
    throw new SaveError(code ? ERRORS[code] : `Não foi possível salvar. ${error.message}`);
  }
  return data as { id: string };
}

export async function upsertContact(clinicId: string, contact: { full_name: string; phone?: string | null; email?: string | null }) {
  const { data, error } = await supabase.rpc('staff_upsert_contact', { p_clinic_id: clinicId, p: contact });
  if (error) {
    const code = Object.keys(ERRORS).find((k) => error.message.includes(k));
    throw new Error(code ? ERRORS[code] : error.message);
  }
  return data as string;
}

export type ContactHit = { id: string; full_name: string; phone: string | null; email: string | null };

/** Busca paciente por nome, telefone ou e-mail. */
export async function searchContacts(clinicId: string, term: string): Promise<ContactHit[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const digits = t.replace(/\D/g, '');
  const safe = t.replace(/[%,()*]/g, ' ');
  const ors = [`full_name.ilike.%${safe}%`, `email.ilike.%${safe}%`];
  if (digits.length >= 4) ors.push(`phone.like.%${digits}%`);
  const { data } = await supabase
    .from('contacts')
    .select('id,full_name,phone,email')
    .eq('clinic_id', clinicId)
    .or(ors.join(','))
    .order('full_name')
    .limit(8);
  return (data ?? []) as ContactHit[];
}
