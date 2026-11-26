import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Card, Loading, Muted, Screen, SectionLabel, Text, Title } from '@/components/ui';
import { usePalette } from '@/constants/theme';
import { hasSupportContact, SupportContacts, useSupport } from '@/features/platform/SupportCard';

/** Ajuda: contato do suporte do sistema. */
export default function HelpScreen() {
  const c = usePalette();
  const support = useSupport();
  return (
    <Screen>
      <Pressable
        accessibilityRole="link"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/painel'))}
        hitSlop={8}>
        <Text style={{ color: c.primary, fontWeight: '600', fontSize: 16 }}>‹ Voltar</Text>
      </Pressable>
      <Title>Ajuda e suporte</Title>
      {!support ? (
        <Loading />
      ) : hasSupportContact(support) ? (
        <Card>
          <SectionLabel>Fale com o suporte do {support.product_name}</SectionLabel>
          <SupportContacts support={support} />
        </Card>
      ) : (
        <Muted>O contato de suporte ainda não foi configurado pelo gerente do sistema.</Muted>
      )}
      <Card>
        <SectionLabel>Dúvidas rápidas</SectionLabel>
        <Muted>• Esqueceu a senha? Na tela Entrar, toque em “Esqueci minha senha”.</Muted>
        <Muted>• Trocar a senha: Minha conta, no topo do painel.</Muted>
        <Muted>• Link de agendamento fora do ar? Veja se “Agendamento online ativo” está ligado em Clínica e aparência.</Muted>
      </Card>
    </Screen>
  );
}
