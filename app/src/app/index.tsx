import { Redirect, router } from 'expo-router';

import { Button, Loading, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (session) return <Redirect href="/painel" />;

  return (
    <Screen>
      <Title>Salus Et Qualitas</Title>
      <Muted>Gestão de agenda para clínicas. Acesse com o login e a senha da sua clínica.</Muted>
      <Button label="Entrar" onPress={() => router.push('/entrar')} />
    </Screen>
  );
}
