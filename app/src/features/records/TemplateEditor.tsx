// ============================================================================
// EDITOR DE FICHA — a clínica monta as próprias perguntas
// ----------------------------------------------------------------------------
// Tudo é editado numa cópia local (useState) e só vai para o banco ao tocar em
// "Salvar". A aba "Pré-visualizar" usa o MESMO FormRenderer que o paciente verá.
// ============================================================================
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chip, Field, Muted, Notice, SectionLabel, Text, ToggleRow } from '@/components/ui';
import { Radius, Space, usePalette } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

import { FormRenderer } from './FormRenderer';
import {
  cleanFields,
  FIELD_TYPE_LABEL,
  newFieldId,
  templateProblem,
  type Answers,
  type FieldType,
  type FormField,
  type RecordTemplate,
  type TemplateKind,
} from './types';
import { cap, type VocabWords } from './vocab';

const ADDABLE: FieldType[] = ['text', 'textarea', 'yesno', 'choice', 'multi', 'scale', 'number', 'date', 'section'];

export type TemplateDraft = {
  id: string | null;
  kind: TemplateKind;
  name: string;
  description: string;
  fields: FormField[];
};

export function draftFrom(t: RecordTemplate): TemplateDraft {
  return { id: t.id, kind: t.kind, name: t.name, description: t.description ?? '', fields: t.fields };
}

