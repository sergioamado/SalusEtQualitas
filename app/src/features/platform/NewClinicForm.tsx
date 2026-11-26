import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Checkbox, Chip, Field, Notice, SectionLabel } from '@/components/ui';
import { Space } from '@/constants/theme';
import { callFunction } from '@/lib/auth';
import { isValidEmail } from '@/lib/format';
import { saveProfessional } from '@/lib/professionals';
import { defaultWeek } from '@/lib/schedule';
import { supabase } from '@/lib/supabase';

import { money, type Plan } from './api';

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Data local daqui a N dias, no formato AAAA-MM-DD. */
function addDaysKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Cria a clínica, o login do gerente e (opcional) o perfil de profissional dele. */
export function NewClinicForm({ plans, onCreated }: { plans: Plan[]; onCreated: (clinicId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [managerAttends, setManagerAttends] = useState(true);
  const [planId, setPlanId] = useState<string | null>(null);
  const [trialDays, setTrialDays] = useState('14');
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
    const trial = Number(trialDays || '0');
    if (!Number.isInteger(trial) || trial < 0 || trial > 365) return setError('Período de teste: de 0 a 365 dias.');

    setBusy(true);
    const { data, error: insertError } = await supabase
      .from('clinics')
      .insert({
        name: name.trim(),
        slug: finalSlug,
        plan_id: planId,
        status: trial > 0 ? 'teste' : 'ativa',
        trial_ends_on: trial > 0 ? addDaysKey(trial) : null,
        due_day: trial > 0 ? null : Math.min(new Date().getDate(), 28),
        next_due_date: trial > 0 ? null : addDaysKey(30),
      })
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
      <SectionLabel>Plano</SectionLabel>
      <View style={styles.chips}>
        <Chip label="Sem plano" selected={planId === null} onPress={() => setPlanId(null)} />
        {plans
          .filter((p) => p.active)
          .map((p) => (
            <Chip key={p.id} label={`${p.name} · ${money(p.price_monthly)}`} selected={planId === p.id} onPress={() => setPlanId(p.id)} />
          ))}
      </View>
      <Field
        label="Período de teste grátis (dias)"
        value={trialDays}
        onChangeText={(v) => setTrialDays(v.replace(/\D/g, '').slice(0, 3))}
        keyboardType="number-pad"
        hint="0 = começa como ativa, com o 1º vencimento daqui a 30 dias."
      />
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
});
