import { callFunction } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export type ClinicStatus = 'teste' | 'ativa' | 'suspensa' | 'cancelada';

export const STATUS_LABEL: Record<ClinicStatus, string> = {
  teste: 'Em teste',
  ativa: 'Ativa',
  suspensa: 'Suspensa',
  cancelada: 'Cancelada',
};
export const STATUS_TONE: Record<ClinicStatus, 'primary' | 'success' | 'warning' | 'danger'> = {
  teste: 'primary',
  ativa: 'success',
  suspensa: 'warning',
  cancelada: 'danger',
};

export const PAYMENT_METHODS = {
  pix: 'Pix',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  cartao: 'Cartão',
  dinheiro: 'Dinheiro',
  outro: 'Outro',
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export type Plan = {
  id: string;
  name: string;
  description: string | null;
  price_monthly: number;
  max_professionals: number | null;
  active: boolean;
  sort_order: number;
};

export type OverviewClinic = {
  id: string;
  name: string;
  slug: string;
  status: ClinicStatus;
  created_at: string;
  public_booking_enabled: boolean;
  plan_id: string | null;
  plan_name: string | null;
  /** Valor do plano (ou o combinado), sem os módulos. */
  price: number | null;
  /** Módulos adicionais ligados, com o preço que esta clínica paga. */
  modules: { key: string; name: string; price: number }[];
  modules_price: number;
  /** Plano + módulos: o que a clínica paga por mês. */
  total_price: number;
  max_professionals: number | null;
  due_day: number | null;
  next_due_date: string | null;
  trial_ends_on: string | null;
  suspended_reason: string | null;
  google_notify_enabled: boolean;
  appts_total: number;
  appts_30d: number;
  portal_30d: number;
  upcoming: number;
  contacts: number;
  professionals: number;
  members: number;
  public_services: number;
  pros_with_hours: number;
  views_30d: number;
  storage_bytes: number;
  google_errors_30d: number;
  last_sign_in: string | null;
  last_activity: string | null;
  last_payment: string | null;
  days_overdue: number;
  problems: string[];
};

export type Overview = {
  generated_at: string;
  grace_days: number;
  totals: {
    clinics: number;
    by_status: Partial<Record<ClinicStatus, number>>;
    mrr: number;
    received_month: number;
    overdue: number;
    with_problems: number;
    appts_30d: number;
    portal_30d: number;
    views_30d: number;
    users: number;
    db_bytes: number;
    storage_bytes: number;
  };
  clinics: OverviewClinic[];
};

/** Módulo adicional vendido à parte (ex.: Pacientes e prontuário). */
export type Module = {
  key: string;
  name: string;
  description: string | null;
  price_monthly: number;
  active: boolean;
  sort_order: number;
};
export type ClinicModule = { module_key: string; price_monthly: number | null; enabled_at: string };

export type Payment = {
  id: string;
  clinic_id: string;
  amount: number;
  paid_on: string;
  reference: string | null;
  method: PaymentMethod;
  notes: string | null;
  created_at: string;
};

export type PlatformSettings = {
  product_name: string;
  support_email: string | null;
  support_whatsapp: string | null;
  support_phone: string | null;
  support_hours: string | null;
  support_message: string | null;
  billing_pix_key: string | null;
  billing_beneficiary: string | null;
  billing_instructions: string | null;
  grace_days: number;
  remind_days: number;
  protect_ip_hour: number;
  protect_ip_day: number;
  protect_contact_day: number;
  protect_active_per_contact: number;
  protect_clinic_hour: number;
  captcha_enabled: boolean;
  captcha_site_key: string | null;
};

export type ProtectionStats = {
  blocked_24h: number;
  blocked_7d: number;
  bookings_24h: number;
  by_reason: Record<string, number>;
  by_clinic: { name: string; slug: string; n: number }[];
};

export const BLOCK_REASON: Record<string, string> = {
  RATE_LIMITED: 'Muitos pedidos da mesma conexão',
  CONTACT_LIMIT: 'Muitos pedidos do mesmo e-mail/telefone',
  TOO_MANY_ACTIVE: 'Paciente com muitos horários em aberto',
  CLINIC_BUSY: 'Pico de pedidos na clínica',
};

/** O captcha só pode ser ligado se a função public-book estiver publicada com a chave secreta. */
export async function checkCaptchaReady(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('public-book', { body: { check: true } });
  return !error && !!(data as { configured?: boolean } | null)?.configured;
}

export async function fetchProtectionStats(): Promise<ProtectionStats> {
  const { data, error } = await supabase.rpc('platform_protection_stats');
  if (error) fail('Não foi possível carregar a proteção do link.', error);
  return data as ProtectionStats;
}

export type SupportInfo = {
  product_name: string;
  email: string | null;
  whatsapp: string | null;
  phone: string | null;
  hours: string | null;
  message: string | null;
};

/** Limites do plano gratuito do Supabase (referência para o painel). */
export const FREE_LIMITS = { db_bytes: 500 * 1024 * 1024, storage_bytes: 1024 * 1024 * 1024 };

function fail(message: string, error: { message?: string } | null): never {
  if (error?.message?.includes('FORBIDDEN')) throw new Error('Somente o gerente do sistema pode fazer isso.');
  throw new Error(error?.message ? `${message} (${error.message})` : message);
}

export async function fetchOverview(): Promise<Overview> {
  const { data, error } = await supabase.rpc('platform_overview');
  if (error) fail('Não foi possível carregar a visão geral.', error);
  return data as Overview;
}

export async function setClinicStatus(clinicId: string, status: ClinicStatus, reason?: string | null) {
  const { error } = await supabase.rpc('admin_set_clinic_status', {
    p_clinic_id: clinicId,
    p_status: status,
    p_reason: reason ?? null,
  });
  if (error) fail('Não foi possível mudar a situação.', error);
}

export async function updateSubscription(
  clinicId: string,
  fields: {
    plan_id: string | null;
    monthly_price: number | null;
    due_day: number | null;
    next_due_date: string | null;
    trial_ends_on: string | null;
  },
) {
  const { error } = await supabase.from('clinics').update(fields).eq('id', clinicId);
  if (error) fail('Não foi possível salvar a assinatura.', error);
}

export async function registerPayment(input: {
  clinicId: string;
  amount: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  advance: boolean;
}): Promise<{ next_due_date: string | null }> {
  const { data, error } = await supabase.rpc('admin_register_payment', {
    p_clinic_id: input.clinicId,
    p_amount: input.amount,
    p_paid_on: input.paidOn,
    p_method: input.method,
    p_reference: input.reference,
    p_notes: input.notes,
    p_advance: input.advance,
  });
  if (error) fail('Não foi possível registrar o pagamento.', error);
  return data as { next_due_date: string | null };
}

export async function listPayments(clinicId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('clinic_payments')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('paid_on', { ascending: false })
    .limit(36);
  if (error) fail('Não foi possível carregar os pagamentos.', error);
  return (data ?? []) as Payment[];
}

export async function deletePayment(id: string) {
  const { error } = await supabase.from('clinic_payments').delete().eq('id', id);
  if (error) fail('Não foi possível apagar o pagamento.', error);
}

export async function fetchNotes(clinicId: string): Promise<string> {
  const { data } = await supabase.from('platform_clinic_notes').select('notes').eq('clinic_id', clinicId).maybeSingle();
  return (data?.notes as string | null) ?? '';
}

export async function saveNotes(clinicId: string, notes: string) {
  const { error } = await supabase
    .from('platform_clinic_notes')
    .upsert({ clinic_id: clinicId, notes: notes.trim() || null, updated_at: new Date().toISOString() });
  if (error) fail('Não foi possível salvar as anotações.', error);
}

export async function listPlans(): Promise<Plan[]> {
  const { data, error } = await supabase.from('plans').select('*').order('sort_order').order('price_monthly');
  if (error) fail('Não foi possível carregar os planos.', error);
  return (data ?? []) as Plan[];
}

export async function savePlan(plan: Omit<Plan, 'id'> & { id?: string }) {
  const { id, ...fields } = plan;
  const query = id ? supabase.from('plans').update(fields).eq('id', id) : supabase.from('plans').insert(fields);
  const { error } = await query;
  if (error) fail('Não foi possível salvar o plano.', error);
}

export async function deletePlan(id: string) {
  const { error } = await supabase.from('plans').delete().eq('id', id);
  if (error) fail('Não foi possível excluir o plano.', error);
}

// ---------------------------------------------------------------------
// Módulos adicionais (o banco só deixa o gerente do sistema alterar)
// ---------------------------------------------------------------------
export async function listModules(): Promise<Module[]> {
  const { data, error } = await supabase.from('modules').select('*').order('sort_order').order('name');
  if (error) fail('Não foi possível carregar os módulos.', error);
  return (data ?? []) as Module[];
}

/** Só nome, descrição, preço e "à venda": a chave (key) é usada pelo código e não muda. */
export async function saveModule(m: Module) {
  const { key, ...fields } = m;
  const { error } = await supabase.from('modules').update(fields).eq('key', key);
  if (error) fail('Não foi possível salvar o módulo.', error);
}

export async function listClinicModules(clinicId: string): Promise<ClinicModule[]> {
  const { data, error } = await supabase.from('clinic_modules').select('module_key,price_monthly,enabled_at').eq('clinic_id', clinicId);
  if (error) fail('Não foi possível carregar os módulos da clínica.', error);
  return (data ?? []) as ClinicModule[];
}

/** Liga (com preço especial opcional) ou desliga um módulo para a clínica. */
export async function setClinicModule(clinicId: string, key: string, on: boolean, price: number | null) {
  const { error } = on
    ? await supabase.from('clinic_modules').upsert({ clinic_id: clinicId, module_key: key, price_monthly: price })
    : await supabase.from('clinic_modules').delete().eq('clinic_id', clinicId).eq('module_key', key);
  if (error) fail('Não foi possível alterar o módulo.', error);
}

export async function fetchSettings(): Promise<PlatformSettings> {
  const { data, error } = await supabase.from('platform_settings').select('*').eq('id', 1).single();
  if (error) fail('Não foi possível carregar as configurações.', error);
  return data as PlatformSettings;
}

export async function saveSettings(settings: PlatformSettings) {
  const { error } = await supabase
    .from('platform_settings')
    .update({ ...settings, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) fail('Não foi possível salvar as configurações.', error);
}

/** Contato de suporte (funciona também sem login). */
export async function fetchSupport(): Promise<SupportInfo | null> {
  const { data } = await supabase.rpc('public_support');
  return (data as SupportInfo | null) ?? null;
}

/** Exclusão definitiva: arquivos, dados e (opcional) logins só dessa clínica. */
export async function deleteClinic(clinicId: string, confirmSlug: string, deleteUsers: boolean) {
  return callFunction<{ removed_files: number; removed_users: number }>('admin-users', {
    action: 'delete_clinic',
    clinic_id: clinicId,
    confirm_slug: confirmSlug,
    delete_users: deleteUsers,
  });
}

// ---------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2).replace('.', ',')} GB`;
}

export function money(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "2026-11-26" -> "26/11/2026" */
export function brDate(key: string | null | undefined): string {
  if (!key) return '—';
  const k = key.slice(0, 10);
  return `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`;
}

/** "há 3 dias", "hoje", "nunca". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'há 1 mês' : `há ${months} meses`;
}

/** Dias até a data (negativo = já passou). */
export function daysUntil(key: string | null | undefined): number | null {
  if (!key) return null;
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}
