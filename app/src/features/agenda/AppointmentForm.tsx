import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { Button, Chip, Field, Muted, Notice, SectionLabel } from '@/components/ui';
import { Space } from '@/constants/theme';
import { brToDateKey, dateKeyToBr, formatDuration, isValidTime, maskCep, maskDate, maskTime, onlyDigits } from '@/lib/format';
import { fromLocal, hhmmToMinutes, minutesToHHMM, toLocal } from '@/lib/tz';
import { lookupCep } from '@/lib/viacep';

import {
  CHANNEL_LABEL,
  saveAppointment,
  SaveError,
  STATUS_LABEL,
  type AgendaAppointment,
  type AgendaSetup,
  type Channel,
  type ContactHit,
  type Modality,
  type Status,
} from './api';
import { PatientPicker, type PatientValue } from './PatientPicker';

export type FormInitial = {
  appointment?: AgendaAppointment;
  date?: string;
  minutes?: number;
  professionalId?: string | null;
  procedureId?: string | null;
  contact?: ContactHit;
};

const CHANNELS: Channel[] = ['interno', 'telefone', 'whatsapp', 'instagram', 'outro'];
const NEW_STATUSES: Status[] = ['agendado', 'confirmado', 'reservado'];

/** Agendar pela recepção (RF02) ou editar/remarcar um agendamento. */
export function AppointmentForm({
  clinicId,
  timeZone,
  setup,
  initial,
  onClose,
}: {
  clinicId: string;
  timeZone: string;
  setup: AgendaSetup;
  initial: FormInitial;
  onClose: (saved?: { id: string; message: string }) => void;
}) {
  const a = initial.appointment;
  const startLocal = a ? toLocal(a.starts_at, timeZone) : null;
  const activeProcedures = setup.procedures.filter((p) => p.active || p.id === a?.procedure_id);

  const [patient, setPatient] = useState<PatientValue>(
    a?.contact
      ? { kind: 'existing', contact: { id: a.contact.id, full_name: a.contact.full_name, phone: a.contact.phone, email: a.contact.email } }
      : initial.contact
        ? { kind: 'existing', contact: initial.contact }
        : null,
  );
  const [procedureId, setProcedureId] = useState<string | null>(
    a?.procedure_id ?? initial.procedureId ?? (activeProcedures.length === 1 ? activeProcedures[0].id : null),
  );
  const procedure = setup.procedures.find((p) => p.id === procedureId) ?? null;

  const doers = (procId: string | null) => {
    const ids = procId ? (setup.profsByProcedure[procId] ?? []) : [];
    const list = setup.professionals.filter((p) => p.active && (ids.length === 0 || ids.includes(p.id)));
    return list.length ? list : setup.professionals.filter((p) => p.active);
  };
  const activePros = setup.professionals.filter((p) => p.active);
  const [professionalId, setProfessionalId] = useState<string | null>(
    a?.professional_id ?? initial.professionalId ?? (activePros.length === 1 ? activePros[0].id : null),
  );
  const professional = setup.professionals.find((p) => p.id === professionalId) ?? null;

  const [modality, setModality] = useState<Modality>(
    a?.modality ?? (procedure && !procedure.allows_clinic && procedure.allows_home_care ? 'residencial' : 'clinica'),
  );
  const [date, setDate] = useState(dateKeyToBr(startLocal?.date ?? initial.date ?? toLocal(new Date(), timeZone).date));
  const [time, setTime] = useState(
    minutesToHHMM(startLocal?.minutes ?? (Number.isFinite(initial.minutes) ? initial.minutes! : 9 * 60)),
  );
  const initialDuration = a
    ? Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000)
    : (procedure?.duration_min ?? 60);
  const [duration, setDuration] = useState(String(initialDuration));
  const [durationTouched, setDurationTouched] = useState(!!a);
  const [status, setStatus] = useState<Status>(a?.status ?? 'agendado');
  const [channel, setChannel] = useState<Channel>(a?.channel === 'portal' ? 'portal' : (a?.channel ?? 'interno'));
  const [price, setPrice] = useState(a?.price != null ? String(a.price).replace('.', ',') : procedure?.price != null ? String(procedure.price).replace('.', ',') : '');
  const [priceTouched, setPriceTouched] = useState(!!a);
  const [insurance, setInsurance] = useState(a?.insurance ?? '');
  const [notes, setNotes] = useState(a?.notes ?? '');
  const [address, setAddress] = useState({
    cep: a?.address_cep ? maskCep(a.address_cep) : '',
    street: a?.address_street ?? '',
    number: a?.address_number ?? '',
    complement: a?.address_complement ?? '',
    district: a?.address_district ?? '',
    city: a?.address_city ?? '',
    state: a?.address_state ?? '',
  });
  const [cepLoading, setCepLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soft, setSoft] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const pickProcedure = (id: string) => {
    setProcedureId(id);
    const p = setup.procedures.find((x) => x.id === id);
    if (!p) return;
    if (!durationTouched) setDuration(String(p.duration_min));
    if (!priceTouched) setPrice(p.price != null ? String(p.price).replace('.', ',') : '');
    if (modality === 'clinica' && !p.allows_clinic && p.allows_home_care) setModality('residencial');
    if (modality === 'residencial' && !p.allows_home_care) setModality('clinica');
    const can = doers(id);
    if (professionalId && !can.some((x) => x.id === professionalId)) setProfessionalId(can.length === 1 ? can[0].id : null);
    else if (!professionalId && can.length === 1) setProfessionalId(can[0].id);
    setSoft(null);
  };

  const searchCep = async (cep: string) => {
    if (onlyDigits(cep).length !== 8) return;
    setCepLoading(true);
    const r = await lookupCep(cep);
    setCepLoading(false);
    if (r.ok) setAddress((s) => ({ ...s, ...r.address }));
  };

  const dateKey = brToDateKey(date);
  const durationNum = Number(duration);
  const priceNum = price.trim() ? Number(price.replace(/\./g, '').replace(',', '.')) : null;
  const errors = {
    patient:
      !patient
        ? 'Escolha ou cadastre o paciente.'
        : patient.kind === 'new' && patient.full_name.trim().length < 2
          ? 'Informe o nome do paciente.'
          : null,
    procedure: !procedureId ? 'Escolha o serviço.' : null,
    professional: !professionalId ? 'Escolha o profissional.' : null,
    date: !dateKey ? 'Data inválida. Use DD/MM/AAAA.' : null,
    time: !isValidTime(time) ? 'Horário inválido. Use 08:30.' : null,
    duration: !Number.isInteger(durationNum) || durationNum < 5 || durationNum > 720 ? 'Entre 5 e 720 minutos.' : null,
    price: priceNum != null && (!Number.isFinite(priceNum) || priceNum < 0) ? 'Valor inválido.' : null,
  };
  const valid = !Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  const save = async (force = false) => {
    setTouched(true);
    setError(null);
    if (!valid || !dateKey || !patient || !procedureId || !professionalId) return;
    setSaving(true);
    try {
      const result = await saveAppointment({
        id: a?.id,
        clinic_id: clinicId,
        ...(patient.kind === 'existing'
          ? { contact_id: patient.contact.id }
          : {
              contact: {
                full_name: patient.full_name.trim(),
                phone: onlyDigits(patient.phone) || null,
                email: patient.email.trim() || null,
              },
            }),
        procedure_id: procedureId,
        professional_id: professionalId,
        modality,
        starts_at: fromLocal(dateKey, hhmmToMinutes(time), timeZone),
        duration_min: durationNum,
        status,
        channel,
        price: priceNum,
        insurance: insurance.trim() || null,
        notes: notes.trim() || null,
        ...(modality === 'residencial' ? { address: { ...address, cep: onlyDigits(address.cep) } } : {}),
        force,
      });
      onClose({ id: result.id, message: a ? 'Agendamento atualizado.' : 'Agendamento criado.' });
    } catch (e) {
      if (e instanceof SaveError && e.soft) setSoft(e.message);
      else setError((e as Error).message);
      setSaving(false);
    }
  };

  const pros = doers(procedureId);
  const allowsClinic = procedure?.allows_clinic ?? true;
  const allowsHome = (procedure?.allows_home_care ?? false) && (professional?.home_care_enabled ?? true);

  return (
    <Sheet
      visible
      title={a ? 'Editar agendamento' : 'Novo agendamento'}
      onClose={() => onClose()}
      footer={
        <>
          {soft ? (
            <View style={{ gap: Space.sm }}>
              <Notice tone="warning">{soft} Deseja encaixar mesmo assim?</Notice>
              <Button label="Encaixar mesmo assim" loading={saving} onPress={() => save(true)} />
              <Button label="Escolher outro horário" variant="secondary" onPress={() => setSoft(null)} />
            </View>
          ) : (
            <>
              {error ? <Notice tone="danger">{error}</Notice> : null}
              {touched && !valid ? <Notice tone="danger">Confira os campos destacados.</Notice> : null}
              <Button label={a ? 'Salvar alterações' : 'Agendar'} loading={saving} onPress={() => save(false)} />
            </>
          )}
        </>
      }>
      <PatientPicker clinicId={clinicId} value={patient} onChange={setPatient} error={show('patient')} />

      <View style={{ gap: Space.xs }}>
        <SectionLabel>Serviço</SectionLabel>
        {activeProcedures.length === 0 ? <Muted>Nenhum serviço cadastrado. Cadastre na aba Serviços.</Muted> : null}
        <View style={styles.chips}>
          {activeProcedures.map((p) => (
            <Chip key={p.id} label={`${p.name} · ${formatDuration(p.duration_min)}`} selected={procedureId === p.id} onPress={() => pickProcedure(p.id)} />
          ))}
        </View>
        {show('procedure') ? <Notice tone="danger">{errors.procedure}</Notice> : null}
      </View>

      <View style={{ gap: Space.xs }}>
        <SectionLabel>Profissional</SectionLabel>
        <View style={styles.chips}>
          {pros.map((p) => (
            <Chip
              key={p.id}
              label={p.name}
              selected={professionalId === p.id}
              onPress={() => {
                setProfessionalId(p.id);
                if (modality === 'residencial' && !p.home_care_enabled) setModality('clinica');
                setSoft(null);
              }}
            />
          ))}
        </View>
        {show('professional') ? <Notice tone="danger">{errors.professional}</Notice> : null}
      </View>

      {allowsHome ? (
        <View style={{ gap: Space.xs }}>
          <SectionLabel>Local</SectionLabel>
          <View style={styles.chips}>
            {allowsClinic ? <Chip label="Na clínica" selected={modality === 'clinica'} onPress={() => setModality('clinica')} /> : null}
            <Chip label="Residencial 🏠" selected={modality === 'residencial'} onPress={() => setModality('residencial')} />
          </View>
        </View>
      ) : null}

      {modality === 'residencial' ? (
        <View style={{ gap: Space.sm }}>
          <Field
            label="CEP"
            value={address.cep}
            onChangeText={(t) => {
              const cep = maskCep(t);
              setAddress((s) => ({ ...s, cep }));
              void searchCep(cep);
            }}
            keyboardType="number-pad"
            hint={cepLoading ? 'Buscando endereço…' : 'Preenche rua, bairro e cidade automaticamente.'}
          />
          <Field label="Rua" value={address.street} onChangeText={(street) => setAddress((s) => ({ ...s, street }))} />
          <View style={styles.row}>
            <Field label="Número" value={address.number} onChangeText={(number) => setAddress((s) => ({ ...s, number }))} style={styles.flex} />
            <Field label="Complemento" value={address.complement} onChangeText={(complement) => setAddress((s) => ({ ...s, complement }))} style={styles.flex2} />
          </View>
          <Field label="Bairro" value={address.district} onChangeText={(district) => setAddress((s) => ({ ...s, district }))} />
          <View style={styles.row}>
            <Field label="Cidade" value={address.city} onChangeText={(city) => setAddress((s) => ({ ...s, city }))} style={styles.flex2} />
            <Field
              label="UF"
              value={address.state}
              onChangeText={(t) => setAddress((s) => ({ ...s, state: t.toUpperCase().slice(0, 2) }))}
              autoCapitalize="characters"
              style={styles.flex}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.row}>
        <Field
          label="Data"
          value={date}
          onChangeText={(t) => {
            setDate(maskDate(t));
            setSoft(null);
          }}
          keyboardType="number-pad"
          placeholder="DD/MM/AAAA"
          error={show('date')}
          style={styles.flex2}
        />
        <Field
          label="Horário"
          value={time}
          onChangeText={(t) => {
            setTime(maskTime(t));
            setSoft(null);
          }}
          keyboardType="number-pad"
          placeholder="08:30"
          error={show('time')}
          style={styles.flex}
        />
        <Field
          label="Duração (min)"
          value={duration}
          onChangeText={(t) => {
            setDuration(t.replace(/\D/g, ''));
            setDurationTouched(true);
            setSoft(null);
          }}
          keyboardType="number-pad"
          error={show('duration')}
          style={styles.flex}
        />
      </View>

      <View style={{ gap: Space.xs }}>
        <SectionLabel>Situação</SectionLabel>
        <View style={styles.chips}>
          {(a ? (Object.keys(STATUS_LABEL) as Status[]).filter((s) => s !== 'cancelado') : NEW_STATUSES).map((s) => (
            <Chip key={s} label={STATUS_LABEL[s]} selected={status === s} onPress={() => setStatus(s)} />
          ))}
        </View>
      </View>

      <View style={{ gap: Space.xs }}>
        <SectionLabel>Como o paciente marcou</SectionLabel>
        <View style={styles.chips}>
          {(channel === 'portal' ? (['portal', ...CHANNELS] as Channel[]) : CHANNELS).map((ch) => (
            <Chip key={ch} label={CHANNEL_LABEL[ch]} selected={channel === ch} onPress={() => setChannel(ch)} />
          ))}
        </View>
      </View>

      <View style={styles.row}>
        <Field
          label="Valor (opcional)"
          value={price}
          onChangeText={(t) => {
            setPrice(t.replace(/[^\d,.]/g, ''));
            setPriceTouched(true);
          }}
          keyboardType="decimal-pad"
          placeholder="150,00"
          error={show('price')}
          style={styles.flex}
        />
        <Field label="Convênio (opcional)" value={insurance} onChangeText={setInsurance} placeholder="Particular" style={styles.flex} />
      </View>
      <Field label="Observações (opcional)" value={notes} onChangeText={setNotes} multiline />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  row: { flexDirection: 'row', gap: Space.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 90 },
  flex2: { flex: 2, minWidth: 140 },
});
