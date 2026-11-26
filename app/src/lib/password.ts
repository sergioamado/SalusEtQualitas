import { portalBaseUrl, supabase } from './supabase';

export const MIN_PASSWORD = 8;

/** Página que o link do e-mail abre para criar a senha nova. */
export function resetRedirectUrl(): string | null {
  const base = portalBaseUrl();
  return base ? `${base}/redefinir-senha` : null;
}

/** Confere a senha nova e a confirmação; devolve a mensagem de erro ou null. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use letras e números na senha.';
  if (password !== confirm) return 'As duas senhas não são iguais.';
  return null;
}

function friendly(message: string): string {
  if (/rate limit|only request this after|too many/i.test(message))
    return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
  if (/different from the old password/i.test(message)) return 'A senha nova precisa ser diferente da atual.';
  if (/password should be|weak/i.test(message)) return `Senha fraca. Use pelo menos ${MIN_PASSWORD} caracteres, com letras e números.`;
  if (/session|jwt|expired|not authenticated/i.test(message))
    return 'O link expirou ou já foi usado. Peça um novo link de redefinição.';
  return 'Não foi possível concluir agora. Tente novamente.';
}

/**
 * Envia o e-mail com o link de redefinição.
 * Por segurança, a resposta é a mesma exista ou não um login com esse e-mail.
 */
export async function requestPasswordReset(email: string): Promise<string | null> {
  const redirectTo = resetRedirectUrl();
  if (!redirectTo) return 'Abra esta tela pelo navegador para pedir o link.';
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
  return error ? friendly(error.message) : null;
}

/** Grava a senha nova do usuário logado (ou que chegou pelo link do e-mail). */
export async function changePassword(password: string): Promise<string | null> {
  const { error } = await supabase.auth.updateUser({ password });
  return error ? friendly(error.message) : null;
}

/** Lê o retorno do link do e-mail (#access_token=…&type=recovery ou #error=…). */
export function readRecoveryHash(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type'),
    error: params.get('error_description') ?? params.get('error'),
  };
}
