import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { PasswordForm } from '@/components/PasswordForm';
import { Button, Loading, Muted, Notice, Screen, Title } from '@/components/ui';
import { readRecoveryHash } from '@/lib/password';
import { supabase } from '@/lib/supabase';

type State = { status: 'checking' } | { status: 'ready' } | { status: 'invalid'; reason: string } | { status: 'done' };

/** Lê o link do e-mail no endereço, abre a sessão e devolve o estado da tela. */
async function openRecoverySession(): Promise<State> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { status: 'invalid', reason: 'Abra o link do e-mail no navegador.' };
  }
  const result = await readLink();
  // Tira os códigos do endereço (não ficam no histórico nem em prints).
  // O expo-router guarda o "#" como parâmetro da rota; zerar o parâmetro limpa o endereço.
  if (window.location.hash) router.setParams({ '#': '' });
  return result;
}

async function readLink(): Promise<State> {
  const link = readRecoveryHash(window.location.hash);

  if (link.error) {
    return {
      status: 'invalid',
      reason: /expired|invalid/i.test(link.error)
        ? 'Este link expirou ou já foi usado.'
        : 'Não foi possível abrir este link.',
    };
  }
  if (link.accessToken && link.refreshToken && link.type === 'recovery') {
    const { error } = await supabase.auth.setSession({
      access_token: link.accessToken,
      refresh_token: link.refreshToken,
    });
    return error ? { status: 'invalid', reason: 'Este link expirou ou já foi usado.' } : { status: 'ready' };
  }
  // Recarregou a página depois de abrir o link: segue se a sessão ainda existe.
  const { data } = await supabase.auth.getSession();
  return data.session ? { status: 'ready' } : { status: 'invalid', reason: 'Link de redefinição ausente ou incompleto.' };
}

/** Página aberta pelo link do e-mail "Redefinir senha". */
export default function ResetPasswordScreen() {
  const [state, setState] = useState<State>({ status: 'checking' });

  useEffect(() => {
    let active = true;
    openRecoverySession().then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, []);

  if (state.status === 'checking') {
    return (
      <Screen>
        <Loading label="Abrindo o link…" />
      </Screen>
    );
  }

  if (state.status === 'invalid') {
    return (
      <Screen footer={<Button label="Pedir um link novo" onPress={() => router.replace('/esqueci-senha')} />}>
        <Title>Link inválido</Title>
        <Notice tone="warning">{state.reason}</Notice>
        <Muted>Os links valem por 1 hora e funcionam uma única vez. Peça outro e use o mais recente.</Muted>
      </Screen>
    );
  }

  if (state.status === 'done') {
    return (
      <Screen footer={<Button label="Ir para o painel" onPress={() => router.replace('/painel')} />}>
        <Title>Senha alterada</Title>
        <Notice tone="success">Pronto! Sua senha nova já vale. Você já está conectado.</Notice>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Criar senha nova</Title>
      <Muted>Escolha a senha nova do seu login.</Muted>
      <PasswordForm submitLabel="Salvar senha nova" onDone={() => setState({ status: 'done' })} />
    </Screen>
  );
}
