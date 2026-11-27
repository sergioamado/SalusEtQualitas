// ============================================================================
// PREENCHER UM REGISTRO (anamnese ou evolução)
// ----------------------------------------------------------------------------
// Dois botões, dois destinos:
//   - "Salvar rascunho": guarda e permite continuar depois (só o autor e o dono veem);
//   - "Assinar e finalizar": confere as obrigatórias e TRAVA o registro para sempre.
// A assinatura pede confirmação, porque não tem volta (só adendo).
// ============================================================================
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chip, Field, Muted, Notice, SectionLabel } from '@/components/ui';
import { Space } from '@/constants/theme';
import { formatDateTimeLong } from '@/lib/format';

import { RecordError, saveEntry, type PatientAppointment } from './api';
import { FormRenderer } from './FormRenderer';
import { missingRequired, type Answers, type FormField, type TemplateKind } from './types';
import { cap, type VocabWords } from './vocab';

export type EditorState = {
  id: string | null;
  kind: TemplateKind;
  templateId: string | null;
  title: string;
  fields: FormField[];
  answers: Answers;
  notes: string;
  appointmentId: string | null;
};

export function EntryEditor({
  state,
  contactId,
  appointments,
  timeZone,
  words,
  onClose,
}: {
  state: EditorState;
  contactId: string;
  appointments: PatientAppointment[];
  timeZone: string;
  words: VocabWords;
  onClose: (message?: string) => void;
}) {
  const [title, setTitle] = useState(state.title);
  const [answers, setAnswers] = useState<Answers>(state.answers);
  const [notes, setNotes] = useState(state.notes);
  const [appointmentId, setAppointmentId] = useState(state.appointmentId);
  const [missing, setMissing] = useState<string[]>([]);
  const [confirmSign, setConfirmSign] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'sign' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Atendimentos que dá para vincular: os não cancelados, mais recentes primeiro.
  const options = appointments.filter((a) => a.status !== 'cancelado').slice(0, 8);
  const freeText = state.fields.length === 0;

  const save = async (sign: boolean) => {
    if (sign) {
      const miss = missingRequired(state.fields, answers);
      if (freeText && notes.trim().length < 2) {
        setError('Escreva as anotações antes de assinar.');
        return;
      }
      if (miss.length) {
        setMissing(miss);
        setConfirmSign(false);
        setError(`Faltam ${miss.length} pergunta(s) obrigatória(s), marcadas em vermelho.`);
        return;
      }
    }
    setError(null);
    setBusy(sign ? 'sign' : 'draft');
    try {
      await saveEntry({
        id: state.id,
        contactId,
        kind: state.kind,
        templateId: state.templateId,
        title,
        answers,
        notes,
        appointmentId,
        sign,
      });
      onClose(sign ? 'Registro assinado e guardado.' : 'Rascunho salvo. Você pode continuar depois.');
    } catch (e) {
      const err = e as RecordError;
      if (err.fieldId) setMissing([err.fieldId]);
      setError(err.message);
      setBusy(null);
      setConfirmSign(false);
    }
  };

  return (
    <View style={{ gap: Space.md }}>
      <View style={styles.row}>
        <Badge label={state.kind === 'anamnese' ? cap(words.intake) : cap(words.session)} tone="primary" />
        {state.id ? <Badge label="Rascunho" tone="warning" /> : <Badge label="Novo" />}
      </View>
      <Field label="Título" value={title} onChangeText={setTitle} maxLength={120} />

      {options.length ? (
        <View style={{ gap: Space.xs }}>
          <SectionLabel>Atendimento</SectionLabel>
          <View style={styles.row}>
            <Chip label="Nenhum" selected={!appointmentId} onPress={() => setAppointmentId(null)} />
            {options.map((a) => (
              <Chip
                key={a.id}
                label={`${a.procedure_name} · ${formatDateTimeLong(a.starts_at, timeZone)}`}
                selected={appointmentId === a.id}
                onPress={() => setAppointmentId(a.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {state.fields.length ? (
        <Card>
          <FormRenderer
            fields={state.fields}
            answers={answers}
            missing={missing}
            onChange={(id, v) => {
              setAnswers((a) => ({ ...a, [id]: v }));
              if (missing.includes(id)) setMissing((m) => m.filter((x) => x !== id));
            }}
          />
        </Card>
      ) : null}

      <Field
        label={freeText ? 'Anotações *' : 'Anotações livres (opcional)'}
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={10000}
        placeholder={`O que foi feito, como o(a) ${words.person} respondeu, próximos passos…`}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {confirmSign ? (
        <Card style={{ gap: Space.sm }}>
          <Notice tone="warning">
            Depois de assinado, este registro não pode mais ser alterado nem excluído — só complementado com adendos. Ele
            fica com o seu nome, a data e a hora.
          </Notice>
          <Button label="Confirmar assinatura" loading={busy === 'sign'} onPress={() => save(true)} />
          <Button label="Voltar" variant="secondary" onPress={() => setConfirmSign(false)} />
        </Card>
      ) : (
        <>
          <Button label="Assinar e finalizar" disabled={!!busy} onPress={() => setConfirmSign(true)} />
          <Button label="Salvar rascunho" variant="secondary" loading={busy === 'draft'} disabled={!!busy} onPress={() => save(false)} />
          <Button label="Cancelar" variant="secondary" disabled={!!busy} onPress={() => onClose()} />
          <Muted style={{ fontSize: 13 }}>Ao cancelar, o que não foi salvo se perde.</Muted>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.sm },
});
