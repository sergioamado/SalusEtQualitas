import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { MaxContentWidth, Space, usePalette } from '@/constants/theme';

export type HeroData = {
  name: string;
  logo_url: string | null;
  cover_url: string | null;
  welcome_message: string | null;
};

/** Capa do portal: foto de fundo (ou cor secundária), logomarca e boas-vindas. */
export function ClinicHero({ clinic, compact }: { clinic: HeroData; compact?: boolean }) {
  const c = usePalette();
  const hasCover = !!clinic.cover_url;
  const textColor = hasCover ? '#FFFFFF' : c.secondaryText;

  return (
    <View style={[styles.hero, { backgroundColor: c.secondary, minHeight: compact ? 150 : 190 }]}>
      {hasCover ? (
        <>
          <Image
            source={{ uri: clinic.cover_url! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            accessibilityIgnoresInvertColors
          />
          <View style={[StyleSheet.absoluteFill, styles.scrim]} />
        </>
      ) : null}
      <View style={styles.inner}>
        {clinic.logo_url ? (
          <View style={styles.logoWrap}>
            <Image
              source={{ uri: clinic.logo_url }}
              style={styles.logo}
              contentFit="contain"
              accessibilityLabel={`Logomarca ${clinic.name}`}
            />
          </View>
        ) : null}
        <Text accessibilityRole="header" style={[styles.name, { color: textColor }]}>
          {clinic.name}
        </Text>
        {clinic.welcome_message ? (
          <Text style={[styles.welcome, { color: textColor }]}>{clinic.welcome_message}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', justifyContent: 'flex-end', overflow: 'hidden' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Space.lg,
    paddingTop: Space.xl,
    paddingBottom: Space.lg,
    gap: Space.sm,
  },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: '100%', height: '100%' },
  name: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  welcome: { fontSize: 15, lineHeight: 21, opacity: 0.95 },
});
