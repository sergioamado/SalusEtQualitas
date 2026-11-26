// ============================================================================
// FERRAMENTAS COMUNS DAS EDGE FUNCTIONS
// ----------------------------------------------------------------------------
// Edge Functions são pequenos programas que rodam NO SERVIDOR do Supabase
// (em Deno, um "primo" do Node.js que roda TypeScript direto). Usamos para o que
// não pode ficar no navegador por envolver chaves secretas: falar com o Google,
// criar/excluir usuários, conferir captcha.
// A pasta _shared (com "_") não é publicada como função: é código reaproveitado.
// ============================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// CORS: por segurança, o navegador só deixa um site chamar um servidor de OUTRO
// endereço se esse servidor responder "pode". Estes cabeçalhos dizem "pode".
// (O navegador manda antes uma pergunta OPTIONS — por isso toda função começa
//  respondendo OPTIONS com esses cabeçalhos.)

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Atalho para responder JSON com o código HTTP certo (200 ok, 400 erro do pedido…).
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Cliente com service role: ignora RLS. Use só depois de checar permissão. */
// A chave service_role é a "chave mestra" do banco. Ela NUNCA pode ir para o app;
// existe só aqui no servidor (o Supabase injeta em Deno.env automaticamente).
// Regra: primeiro confira QUEM está pedindo (requireUser + checagem de papel),
// só depois use o serviceClient.
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

/** Cliente agindo como o usuário que fez a requisição (respeita RLS). */
// Repassa o token de login que veio do app: o banco enxerga como se fosse o próprio usuário.
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

// Confere se quem chamou a função está logado. Devolve null se não estiver.
export async function requireUser(req: Request) {
  const client = userClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { client, user: data.user };
}
