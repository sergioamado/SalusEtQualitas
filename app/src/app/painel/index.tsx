import { Redirect, router } from 'expo-router';

import { Button, Muted, OptionCard, Screen, Title } from '@/components/ui';
import { ROLE_LABEL, useAuth } from '@/lib/auth';

/** Decide para onde o usuário vai depois do login. */
export default function PanelHome() {
  const { isPlatformAdmin, memberships, signOut } = useAuth();

  if (isPlatformAdmin) return <Redirect href="/painel/admin" />;
  if (memberships.length === 1) return <Redirect href={`/painel/${memberships[0].clinic_id}`} />;

  return (
    <Screen footer={<Button label="Sair" variant="secondary" onPress={signOut} />}>
      {memberships.length === 0 ? (
        <>
          <Title>Sem acesso</Title>
          <Muted>Seu login ainda não está vinculado a nenhuma clínica. Fale com o gerente do sistema.</Muted>
        </>
      ) : (
        <>
          <Title>Escolha a clínica</Title>
          {memberships.map((m) => (
            <OptionCard
              key={m.clinic_id}
              title={m.clinic?.name ?? 'Clínica'}
              subtitle={ROLE_LABEL[m.role]}
              onPress={() => router.push(`/painel/${m.clinic_id}`)}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
