// ============================================================================
// DESENHA UMA FICHA a partir da lista de perguntas (FormField[])
// ----------------------------------------------------------------------------
// Este é o coração do "formulário genérico": não existe uma tela de anamnese de
// fisioterapia e outra de salão — existe UM componente que lê as perguntas e
// escolhe o controle certo para cada tipo (texto, sim/não, escala…).
// Usado na pré-visualização do editor, no prontuário e no link do paciente.
// ============================================================================
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Checkbox, Chip, Field, Muted, Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { brToDateKey, dateKeyToBr, maskDate } from '@/lib/format';

import type { AnswerValue, Answers, FormField } from './types';

type Props = {
  fields: FormField[];
  answers: Answers;
  onChange: (id: string, value: AnswerValue) => void;
  /** Ids das perguntas obrigatórias que ficaram sem resposta (destacadas em vermelho). */
  missing?: string[];
};

export function FormRenderer({ fields, answers, onChange, missing = [] }: Props) {
  return (
    <View style={{ gap: Space.lg }}>
      {fields.map((f) => (
        <FieldControl key={f.id} field={f} value={answers[f.id] ?? null} onChange={(v) => onChange(f.id, v)} missing={missing.includes(f.id)} />
      ))}
    </View>
  );
}

function FieldControl({
  field: f,
  value,
  onChange,
  missing,
}: {
  field: FormField;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
  missing: boolean;
}) {
  const c = usePalette();
  const label = f.required ? `${f.label} *` : f.label;
  const error = missing ? 'Responda esta pergunta.' : null;

  // Cada tipo de pergunta vira um controle diferente.
  switch (f.type) {
    case 'section':
      return (
        <View style={[styles.section, { borderBottomColor: c.border }]}>
          <Text style={[styles.sectionText, { color: c.text }]}>{f.label}</Text>
          {f.help ? <Muted>{f.help}</Muted> : null}
        </View>
      );

    case 'text':
    case 'textarea':
      return (
        <Field
          label={label}
          hint={f.help}
          error={error}
          value={typeof value === 'string' ? value : ''}
          onChangeText={(t) => onChange(t)}
          multiline={f.type === 'textarea'}
          maxLength={f.type === 'textarea' ? 5000 : 500}
        />
      );

    case 'number':
      return <NumberControl label={label} hint={f.help} error={error} value={typeof value === 'number' ? value : null} onChange={onChange} />;

    case 'date':
      return <DateControl label={label} hint={f.help} error={error} value={typeof value === 'string' ? value : null} onChange={onChange} />;

    case 'yesno':
      return (
        <Question label={label} help={f.help} error={error}>
          <View style={styles.row} accessibilityRole="radiogroup">
            {/* Tocar de novo na opção marcada desmarca (volta a "sem resposta"). */}
            <Chip label="Sim" selected={value === true} onPress={() => onChange(value === true ? null : true)} />
            <Chip label="Não" selected={value === false} onPress={() => onChange(value === false ? null : false)} />
          </View>
        </Question>
      );

    case 'choice':
      return (
        <Question label={label} help={f.help} error={error}>
          <View style={styles.wrap} accessibilityRole="radiogroup">
            {(f.options ?? []).map((o) => (
              <Chip key={o} label={o} selected={value === o} onPress={() => onChange(value === o ? null : o)} />
            ))}
          </View>
        </Question>
      );

    case 'multi': {
      const list = Array.isArray(value) ? value : [];
      return (
        <Question label={label} help={f.help} error={error}>
          <View style={{ gap: 2 }}>
            {(f.options ?? []).map((o) => (
              <Checkbox
                key={o}
                checked={list.includes(o)}
                onChange={(on) => onChange(on ? [...list, o] : list.filter((x) => x !== o))}>
                {o}
              </Checkbox>
            ))}
          </View>
        </Question>
      );
    }

    case 'scale':
      return (
        <Question label={label} help={f.help ?? '0 = nada, 10 = máximo'} error={error}>
          <View style={styles.wrap} accessibilityRole="radiogroup">
            {Array.from({ length: 11 }, (_, n) => (
              <View key={n} style={styles.scaleItem}>
                <Chip label={String(n)} selected={value === n} onPress={() => onChange(value === n ? null : n)} />
              </View>
            ))}
          </View>
        </Question>
      );
  }
}

/** Pergunta com título, ajuda e erro (para controles que não são caixas de texto). */
function Question({ label, help, error, children }: { label: string; help?: string | null; error: string | null; children: React.ReactNode }) {
  const c = usePalette();
  return (
    <View style={{ gap: Space.xs }} accessibilityLabel={label}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      {help ? <Text style={[styles.hint, { color: c.textMuted }]}>{help}</Text> : null}
      {children}
      {error ? <Text style={[styles.hint, { color: c.danger }]}>{error}</Text> : null}
    </View>
  );
}

// Número: guardamos o texto digitado enquanto a pessoa escreve ("1," ainda não é
// número) e só repassamos o valor numérico válido.
function NumberControl({
  label,
  hint,
  error,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  error: string | null;
  value: number | null;
  onChange: (v: AnswerValue) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value).replace('.', ','));
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      value={text}
      keyboardType="decimal-pad"
      onChangeText={(t) => {
        const clean = t.replace(/[^\d,.-]/g, '').slice(0, 12);
        setText(clean);
        const n = Number(clean.replace(',', '.'));
        onChange(clean === '' || Number.isNaN(n) ? null : n);
      }}
    />
  );
}

// Data: a pessoa digita DD/MM/AAAA; guardamos AAAA-MM-DD (formato do banco).
function DateControl({
  label,
  hint,
  error,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  error: string | null;
  value: string | null;
  onChange: (v: AnswerValue) => void;
}) {
  const [text, setText] = useState(value ? dateKeyToBr(value) : '');
  const invalid = text.length === 10 && !brToDateKey(text);
  return (
    <Field
      label={label}
      hint={hint ?? 'DD/MM/AAAA'}
      error={error ?? (invalid ? 'Data inválida.' : null)}
      value={text}
      keyboardType="number-pad"
      placeholder="DD/MM/AAAA"
      onChangeText={(t) => {
        const masked = maskDate(t);
        setText(masked);
        onChange(masked.length === 10 ? brToDateKey(masked) : null);
      }}
    />
  );
}

const styles = StyleSheet.create({
  section: { paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth, marginTop: Space.sm, gap: 2 },
  sectionText: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 13 },
  row: { flexDirection: 'row', gap: Space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  scaleItem: { minWidth: 48 },
});