export function TemplateEditor({
  clinicId,
  initial,
  words,
  nextOrder,
  onClose,
}: {
  clinicId: string;
  initial: TemplateDraft;
  words: VocabWords;
  nextOrder: number;
  /** Fecha o editor; com texto = salvou (mensagem de sucesso). */
  onClose: (message?: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<'editar' | 'ver'>('editar');
  const [previewAnswers, setPreviewAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Funções que alteram a lista de perguntas (sempre criando uma lista nova:
  // no React não se altera o estado "no lugar", troca-se por uma cópia).
  const update = (index: number, patch: Partial<FormField>) =>
    setDraft((d) => ({ ...d, fields: d.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) }));
  const remove = (index: number) => setDraft((d) => ({ ...d, fields: d.fields.filter((_, i) => i !== index) }));
  const move = (index: number, delta: -1 | 1) =>
    setDraft((d) => {
      const list = [...d.fields];
      const target = index + delta;
      if (target < 0 || target >= list.length) return d;
      [list[index], list[target]] = [list[target], list[index]];
      return { ...d, fields: list };
    });
  const add = (type: FieldType) =>
    setDraft((d) => ({
      ...d,
      fields: [
        ...d.fields,
        {
          id: newFieldId(d.fields.map((f) => f.id)),
          type,
          label: '',
          ...(type === 'choice' || type === 'multi' ? { options: [] } : {}),
        },
      ],
    }));

  const save = async () => {
    const problem = templateProblem(draft.name, draft.fields);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    const row = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      fields: cleanFields(draft.fields),
      updated_at: new Date().toISOString(),
    };
    const { error: dbError } = draft.id
      ? await supabase.from('record_templates').update(row).eq('id', draft.id)
      : await supabase.from('record_templates').insert({ ...row, clinic_id: clinicId, kind: draft.kind, sort_order: nextOrder });
    setSaving(false);
    if (dbError) {
      setError(
        /fields_valid/.test(dbError.message)
          ? 'Alguma pergunta está em formato inválido. Confira os textos e as opções.'
          : 'Não foi possível salvar agora. Tente novamente.',
      );
      return;
    }
    onClose(draft.id ? 'Ficha atualizada.' : 'Ficha criada.');
  };

  const kindLabel = draft.kind === 'anamnese' ? cap(words.intake) : cap(words.session);

  return (
    <View style={{ gap: Space.md }}>
      <View style={styles.headRow}>
        <Badge label={kindLabel} tone="primary" />
        <View style={styles.flex} />
        <Chip label="Editar" selected={tab === 'editar'} onPress={() => setTab('editar')} />
        <Chip label="Pré-visualizar" selected={tab === 'ver'} onPress={() => setTab('ver')} />
      </View>

      {tab === 'ver' ? (
        <Card>
          <Text style={styles.previewTitle}>{draft.name || 'Sem nome'}</Text>
          {draft.description ? <Muted>{draft.description}</Muted> : null}
          <Muted>É assim que a ficha aparece para quem preenche. Teste à vontade: nada é salvo aqui.</Muted>
          <FormRenderer
            fields={cleanFields(draft.fields).filter((f) => f.label)}
            answers={previewAnswers}
            onChange={(id, v) => setPreviewAnswers((a) => ({ ...a, [id]: v }))}
          />
        </Card>
      ) : (
        <>
          {/* O tipo só é escolhido ao criar (depois de existir, não muda). */}
          {!initial.id ? (
            <View style={{ gap: Space.xs }}>
              <SectionLabel>Tipo de ficha</SectionLabel>
              <View style={styles.wrap}>
                <Chip label={`${cap(words.intake)} (ficha inicial)`} selected={draft.kind === 'anamnese'} onPress={() => setDraft((d) => ({ ...d, kind: 'anamnese' }))} />
                <Chip label={`${cap(words.session)} (cada atendimento)`} selected={draft.kind === 'evolucao'} onPress={() => setDraft((d) => ({ ...d, kind: 'evolucao' }))} />
              </View>
            </View>
          ) : null}
          <Field label="Nome da ficha" value={draft.name} maxLength={80} onChangeText={(name) => setDraft((d) => ({ ...d, name }))} />
          <Field
            label="Descrição (opcional)"
            value={draft.description}
            maxLength={500}
            multiline
            onChangeText={(description) => setDraft((d) => ({ ...d, description }))}
          />
          {initial.id ? (
            <Muted>As mudanças valem para as próximas fichas. As já preenchidas continuam exatamente como foram respondidas.</Muted>
          ) : null}

          <SectionLabel>Perguntas ({draft.fields.filter((f) => f.type !== 'section').length})</SectionLabel>
          {draft.fields.length === 0 ? <Muted>Nenhuma pergunta ainda. Use os botões abaixo para adicionar.</Muted> : null}
          {draft.fields.map((f, index) => (
            <FieldEditor
              key={f.id}
              field={f}
              index={index}
              total={draft.fields.length}
              onChange={(patch) => update(index, patch)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => remove(index)}
            />
          ))}

          <Card style={{ gap: Space.sm }}>
            <Text style={styles.addTitle}>Adicionar</Text>
            <View style={styles.wrap}>
              {ADDABLE.map((t) => (
                <Chip key={t} label={`+ ${FIELD_TYPE_LABEL[t]}`} onPress={() => add(t)} />
              ))}
            </View>
          </Card>
        </>
      )}

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={draft.id ? 'Salvar alterações' : 'Criar ficha'} loading={saving} onPress={save} />
      <Button label="Cancelar" variant="secondary" onPress={() => onClose()} />
    </View>
  );
}

/** Cartão de uma pergunta dentro do editor. */
function FieldEditor({
  field: f,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  field: FormField;
  index: number;
  total: number;
  onChange: (patch: Partial<FormField>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const c = usePalette();
  const isSection = f.type === 'section';
  const hasOptions = f.type === 'choice' || f.type === 'multi';
  return (
    <Card style={[{ gap: Space.sm }, isSection && { backgroundColor: c.surfaceMuted }]}>
      <View style={styles.headRow}>
        <Text style={[styles.number, { color: c.textMuted }]}>{index + 1}</Text>
        <Badge label={FIELD_TYPE_LABEL[f.type]} />
        <View style={styles.flex} />
        <SmallButton label="↑" accessibilityLabel="Subir" disabled={index === 0} onPress={() => onMove(-1)} />
        <SmallButton label="↓" accessibilityLabel="Descer" disabled={index === total - 1} onPress={() => onMove(1)} />
        <SmallButton label="✕" accessibilityLabel="Remover pergunta" onPress={onRemove} />
      </View>
      <Field
        label={isSection ? 'Título da seção' : 'Pergunta'}
        value={f.label}
        maxLength={200}
        onChangeText={(label) => onChange({ label })}
      />
      {hasOptions ? (
        <Field
          label="Opções (uma por linha)"
          value={(f.options ?? []).join('\n')}
          multiline
          onChangeText={(t) => onChange({ options: t.split('\n').slice(0, 30) })}
        />
      ) : null}
      <Field label="Texto de ajuda (opcional)" value={f.help ?? ''} maxLength={200} onChangeText={(help) => onChange({ help })} />
      {!isSection ? (
        <ToggleRow label="Obrigatória" value={!!f.required} onChange={(required) => onChange({ required })} />
      ) : null}
    </Card>
  );
}

function SmallButton({
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={[styles.small, { borderColor: c.border, opacity: disabled ? 0.35 : 1 }]}>
      <Text style={{ color: c.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  number: { fontSize: 15, fontWeight: '700', minWidth: 20 },
  previewTitle: { fontSize: 20, fontWeight: '700' },
  addTitle: { fontSize: 15, fontWeight: '600' },
  small: { width: 36, height: 36, borderRadius: Radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
