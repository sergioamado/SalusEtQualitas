// ============================================================================
// /ficha/<código> — link que a clínica manda para o paciente preencher a ficha
// ----------------------------------------------------------------------------
// Tela pública (sem login), como /agendar/<slug>. Toda a lógica está em
// features/records/PublicIntakeScreen.tsx; aqui só lemos o código da URL.
// ============================================================================
import { Stack, useLocalSearchParams } from 'expo-router';

import { PublicIntakeScreen } from '@/features/records/PublicIntakeScreen';

export default function IntakeLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return (
    <>
      {/* Título da aba do navegador. Não mostra nada do paciente. */}
      <Stack.Screen options={{ title: 'Ficha de preenchimento' }} />
      <PublicIntakeScreen key={String(token)} token={String(token)} />
    </>
  );
}
