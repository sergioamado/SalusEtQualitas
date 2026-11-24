import { supabase } from '@/lib/supabase';

export type Modality = 'clinica' | 'residencial';

export type PublicProcedure = {
  id: string;
  name: string;
  description: string | null;
  duration_min: number;
  price: number | null;
  allows_clinic: boolean;
  allows_home_care: boolean;
  image_url: string | null;
  video_url: string | null;
};

export type PublicProfessional = {
  id: string;
  name: string;
  specialty: string | null;
  home_care_enabled: boolean;
  procedure_ids: string[];
};

export type PublicClinic = {
  id: string;
  slug: string;
  name: string;
  phone: string | null;
  address: string | null;
  timezone: string;
  max_days_ahead: number;
  auto_confirm: boolean;
  logo_url: string | null;
  cover_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  font_family: string | null;
  welcome_message: string | null;
  whatsapp: string | null;
  instagram: string | null;
  procedures: PublicProcedure[];
  professionals: PublicProfessional[];
};

export type Slot = {
  starts_at: string;
  professional_id: string;
  professional_name: string;
};

export type Address = {
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
};

export type BookingInput = {
  slug: string;
  procedureId: string;
  professionalId: string;
  startsAt: string;
  modality: Modality;
  fullName: string;
  email: string;
  phone: string;
  address: Address | null;
  consent: boolean;
};

export type BookingResult = {
  appointment_id: string;
  status: 'reservado' | 'agendado';
  starts_at: string;
  ends_at: string;
  modality: Modality;
  procedure_name: string;
  professional_name: string;
  clinic_name: string;
  clinic_phone: string | null;
  clinic_address: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  CLINIC_NOT_FOUND: 'Este link de agendamento não está disponível.',
  PROCEDURE_NOT_FOUND: 'Este serviço não está mais disponível.',
  PROFESSIONAL_NOT_FOUND: 'Este profissional não está disponível para o serviço escolhido.',
  MODALITY_NOT_ALLOWED: 'Este serviço não é oferecido no local de atendimento escolhido.',
  SLOT_UNAVAILABLE: 'Esse horário acabou de ser ocupado. Escolha outro, por favor.',
  CONSENT_REQUIRED: 'É preciso aceitar o uso dos dados para concluir o agendamento.',
  INVALID_NAME: 'Informe seu nome completo.',
  INVALID_EMAIL: 'Informe um e-mail válido.',
  INVALID_PHONE: 'Informe um telefone com DDD.',
  INVALID_ADDRESS: 'Preencha o endereço completo do atendimento.',
};

export class BookingError extends Error {
  constructor(public code: string) {
    super(ERROR_MESSAGES[code] ?? 'Não foi possível concluir agora. Verifique sua conexão e tente novamente.');
  }
}

function toBookingError(error: { message?: string }): BookingError {
  const code = Object.keys(ERROR_MESSAGES).find((key) => error.message?.includes(key));
  return new BookingError(code ?? 'UNKNOWN');
}

export async function fetchClinic(slug: string): Promise<PublicClinic | null> {
  const { data, error } = await supabase.rpc('public_clinic', { p_slug: slug });
  if (error) throw toBookingError(error);
  return (data as PublicClinic | null) ?? null;
}

export async function fetchSlots(params: {
  slug: string;
  procedureId: string;
  modality: Modality;
  date: string;
  professionalId: string | null;
}): Promise<Slot[]> {
  const { data, error } = await supabase.rpc('public_available_slots', {
    p_slug: params.slug,
    p_procedure_id: params.procedureId,
    p_modality: params.modality,
    p_date: params.date,
    p_professional_id: params.professionalId,
  });
  if (error) throw toBookingError(error);
  return ((data as Slot[]) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export async function book(input: BookingInput): Promise<BookingResult> {
  const { data, error } = await supabase.rpc('public_book', {
    p_slug: input.slug,
    p_procedure_id: input.procedureId,
    p_professional_id: input.professionalId,
    p_starts_at: input.startsAt,
    p_modality: input.modality,
    p_full_name: input.fullName,
    p_email: input.email,
    p_phone: input.phone,
    p_address: input.address,
    p_consent: input.consent,
  });
  if (error) throw toBookingError(error);
  return data as BookingResult;
}
