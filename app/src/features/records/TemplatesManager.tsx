// ============================================================================
// MODELOS DE FICHA — lista, modelos prontos e vocabulário da clínica
// ----------------------------------------------------------------------------
// Tela do gerente da clínica (aba "Modelos de ficha" do painel).
// Usa o mesmo padrão das outras telas de cadastro: carrega a lista, mostra,
// e abre o editor no lugar da lista quando a pessoa toca em criar/editar.
// ============================================================================
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Loading, Muted, Notice, OptionCard, SectionLabel, Text } from '@/components/ui';
import { Space } from '@/constants/theme';
import { useClinic } from '@/features/panel/clinic-context';
import { supabase } from '@/lib/supabase';

import { PRESETS, type PresetArea } from './presets';
import { draftFrom, TemplateEditor, type TemplateDraft } from './TemplateEditor';
import type { RecordTemplate, TemplateKind } from './types';
import { cap, vocab, VOCAB_LABEL, type Vocabulary } from './vocab';

type Message = { tone: 'success' | 'danger'; text: string };

export function TemplatesManager() {
  const { clinic, reload } = useClinic();
  const words = vocab(clinic.record_vocabulary);
  const [version, setVersion] = useState(0);
  const key = `${clinic.id}|${version}`;
  const [response, setResponse] = useState<{ key: string; list?: RecordTemplate[]; error?: string }>();
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from('record_templates')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('kind')
      .order('sort_order')
      .order('name')
      .then(({ data, error }) => {
        if (!active) return;
        setResponse(error ? { key, error: error.message } : { key, list: (data ?? []) as RecordTemplate[] });
      });
    return () => {
      active = false;
    };
  }, [clinic.id, key]);

  const current = response?.key === key ? response : response?.list ? response : undefined;
  const refresh = () => setVersion((v) => v + 1);

  if (!current) return <Loading label="Carregando fichas…" />;
  if (current.error || !current.list) return <Notice tone="danger">{current.error ?? 'Erro ao carregar.'}</Notice>;
  const list = current.list;
  const nextOrder = list.length ? Math.max(...list.map((t) => t.sort_order)) + 1 : 0;

  if (editing) {
    return (
      <TemplateEditor
        clinicId={clinic.id}
        initial={editing}
        words={words}
        nextOrder={nextOrder}
        onClose={(text) => {
          setEditing(null);
          if (text) setMessage({ tone: 'success', text });
          refresh();
        }}
      />
    );
  }

  // ---- ações ----
  const run = async (work: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true);
    setMessage(null);
    const { error } = await work();
    setBusy(false);
    setMessage(error ? { tone: 'danger', text: 'Não foi possível concluir. Tente novamente.' } : { tone: 'success', text: ok });
    refresh();
  };

  const setVocabulary = async (v: Vocabulary) => {
    if (v === clinic.record_vocabulary) return;
    await run(() => supabase.from('clinics').update({ record_vocabulary: v }).eq('id', clinic.id), 'Vocabulário atualizado.');
    reload();
  };

  const applyPreset = (area: PresetArea) =>
    run(
      () =>
        supabase.from('record_templates').insert(
          area.templates.map((t, i) => ({
            clinic_id: clinic.id,
            kind: t.kind,
            name: t.name,
            description: t.description,
            fields: t.fields,
            sort_order: nextOrder + i,
          })),
        ),
      `Modelos de ${area.label} adicionados. Agora é só ajustar as perguntas, se quiser.`,
    );

  const duplicate = (t: RecordTemplate) =>
    run(
      () =>
        supabase.from('record_templates').insert({
          clinic_id: clinic.id,
          kind: t.kind,
          name: `${t.name} (cópia)`.slice(0, 80),
          description: t.description,
          fields: t.fields,
          sort_order: nextOrder,
        }),
      'Cópia criada.',
    );

  const toggleActive = (t: RecordTemplate) =>
    run(
      () => supabase.from('record_templates').update({ active: !t.active }).eq('id', t.id),
      t.active ? 'Ficha desativada: não aparece mais para preencher.' : 'Ficha ativada.',
    );

  const remove = (t: RecordTemplate) => {
    setConfirmDelete(null);
    return run(() => supabase.from('record_templates').delete().eq('id', t.id), 'Ficha excluída. As já preenchidas continuam guardadas.');
  };

  const newDraft = (kind: TemplateKind): TemplateDraft => ({ id: null, kind, name: '', description: '', fields: [] });

  const sections: { kind: TemplateKind; title: string; hint: string }[] = [
    {
      kind: 'anamnese',
      title: `${cap(words.intake)} (ficha inicial)`,
      hint: `Preenchida uma vez, no começo — pela equipe ou pelo próprio ${words.person}, por link.`,
    },
    {
      kind: 'evolucao',
      title: `${cap(words.session)} (cada atendimento)`,
      hint: `Preenchida pelo profissional a cada atendimento. Vai para o ${words.record}.`,
    },
  ];

  return (
    <View style={{ gap: Space.md }}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {/* Vocabulário */}
      <Card>
        <Text style={styles.cardTitle}>Como sua clínica chama as coisas?</Text>
        <Muted>Muda só os textos das telas. Pode trocar quando quiser.</Muted>
        {(['saude', 'beleza'] as const).map((v) => (
          <OptionCard key={v} title={VOCAB_LABEL[v]} selected={clinic.record_vocabulary === v} disabled={busy} onPress={() => setVocabulary(v)} />
        ))}
      </Card>

      {/* Modelos prontos */}
      <Card>
        <Text style={styles.cardTitle}>Modelos prontos</Text>
        <Muted>
          Comece por um modelo da sua área: ele cria uma {words.intake} e um(a) {words.session} já com as perguntas mais comuns.
          Depois você ajusta do seu jeito.
        </Muted>
        {PRESETS.map((area) => (
          <OptionCard
            key={area.key}
            title={area.label}
            subtitle={area.templates.map((t) => t.name).join(' + ')}
            aside="Usar"
            disabled={busy}
            onPress={() => applyPreset(area)}
          />
        ))}
      </Card>

      {sections.map((s) => {
        const items = list.filter((t) => t.kind === s.kind);
        return (
          <View key={s.kind} style={{ gap: Space.sm }}>
            <SectionLabel>{s.title}</SectionLabel>
            <Muted>{s.hint}</Muted>
            {items.length === 0 ? <Muted>Nenhuma ficha deste tipo ainda.</Muted> : null}
            {items.map((t) => {
              const count = t.fields.filter((f) => f.type !== 'section').length;
              return (
                <Card key={t.id} style={{ gap: Space.sm }}>
                  <View style={styles.row}>
                    <View style={styles.flex}>
                      <Text style={styles.name}>{t.name}</Text>
                      <Muted>
                        {count} pergunta(s){t.description ? ` · ${t.description}` : ''}
                      </Muted>
                    </View>
                    {t.active ? <Badge label="Ativa" tone="success" /> : <Badge label="Desativada" />}
                  </View>
                  <View style={styles.actions}>
                    <View style={styles.action}>
                      <Button label="Editar" variant="secondary" onPress={() => setEditing(draftFrom(t))} />
                    </View>
                    <View style={styles.action}>
                      <Button label="Duplicar" variant="secondary" disabled={busy} onPress={() => duplicate(t)} />
                    </View>
                    <View style={styles.action}>
                      <Button label={t.active ? 'Desativar' : 'Ativar'} variant="secondary" disabled={busy} onPress={() => toggleActive(t)} />
                    </View>
                    <View style={styles.action}>
                      {confirmDelete === t.id ? (
                        <Button label="Confirmar exclusão" disabled={busy} onPress={() => remove(t)} />
                      ) : (
                        <Button label="Excluir" variant="secondary" disabled={busy} onPress={() => setConfirmDelete(t.id)} />
                      )}
                    </View>
                  </View>
                  {confirmDelete === t.id ? (
                    <Muted>
                      As fichas já preenchidas com este modelo continuam guardadas. Links de preenchimento ainda não respondidos
                      deixam de funcionar. Se só quer parar de usar, prefira “Desativar”.
                    </Muted>
                  ) : null}
                </Card>
              );
            })}
            <Button label={`+ Nova ficha: ${s.title.toLowerCase()}`} variant="secondary" onPress={() => setEditing(newDraft(s.kind))} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  name: { fontSize: 17, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  action: { flexGrow: 1, minWidth: 130 },
});
