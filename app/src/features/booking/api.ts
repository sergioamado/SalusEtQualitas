// ============================================================================
// API DO AGENDAMENTO PÚBLICO — a "ponte" entre as telas e o banco
// ----------------------------------------------------------------------------
// Regra de ouro do projeto: as TELAS não falam direto com o banco. Elas chamam
// funções deste arquivo (fetchClinic, fetchSlots, book). Assim:
//   - se o banco mudar, mexemos só aqui;
//   - os erros chegam às telas já traduzidos para o português.
//
// O paciente não tem login, então ele NÃO pode ler tabelas diretamente (o RLS
// bloqueia). Ele só pode chamar funções "public_*" que nós escrevemos no banco
// (supabase.rpc = Remote Procedure Call = "execute esta função lá no servidor").
// Essas funções devolvem SÓ o que é seguro mostrar e conferem todas as regras
// (horário livre, limites anti-abuso…) do lado do servidor, onde ninguém burla.
// ============================================================================
import { supabase } from '@/lib/supabase';

// "Tipos" do TypeScript: descrevem o formato dos dados. Não existem quando o app
// roda — servem para o editor avisar erros (ex.: digitar clinic.nmae) antes de rodar.
// Atendimento na clínica ou na casa do paciente (residencial).
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
  photo_url: string | null;
  bio: string | null;
  home_care_enabled: boolean;
  procedure_ids: string[];
};

export type GalleryPhoto = { url: string; caption?: string | null };

// Formato do JSON que a função public_clinic (no banco) devolve.
export type PublicClinic = {
  id: string;
  slug: string;
  name: string;
  phone: string | null;
  email: string | null;
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
  about: string | null;
  gallery: GalleryPhoto[];
  /** Chave pública do captcha quando a proteção extra está ligada. */
  captcha_site_key: string | null;
  procedures: PublicProcedure[];
  professionals: PublicProfessional[];
};

// Um horário livre: "às 14:00 com a Dra. Ana".
// starts_at vem no formato ISO com fuso (ex.: 2026-11-27T14:00:00-03:00).
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
  /** Token do captcha (Turnstile), quando exigido. */
  captchaToken?: string | null;
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

// O banco responde erros com CÓDIGOS curtos em inglês (ex.: SLOT_UNAVAILABLE).
// Aqui traduzimos cada código para uma frase amigável. Vantagem: a mesma regra
// do banco pode ganhar textos diferentes no app sem mexer no SQL.
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
  RATE_LIMITED: 'Muitos pedidos foram feitos a partir desta conexão. Tente novamente mais tarde ou fale com a clínica.',
  CONTACT_LIMIT: 'Você já fez vários pedidos hoje com este e-mail ou telefone. Fale com a clínica para agendar mais.',
  TOO_MANY_ACTIVE: 'Você já tem horários marcados nesta clínica. Para agendar mais, fale com a clínica.',
  CLINIC_BUSY: 'A clínica está recebendo muitos pedidos agora. Tente de novo em alguns minutos.',
  CAPTCHA_REQUIRED: 'Confirme que você não é um robô para concluir.',
  CAPTCHA_FAILED: 'Não foi possível confirmar que você não é um robô. Tente de novo.',
  CAPTCHA_NOT_CONFIGURED: 'O agendamento online está em manutenção. Tente mais tarde ou fale com a clínica.',
};

// Um tipo de erro nosso, que carrega o código (para a tela decidir o que fazer,
// ex.: SLOT_UNAVAILABLE -> voltar para a escolha de horário) e a mensagem traduzida.
export class BookingError extends Error {
  constructor(public code: string) {
    super(ERROR_MESSAGES[code] ?? 'Não foi possível concluir agora. Verifique sua conexão e tente novamente.');
  }
}

// Procura qual dos nossos códigos aparece dentro da mensagem de erro do banco.
function toBookingError(error: { message?: string }): BookingError {
  const code = Object.keys(ERROR_MESSAGES).find((key) => error.message?.includes(key));
  return new BookingError(code ?? 'UNKNOWN');
}

// Dados públicos da clínica (nome, fotos, serviços, profissionais).
// Devolve null se o link não existe ou está desligado.
export async function fetchClinic(slug: string): Promise<PublicClinic | null> {
  const { data, error } = await supabase.rpc('public_clinic', { p_slug: slug });
  if (error) throw toBookingError(error);
  return (data as PublicClinic | null) ?? null;
}

// Horários livres de um dia. O CÁLCULO é feito no banco (public_available_slots),
// que conhece a escala de cada profissional, as folgas e o que já está ocupado.
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

// Cria o agendamento. Os nomes p_* são os parâmetros da função SQL.
export async function book(input: BookingInput): Promise<BookingResult> {
  const params = {
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
  };

  // Com captcha: a Edge Function confere o token e faz o agendamento.
  // (A conferência do captcha precisa de uma chave SECRETA do Cloudflare, por isso
  //  é feita numa Edge Function — supabase/functions/public-book — e não aqui.)
  if (input.captchaToken) {
    const { data, error } = await supabase.functions.invoke('public-book', {
      body: { ...params, captcha_token: input.captchaToken },
    });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      throw toBookingError({ message: payload?.error ?? error.message });
    }
    if (data?.error) throw new BookingError(String(data.error));
    return data as BookingResult;
  }

  // Sem captcha: chama direto a função do banco.
  const { data, error } = await supabase.rpc('public_book', params);
  if (error) throw toBookingError(error);
  // Bloqueios da proteção do link voltam como { error: "CÓDIGO" }.
  if (data && typeof data === 'object' && 'error' in data) throw new BookingError(String((data as { error: string }).error));
  return data as BookingResult;
}
