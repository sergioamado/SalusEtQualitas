import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { Badge, Button, Card, Chip, Field, Loading, Muted, Notice, Screen, SectionLabel, Text, Title } from '@/components/ui';
import { Space } from '@/constants/theme';
import { useClinic } from '@/features/panel/clinic-context';
import { brToDateKey, formatDateLong, isValidTime, maskDate, maskPhone, maskTime, onlyDigits } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { hhmmToMinutes } from '@/lib/tz';

import { loadSetup, upsertContact, type AgendaSetup } from './api';
import { AppointmentForm } from './AppointmentForm';
import { PatientPicker, type PatientValue } from './PatientPicker';

type WaitStatus = 'aguardando' | 'encaixado' | 'desistiu';
type Entry = {
  id: string;
  status: WaitStatus;
  desired_date: string | null;
  desired_from: string | null;
  desired_to: string | null;
  notes: string | null;
  created_at: string;
  professional_id: string | null;
  procedure_id: string | null;
  contact: { id: string; full_name: string; phone: string | null; email: string | null } | null;
};

const TABS: { key: WaitStatus; label: string }[] = [
  { key: 'aguardando', label: 'Aguardando' },
  { key: 'encaixado', label: 'Encaixados' },
  { key: 'desistiu', label: 'Desistiram' },
];

/** RF06: pacientes que querem um horário ocupado; quando vagar, a recepção encaixa. */
export function WaitlistScreen() {
  const { clinic } = useClinic();
  const [tab, setTab] = useState<WaitStatus>('aguardando');
  const [version, setVersion] = useState(0);
  const key = `${clinic.id}|${tab}|${version}`;
  const [response, setResponse] = useState<{ key: string; items?: Entry[]; setup?: AgendaSetup; error?: string }>();
  const [adding, setAdding] = useState(false);
  const [fitting, setFitting] = useState<Entry | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase
        .from('waitlist')
        .select(
          'id,status,desired_date,desired_from,desired_to,notes,created_at,professional_id,procedure_id, contact:contacts!waitlist_contact_id_clinic_id_fkey ( id, full_name, phone, email )',
        )
        .eq('clinic_id', clinic.id)
        .eq('status', tab)
        .order('desired_date', { ascending: true, nullsFirst: false })
        .order('created_at'),
      loadSetup(clinic.id),
    ])
      .then(([w, setup]) => {
        if (!active) return;
        if (w.error) setResponse({ key, error: w.error.message });
        else setResponse({ key, items: (w.data ?? []) as unknown as Entry[], setup });
      })
      .catch((e: Error) => active && setResponse({ key, error: e.message }));
    return () => {
      active = false;
    };
  }, [clinic.id, key, tab]);

  useEffect(() => {
    const channel = supabase
      .channel(`espera-${clinic.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist', filter: `clinic_id=eq.${clinic.id}` }, () =>
        setVersion((v) => v + 1),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinic.id]);

  const current = response?.key === key ? response : undefined;
  const setup = current?.setup ?? response?.setup;
  const refresh = (text?: string) => {
    if (text) setMessage(text);
    setVersion((v) => v + 1);
  };

  const setStatus = async (entry: Entry, status: WaitStatus) => {
    await supabase.from('waitlist').update({ status }).eq('id', entry.id);
    refresh(status === 'aguardando' ? 'Voltou para a lista de espera.' : status === 'desistiu' ? 'Marcado como desistência.' : undefined);
  };

  const nameOf = (list: { id: string; name: string }[] | undefined, id: string | null) => (id ? list?.find((x) => x.id === id)?.name : null);

  return (
    <Screen wide safeTop={false}>
      <Title>Lista de espera</Title>
      <Muted>
        Anote aqui quem queria um horário que já estava ocupado. Quando alguém cancela, a agenda avisa que há gente esperando, e
        você encaixa com um toque.
      </Muted>
      {message ? <Notice tone="success">{message}</Notice> : null}
      <Button label="+ Adicionar à lista de espera" onPress={() => setAdding(true)} />

      <View style={styles.chips}>
        {TABS.map((t) => (
          <Chip key={t.key} label={t.label} selected={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </View>

      {!current ? <Loading /> : null}
      {current?.error ? <Notice tone="danger">{current.error}</Notice> : null}
      {current?.items?.length === 0 ? <Muted>Ninguém aqui.</Muted> : null}

      {current?.items?.map((e) => {
        const want = [
          nameOf(setup?.procedures, e.procedure_id),
          nameOf(setup?.professionals, e.professional_id) ? `com ${nameOf(setup?.professionals, e.professional_id)}` : null,
        ]
          .filter(Boolean)
          .join(' ');
        const when = [
          e.desired_date ? formatDateLong(e.desired_date) : 'qualquer dia',
          e.desired_from || e.desired_to
            ? `${e.desired_from ? `das ${e.desired_from.slice(0, 5)}` : ''}${e.desired_to ? ` até ${e.desired_to.slice(0, 5)}` : ''}`
            : null,
        ]
          .filter(Boolean)
          .join(', ');
        const phone = e.contact?.phone;
        return (
          <Card key={e.id} style={{ gap: Space.sm }}>
            <View style={styles.row}>
              <Text style={styles.name}>{e.contact?.full_name ?? 'Paciente'}</Text>
              {e.desired_date && e.desired_date < new Date().toISOString().slice(0, 10) && tab === 'aguardando' ? (
                <Badge label="Data passou" tone="warning" />
              ) : null}
            </View>
            <Muted>
              Quer: {want || 'qualquer serviço'} · {when}
            </Muted>
            {phone ? <Muted>{maskPhone(phone)}</Muted> : null}
            {e.notes ? <Muted>“{e.notes}”</Muted> : null}
            <View style={styles.actions}>
              {tab === 'aguardando' ? (
                <>
                  <Button label="Encaixar na agenda" onPress={() => setFitting(e)} disabled={!setup} />
                  {phone ? <Button label="WhatsApp" variant="secondary" onPress={() => Linking.openURL(`https://wa.me/55${phone}`)} /> : null}
                  <Button label="Desistiu" variant="secondary" onPress={() => setStatus(e, 'desistiu')} />
                </>
              ) : (
                <Button label="Voltar para aguardando" variant="secondary" onPress={() => setStatus(e, 'aguardando')} />
              )}
            </View>
          </Card>
        );
      })}

      {adding && setup ? (
        <WaitlistForm
          clinicId={clinic.id}
          setup={setup}
          onClose={(text) => {
            setAdding(false);
            if (text) refresh(text);
          }}
        />
      ) : null}

      {fitting && setup ? (
        <AppointmentForm
          clinicId={clinic.id}
          timeZone={clinic.timezone}
          setup={setup}
          initial={{
            contact: fitting.contact ?? undefined,
            procedureId: fitting.procedure_id,
            professionalId: fitting.professional_id,
            date: fitting.desired_date ?? undefined,
            minutes: fitting.desired_from ? hhmmToMinutes(fitting.desired_from.slice(0, 5)) : undefined,
          }}
          onClose={async (saved) => {
            const entry = fitting;
            setFitting(null);
            if (saved) {
              await supabase.from('waitlist').update({ status: 'encaixado' }).eq('id', entry.id);
              refresh('Paciente encaixado na agenda e retirado da lista de espera.');
            }
          }}
        />
      ) : null}
    </Screen>
  );
}

