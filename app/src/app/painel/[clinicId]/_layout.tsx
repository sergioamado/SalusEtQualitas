import { router, Slot, useLocalSearchParams, usePathname } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Loading, Muted, Notice, Screen, Text, Title } from '@/components/ui';
import { MaxPanelWidth, Radius, Space, usePalette } from '@/constants/theme';
import { ClinicContext, type ClinicRow } from '@/features/panel/clinic-context';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function ClinicPanelLayout() {
  const { clinicId } = useLocalSearchParams<{ clinicId: string }>();
  const { isPlatformAdmin, memberships, signOut } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const key = `${clinicId}|${attempt}`;
  const [response, setResponse] = useState<{ key: string; clinic?: ClinicRow | null; error?: string }>();

  useEffect(() => {
    let active = true;
    supabase
      .from('clinics')
      .select('*')
      .eq('id', clinicId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setResponse(error ? { key, error: error.message } : { key, clinic: data as ClinicRow | null });
      });
    return () => {
      active = false;
    };
  }, [clinicId, key]);

  // Mantém a tela atual durante recargas (ex.: depois de salvar configurações).
  const current = response?.key === key ? response : response?.clinic?.id === clinicId ? response : undefined;
  const role = memberships.find((m) => m.clinic_id === clinicId)?.role ?? null;
  const canManage = isPlatformAdmin || role === 'admin';

  const loadedClinic = current?.clinic ?? null;
  const value = useMemo(
    () =>
      loadedClinic
        ? { clinic: loadedClinic, reload: () => setAttempt((n) => n + 1), role, canManage }
        : null,
    [loadedClinic, role, canManage],
  );

  if (!current) {
    return (
      <Screen>
        <Loading label="Carregando clínica…" />
      </Screen>
    );
  }
  if (current.error || !value) {
    return (
      <Screen>
        <Title>Clínica não encontrada</Title>
        {current.error ? <Notice tone="danger">{current.error}</Notice> : null}
        <Muted>Você não tem acesso a esta clínica ou ela foi removida.</Muted>
        <Button label="Voltar" onPress={() => router.replace('/painel')} />
        <Button label="Sair" variant="secondary" onPress={signOut} />
      </Screen>
    );
  }

  return (
    <ClinicContext.Provider value={value}>
      <PanelHeader clinic={value.clinic} canManage={canManage} isPlatformAdmin={isPlatformAdmin} onSignOut={signOut} />
      <Slot />
    </ClinicContext.Provider>
  );
}

function PanelHeader({
  clinic,
  canManage,
  isPlatformAdmin,
  onSignOut,
}: {
  clinic: ClinicRow;
  canManage: boolean;
  isPlatformAdmin: boolean;
  onSignOut: () => void;
}) {
  const c = usePalette();
  const pathname = usePathname();
  const base = `/painel/${clinic.id}`;
  const tabs = [
    { href: base, label: 'Agenda' },
    { href: `${base}/agendamentos`, label: 'Pedidos recebidos' },
    { href: `${base}/espera`, label: 'Lista de espera' },
    ...(canManage
      ? [
          { href: `${base}/servicos`, label: 'Serviços' },
          { href: `${base}/profissionais`, label: 'Profissionais e horários' },
          { href: `${base}/configuracoes`, label: 'Clínica e aparência' },
          { href: `${base}/equipe`, label: 'Equipe e acessos' },
        ]
      : []),
  ];

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.surface, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth }}>
      <View style={styles.inner}>
        <View style={styles.topRow}>
          {clinic.logo_url ? <Image source={{ uri: clinic.logo_url }} style={styles.logo} contentFit="contain" /> : null}
          <Text numberOfLines={1} style={[styles.name, { color: c.text }]}>
            {clinic.name}
          </Text>
          {isPlatformAdmin ? (
            <Pressable accessibilityRole="link" onPress={() => router.replace('/painel/admin')} hitSlop={8}>
              <Text style={[styles.link, { color: c.primary }]}>Todas as clínicas</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={onSignOut} hitSlop={8}>
            <Text style={[styles.link, { color: c.textMuted }]}>Sair</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabs.map((t) => {
            const active = pathname === t.href;
            return (
              <Pressable
                key={t.href}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => router.replace(t.href as never)}
                style={[styles.tab, { backgroundColor: active ? c.primarySoft : 'transparent' }]}>
                <Text style={[styles.tabText, { color: active ? c.primary : c.textMuted }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  inner: {
    width: '100%',
    maxWidth: MaxPanelWidth,
    alignSelf: 'center',
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    gap: Space.xs,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 40 },
  logo: { width: 32, height: 32, borderRadius: 8 },
  name: { flex: 1, fontSize: 17, fontWeight: '700' },
  link: { fontSize: 14, fontWeight: '600' },
  tabs: { gap: Space.xs, paddingBottom: Space.sm },
  tab: { paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.md },
  tabText: { fontSize: 15, fontWeight: '600' },
});
