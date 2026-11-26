import { Redirect, Stack } from 'expo-router';

import { Loading, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** Toda a área /painel exige login. */
// Padrão "guarda de rota": em vez de checar o login em cada tela do painel,
// checamos uma vez só aqui no _layout, que envolve todas elas.
// IMPORTANTE: isso é só conforto de navegação. A segurança DE VERDADE está no banco
// (RLS): mesmo que alguém burlasse esta tela, o banco não entregaria os dados.
export default function PanelLayout() {
  const { loading, session } = useAuth();
  // Enquanto não sabemos se há login, mostramos "Carregando…" (e não a tela de login,
  // senão ela "piscaria" para quem já está logado).
  if (loading) {
    return (
      <Screen>
        <Loading label="Carregando…" />
      </Screen>
    );
  }
  // Sem login: manda para /entrar.
  if (!session) return <Redirect href="/entrar" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
