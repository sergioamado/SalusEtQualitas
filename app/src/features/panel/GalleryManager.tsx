import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Muted, Notice, SectionLabel, Text } from '@/components/ui';
import { Radius, Space, usePalette } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { pickAndUploadImage, removeUploadedImage } from '@/lib/upload';

export type GalleryItem = { url: string; caption?: string | null };
const MAX = 12;

/**
 * Fotos do espaço da clínica (até 12), mostradas na página do link de agendamento.
 * Cada mudança é salva na hora.
 */
export function GalleryManager({
  clinicId,
  photos,
  onChanged,
}: {
  clinicId: string;
  photos: GalleryItem[];
  onChanged: () => void;
}) {
  const c = usePalette();
  // Edição local das legendas; a lista em si vem do banco (photos).
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const persist = async (next: GalleryItem[], success?: string) => {
    const { error } = await supabase.from('clinics').update({ gallery: next }).eq('id', clinicId);
    if (error) {
      setMessage({ tone: 'danger', text: 'Não foi possível salvar as fotos. Tente novamente.' });
      return false;
    }
    if (success) setMessage({ tone: 'success', text: success });
    onChanged();
    return true;
  };

  const add = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const url = await pickAndUploadImage(clinicId, 'gallery');
      if (url) await persist([...photos, { url, caption: null }], 'Foto adicionada.');
    } catch (e) {
      setMessage({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (index: number) => {
    const target = photos[index];
    if (await persist(photos.filter((_, i) => i !== index), 'Foto removida.')) await removeUploadedImage(target.url);
  };

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    [next[index], next[to]] = [next[to], next[index]];
    persist(next);
  };

  const saveCaption = (index: number) => {
    const url = photos[index].url;
    const value = captions[url];
    if (value === undefined || value.trim() === (photos[index].caption ?? '')) return;
    persist(
      photos.map((p, i) => (i === index ? { ...p, caption: value.trim() || null } : p)),
      'Legenda salva.',
    );
  };

  return (
    <Card>
      <SectionLabel>Fotos do espaço</SectionLabel>
      <Muted style={{ fontSize: 13 }}>
        Recepção, salas, fachada, equipamentos… Aparecem em “Conheça a clínica” no link de agendamento. A primeira
        foto fica em destaque. Até {MAX} fotos, 5 MB cada.
      </Muted>

      {photos.length === 0 ? (
        <View style={[styles.empty, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
          <Text style={{ color: c.textMuted, textAlign: 'center' }}>Nenhuma foto ainda.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {photos.map((p, i) => (
            <View key={p.url} style={[styles.item, { borderColor: c.border, backgroundColor: c.surface }]}>
              <View style={styles.thumb}>
                <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                {i === 0 ? (
                  <View style={[styles.badge, { backgroundColor: c.primary }]}>
                    <Text style={{ color: c.primaryText, fontSize: 11, fontWeight: '700' }}>Destaque</Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flex: 1, gap: Space.xs }}>
                <TextInput
                  accessibilityLabel={`Legenda da foto ${i + 1}`}
                  value={captions[p.url] ?? p.caption ?? ''}
                  onChangeText={(v) => setCaptions((m) => ({ ...m, [p.url]: v.slice(0, 80) }))}
                  onBlur={() => saveCaption(i)}
                  onSubmitEditing={() => saveCaption(i)}
                  placeholder="Legenda (opcional), ex.: Recepção"
                  placeholderTextColor={c.textMuted}
                  style={[styles.caption, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
                />
                <View style={styles.actions}>
                  <SmallButton label="◀" hint="Mover para a esquerda" disabled={i === 0} onPress={() => move(i, -1)} />
                  <SmallButton label="▶" hint="Mover para a direita" disabled={i === photos.length - 1} onPress={() => move(i, 1)} />
                  <SmallButton label="Remover" hint="Remover foto" danger onPress={() => remove(i)} />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button
        label={photos.length >= MAX ? `Limite de ${MAX} fotos` : 'Adicionar foto'}
        variant="secondary"
        loading={busy}
        disabled={photos.length >= MAX}
        onPress={add}
      />
    </Card>
  );
}

function SmallButton({
  label,
  hint,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.small,
        { borderColor: c.border, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 },
      ]}>
      <Text style={{ color: danger ? c.danger : c.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: Radius.md, padding: Space.xl },
  list: { gap: Space.sm },
  item: { flexDirection: 'row', gap: Space.md, borderWidth: 1, borderRadius: Radius.md, padding: Space.sm },
  thumb: { width: 112, height: 84, borderRadius: Radius.sm, overflow: 'hidden' },
  badge: { position: 'absolute', left: 4, top: 4, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  caption: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Space.sm, paddingVertical: 8, fontSize: 14 },
  actions: { flexDirection: 'row', gap: Space.xs },
  small: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
});
