import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { MaxContentWidth, Radius, Space, usePalette } from '@/constants/theme';

/** Janela por cima da tela (detalhes, formulários). No celular ocupa a tela; no computador, uma coluna central. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const c = usePalette();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Fechar" style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['top', 'bottom']} style={[styles.panel, { backgroundColor: c.background }]}>
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
                {title}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onClose} hitSlop={10}>
                <Text style={[styles.close, { color: c.textMuted }]}>✕</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {footer ? <View style={[styles.footer, { borderTopColor: c.border }]}>{footer}</View> : null}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  panel: {
    width: '100%',
    maxWidth: MaxContentWidth + 40,
    height: '100%',
    maxHeight: Platform.OS === 'web' ? '92%' : '100%',
    borderRadius: Platform.OS === 'web' ? Radius.lg : 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '700' },
  close: { fontSize: 20, fontWeight: '700' },
  body: { padding: Space.lg, gap: Space.md },
  footer: { padding: Space.lg, gap: Space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
