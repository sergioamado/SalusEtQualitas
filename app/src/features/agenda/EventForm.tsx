import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { Button, Chip, Field, Muted, Notice, SectionLabel, ToggleRow } from '@/components/ui';
import { Space } from '@/constants/theme';
import { addDays, brToDateKey, dateKeyToBr, isValidTime, maskDate, maskTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { fromLocal, hhmmToMinutes, minutesToHHMM, toLocal } from '@/lib/tz';

import { EVENT_LABEL, type AgendaEvent, type AgendaSetup, type EventKind } from './api';

const KINDS: EventKind[] = ['folga', 'feriado', 'reuniao', 'outro'];
const DEFAULT_TITLE: Record<EventKind, string> = { folga: 'Folga', feriado: 'Feriado', reuniao: 'Reunião', outro: 'Bloqueio' };

/** RF07: bloqueios na agenda. Sem profissional = vale para a clínica inteira. */
export function EventForm({
  clinicId,
  timeZone,
  setup,
  event,
  initial,
  onClose,
}: {
  clinicId: string;
  timeZone: string;
  setup: AgendaSetup;
  event?: AgendaEvent;
  initial?: { date: string; minutes?: number; professionalId?: string | null };
  onClose: (message?: string) => void;
}) {
  const s = event ? toLocal(event.starts_at, timeZone) : null;
  const e = event ? toLocal(event.ends_at, timeZone) : null;
  const wasAllDay = !!(s && e && s.minutes === 0 && e.minutes === 0);
  const startDate = s?.date ?? initial?.date ?? toLocal(new Date(), timeZone).date;

  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'folga');
  const [title, setTitle] = useState(event?.title ?? DEFAULT_TITLE[event?.kind ?? 'folga']);
  const [titleTouched, setTitleTouched] = useState(!!event);
  const [professionalId, setProfessionalId] = useState<string | null>(
    event ? event.professional_id : (initial?.professionalId ?? null),
  );
  const [allDay, setAllDay] = useState(event ? wasAllDay : initial?.minutes === undefined);
  const [fromDate, setFromDate] = useState(dateKeyToBr(startDate));
  const [toDate, setToDate] = useState(dateKeyToBr(e && wasAllDay ? addDays(e.date, -1) : (e?.date ?? startDate)));
  const [fromTime, setFromTime] = useState(minutesToHHMM(s && !wasAllDay ? s.minutes : (initial?.minutes ?? 12 * 60)));
  const [toTime, setToTime] = useState(minutesToHHMM(e && !wasAllDay ? e.minutes : Math.min((initial?.minutes ?? 12 * 60) + 60, 23 * 60 + 45)));
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickKind = (k: EventKind) => {
    setKind(k);
    if (!titleTouched) setTitle(DEFAULT_TITLE[k]);
    if (k === 'feriado') {
      setAllDay(true);
      setProfessionalId(null);
    }
  };

  const save = async () => {
    setError(null);
    const d1 = brToDateKey(fromDate);
    const d2 = allDay ? brToDateKey(toDate) : d1;
    if (!d1 || !d2) return setError('Data inválida. Use DD/MM/AAAA.');
    if (!title.trim()) return setError('Dê um nome ao bloqueio.');
    let startsAt: string;
    let endsAt: string;
    if (allDay) {
      if (d2 < d1) return setError('A data final precisa ser igual ou depois da inicial.');
      startsAt = fromLocal(d1, 0, timeZone);
      endsAt = fromLocal(addDays(d2, 1), 0, timeZone);
    } else {
      if (!isValidTime(fromTime) || !isValidTime(toTime)) return setError('Horário inválido. Use 08:30.');
      if (toTime <= fromTime) return setError('O fim precisa ser depois do início.');
      startsAt = fromLocal(d1, hhmmToMinutes(fromTime), timeZone);
      endsAt = fromLocal(d1, hhmmToMinutes(toTime), timeZone);
    }
    setSaving(true);
    const row = {
      clinic_id: clinicId,
      kind,
      title: title.trim(),
      professional_id: professionalId,
      starts_at: startsAt,
      ends_at: endsAt,
      notes: notes.trim() || null,
    };
    const { error: err } = event
      ? await supabase.from('schedule_events').update(row).eq('id', event.id)
      : await supabase.from('schedule_events').insert(row);
    setSaving(false);
    if (err) return setError(`Não foi possível salvar. ${err.message}`);
    onClose(event ? 'Bloqueio atualizado.' : 'Bloqueio criado. Esses horários não aparecem mais no link de agendamento.');
  };

  const remove = async () => {
    if (!event) return;
    setSaving(true);
    const { error: err } = await supabase.from('schedule_events').delete().eq('id', event.id);
    setSaving(false);
    if (err) return setError('Não foi possível excluir.');
    onClose('Bloqueio removido.');
  };

  return (
    <Sheet
      visible
      title={event ? 'Editar bloqueio' : 'Novo bloqueio'}
      onClose={() => onClose()}
      footer={
        <>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button label={event ? 'Salvar' : 'Criar bloqueio'} loading={saving} onPress={save} />
          {event ? <Button label="Excluir bloqueio" variant="secondary" disabled={saving} onPress={remove} /> : null}
        </>
      }>
      <Muted>Durante um bloqueio, ninguém consegue agendar pelo link. A recepção ainda pode encaixar, com confirmação.</Muted>

      <View style={{ gap: Space.xs }}>
        <SectionLabel>Tipo</SectionLabel>
        <View style={styles.chips}>
          {KINDS.map((k) => (
            <Chip key={k} label={EVENT_LABEL[k]} selected={kind === k} onPress={() => pickKind(k)} />
          ))}
        </View>
      </View>

      <Field
        label="Nome"
        value={title}
        onChangeText={(t) => {
          setTitle(t);
          setTitleTouched(true);
        }}
      />

      <View style={{ gap: Space.xs }}>
        <SectionLabel>Para quem</SectionLabel>
        <View style={styles.chips}>
          <Chip label="Clínica inteira" selected={professionalId === null} onPress={() => setProfessionalId(null)} />
          {setup.professionals
            .filter((p) => p.active)
            .map((p) => (
              <Chip key={p.id} label={p.name} selected={professionalId === p.id} onPress={() => setProfessionalId(p.id)} />
            ))}
        </View>
      </View>

      <ToggleRow label="Dia inteiro" value={allDay} onChange={setAllDay} />

      {allDay ? (
        <View style={styles.row}>
          <Field label="De" value={fromDate} onChangeText={(t) => setFromDate(maskDate(t))} keyboardType="number-pad" placeholder="DD/MM/AAAA" style={styles.flex} />
          <Field label="Até" value={toDate} onChangeText={(t) => setToDate(maskDate(t))} keyboardType="number-pad" placeholder="DD/MM/AAAA" style={styles.flex} />
        </View>
      ) : (
        <View style={styles.row}>
          <Field label="Dia" value={fromDate} onChangeText={(t) => setFromDate(maskDate(t))} keyboardType="number-pad" placeholder="DD/MM/AAAA" style={styles.flex2} />
          <Field label="Das" value={fromTime} onChangeText={(t) => setFromTime(maskTime(t))} keyboardType="number-pad" style={styles.flex} />
          <Field label="Até" value={toTime} onChangeText={(t) => setToTime(maskTime(t))} keyboardType="number-pad" style={styles.flex} />
        </View>
      )}

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
