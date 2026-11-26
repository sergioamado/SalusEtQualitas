import { supabase } from './supabase';
import { defaultWeek, weekToRows, type WeekSchedule } from './schedule';

export type ProfessionalPayload = {
  id?: string;
  clinic_id: string;
  name: string;
  specialty?: string | null;
  /** Ausente = não altera. */
  photo_url?: string | null;
  /** Ausente = não altera. */
  bio?: string | null;
  color?: string | null;
  user_id?: string | null;
  active?: boolean;
  public_visible?: boolean;
  home_care_enabled?: boolean;
  travel_buffer_min?: number;
  /** Ausente = não altera. */
  procedure_ids?: string[];
  /** Ausente = não altera. */
  week?: WeekSchedule;
};

const MESSAGES: Record<string, string> = {
  INVALID_NAME: 'Informe o nome do profissional.',
  USER_NOT_MEMBER: 'Esse login não faz parte da equipe desta clínica.',
  NOT_FOUND: 'Profissional não encontrado.',
};

/** Grava perfil, serviços, horários e pausas numa transação só (RPC save_professional). */
export async function saveProfessional({ week, ...rest }: ProfessionalPayload): Promise<string> {
  const payload: Record<string, unknown> = { ...rest };
  if (week) Object.assign(payload, weekToRows(week));
  const { data, error } = await supabase.rpc('save_professional', { p: payload });
  if (error) {
    const code = Object.keys(MESSAGES).find((k) => error.message.includes(k));
    if (code) throw new Error(MESSAGES[code]);
    if (/professionals_clinic_user_key|duplicate/i.test(error.message))
      throw new Error('Esse login já está ligado a outro profissional desta clínica.');
    if (/row-level security|permission/i.test(error.message))
      throw new Error('Somente o gerente da clínica pode alterar profissionais.');
    throw new Error(`Não foi possível salvar. ${error.message}`);
  }
  return data as string;
}

/**
 * Clínica pequena: a própria gerente passa a atender.
 * Cria o perfil ligado ao login dela, com Seg–Sex 08h–18h e todos os serviços ativos.
 */
export async function createSelfProfessional(clinicId: string, userId: string, name: string, specialty?: string) {
  const { data } = await supabase.from('procedures').select('id').eq('clinic_id', clinicId).eq('active', true);
  return saveProfessional({
    clinic_id: clinicId,
    name,
    specialty: specialty || null,
    user_id: userId,
    procedure_ids: (data ?? []).map((r) => r.id as string),
    week: defaultWeek(),
  });
}
