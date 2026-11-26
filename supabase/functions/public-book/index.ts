// Agendamento público com captcha (Cloudflare Turnstile).
// Usada só quando o gerente do sistema liga "Exigir captcha" (platform_settings.captcha_enabled).
// Confere o token no Cloudflare e chama public_book_verified com o IP real do paciente,
// que aplica os mesmos limites da proteção do link.
//
// Segredo necessário: TURNSTILE_SECRET_KEY (chave secreta do widget no Cloudflare).
// Publicar sem exigir login: supabase functions deploy public-book --no-verify-jwt
import { corsHeaders, json, serviceClient } from '../_shared/http.ts';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  // deno-lint-ignore no-explicit-any
  let b: any;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  // Conferência do painel antes de ligar o captcha: { check: true }
  if (b.check === true) return json({ configured: !!secret });
  if (!secret) return json({ error: 'CAPTCHA_NOT_CONFIGURED' }, 503);

  const ip =
    req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const token = typeof b.captcha_token === 'string' ? b.captcha_token : '';
  if (!token || token.length > 4096) return json({ error: 'CAPTCHA_FAILED' }, 400);

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const check = await fetch(VERIFY_URL, { method: 'POST', body: form })
    .then((r) => r.json())
    .catch(() => null);
  if (!check?.success) return json({ error: 'CAPTCHA_FAILED' }, 400);

  const db = serviceClient();
  const { data, error } = await db.rpc('public_book_verified', {
    p_ip: ip,
    p_slug: b.p_slug,
    p_procedure_id: b.p_procedure_id,
    p_professional_id: b.p_professional_id,
    p_starts_at: b.p_starts_at,
    p_modality: b.p_modality,
    p_full_name: b.p_full_name,
    p_email: b.p_email,
    p_phone: b.p_phone,
    p_address: b.p_address ?? null,
    p_consent: b.p_consent === true,
  });
  // Erros de regra (SLOT_UNAVAILABLE, INVALID_EMAIL…) seguem com o código para o site traduzir.
  if (error) return json({ error: error.message }, 400);
  return json(data);
});
