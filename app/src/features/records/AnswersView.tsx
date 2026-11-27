// Mostra uma ficha JÁ RESPONDIDA, só para leitura (prontuário).
// Exibe apenas o que foi respondido; um título de seção só aparece se
// alguma pergunta dela tiver resposta.
import { StyleSheet, View } from 'react-native';

import { Muted, Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { dateKeyToBr } from '@/lib/format';

import { isEmptyAnswer, type AnswerValue, type Answers, type FormField } from './types';

export function formatAnswer(field: FormField, v: AnswerValue): string {
  if (v === null || v === undefined) return '—';
  switch (field.type) {
    case 'yesno':
      return v ? 'Sim' : 'Não';
    case 'multi':
      return Array.isArray(v) ? v.join(', ') : String(v);
    case 'scale':
      return `${v} de 10`;
    case 'number':
      return String(v).replace('.', ',');
    case 'date':
      return typeof v === 'string' ? dateKeyToBr(v) : String(v);
    default:
      return String(v);
  }
}

export function AnswersView({ fields, answers }: { fields: FormField[]; answers: Answers }) {
  const c = usePalette();
  // Agrupa em blocos: [seção, perguntas…]. Assim dá para esconder seções vazias.
  const blocks: { section: FormField | null; items: FormField[] }[] = [{ section: null, items: [] }];
  for (const f of fields) {
    if (f.type === 'section') blocks.push({ section: f, items: [] });
    else if (!isEmptyAnswer(answers[f.id])) blocks[blocks.length - 1].items.push(f);
  }
  const visible = blocks.filter((b) => b.items.length > 0);
  if (visible.length === 0) return <Muted>Nenhuma pergunta respondida.</Muted>;

  return (
    <View style={{ gap: Space.md }}>
      {visible.map((b, i) => (
        <View key={b.section?.id ?? `b${i}`} style={{ gap: Space.sm }}>
          {b.section ? <Text style={[styles.section, { color: c.textMuted }]}>{b.section.label}</Text> : null}
          {b.items.map((f) => (
            <View key={f.id} style={{ gap: 1 }}>
              <Text style={[styles.q, { color: c.textMuted }]}>{f.label}</Text>
              <Text style={[styles.a, { color: c.text }]}>{formatAnswer(f, answers[f.id])}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  q: { fontSize: 13 },
  a: { fontSize: 16, lineHeight: 22 },
});
