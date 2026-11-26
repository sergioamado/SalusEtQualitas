import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { Button, Card, Field, Loading, Muted, Notice, Screen, SectionLabel, Text, Title } from '@/components/ui';
import { usePalette } from '@/constants/theme';
import { hasSupportContact, SupportContacts, useSupport } from '@/features/platform/SupportCard';
import { useAuth } from '@/lib/auth';

export default function SignInScreen() {
  const c = usePalette();
  const { loading, session, signIn } = useAuth();
  const support = useSupport();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading && !submitting) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (session) return <Redirect href="/painel" />;

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Informe e-mail e senha.');
      return;
    }
    setSubmitting(true);
    const message = await signIn(email, password);
    setSubmitting(false);
    if (message) setError(message);
  };

  return (
    <Screen footer={<Button label="Entrar" loading={submitting} onPress={submit} />}>
      <Title>Entrar</Title>
      <Muted>Use o login criado pelo gerente do sistema ou da sua clínica.</Muted>
      <Field
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        textContentType="username"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label="Senha"
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        secureTextEntry
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Pressable accessibilityRole="link" onPress={() => router.push('/esqueci-senha')} hitSlop={8}>
        <Text style={{ color: c.primary, fontWeight: '600', fontSize: 15 }}>Esqueci minha senha</Text>
      </Pressable>
      {hasSupportContact(support) ? (
        <Card>
          <SectionLabel>Precisa de ajuda?</SectionLabel>
          <SupportContacts support={support} context="acesso ao painel" />
        </Card>
      ) : null}
    </Screen>
  );
}
