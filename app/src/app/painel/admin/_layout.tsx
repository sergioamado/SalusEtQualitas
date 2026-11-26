import { Redirect, router, Slot, usePathname } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { MaxPanelWidth, Radius, Space, usePalette } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

const TABS = [
  { href: '/painel/admin', label: 'Clínicas e uso' },
  { href: '/painel/admin/planos', label: 'Planos' },
  { href: '/painel/admin/configuracoes', label: 'Suporte, cobrança e proteção' },
] as const;

/** Área do gerente do sistema: só para platform_admins. */
export default function AdminLayout() {
  const { isPlatformAdmin, signOut } = useAuth();
  const c = usePalette();
  const pathname = usePathname();
  if (!isPlatformAdmin) return <Redirect href="/painel" />;

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView
        edges={['top']}
        style={{ backgroundColor: c.surface, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth }}>
        <View style={styles.inner}>
          <View style={styles.topRow}>
            <Text numberOfLines={1} style={[styles.title, { color: c.text }]}>
              Gerente do sistema
            </Text>
            <Pressable accessibilityRole="link" onPress={() => router.push('/painel/conta')} hitSlop={8}>
              <Text style={[styles.link, { color: c.textMuted }]}>Minha conta</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={signOut} hitSlop={8}>
              <Text style={[styles.link, { color: c.textMuted }]}>Sair</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map((t) => {
              const active = t.href === '/painel/admin' ? pathname === t.href || pathname.startsWith('/painel/admin/clinica') : pathname === t.href;
              return (
                <Pressable
                  key={t.href}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => router.replace(t.href)}
                  style={[styles.tab, { backgroundColor: active ? c.primarySoft : 'transparent' }]}>
                  <Text style={[styles.tabText, { color: active ? c.primary : c.textMuted }]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </SafeAreaView>
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { width: '100%', maxWidth: MaxPanelWidth, alignSelf: 'center', paddingHorizontal: Space.lg, paddingTop: Space.sm, gap: Space.xs },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 40 },
  title: { flex: 1, fontSize: 17, fontWeight: '700' },
  link: { fontSize: 14, fontWeight: '600' },
  tabs: { gap: Space.xs, paddingBottom: Space.sm },
  tab: { paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.md },
  tabText: { fontSize: 15, fontWeight: '600' },
});
