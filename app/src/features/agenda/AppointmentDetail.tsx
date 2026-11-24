import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { Badge, Button, Chip, Field, Muted, Notice, SectionLabel, SummaryRow } from '@/components/ui';
import { Space } from '@/constants/theme';
import { formatDateTimeLong, formatPrice, formatTime, maskPhone } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { toLocal } from '@/lib/tz';

import { CHANNEL_LABEL, STATUS_LABEL, STATUS_ORDER, type AgendaAppointment, type AgendaSetup, type Status } from './api';

/** Detalhes do agendamento: mudar situação (RF05), cancelar com motivo, remarcar e falar com o paciente. */
export function AppointmentDetail({
  clinicId,
  timeZone,
  setup,
  appointment: a,
  onClose,
  onEdit,
  onChanged,
  onOpenWaitlist,
}: {
  clinicId: string;
  timeZone: string;
  setup: AgendaSetup;
  appointment: AgendaAppointment;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (message: string) => void;
  onOpenWaitlist: () => void;
}) {
  const [busy, setBusy] = useState<Status | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [waitlistHint, setWaitlistHint] = useState<number | null>(null);

  const procedure = setup.procedures.find((p) => p.id === a.procedure_id);
  const professional = setup.professionals.find((p) => p.id === a.professional_id);
  const room = setup.rooms.find((r) => r.id === a.room_id);
  const phone = a.contact?.phone ?? null;
  const cancelled = a.status === 'cancelado';

  const setStatus = async (status: Status) => {
    setBusy(status);
    setError(null);
    const { error: e } = await supabase.from('appointments').update({ status, cancel_reason: null }).eq('id', a.id);
    setBusy(null);
    if (e) {
      setError(
        e.code === '23P01'
          ? 'Não dá para reativar: esse horário já foi ocupado por outro agendamento. Use “Editar / remarcar”.'
          : 'Não foi possível alterar a situação.',
      );
      return;
    }
    onChanged(`Situação alterada para “${STATUS_LABEL[status]}”.`);
  };

  const cancel = async () => {
    setBusy('cancel');
    setError(null);
    const { error: e } = await supabase
      .from('appointments')
      .update({ status: 'cancelado', cancel_reason: reason.trim() || null })
      .eq('id', a.id);
    if (e) {
      setBusy(null);
      setError('Não foi possível cancelar.');
      return;
    }
    // RF06: avisa se há gente na lista de espera que pode ocupar a vaga.
    const day = toLocal(a.starts_at, timeZone).date;
    const { count } = await supabase
      .from('waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('status', 'aguardando')
      .or(
        `and(or(desired_date.is.null,desired_date.eq.${day}),or(professional_id.is.null,professional_id.eq.${a.professional_id}))`,
      );
    setBusy(null);
    if (count) {
      setWaitlistHint(count);
      setCancelling(false);
      return;
    }
    onChanged('Agendamento cancelado. O horário ficou livre.');
  };

  const address = [
    [a.address_street, a.address_number].filter(Boolean).join(', '),
    a.address_complement,
    a.address_district,
    [a.address_city, a.address_state].filter(Boolean).join('/'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Sheet visible title={a.contact?.full_name ?? 'Agendamento'} onClose={onClose}>
      {waitlistHint ? (
        <View style={{ gap: Space.sm }}>
          <Notice tone="success">Agendamento cancelado.</Notice>
          <Notice tone="warning">
            {waitlistHint === 1 ? 'Há 1 paciente' : `Há ${waitlistHint} pacientes`} na lista de espera que pode(m) ocupar
            esta vaga.
          </Notice>
          <Button label="Ver lista de espera" onPress={onOpenWaitlist} />
          <Button label="Fechar" variant="secondary" onPress={() => onChanged('Agendamento cancelado.')} />
        </View>
      ) : null}

      <View style={styles.badges}>
        <Badge
          label={STATUS_LABEL[a.status]}
          tone={a.status === 'reservado' ? 'warning' : a.status === 'confirmado' ? 'success' : a.status === 'nao_compareceu' ? 'danger' : a.status === 'agendado' ? 'primary' : 'neutral'}
        />
        <Badge label={a.modality === 'residencial' ? 'Residencial' : 'Na clínica'} />
        <Badge label={CHANNEL_LABEL[a.channel]} />
      </View>

      <View style={{ gap: Space.xs }}>
        <SummaryRow label="Quando" value={`${formatDateTimeLong(a.starts_at, timeZone)} às ${formatTime(a.ends_at, timeZone)}`} />
        <SummaryRow label="Serviço" value={procedure?.name ?? '—'} />
        <SummaryRow label="Profissional" value={professional?.name ?? '—'} />
        {room ? <SummaryRow label="Sala" value={room.name} /> : null}
        {a.modality === 'residencial' && address ? <SummaryRow label="Endereço" value={address} /> : null}
        {phone ? <SummaryRow label="Telefone" value={maskPhone(phone)} /> : null}
        {a.contact?.email ? <SummaryRow label="E-mail" value={a.contact.email} /> : null}
        {a.price != null ? <SummaryRow label="Valor" value={formatPrice(a.price) ?? ''} /> : null}
        {a.insurance ? <SummaryRow label="Convênio" value={a.insurance} /> : null}
        {a.notes ? <SummaryRow label="Observações" value={a.notes} /> : null}
        {cancelled && a.cancel_reason ? <SummaryRow label="Motivo do cancelamento" value={a.cancel_reason} /> : null}
      </View>

      {a.google_sync_error ? <Notice tone="warning">Google Agenda: {a.google_sync_error}</Notice> : null}

      {phone ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Button label="WhatsApp" variant="secondary" onPress={() => Linking.openURL(`https://wa.me/55${phone}`)} />
          </View>
          <View style={styles.flex}>
            <Button label="Ligar" variant="secondary" onPress={() => Linking.openURL(`tel:${phone}`)} />
          </View>
        </View>
      ) : null}

      <View style={{ gap: Space.xs }}>
        <SectionLabel>{cancelled ? 'Reativar como' : 'Mudar situação'}</SectionLabel>
        <View style={styles.chips}>
          {STATUS_ORDER.filter((s) => s !== 'cancelado' && s !== a.status).map((s) => (
            <Chip key={s} label={busy === s ? '…' : STATUS_LABEL[s]} onPress={() => setStatus(s)} />
          ))}
        </View>
      </View>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Button label="Editar / remarcar" onPress={onEdit} />

      {!cancelled ? (
        cancelling ? (
          <View style={{ gap: Space.sm }}>
            <Field
              label="Motivo do cancelamento (opcional)"
              value={reason}
              onChangeText={setReason}
              placeholder="Ex.: paciente pediu para remarcar"
            />
            <Button label="Confirmar cancelamento" loading={busy === 'cancel'} onPress={cancel} />
            <Button label="Voltar" variant="secondary" onPress={() => setCancelling(false)} />
          </View>
        ) : (
          <Button label="Cancelar agendamento" variant="secondary" onPress={() => setCancelling(true)} />
        )
      ) : (
        <Muted>Agendamento cancelado. O horário está livre para outros pacientes.</Muted>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  row: { flexDirection: 'row', gap: Space.sm },
  flex: { flex: 1 },
});
