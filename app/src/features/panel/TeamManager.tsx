import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chip, Field, Loading, Muted, Notice, SectionLabel, Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { callFunction, ROLE_LABEL, type MemberRole } from '@/lib/auth';
import { isValidEmail } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type Member = {
  user_id: string;
  role: MemberRole;
  email: string | null;
  full_name: string | null;
  last_sign_in_at: string | null;
};

const ROLES: MemberRole[] = ['admin', 'recepcao', 'profissional'];

/** Lista, cria e gerencia logins de uma clínica (usado pelo gerente da clínica e pelo admin). */
export function TeamManager({ clinicId }: { clinicId: string }) {
  const [version, setVersion] = useState(0);
  const key = `${clinicId}|${version}`;
  const [response, setResponse] = useState<{ key: string; members?: Member[]; error?: string }>();
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => active && setMyId(data.user?.id ?? null));
    callFunction<{ members: Member[] }>('admin-users', { action: 'list', clinic_id: clinicId })
      .then((r) => active && setResponse({ key, members: r.members }))
      .catch((e: Error) => active && setResponse({ key, error: e.message }));
    return () => {
      active = false;
    };
  }, [clinicId, key]);

  const current = response?.key === key ? response : undefined;
  const refresh = () => setVersion((v) => v + 1);

  return (
    <View style={{ gap: Space.lg }}>
      <NewMemberForm clinicId={clinicId} onCreated={refresh} />
      <SectionLabel>Pessoas com acesso</SectionLabel>
      {current?.error ? (
        <Notice tone="danger">{current.error}</Notice>
      ) : !current ? (
        <Loading />
      ) : current.members!.length === 0 ? (
        <Muted>Nenhum usuário ainda. Crie o primeiro acesso acima.</Muted>
      ) : (
        current.members!.map((m) => (
          <MemberRow key={m.user_id} clinicId={clinicId} member={m} isMe={m.user_id === myId} onChanged={refresh} />
        ))
      )}
    </View>
  );
}

function NewMemberForm({ clinicId, onCreated }: { clinicId: string; onCreated: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<MemberRole>('recepcao');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const submit = async () => {
    setMessage(null);
    if (!isValidEmail(email)) return setMessage({ tone: 'danger', text: 'Informe um e-mail válido.' });
    if (password.length < 8) return setMessage({ tone: 'danger', text: 'A senha precisa ter pelo menos 8 caracteres.' });
    setBusy(true);
    try {
      await callFunction('admin-users', {
        action: 'create',
        clinic_id: clinicId,
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        role,
      });
      setMessage({ tone: 'success', text: `Acesso criado. Envie o e-mail e a senha para ${fullName.trim() || email.trim()}.` });
      setFullName('');
      setEmail('');
      setPassword('');
      onCreated();
    } catch (e) {
      setMessage({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionLabel>Novo acesso</SectionLabel>
      <Field label="Nome" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <View style={styles.row}>
        <Field
          label="E-mail (login)"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.flex}
        />
        <Field
          label="Senha inicial"
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          hint="Mínimo de 8 caracteres"
          style={styles.flex}
        />
      </View>
      <View style={styles.chips}>
        {ROLES.map((r) => (
          <Chip key={r} label={ROLE_LABEL[r]} selected={role === r} onPress={() => setRole(r)} />
        ))}
      </View>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button label="Criar acesso" loading={busy} onPress={submit} />
    </Card>
  );
}

function MemberRow({
  clinicId,
  member,
  isMe,
  onChanged,
}: {
  clinicId: string;
  member: Member;
  isMe: boolean;
  onChanged: () => void;
}) {
  const c = usePalette();
  const [mode, setMode] = useState<'view' | 'password' | 'remove'>('view');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const run = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await callFunction('admin-users', { clinic_id: clinicId, user_id: member.user_id, ...body });
      setMessage({ tone: 'success', text: success });
      setMode('view');
      setPassword('');
      onChanged();
    } catch (e) {
      setMessage({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={[styles.name, { color: c.text }]}>
            {member.full_name || member.email}
            {isMe ? ' (você)' : ''}
          </Text>
          {member.full_name ? <Muted>{member.email}</Muted> : null}
          <Muted style={{ fontSize: 13 }}>
            {member.last_sign_in_at
              ? `Último acesso: ${new Date(member.last_sign_in_at).toLocaleString('pt-BR')}`
              : 'Ainda não entrou'}
          </Muted>
        </View>
        <Badge label={ROLE_LABEL[member.role]} tone={member.role === 'admin' ? 'primary' : 'neutral'} />
      </View>

      {!isMe ? (
        <View style={styles.chips}>
          {ROLES.map((r) => (
            <Chip
              key={r}
              label={ROLE_LABEL[r]}
              selected={member.role === r}
              onPress={() => r !== member.role && run({ action: 'set_role', role: r }, 'Papel atualizado.')}
            />
          ))}
        </View>
      ) : null}

      {mode === 'password' ? (
        <View style={{ gap: Space.sm }}>
          <Field label="Nova senha" value={password} onChangeText={setPassword} autoCapitalize="none" hint="Mínimo de 8 caracteres" />
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button
                label="Salvar senha"
                loading={busy}
                disabled={password.length < 8}
                onPress={() => run({ action: 'set_password', password }, 'Senha alterada.')}
              />
            </View>
            <View style={styles.flex}>
              <Button label="Voltar" variant="secondary" onPress={() => setMode('view')} />
            </View>
          </View>
        </View>
      ) : mode === 'remove' ? (
        <View style={{ gap: Space.sm }}>
          <Notice tone="danger">Remover o acesso de {member.full_name || member.email}? A pessoa não conseguirá mais entrar.</Notice>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label="Remover acesso" loading={busy} onPress={() => run({ action: 'remove' }, 'Acesso removido.')} />
            </View>
            <View style={styles.flex}>
              <Button label="Voltar" variant="secondary" onPress={() => setMode('view')} />
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Button label="Definir nova senha" variant="secondary" onPress={() => setMode('password')} />
          </View>
          {!isMe ? (
            <View style={styles.flex}>
              <Button label="Remover acesso" variant="secondary" onPress={() => setMode('remove')} />
            </View>
          ) : null}
        </View>
      )}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start', flexWrap: 'wrap' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  name: { fontSize: 16, fontWeight: '600' },
});
