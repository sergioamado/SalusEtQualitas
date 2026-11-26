import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServiceMedia } from '@/components/ServiceMedia';
import { Text } from '@/components/ui';
import { mix, Radius, Space, usePalette } from '@/constants/theme';
import { formatDateTimeLong, formatDuration, formatPrice } from '@/lib/format';

import type { Modality, PublicClinic, PublicProcedure } from './api';

export const STEP_LABELS = ['Serviço', 'Local', 'Profissional', 'Horário', 'Seus dados'] as const;
const WIDE = 900;

export type BookingSummary = {
  procedure: PublicProcedure | null;
  modality: Modality | null;
  professionalName: string | null;
  startsAt: string | null;
};

export type ShellProps = {
  clinic: PublicClinic;
  /** 0..4; 5 = concluído. */
  stepIndex: number;
  summary: BookingSummary;
  onBack?: () => void;
  onHome: () => void;
};

/** Moldura dos passos: barra com a marca, progresso, conteúdo e (no computador) resumo ao lado. */
export function BookingShell({
  clinic,
  stepIndex,
  summary,
  onBack,
  onHome,
  footer,
  children,
}: ShellProps & { footer?: ReactNode; children: ReactNode }) {
  const c = usePalette();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const done = stepIndex >= STEP_LABELS.length;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      {/* Barra superior com a marca */}
      <View style={[styles.topBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={styles.topInner}>
          <View style={styles.side}>
            {onBack ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={onBack} hitSlop={12}>
                <Text style={[styles.back, { color: c.primary }]}>‹ Voltar</Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Página inicial de ${clinic.name}`}
            onPress={onHome}
            style={styles.brand}>
            {clinic.logo_url ? (
              <Image source={{ uri: clinic.logo_url }} style={styles.logo} contentFit="contain" />
            ) : null}
            <Text numberOfLines={1} style={[styles.brandName, { color: c.text }]}>
              {clinic.name}
            </Text>
          </Pressable>
          <View style={[styles.side, { alignItems: 'flex-end' }]}>
            {!done ? (
              <Text style={[styles.count, { color: c.textMuted }]}>
                {wide ? 'Passo ' : ''}
                {stepIndex + 1} de {STEP_LABELS.length}
              </Text>
            ) : null}
          </View>
        </View>
        {!done ? <Progress stepIndex={stepIndex} wide={wide} /> : null}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={[styles.body, { flexDirection: wide ? 'row' : 'column' }]}>
            <View style={[styles.main, wide && { maxWidth: 640 }]}>
              {!wide && !done && summary.procedure ? <SummaryStrip summary={summary} clinic={clinic} /> : null}
              {children}
            </View>
            {wide && !done ? (
              <View style={styles.aside}>
                <SummaryCard summary={summary} clinic={clinic} />
              </View>
            ) : null}
          </View>
        </ScrollView>

        {footer ? (
          <View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border }]}>
            <View style={[styles.body, styles.footerInner]}>
              <View style={[styles.main, wide && { maxWidth: 640 }]}>{footer}</View>
              {wide && !done ? <View style={styles.aside} /> : null}
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Progress({ stepIndex, wide }: { stepIndex: number; wide: boolean }) {
  const c = usePalette();
  return (
    <View style={[styles.progress, !wide && { gap: 4 }]}>
      {STEP_LABELS.map((label, i) => {
        const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo';
        return (
          <View key={label} style={styles.progressItem}>
            <View
              style={[
                styles.progressBar,
                { backgroundColor: state === 'todo' ? c.surfaceMuted : c.primary, opacity: state === 'done' ? 0.55 : 1 },
              ]}
            />
            {wide ? (
              <Text
                style={[
                  styles.progressLabel,
                  { color: state === 'current' ? c.text : c.textMuted, fontWeight: state === 'current' ? '700' : '400' },
                ]}>
                {label}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function rows(summary: BookingSummary, clinic: PublicClinic) {
  const p = summary.procedure;
  return [
    {
      label: 'Serviço',
      value: p ? p.name : null,
      detail: p ? [formatDuration(p.duration_min), formatPrice(p.price)].filter(Boolean).join(' · ') : null,
    },
    {
      label: 'Local',
      value: summary.modality === 'residencial' ? 'No seu endereço (Home Care)' : summary.modality === 'clinica' ? 'Na clínica' : null,
      detail: summary.modality === 'clinica' ? clinic.address : null,
    },
    { label: 'Profissional', value: summary.professionalName, detail: null },
    {
      label: 'Data e horário',
      value: summary.startsAt ? formatDateTimeLong(summary.startsAt, clinic.timezone) : null,
      detail: null,
    },
  ];
}

/** Resumo lateral (computador). */
export function SummaryCard({ summary, clinic, title = 'Seu agendamento' }: { summary: BookingSummary; clinic: PublicClinic; title?: string }) {
  const c = usePalette();
  const p = summary.procedure;
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {p && (p.image_url || p.video_url) ? (
        <ServiceMedia imageUrl={p.image_url} videoUrl={p.video_url} height={150} rounded={false} showPlay={false} />
      ) : (
        <LinearGradient
          colors={[mix(c.primarySoft, c.primary, 0.1), mix(c.primarySoft, c.primary, 0.4)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardBand}>
          <Text style={[styles.cardBandText, { color: c.text }]}>{clinic.name}</Text>
        </LinearGradient>
      )}
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, { color: c.text }]}>{title}</Text>
        {rows(summary, clinic).map((r) => (
          <View key={r.label} style={[styles.row, { borderTopColor: c.border }]}>
            <Text style={[styles.rowLabel, { color: c.textMuted }]}>{r.label}</Text>
            <Text style={[styles.rowValue, { color: r.value ? c.text : c.textMuted, fontWeight: r.value ? '600' : '400' }]}>
              {r.value ?? 'A escolher'}
            </Text>
            {r.value && r.detail ? <Text style={[styles.rowDetail, { color: c.textMuted }]}>{r.detail}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Resumo compacto no topo (celular). */
function SummaryStrip({ summary, clinic }: { summary: BookingSummary; clinic: PublicClinic }) {
  const c = usePalette();
  const p = summary.procedure!;
  const when = summary.startsAt ? formatDateTimeLong(summary.startsAt, clinic.timezone) : null;
  const parts = [
    formatDuration(p.duration_min),
    summary.modality === 'residencial' ? 'Em casa' : summary.modality === 'clinica' ? 'Na clínica' : null,
    summary.professionalName,
  ].filter(Boolean);
  return (
    <View style={[styles.strip, { backgroundColor: c.primarySoft, borderColor: mix(c.primarySoft, c.primary, 0.3) }]}>
      {p.image_url || p.video_url ? (
        <View style={styles.stripThumb}>
          <ServiceMedia imageUrl={p.image_url} videoUrl={p.video_url} height={52} rounded={false} showPlay={false} />
        </View>
      ) : null}
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.stripTitle, { color: c.text }]}>
          {p.name}
        </Text>
        <Text numberOfLines={1} style={[styles.stripText, { color: c.textMuted }]}>
          {parts.join(' · ')}
        </Text>
        {when ? (
          <Text numberOfLines={1} style={[styles.stripText, { color: c.text, fontWeight: '600' }]}>
            {when}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { borderBottomWidth: 1 },
  topInner: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    gap: Space.md,
  },
  side: { width: 96 },
  back: { fontSize: 16, fontWeight: '600' },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm },
  logo: { width: 30, height: 30, borderRadius: 8 },
  brandName: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  count: { fontSize: 13, fontVariant: ['tabular-nums'] },
  progress: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
  },
  progressItem: { flex: 1, gap: 6 },
  progressBar: { height: 4, borderRadius: 2 },
  progressLabel: { fontSize: 13 },

  scroll: { flexGrow: 1, paddingVertical: Space.xl },
  body: { width: '100%', maxWidth: 1040, alignSelf: 'center', paddingHorizontal: Space.lg, gap: Space.xl, alignItems: 'flex-start' },
  main: { flex: 1, width: '100%', gap: Space.lg },
  aside: { width: 340 },

  footer: { borderTopWidth: 1, paddingVertical: Space.md },
  footerInner: { flexDirection: 'row' },

  card: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' },
  cardBand: { height: 90, justifyContent: 'flex-end', padding: Space.lg },
  cardBandText: { fontSize: 16, fontWeight: '700' },
  cardBody: { padding: Space.lg, gap: Space.md },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  row: { borderTopWidth: 1, paddingTop: Space.md, gap: 2 },
  rowLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  rowValue: { fontSize: 15, lineHeight: 21 },
  rowDetail: { fontSize: 13, lineHeight: 18 },

  strip: { flexDirection: 'row', gap: Space.md, alignItems: 'center', borderWidth: 1, borderRadius: Radius.md, padding: Space.sm },
  stripThumb: { width: 72, height: 52, borderRadius: Radius.sm, overflow: 'hidden' },
  stripTitle: { fontSize: 15, fontWeight: '700' },
  stripText: { fontSize: 13 },
});
