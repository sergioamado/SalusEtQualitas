import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { Radius } from '@/constants/theme';
import { youTubeId, youTubeThumbnail } from '@/lib/youtube';

/**
 * Foto do serviço e/ou vídeo do YouTube.
 * - Só foto: mostra a foto.
 * - Só vídeo: mostra a miniatura do vídeo com o botão "Ver vídeo".
 * - Os dois: mostra a foto com o botão "Ver vídeo".
 * O vídeo abre no navegador/app do YouTube (funciona igual na web, Android e iPhone).
 */
export function ServiceMedia({
  imageUrl,
  videoUrl,
  height = 160,
  rounded = true,
  showPlay = true,
}: {
  imageUrl: string | null | undefined;
  videoUrl: string | null | undefined;
  height?: number;
  rounded?: boolean;
  /** false em miniaturas: mostra a imagem sem o botão do vídeo. */
  showPlay?: boolean;
}) {
  const videoId = youTubeId(videoUrl);
  const source = imageUrl ?? (videoId ? youTubeThumbnail(videoId) : null);
  if (!source) return null;

  return (
    <View style={[styles.box, { height }, rounded && styles.rounded]}>
      <Image source={{ uri: source }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      {videoId && showPlay ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Ver vídeo do serviço no YouTube"
          onPress={() => WebBrowser.openBrowserAsync(`https://www.youtube.com/watch?v=${videoId}`)}
          hitSlop={8}
          style={({ pressed }) => [styles.play, pressed && { opacity: 0.8 }]}>
          <Text style={styles.playText}>▶  Ver vídeo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden', backgroundColor: '#00000010' },
  rounded: { borderRadius: Radius.md },
  play: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  playText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
