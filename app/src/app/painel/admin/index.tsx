import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Checkbox, Field, Loading, Muted, Notice, Screen, SectionLabel, Text, Title } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { callFunction, useAuth } from '@/lib/auth';
import { isValidEmail } from '@/lib/format';
import { saveProfessional } from '@/lib/professionals';
import { defaultWeek } from '@/lib/schedule';
import { supabase } from '@/lib/supabase';

type ClinicItem = { id: string; name: string; slug: string; public_booking_enabled: boolean; created_at: string };

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Gerente do sistema: vê e cria todas as clínicas. */
export default function AdminScreen() {
  const { isPlatformAdmin, signOut } = useAuth();
  const c = usePalette();
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [response, setResponse] = useState<{ key: number; items?: ClinicItem[]; error?: string }>();

  useEffect(() => {
    if (!isPlatformAdmin) return;
    let active = true;
    supabase
      .from('clinics')
      .select('id, name, slug, public_booking_enabled, created_at')
      .order('name')
      .then(({ data, error }) => {
        if (!active) return;
        setResponse(error ? { key: version, error: error.message } : { key: version, items: data as ClinicItem[] });
      });
    return () => {
      active = false;
    };
  }, [isPlatformAdmin, version]);

  const filtered = useMemo(() => {
    const term = slugify(search);
    const items = response?.items ?? [];
    return term ? items.filter((i) => slugify(i.name).includes(term) || i.slug.includes(term)) : items;
  }, [response, search]);

  if (!isPlatformAdmin) return <Redirect href="/painel" />;

  return (
    <Screen wide footer={<Button label="Sair" variant="secondary" onPress={signOut} />}>
      <Title>Gerente do sistema</Title>
      <Muted>Você enxerga todas as clínicas. Cada clínica só enxerga os próprios dados.</Muted>

      <NewClinicForm onCreated={(id) => { setVersion((v) => v + 1); router.push(`/painel/${id}/equipe`); }} />

      <SectionLabel>Clínicas ({response?.items?.length ?? 0})</SectionLabel>
      <Field label="Buscar" value={search} onChangeText={setSearch} placeholder="Nome ou link" />
      {response?.error ? (
        <Notice tone="danger">{response.error}</Notice>
      ) : !response ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Muted>Nenhuma clínica encontrada.</Muted>
      ) : (
        filtered.map((item) => (
          <Pressable key={item.id} accessibilityRole="link" onPress={() => router.push(`/painel/${item.id}`)}>
            <Card>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={[styles.name, { color: c.text }]}>{item.name}</Text>
                  <Muted>/agendar/{item.slug}</Muted>
                </View>
                <Badge
                  label={item.public_booking_enabled ? 'Link ativo' : 'Link desligado'}
                  tone={item.public_booking_enabled ? 'success' : 'neutral'}
                />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

function NewClinicForm({ onCreated }: { onCreated: (clinicId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [managerAttends, setManagerAttends] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return <Button label="+ Nova clínica" onPress={() => setOpen(true)} />;

  const finalSlug = slugTouched ? slug : slugify(name);

  const submit = async () => {
    setError(null);
    if (name.trim().length < 2) return setError('Informe o nome da clínica.');
    if (!/^[a-z0-9-]{3,60}$/.test(finalSlug)) return setError('O link precisa ter de 3 a 60 letras minúsculas, números ou hífens.');
    if (!isValidEmail(managerEmail)) return setError('Informe o e-mail do gerente da clínica.');
    if (managerPassword.length < 8) return setError('A senha do gerente precisa ter pelo menos 8 caracteres.');

    setBusy(true);
    const { data, error: insertError } = await supabase
      .from('clinics')
      .insert({ name: name.trim(), slug: finalSlug })
      .select('id')
      .single();
    if (insertError || !data) {
      setBusy(false);
      return setError(/duplicate|unique/i.test(insertError?.message ?? '') ? 'Esse link já está em uso.' : 'Não foi possível criar a clínica.');
    }
    let managerId: string;
    try {
      const created = await callFunction<{ user_id: string }>('admin-users', {
        action: 'create',
        clinic_id: data.id,
        email: managerEmail.trim(),
        password: managerPassword,
        full_name: managerName.trim(),
        role: 'admin',
      });
      managerId = created.user_id;
    } catch (e) {
      setBusy(false);
      setError(`Clínica criada, mas o login do gerente falhou: ${(e as Error).message} Crie-o na aba Equipe.`);
      onCreated(data.id);
      return;
    }
    if (managerAttends) {
      try {
        await saveProfessional({
          clinic_id: data.id,
          name: managerName.trim() || name.trim(),
          user_id: managerId,
          week: defaultWeek(),
        });
      } catch {
        // Não impede a criação: o gerente pode tocar em "Sim, eu atendo" depois.
      }
    }
    setBusy(false);
    onCreated(data.id);
  };

  return (
    <Card>
      <SectionLabel>Nova clínica</SectionLabel>
      <Field label="Nome da clínica" value={name} onChangeText={setName} />
      <Field
        label="Link de agendamento"
        value={finalSlug}
        onChangeText={(v) => {
          setSlugTouched(true);
          setSlug(slugify(v));
        }}
        autoCapitalize="none"
        hint={`/agendar/${finalSlug || '...'}`}
      />
      <SectionLabel>Gerente da clínica</SectionLabel>
      <Field label="Nome" value={managerName} onChangeText={setManagerName} autoCapitalize="words" />
      <View style={styles.row}>
        <Field
          label="E-mail (login)"
          value={managerEmail}
          onChangeText={setManagerEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.flex}
        />
        <Field
          label="Senha inicial"
          value={managerPassword}
          onChangeText={setManagerPassword}
          autoCapitalize="none"
          autoCorrect={false}
          hint="Mínimo de 8 caracteres"
          style={styles.flex}
        />
      </View>
      <Checkbox checked={managerAttends} onChange={setManagerAttends}>
        O gerente também atende os pacientes (clínica pequena, sem outros profissionais). Já cria o perfil de
        profissional dele com Seg–Sex 8h–18h.
      </Checkbox>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button label="Criar clínica" loading={busy} onPress={submit} />
        </View>
        <View style={styles.flex}>
          <Button label="Cancelar" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 200 },
  row: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start', flexWrap: 'wrap' },
  name: { fontSize: 16, fontWeight: '600' },
});
