import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { PasswordForm } from '@/components/PasswordForm';
import { Button, Card, Muted, Notice, Screen, SectionLabel, Text, Title } from '@/components/ui';
import { usePalette } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

/** Minha conta: e-mail do login e troca de senha. */
export default function AccountScreen() {
  const c = usePalette();
  const { session, isPlatformAdmin, signOut } = useAuth();
  const [saved, setSaved] = useState(false);

  return (
    <Screen footer={<Button label="Sair" variant="secondary" onPress={signOut} />}>
      <Pressable
        accessibilityRole="link"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/painel'))}
        hitSlop={8}>
        <Text style={{ color: c.primary, fontWeight: '600', fontSize: 16 }}>‹ Voltar</Text>
      </Pressable>
      <Title>Minha conta</Title>

      <Card>
        <SectionLabel>Login</SectionLabel>
        <Text selectable style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>
          {session?.user.email}
        </Text>
        {isPlatformAdmin ? <Muted>Gerente do sistema</Muted> : null}
      </Card>

      <Card>
        <SectionLabel>Trocar senha</SectionLabel>
        {saved ? <Notice tone="success">Senha alterada. Use a senha nova no próximo login.</Notice> : null}
        <PasswordForm submitLabel="Trocar senha" onDone={() => setSaved(true)} />
      </Card>
    </Screen>
  );
}
