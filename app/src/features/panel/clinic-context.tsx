import { createContext, useContext } from 'react';

import type { MemberRole } from '@/lib/auth';

export type ClinicRow = {
  id: string;
  slug: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  public_booking_enabled: boolean;
  public_booking_status: 'reservado' | 'agendado';
  logo_url: string | null;
  cover_url: string | null;
  primary_color: string;
  secondary_color: string;
  font_family: string;
  welcome_message: string | null;
  whatsapp: string | null;
  instagram: string | null;
  google_notify_enabled: boolean;
  google_calendar_id: string | null;
  about: string | null;
  gallery: { url: string; caption?: string | null }[] | null;
  status: 'teste' | 'ativa' | 'suspensa' | 'cancelada';
  plan_id: string | null;
  monthly_price: number | null;
  next_due_date: string | null;
  trial_ends_on: string | null;
  suspended_reason: string | null;
  /** Vocabulário do módulo Pacientes: 'saude' ou 'beleza' (veja features/records/vocab.ts). */
  record_vocabulary: 'saude' | 'beleza';
};

export type ClinicContextValue = {
  clinic: ClinicRow;
  reload: () => void;
  role: MemberRole | null;
  /** Gerente da clínica ou gerente do sistema. */
  canManage: boolean;
  /** Módulos adicionais contratados (ex.: 'pacientes'). */
  modules: string[];
};

export const ClinicContext = createContext<ClinicContextValue | null>(null);

export function useClinic(): ClinicContextValue {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error('useClinic precisa estar dentro do painel da clínica.');
  return ctx;
}
