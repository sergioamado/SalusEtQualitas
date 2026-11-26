import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { Button, Field, Muted, Notice, Screen, Text, Title } from '@/components/ui';
import { usePalette } from '@/constants/theme';
import { isValidEmail } from '@/lib/format';
import { requestPasswordReset } from '@/lib/password';

/** Pede o link de redefinição de senha por e-mail. */
export default function ForgotPasswordScreen() {
  const c = usePalette();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!isValidEmail(email.trim())) return setError('Informe um e-mail válido.');
    setSending(true);
    const message = await requestPasswordReset(email);
    setSending(false);
    if (message) setError(message);
    else setSentTo(email.trim().toLowerCase());
  };

  return (
    <Screen
      footer={
        sentTo ? (
          <Button label="Voltar para o login" variant="secondary" onPress={() => router.replace('/entrar')} />
        ) : (
          <Button label="Enviar link" loading={sending} onPress={submit} />
        )
      }>
      <Title>Esqueci minha senha</Title>
      {sentTo ? (
        <>
          <Notice tone="success">
            Se existir um login com {sentTo}, enviamos um link para criar uma senha nova.
          </Notice>
          <Muted>
            Abra o e-mail e toque em “Redefinir senha”. O link vale por 1 hora e só funciona uma vez. Não chegou em
            alguns minutos? Olhe a caixa de spam ou lixo eletrônico.
          </Muted>
        </>
      ) : (
        <>
          <Muted>Informe o e-mail do seu login. Vamos mandar um link para você criar uma senha nova.</Muted>
          <Field
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            autoComplete="email"
            textContentType="username"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={submit}
            returnKeyType="send"
          />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Pressable accessibilityRole="link" onPress={() => router.replace('/entrar')} hitSlop={8}>
            <Text style={{ color: c.primary, fontWeight: '600' }}>‹ Voltar para o login</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}
