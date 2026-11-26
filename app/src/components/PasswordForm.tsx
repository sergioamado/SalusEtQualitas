import { useState } from 'react';
import { View } from 'react-native';

import { Button, Field, Muted, Notice } from '@/components/ui';
import { Space } from '@/constants/theme';
import { changePassword, MIN_PASSWORD, passwordProblem } from '@/lib/password';

/** Senha nova + confirmação. Usado na redefinição por e-mail e em "Minha conta". */
export function PasswordForm({ submitLabel, onDone }: { submitLabel: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setSaving(true);
    const message = await changePassword(password);
    setSaving(false);
    if (message) setError(message);
    else {
      setPassword('');
      setConfirm('');
      onDone();
    }
  };

  return (
    <View style={{ gap: Space.md }}>
      <Field
        label="Senha nova"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint={`Pelo menos ${MIN_PASSWORD} caracteres, com letras e números.`}
      />
      <Field
        label="Repita a senha nova"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={submitLabel} loading={saving} onPress={submit} />
      <Muted style={{ fontSize: 13 }}>Dica: não use a mesma senha de outros sites.</Muted>
    </View>
  );
}
