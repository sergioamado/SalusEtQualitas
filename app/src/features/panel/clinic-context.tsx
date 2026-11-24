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
};

export type ClinicContextValue = {
  clinic: ClinicRow;
  reload: () => void;
  role: MemberRole | null;
  /** Gerente da clínica ou gerente do sistema. */
  canManage: boolean;
};

export const ClinicContext = createContext<ClinicContextValue | null>(null);

export function useClinic(): ClinicContextValue {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error('useClinic precisa estar dentro do painel da clínica.');
  return ctx;
}
