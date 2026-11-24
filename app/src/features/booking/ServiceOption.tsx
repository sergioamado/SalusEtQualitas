import { Pressable, StyleSheet, View } from 'react-native';

import { ServiceMedia } from '@/components/ServiceMedia';
import { Text } from '@/components/ui';
import { Radius, Space, usePalette } from '@/constants/theme';
import { formatDuration, formatPrice } from '@/lib/format';

import type { PublicProcedure } from './api';

/** Cartão de serviço no portal, com foto e/ou vídeo do YouTube quando a clínica cadastrou. */
export function ServiceOption({
  procedure: p,
  selected,
  onPress,
}: {
  procedure: PublicProcedure;
  selected: boolean;
  onPress: () => void;
}) {
  const c = usePalette();
  const price = formatPrice(p.price);
  const hasMedia = !!(p.image_url || p.video_url);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={p.name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: selected ? c.primarySoft : c.surface, borderColor: selected ? c.primary : c.border },
        pressed && { opacity: 0.9 },
      ]}>
      {hasMedia ? <ServiceMedia imageUrl={p.image_url} videoUrl={p.video_url} height={150} rounded={false} /> : null}
      <View style={styles.body}>
        <View style={styles.flex}>
          <Text style={[styles.title, { color: c.text }]}>{p.name}</Text>
          {p.description ? <Text style={[styles.sub, { color: c.textMuted }]}>{p.description}</Text> : null}
          <Text style={[styles.sub, { color: c.textMuted }]}>{formatDuration(p.duration_min)}</Text>
        </View>
        {price ? <Text style={[styles.price, { color: c.text }]}>{price}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: Radius.lg, overflow: 'hidden' },
  body: { flexDirection: 'row', gap: Space.md, padding: Space.lg, alignItems: 'flex-start' },
  flex: { flex: 1, gap: 4 },
  title: { fontSize: 17, fontWeight: '700' },
  sub: { fontSize: 14, lineHeight: 20 },
  price: { fontSize: 16, fontWeight: '700' },
});
