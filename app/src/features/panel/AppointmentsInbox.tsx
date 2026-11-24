import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chip, Field, Loading, Muted, Notice, Screen, Text, Title } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { formatDateTimeLong, formatTime, maskPhone } from '@/lib/format';
import { supabase } from '@/lib/supabase';

import { useClinic } from './clinic-context';

type Status = 'agendado' | 'reservado' | 'confirmado' | 'nao_compareceu' | 'concluido' | 'cancelado';

type Appointment = {
  id: string;
  status: Status;
  modality: 'clinica' | 'residencial';
  channel: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  cancel_reason: string | null;
  google_sync_error: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  contact: { full_name: string; phone: string | null; email: string | null; status: string } | null;
  procedure: { name: string } | null;
  professional: { name: string } | null;
  room: { name: string } | null;
};

const SELECT = `
  id, status, modality, channel, starts_at, ends_at, created_at, cancel_reason, google_sync_error,
  address_street, address_number, address_complement, address_district, address_city, address_state,
  contact:contacts!appointments_contact_id_clinic_id_fkey ( full_name, phone, email, status ),
  procedure:procedures!appointments_procedure_id_clinic_id_fkey ( name ),
  professional:professionals!appointments_professional_id_clinic_id_fkey ( name ),
  room:rooms!appointments_room_id_clinic_id_fkey ( name )
`;

export const STATUS_LABEL: Record<Status, string> = {
  reservado: 'Aguardando aprovação',
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  nao_compareceu: 'Não compareceu',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};
const STATUS_TONE: Record<Status, 'warning' | 'primary' | 'success' | 'danger' | 'neutral'> = {
  reservado: 'warning',
  agendado: 'primary',
  confirmado: 'success',
  nao_compareceu: 'danger',
  concluido: 'neutral',
  cancelado: 'neutral',
};
const CHANNEL_LABEL: Record<string, string> = {
  portal: 'Link de agendamento',
  interno: 'Recepção',
  whatsapp: 'WhatsApp',
  telefone: 'Telefone',
  instagram: 'Instagram',
  outro: 'Outro',
};

type Tab = 'pendentes' | 'proximos' | 'recebidos';
const TABS: { key: Tab; label: string }[] = [
  { key: 'pendentes', label: 'Aguardando aprovação' },
  { key: 'proximos', label: 'Próximos' },
  { key: 'recebidos', label: 'Recebidos recentemente' },
];

