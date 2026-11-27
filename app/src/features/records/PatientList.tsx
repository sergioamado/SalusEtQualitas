// ============================================================================
// LISTA DE PACIENTES (módulo Pacientes)
// ----------------------------------------------------------------------------
// Toda a equipe vê a lista (nome e contato já são visíveis na agenda), mas o
// cadeado aparece para quem não pode abrir o prontuário daquele paciente.
// Quem decide o cadeado é o BANCO (campo can_view de record_patient_list).
// ============================================================================
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chip, Field, Loading, Muted, Notice, Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { upsertContact } from '@/features/agenda/api';
import { useClinic } from '@/features/panel/clinic-context';
import { formatDateLong, isValidEmail, isValidFullName, maskPhone, onlyDigits } from '@/lib/format';
import { toLocal } from '@/lib/tz';

import { listPatients, type PatientListItem } from './api';
import { cap, vocab } from './vocab';

export function PatientList() {
  const { clinic, role } = useClinic();
  const words = vocab(clinic.record_vocabulary);
  const isProfessional = role === 'profissional';

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [onlyMine, setOnlyMine] = useState(isProfessional);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const key = `${clinic.id}|${search}|${version}`;
  const [response, setResponse] = useState<{ key: string; list?: PatientListItem[]; error?: string }>();

  // Espera a pessoa parar de digitar (300 ms) antes de buscar no banco.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let active = true;
    listPatients(clinic.id, search)
      .then((list) => active && setResponse({ key, list }))
      .catch((e: Error) => active && setResponse({ key, error: e.message }));
    return () => {
      active = false;
    };
  }, [clinic.id, search, key]);

  const current = response?.key === key ? response : response?.list ? response : undefined;
  const list = (current?.list ?? []).filter((p) => !onlyMine || p.mine);

  const open = (p: PatientListItem) => router.push(`/painel/${clinic.id}/pacientes/${p.id}` as never);

  return (
    <View style={{ gap: Space.md }}>
      <Field label={`Buscar ${words.person}`} placeholder="Nome, telefone ou e-mail" value={query} onChangeText={setQuery} />
      <View style={styles.row}>
        {isProfessional ? (
          <>
            <Chip label={`Meus ${words.people}`} selected={onlyMine} onPress={() => setOnlyMine(true)} />
            <Chip label="Todos" selected={!onlyMine} onPress={() => setOnlyMine(false)} />
          </>
        ) : null}
        <View style={styles.flex} />
        {!adding ? (
          <View style={{ minWidth: 180 }}>
            <Button label={`+ Novo(a) ${words.person}`} variant="secondary" onPress={() => setAdding(true)} />
          </View>
        ) : null}
      </View>

      {adding ? (
        <NewPatientForm
          clinicId={clinic.id}
          person={words.person}
          onClose={(id) => {
            setAdding(false);
            if (id) router.push(`/painel/${clinic.id}/pacientes/${id}` as never);
            else setVersion((v) => v + 1);
          }}
        />
      ) : null}

      {!current ? (
        <Loading label={`Carregando ${words.people}…`} />
      ) : current.error ? (
        <Notice tone="danger">{current.error}</Notice>
      ) : list.length === 0 ? (
        <Muted>
          {search
            ? 'Ninguém encontrado com essa busca.'
            : onlyMine
              ? `Você ainda não atendeu nenhum(a) ${words.person}. Toque em “Todos” para ver a lista completa.`
              : `Nenhum(a) ${words.person} cadastrado(a) ainda. Eles aparecem aqui ao agendar ou ao cadastrar.`}
        </Muted>
      ) : (
        list.map((p) => <PatientRow key={p.id} p={p} timeZone={clinic.timezone} intakeWord={words.intake} onPress={() => open(p)} />)
      )}
      {current?.list && current.list.length >= 200 && !search ? (
        <Muted>Mostrando os 200 mais recentes. Use a busca para encontrar os demais.</Muted>
      ) : null}
    </View>
  );
}

function PatientRow({
  p,
  timeZone,
  intakeWord,
  onPress,
}: {
  p: PatientListItem;
  timeZone: string;
  intakeWord: string;
  onPress: () => void;
}) {
  const c = usePalette();
  const day = (iso: string) => formatDateLong(toLocal(iso, timeZone).date);
  const info = [
    p.phone ? maskPhone(p.phone) : null,
    p.last_visit ? `Último atendimento: ${day(p.last_visit)}` : null,
    p.next_visit ? `Próximo: ${day(p.next_visit)}` : null,
  ].filter(Boolean);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      <Card style={{ gap: Space.xs }}>
        <View style={styles.row}>
          <Text style={[styles.name, styles.flex]}>{p.full_name}</Text>
          {p.can_view ? null : <Text style={{ color: c.textMuted }}>🔒</Text>}
        </View>
        {info.length ? <Muted>{info.join(' · ')}</Muted> : null}
        {p.can_view ? (
          <View style={styles.row}>
            {p.has_intake ? <Badge label={`${cap(intakeWord)} ok`} tone="success" /> : <Badge label={`Sem ${intakeWord}`} tone="warning" />}
            {p.entries ? <Badge label={`${p.entries} registro(s)`} /> : null}
          </View>
        ) : (
          <Muted style={{ fontSize: 13 }}>Prontuário restrito ao dono da clínica e a quem atendeu.</Muted>
        )}
      </Card>
    </Pressable>
  );
}

/** Cadastro rápido (sem agendar). Usa a mesma função da agenda, que evita duplicados. */
function NewPatientForm({ clinicId, person, onClose }: { clinicId: string; person: string; onClose: (id?: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!isValidFullName(name)) return setError('Informe nome e sobrenome.');
    const digits = onlyDigits(phone);
    if (digits && (digits.length < 10 || digits.length > 11)) return setError('Telefone com DDD, só números.');
    if (email.trim() && !isValidEmail(email)) return setError('E-mail inválido.');
    setError(null);
    setSaving(true);
    try {
      const id = await upsertContact(clinicId, { full_name: name.trim(), phone: digits || null, email: email.trim() || null });
      onClose(id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Card>
      <Text style={styles.name}>Novo(a) {person}</Text>
      <Field label="Nome completo" value={name} onChangeText={setName} maxLength={150} />
      <Field label="Telefone (WhatsApp)" value={maskPhone(phone)} onChangeText={(t) => setPhone(onlyDigits(t))} keyboardType="phone-pad" />
      <Field label="E-mail (opcional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Cadastrar e abrir ficha" loading={saving} onPress={save} />
      <Button label="Cancelar" variant="secondary" onPress={() => onClose()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.sm },
  name: { fontSize: 17, fontWeight: '600' },
});
