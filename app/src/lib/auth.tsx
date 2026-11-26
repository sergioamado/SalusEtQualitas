// ============================================================================
// LOGIN E "QUEM SOU EU" (contexto de autenticação)
// ----------------------------------------------------------------------------
// Problema: quase toda tela precisa saber se há alguém logado, se essa pessoa é
// gerente do sistema e de quais clínicas ela faz parte.
// Solução React: um CONTEXTO. O <AuthProvider> fica em volta do app inteiro
// (veja app/_layout.tsx) e qualquer tela chama `useAuth()` para ler esses dados,
// sem precisar passar de componente em componente.
// ============================================================================
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

// Os três papéis de quem trabalha na clínica (tabela clinic_members, coluna role).
// O "gerente do sistema" (você, dono da plataforma) NÃO é um papel de clínica:
// fica numa tabela separada, platform_admins.
export type MemberRole = 'admin' | 'recepcao' | 'profissional';

// Record<Chave, Valor>: um "dicionário" tipado. O TypeScript obriga a ter
// um rótulo para CADA papel — se um dia criarmos um novo papel, ele avisa aqui.
export const ROLE_LABEL: Record<MemberRole, string> = {
  admin: 'Gerente da clínica',
  recepcao: 'Recepção',
  profissional: 'Profissional',
};

// Uma "participação": a pessoa X trabalha na clínica Y com o papel Z.
// Uma mesma pessoa pode estar em várias clínicas.
export type Membership = {
  clinic_id: string;
  role: MemberRole;
  clinic: { id: string; name: string; slug: string } | null;
};

// Tudo o que o contexto oferece para as telas.
type AuthState = {
  loading: boolean; // ainda descobrindo se há login? (mostrar "Carregando…")
  session: Session | null; // null = ninguém logado
  isPlatformAdmin: boolean;
  memberships: Membership[];
  signIn: (email: string, password: string) => Promise<string | null>; // devolve a mensagem de erro, ou null se deu certo
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

type Profile = { userId: string; isPlatformAdmin: boolean; memberships: Membership[] };

// Busca no banco o "perfil" de quem entrou.
// Promise.all = faz as duas consultas AO MESMO TEMPO (mais rápido que uma depois da outra).
// Repare que não passamos nenhuma senha/permissão: o banco sabe quem é o usuário pelo
// token de login e as regras RLS só devolvem as linhas que ele pode ver.
async function loadProfile(userId: string): Promise<Profile> {
  const [admin, members] = await Promise.all([
    supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    // 'clinic:clinics(id, name, slug)' = "join" automático: traz junto os dados da
    // clínica ligada pela chave estrangeira clinic_id.
    supabase.from('clinic_members').select('clinic_id, role, clinic:clinics(id, name, slug)').eq('user_id', userId),
  ]);
  return {
    userId,
    isPlatformAdmin: !!admin.data, // !! transforma "tem algo / não tem" em true/false
    memberships: (members.data ?? []) as unknown as Membership[],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = "ainda não sei"; null = "sei que não há login"; Session = logado.
  // Esse truque de três estados evita piscar a tela de login antes da hora.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);

  // useEffect com [] = roda UMA vez, quando o app abre.
  useEffect(() => {
    // onAuthStateChange: o Supabase nos avisa sempre que o login muda
    // (abriu o app já logado, entrou, saiu, token renovado…).
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        return;
      }
      // Não chamar o Supabase dentro do callback (recomendação da lib): adia.
      // setTimeout(…, 0) = "faça isso logo depois", fora do callback.
      setTimeout(() => {
        loadProfile(next.user.id)
          .then(setProfile)
          .catch(() => setProfile({ userId: next.user.id, isPlatformAdmin: false, memberships: [] }));
      }, 0);
    });
    // A função devolvida pelo useEffect é a "limpeza": para de escutar quando sai.
    return () => data.subscription.unsubscribe();
  }, []);

  // useMemo: só recria o objeto quando session ou profile mudam.
  // Assim as telas não re-renderizam à toa.
  const value = useMemo<AuthState>(() => {
    const userId = session?.user.id;
    // O perfil carregado é DESTE usuário? (evita mostrar por um instante os dados
    // de quem estava logado antes, ao trocar de conta)
    const profileReady = !session || profile?.userId === userId;
    return {
      loading: session === undefined || !profileReady,
      session: session ?? null,
      isPlatformAdmin: profileReady ? !!profile?.isPlatformAdmin : false,
      memberships: profileReady ? profile?.memberships ?? [] : [],
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (!error) return null;
        // Traduz as mensagens em inglês do Supabase para algo que o usuário entende.
        if (/invalid login credentials/i.test(error.message)) return 'E-mail ou senha incorretos.';
        if (/email not confirmed/i.test(error.message)) return 'E-mail ainda não confirmado.';
        return 'Não foi possível entrar agora. Tente novamente.';
      },
      signOut: async () => {
        await supabase.auth.signOut();
        // Não precisamos limpar nada aqui: o onAuthStateChange lá em cima é chamado
        // com next = null e zera tudo sozinho.
      },
    };
  }, [session, profile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// "Hook" personalizado: é assim que as telas usam o contexto.
// Ex.: const { session, signOut } = useAuth();
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}

/** Chama uma Edge Function e devolve a mensagem de erro em português, se houver. */
// Edge Functions (pasta supabase/functions) são usadas para o que NÃO pode ficar no
// navegador: criar usuários, falar com o Google, conferir o captcha — tudo que
// precisa de chave secreta. O token de login vai junto automaticamente.
export async function callFunction<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = 'Não foi possível concluir. Verifique sua conexão.';
    // Quando a função responde com erro (ex.: 400), a mensagem dela vem "escondida"
    // em error.context; aqui a gente lê esse JSON para mostrar o motivo real.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) message = payload.error;
    }
    throw new Error(message);
  }
  return data as T;
}