export function AppointmentsInbox() {
  const { clinic } = useClinic();
  const [tab, setTab] = useState<Tab>('pendentes');
  const [version, setVersion] = useState(0);
  const [response, setResponse] = useState<{ key: string; items?: Appointment[]; error?: string }>();
  const [newCount, setNewCount] = useState(0);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const key = `${clinic.id}|${tab}|${version}`;
  const baseTitle = useRef<string | null>(null);

  // Lista da aba atual
  useEffect(() => {
    let active = true;
    const now = new Date().toISOString();
    let q = supabase.from('appointments').select(SELECT).eq('clinic_id', clinic.id);
    if (tab === 'pendentes') q = q.eq('status', 'reservado').gte('starts_at', now).order('starts_at');
    else if (tab === 'proximos')
      q = q.in('status', ['agendado', 'confirmado']).gte('ends_at', now).order('starts_at').limit(100);
    else q = q.order('created_at', { ascending: false }).limit(50);
    q.then(({ data, error }) => {
      if (!active) return;
      setResponse(error ? { key, error: error.message } : { key, items: (data ?? []) as unknown as Appointment[] });
    });
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinic.id)
      .eq('status', 'reservado')
      .gte('starts_at', now)
      .then(({ count }) => active && setPendingCount(count ?? 0));
    return () => {
      active = false;
    };
  }, [clinic.id, tab, key]);

  // RNF03: tempo real — qualquer mudança nos agendamentos desta clínica recarrega a lista.
  useEffect(() => {
    const channel = supabase
      .channel(`agendamentos-${clinic.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setNewCount((n) => n + 1);
          setVersion((v) => v + 1);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinic.id]);

  // No navegador, mostra o número de pendentes no título da aba.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (baseTitle.current === null) baseTitle.current = document.title;
    document.title = pendingCount ? `(${pendingCount}) ${clinic.name}` : clinic.name;
  }, [pendingCount, clinic.name]);
  useEffect(
    () => () => {
      if (Platform.OS === 'web' && typeof document !== 'undefined' && baseTitle.current !== null) {
        document.title = baseTitle.current;
      }
    },
    [],
  );

  const current = response?.key === key ? response : undefined;

  return (
    <Screen wide safeTop={false}>
      <Title>Agendamentos</Title>
      {newCount > 0 ? (
        <Pressable onPress={() => { setNewCount(0); setTab('recebidos'); }}>
          <Notice tone="success">
            {newCount === 1 ? 'Chegou 1 novo agendamento.' : `Chegaram ${newCount} novos agendamentos.`} Toque para ver.
          </Notice>
        </Pressable>
      ) : null}
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Chip
            key={t.key}
            label={t.key === 'pendentes' && pendingCount ? `${t.label} (${pendingCount})` : t.label}
            selected={tab === t.key}
            onPress={() => setTab(t.key)}
          />
        ))}
      </View>

      {current?.error ? (
        <Notice tone="danger">{current.error}</Notice>
      ) : !current ? (
        <Loading label="Carregando agendamentos…" />
      ) : current.items!.length === 0 ? (
        <Muted>
          {tab === 'pendentes'
            ? 'Nenhum agendamento aguardando aprovação.'
            : tab === 'proximos'
              ? 'Nenhum agendamento futuro.'
              : 'Nenhum agendamento recebido ainda.'}
        </Muted>
      ) : (
        <View style={styles.list}>
          {current.items!.map((a) => (
            <AppointmentCard key={a.id} appointment={a} timezone={clinic.timezone} onChanged={() => setVersion((v) => v + 1)} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function AppointmentCard({
  appointment: a,
  timezone,
  onChanged,
}: {
  appointment: Appointment;
  timezone: string;
  onChanged: () => void;
}) {
  const c = usePalette();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const update = async (status: Status, cancelReason?: string) => {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from('appointments')
      .update({ status, ...(cancelReason !== undefined ? { cancel_reason: cancelReason || null } : {}) })
      .eq('id', a.id);
    setBusy(false);
    if (error) setError('Não foi possível atualizar. Tente novamente.');
    else {
      setCancelling(false);
      onChanged();
    }
  };

  const phone = a.contact?.phone ?? null;
  const address = useMemo(
    () =>
      a.modality === 'residencial'
        ? [
            [a.address_street, a.address_number].filter(Boolean).join(', '),
            a.address_complement,
            a.address_district,
            [a.address_city, a.address_state].filter(Boolean).join('/'),
          ]
            .filter(Boolean)
            .join(' - ')
        : null,
    [a],
  );

  const actions: { label: string; status: Status; primary?: boolean }[] =
    a.status === 'reservado'
      ? [{ label: 'Aprovar', status: 'agendado', primary: true }]
      : a.status === 'agendado'
        ? [{ label: 'Paciente confirmou', status: 'confirmado', primary: true }]
        : a.status === 'confirmado'
          ? [
              { label: 'Concluído', status: 'concluido', primary: true },
              { label: 'Não compareceu', status: 'nao_compareceu' },
            ]
          : [];
  const canCancel = ['reservado', 'agendado', 'confirmado'].includes(a.status);

  return (
    <Card>
      <View style={styles.cardTop}>
        <View style={styles.flex}>
          <Text style={[styles.when, { color: c.text }]}>{formatDateTimeLong(a.starts_at, timezone)}</Text>
          <Muted>
            até {formatTime(a.ends_at, timezone)} · {a.procedure?.name ?? 'Atendimento'}
          </Muted>
        </View>
        <Badge label={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} />
      </View>

      <View style={{ gap: 2 }}>
        <Text style={[styles.patient, { color: c.text }]}>
          {a.contact?.full_name ?? 'Paciente'}
        </Text>
        <View style={styles.badges}>
          {a.contact?.status === 'lead' ? <Badge label="Novo paciente" tone="primary" /> : null}
          <Badge label={CHANNEL_LABEL[a.channel] ?? a.channel} />
          <Badge label={a.modality === 'residencial' ? 'Residencial' : 'Na clínica'} />
        </View>
        {phone ? <Muted>{maskPhone(phone)}{a.contact?.email ? ` · ${a.contact.email}` : ''}</Muted> : null}
        <Muted>
          {a.professional?.name ?? '-'}
          {a.room?.name ? ` · ${a.room.name}` : ''}
        </Muted>
        {address ? <Muted>📍 {address}</Muted> : null}
        {a.cancel_reason ? <Muted>Motivo do cancelamento: {a.cancel_reason}</Muted> : null}
      </View>

      {a.google_sync_error ? (
        <Notice tone="warning">Google Agenda: {a.google_sync_error}</Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {cancelling ? (
        <View style={{ gap: Space.sm }}>
          <Field
            label="Motivo do cancelamento (opcional)"
            value={reason}
            onChangeText={setReason}
            placeholder="Ex.: paciente pediu para remarcar"
          />
          <View style={styles.actions}>
            <View style={styles.flex}>
              <Button label="Confirmar cancelamento" loading={busy} onPress={() => update('cancelado', reason.trim())} />
            </View>
            <View style={styles.flex}>
              <Button label="Voltar" variant="secondary" onPress={() => setCancelling(false)} />
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {actions.map((act) => (
            <View key={act.status} style={styles.flex}>
              <Button
                label={act.label}
                variant={act.primary ? 'primary' : 'secondary'}
                loading={busy}
                onPress={() => update(act.status)}
              />
            </View>
          ))}
          {phone ? (
            <View style={styles.flex}>
              <Button
                label="WhatsApp"
                variant="secondary"
                onPress={() => Linking.openURL(`https://wa.me/55${phone}`)}
              />
            </View>
          ) : null}
          {canCancel ? (
            <View style={styles.flex}>
              <Button label={a.status === 'reservado' ? 'Recusar' : 'Cancelar'} variant="secondary" onPress={() => setCancelling(true)} />
            </View>
          ) : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 140 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  list: { gap: Space.md },
  cardTop: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  when: { fontSize: 17, fontWeight: '700', textTransform: 'capitalize' },
  patient: { fontSize: 16, fontWeight: '600' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs, marginVertical: Space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
});
