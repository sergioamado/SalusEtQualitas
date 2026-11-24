import { Redirect, Stack } from 'expo-router';

import { Loading, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** Toda a área /painel exige login. */
export default function PanelLayout() {
  const { loading, session } = useAuth();
  if (loading) {
    return (
      <Screen>
        <Loading label="Carregando…" />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/entrar" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
