import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

export type MemberRole = 'admin' | 'recepcao' | 'profissional';

export const ROLE_LABEL: Record<MemberRole, string> = {
  admin: 'Gerente da clínica',
  recepcao: 'Recepção',
  profissional: 'Profissional',
};

export type Membership = {
  clinic_id: string;
  role: MemberRole;
  clinic: { id: string; name: string; slug: string } | null;
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  isPlatformAdmin: boolean;
  memberships: Membership[];
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

type Profile = { userId: string; isPlatformAdmin: boolean; memberships: Membership[] };

async function loadProfile(userId: string): Promise<Profile> {
  const [admin, members] = await Promise.all([
    supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    supabase.from('clinic_members').select('clinic_id, role, clinic:clinics(id, name, slug)').eq('user_id', userId),
  ]);
  return {
    userId,
    isPlatformAdmin: !!admin.data,
    memberships: (members.data ?? []) as unknown as Membership[],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        return;
      }
      // Não chamar o Supabase dentro do callback (recomendação da lib): adia.
      setTimeout(() => {
        loadProfile(next.user.id)
          .then(setProfile)
          .catch(() => setProfile({ userId: next.user.id, isPlatformAdmin: false, memberships: [] }));
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(() => {
    const userId = session?.user.id;
    const profileReady = !session || profile?.userId === userId;
    return {
      loading: session === undefined || !profileReady,
      session: session ?? null,
      isPlatformAdmin: profileReady ? !!profile?.isPlatformAdmin : false,
      memberships: profileReady ? profile?.memberships ?? [] : [],
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (!error) return null;
        if (/invalid login credentials/i.test(error.message)) return 'E-mail ou senha incorretos.';
        if (/email not confirmed/i.test(error.message)) return 'E-mail ainda não confirmado.';
        return 'Não foi possível entrar agora. Tente novamente.';
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [session, profile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}

/** Chama uma Edge Function e devolve a mensagem de erro em português, se houver. */
export async function callFunction<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = 'Não foi possível concluir. Verifique sua conexão.';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) message = payload.error;
    }
    throw new Error(message);
  }
  return data as T;
}
