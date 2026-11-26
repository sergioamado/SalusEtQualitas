// ============================================================================
// CONEXÃO COM O SUPABASE (o "backend" do sistema)
// ----------------------------------------------------------------------------
// O Supabase é um "Backend como Serviço": ele já nos entrega pronto
//   - um banco Postgres (tabelas, funções, regras de segurança);
//   - login de usuários (Auth);
//   - armazenamento de arquivos (Storage — fotos, logos);
//   - funções no servidor (Edge Functions — código que não pode rodar no navegador).
// Em vez de escrever um servidor nosso, o app conversa direto com o Supabase
// através deste "cliente". Todo o app importa `supabase` daqui.
// ============================================================================

// AsyncStorage = "gaveta" do aparelho onde guardamos o login para não pedir a senha
// toda vez que o app abre (no navegador ele usa o localStorage por baixo).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

// Variáveis de ambiente: ficam no arquivo app/.env (que NÃO vai para o GitHub).
// O prefixo EXPO_PUBLIC_ é obrigatório para o Expo colocar o valor dentro do app.
// ATENÇÃO: tudo que tem EXPO_PUBLIC_ fica visível para qualquer pessoa que abrir o
// site. Por isso só colocamos aqui chaves PÚBLICAS. Chaves secretas (Google, Turnstile,
// service_role) ficam guardadas no próprio Supabase, como "secrets" das Edge Functions.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// "Falhar cedo": se esquecer de configurar o .env, o erro aparece já na abertura,
// com uma mensagem clara, em vez de um erro estranho lá na frente.
if (!url || !anonKey) {
  throw new Error(
    'Configure EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no arquivo app/.env (veja .env.example).',
  );
}

// A chave anon é pública por natureza: o acesso aos dados é controlado
// pelas políticas RLS e funções public_* no banco.
// (RLS = Row Level Security: regras escritas NO BANCO dizendo quem pode ler/alterar
//  cada linha. Mesmo que alguém pegue a chave anon e tente acessar tudo, o banco
//  só devolve o que as regras permitem. Veja supabase/migrations/20261123000000_agendamento.sql.)
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage, // onde guardar a sessão (o "login")
    autoRefreshToken: true, // o token de login expira (~1h); a lib renova sozinha
    persistSession: true, // lembrar o login entre aberturas do app
    detectSessionInUrl: false, // nós mesmos tratamos o link de "redefinir senha" (veja redefinir-senha.tsx)
  },
});

// No celular, renova o login só com o app em primeiro plano.
// (Economiza bateria e evita renovações com o app minimizado.)
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Endereço público do portal (para montar o link de agendamento). */
// Ex.: https://salusetqualitas.expo.app — usado para mostrar ao gerente o link
// "https://.../agendar/minha-clinica" que ele divulga aos pacientes.
export function portalBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_PORTAL_URL;
  if (configured) return configured.replace(/\/$/, ''); // tira a "/" do final, se houver
  // Sem configuração: no navegador, usa o próprio endereço em que o site está aberto.
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return '';
}
