// ============================================================================
// LAYOUT RAIZ — a "moldura" que envolve TODAS as telas
// ----------------------------------------------------------------------------
// Usamos o expo-router: cada ARQUIVO dentro de app/src/app vira um ENDEREÇO.
//   app/index.tsx               ->  /
//   app/entrar.tsx              ->  /entrar
//   app/agendar/[slug].tsx      ->  /agendar/qualquer-coisa   ([slug] = parte variável)
//   app/painel/[clinicId]/...   ->  /painel/<id-da-clinica>/...
// Arquivos chamados _layout.tsx não são telas: são molduras que envolvem as telas
// da mesma pasta (ótimo para "toda a pasta /painel exige login").
// O mesmo código vira site, app Android e app iPhone.
// ============================================================================
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/lib/auth';

export default function RootLayout() {
  return (
    // SafeAreaProvider: informa as áreas "seguras" do celular (fora do entalhe/notch
    // e da barra de gestos), para nada ficar escondido atrás delas.
    <SafeAreaProvider>
      {/* AuthProvider: disponibiliza o login para todas as telas (veja lib/auth.tsx). */}
      <AuthProvider>
        <StatusBar style="auto" />
        {/* Stack = navegação em "pilha": cada tela nova fica por cima da anterior
            (o botão voltar tira a de cima). headerShown:false porque cada tela
            desenha o próprio cabeçalho. */}
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