function WaitlistForm({ clinicId, setup, onClose }: { clinicId: string; setup: AgendaSetup; onClose: (message?: string) => void }) {
  const [patient, setPatient] = useState<PatientValue>(null);
  const [procedureId, setProcedureId] = useState<string | null>(null);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!patient) return setError('Escolha ou cadastre o paciente.');
    const dateKey = date.trim() ? brToDateKey(date) : null;
    if (date.trim() && !dateKey) return setError('Data inválida. Use DD/MM/AAAA ou deixe vazio.');
    if ((from && !isValidTime(from)) || (to && !isValidTime(to))) return setError('Horário inválido. Use 08:30 ou deixe vazio.');
    if (from && to && to <= from) return setError('O horário final precisa ser depois do inicial.');
    setSaving(true);
    try {
      const contactId =
        patient.kind === 'existing'
          ? patient.contact.id
          : await upsertContact(clinicId, {
              full_name: patient.full_name.trim(),
              phone: onlyDigits(patient.phone) || null,
              email: patient.email.trim() || null,
            });
      const { error: e } = await supabase.from('waitlist').insert({
        clinic_id: clinicId,
        contact_id: contactId,
        procedure_id: procedureId,
        professional_id: professionalId,
        desired_date: dateKey,
        desired_from: from || null,
        desired_to: to || null,
        notes: notes.trim() || null,
      });
      if (e) throw new Error(e.message);
      onClose('Adicionado à lista de espera.');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible
      title="Adicionar à lista de espera"
      onClose={() => onClose()}
      footer={
        <>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button label="Adicionar" loading={saving} onPress={save} />
        </>
      }>
      <PatientPicker clinicId={clinicId} value={patient} onChange={setPatient} />
      <View style={{ gap: Space.xs }}>
        <SectionLabel>Serviço (opcional)</SectionLabel>
        <View style={styles.chips}>
          <Chip label="Qualquer" selected={!procedureId} onPress={() => setProcedureId(null)} />
          {setup.procedures
            .filter((p) => p.active)
            .map((p) => (
              <Chip key={p.id} label={p.name} selected={procedureId === p.id} onPress={() => setProcedureId(p.id)} />
            ))}
        </View>
      </View>
      {setup.professionals.filter((p) => p.active).length > 1 ? (
        <View style={{ gap: Space.xs }}>
          <SectionLabel>Profissional (opcional)</SectionLabel>
          <View style={styles.chips}>
            <Chip label="Qualquer" selected={!professionalId} onPress={() => setProfessionalId(null)} />
            {setup.professionals
              .filter((p) => p.active)
              .map((p) => (
                <Chip key={p.id} label={p.name} selected={professionalId === p.id} onPress={() => setProfessionalId(p.id)} />
              ))}
          </View>
        </View>
      ) : null}
      <View style={styles.formRow}>
        <Field
          label="Dia desejado (opcional)"
          value={date}
          onChangeText={(t) => setDate(maskDate(t))}
          keyboardType="number-pad"
          placeholder="DD/MM/AAAA"
          style={styles.flex2}
        />
        <Field label="A partir de" value={from} onChangeText={(t) => setFrom(maskTime(t))} keyboardType="number-pad" placeholder="08:00" style={styles.flex} />
        <Field label="Até" value={to} onChangeText={(t) => setTo(maskTime(t))} keyboardType="number-pad" placeholder="12:00" style={styles.flex} />
      </View>
      <Field label="Observações (opcional)" value={notes} onChangeText={setNotes} multiline placeholder="Ex.: prefere de manhã" />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexWrap: 'wrap' },
  name: { fontSize: 17, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  formRow: { flexDirection: 'row', gap: Space.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 90 },
  flex2: { flex: 2, minWidth: 140 },
});
