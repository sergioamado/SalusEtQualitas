import { type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MaxContentWidth, MaxPanelWidth, Radius, Space, useBrandFonts, usePalette } from '@/constants/theme';

/**
 * Text que aplica a fonte da clínica. Fontes personalizadas têm um arquivo por
 * peso, então fontWeight >= 600 vira a variante "bold" da família.
 */
export function Text({ style, ...props }: TextProps) {
  const fonts = useBrandFonts();
  if (!fonts) return <RNText style={style} {...props} />;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const w = flat.fontWeight;
  const bold = w === 'bold' || (w != null && Number(w) >= 600);
  return <RNText {...props} style={[flat, { fontFamily: bold ? fonts.bold : fonts.regular, fontWeight: 'normal' }]} />;
}

/** Tela com rolagem, largura limitada no computador e rodapé fixo opcional. */
export function Screen({
  children,
  footer,
  wide,
  top,
  safeTop = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  /** Painel interno: conteúdo mais largo no computador. */
  wide?: boolean;
  /** Conteúdo de largura total acima da coluna (ex.: capa). */
  top?: ReactNode;
  /** false quando já existe um cabeçalho cuidando da área segura do topo. */
  safeTop?: boolean;
}) {
  const c = usePalette();
  const column = [styles.column, wide && { maxWidth: MaxPanelWidth }];
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]} edges={safeTop ? ['top', 'bottom'] : ['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {top}
          <View style={column}>{children}</View>
        </ScrollView>
        {footer ? (
          <View style={[styles.footer, { backgroundColor: c.background, borderTopColor: c.border }]}>
            <View style={column}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const c = usePalette();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
      {children}
    </Text>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const c = usePalette();
  return <Text style={[styles.muted, { color: c.textMuted }, style]}>{children}</Text>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const c = usePalette();
  return <Text style={[styles.sectionLabel, { color: c.textMuted }]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const c = usePalette();
  const primary = variant === 'primary';
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: c.primary }
          : { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.border },
        inactive && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
      ]}>
      {loading ? (
        <ActivityIndicator color={primary ? c.primaryText : c.primary} />
      ) : (
        <Text style={[styles.buttonText, { color: primary ? c.primaryText : c.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Cartão selecionável (serviço, local, profissional). */
export function OptionCard({
  title,
  subtitle,
  aside,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  aside?: string | null;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? c.primarySoft : c.surface,
          borderColor: selected ? c.primary : c.border,
        },
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.85 },
      ]}>
      <View style={styles.flex}>
        <Text style={[styles.cardTitle, { color: c.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.cardSubtitle, { color: c.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {aside ? <Text style={[styles.cardAside, { color: c.text }]}>{aside}</Text> : null}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c.primary : c.surface,
          borderColor: selected ? c.primary : c.border,
        },
        pressed && { opacity: 0.85 },
      ]}>
      <Text style={[styles.chipText, { color: selected ? c.primaryText : c.text }]}>{label}</Text>
    </Pressable>
  );
}

type FieldProps = Omit<TextInputProps, 'ref'> & {
  label: string;
  error?: string | null;
  hint?: string | null;
  ref?: Ref<TextInputInstance>;
};

export function Field({ label, error, hint, style, ref, ...input }: FieldProps) {
  const c = usePalette();
  const fonts = useBrandFonts();
  return (
    <View style={[styles.field, style as object]}>
      <Text style={[styles.fieldLabel, { color: c.text }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={c.textMuted}
        accessibilityLabel={label}
        style={[
          styles.input,
          {
            color: c.text,
            backgroundColor: input.editable === false ? c.surfaceMuted : c.surface,
            borderColor: error ? c.danger : c.border,
          },
          fonts && { fontFamily: fonts.regular },
          input.multiline && styles.multiline,
        ]}
        {...input}
      />
      {error ? (
        <Text style={[styles.fieldHint, { color: c.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.fieldHint, { color: c.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={styles.checkboxRow}>
      <View
        style={[
          styles.checkbox,
          { borderColor: checked ? c.primary : c.border, backgroundColor: checked ? c.primary : c.surface },
        ]}>
        {checked ? <Text style={{ color: c.primaryText, fontWeight: '700' }}>✓</Text> : null}
      </View>
      <Text style={[styles.flex, styles.muted, { color: c.text }]}>{children}</Text>
    </Pressable>
  );
}

export function Notice({ tone, children }: { tone: 'danger' | 'warning' | 'success'; children: ReactNode }) {
  const c = usePalette();
  const bg = { danger: c.dangerSoft, warning: c.warningSoft, success: c.successSoft }[tone];
  const fg = { danger: c.danger, warning: c.warning, success: c.success }[tone];
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={[styles.muted, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const c = usePalette();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={c.primary} />
      {label ? <Muted>{label}</Muted> : null}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const c = usePalette();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <Text style={[styles.fieldLabel, { color: c.text }]}>{label}</Text>
        {description ? <Text style={[styles.fieldHint, { color: c.textMuted }]}>{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.primary, false: c.border }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const c = usePalette();
  return (
    <View style={[styles.cardBox, { backgroundColor: c.surface, borderColor: c.border }, style]}>{children}</View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'warning' | 'success' | 'danger' | 'primary' }) {
  const c = usePalette();
  const map = {
    neutral: [c.surfaceMuted, c.textMuted],
    warning: [c.warningSoft, c.warning],
    success: [c.successSoft, c.success],
    danger: [c.dangerSoft, c.danger],
    primary: [c.primarySoft, c.primary],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  const c = usePalette();
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: c.textMuted }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: c.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.xs },
  cardBox: { borderWidth: 1, borderRadius: Radius.lg, padding: Space.lg, gap: Space.md },
  badge: { alignSelf: 'flex-start', paddingHorizontal: Space.sm, paddingVertical: 3, borderRadius: Radius.pill },
  badgeText: { fontSize: 12, fontWeight: '700' },
  summaryRow: { gap: 2 },
  summaryLabel: { fontSize: 13 },
  summaryValue: { fontSize: 16, fontWeight: '600' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: Space.xxl },
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
  },
  footer: { paddingVertical: Space.md, borderTopWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  muted: { fontSize: 15, lineHeight: 21 },
  sectionLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: Space.sm },
  button: { minHeight: 52, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.lg },
  buttonText: { fontSize: 17, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 64,
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
  },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  cardSubtitle: { fontSize: 14, marginTop: 2, lineHeight: 19 },
  cardAside: { fontSize: 15, fontWeight: '600' },
  chip: {
    minHeight: 44,
    minWidth: 76,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  field: { gap: Space.xs },
  fieldLabel: { fontSize: 15, fontWeight: '600' },
  input: { minHeight: 50, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Space.md, fontSize: 16 },
  multiline: { minHeight: 96, paddingTop: Space.md, textAlignVertical: 'top' },
  fieldHint: { fontSize: 13 },
  checkboxRow: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start', paddingVertical: Space.xs },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  notice: { padding: Space.md, borderRadius: Radius.md },
  loading: { paddingVertical: Space.xxl, alignItems: 'center', gap: Space.md },
});
