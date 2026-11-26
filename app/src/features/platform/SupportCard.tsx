import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Muted, Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { whatsappUrl } from '@/features/booking/links';
import { maskPhone } from '@/lib/format';

import { fetchSupport, type SupportInfo } from './api';

/** Carrega o contato de suporte (funciona com ou sem login). */
export function useSupport(): SupportInfo | null {
  const [support, setSupport] = useState<SupportInfo | null>(null);
  useEffect(() => {
    let active = true;
    fetchSupport()
      .then((s) => active && setSupport(s))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return support;
}

export function hasSupportContact(s: SupportInfo | null): s is SupportInfo {
  return !!(s && (s.email || s.whatsapp || s.phone));
}

/** Linhas de contato do suporte (WhatsApp, e-mail, telefone). */
export function SupportContacts({ support, context }: { support: SupportInfo; context?: string }) {
  const c = usePalette();
  const wa = whatsappUrl(support.whatsapp, context ? `Olá! Preciso de ajuda: ${context}` : 'Olá! Preciso de ajuda com o sistema.');
  const rows = [
    wa ? { label: 'WhatsApp', value: maskPhone(support.whatsapp ?? ''), url: wa } : null,
    support.email
      ? {
          label: 'E-mail',
          value: support.email,
          url: `mailto:${support.email}?subject=${encodeURIComponent(`Suporte ${support.product_name}${context ? ` – ${context}` : ''}`)}`,
        }
      : null,
    support.phone ? { label: 'Telefone', value: support.phone, url: `tel:${support.phone.replace(/\D/g, '')}` } : null,
  ].filter((r): r is { label: string; value: string; url: string } => !!r);

  return (
    <View style={{ gap: Space.sm }}>
      {rows.map((r) => (
        <Pressable key={r.label} accessibilityRole="link" onPress={() => Linking.openURL(r.url)} style={styles.row} hitSlop={4}>
          <Text style={[styles.label, { color: c.textMuted }]}>{r.label}</Text>
          <Text style={[styles.value, { color: c.primary }]}>{r.value}</Text>
        </Pressable>
      ))}
      {support.hours ? <Muted style={{ fontSize: 13 }}>Atendimento: {support.hours}</Muted> : null}
      {support.message ? <Muted style={{ fontSize: 13 }}>{support.message}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: Space.md, flexWrap: 'wrap' },
  label: { width: 80, fontSize: 13, fontWeight: '600' },
  value: { fontSize: 15, fontWeight: '700' },
});
