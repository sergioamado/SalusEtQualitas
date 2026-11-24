import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

const BUCKET = 'clinic-assets';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Abre a galeria, envia a imagem para clinic-assets/<clinicId>/ e devolve a URL pública.
 * Retorna null se o usuário desistir. Deve ser chamada a partir de um toque (exigência da web).
 */
export async function pickAndUploadImage(clinicId: string, kind: 'logo' | 'cover' | 'service'): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: kind === 'logo' ? [1, 1] : [16, 9],
    quality: 0.8,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const contentType = asset.mimeType ?? 'image/jpeg';
  const ext = ALLOWED[contentType];
  if (!ext) throw new Error('Use uma imagem JPG, PNG ou WEBP.');
  if (asset.fileSize && asset.fileSize > MAX_BYTES) throw new Error('A imagem passa de 5 MB. Escolha uma menor.');

  const body = asset.file ?? (await (await fetch(asset.uri)).arrayBuffer());
  const path = `${clinicId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) {
    throw new Error(
      /exceeded|too large/i.test(error.message)
        ? 'A imagem passa de 5 MB. Escolha uma menor.'
        : 'Não foi possível enviar a imagem. Tente novamente.',
    );
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Apaga do Storage uma imagem antiga da clínica (ignora URLs de fora do bucket). */
export async function removeUploadedImage(publicUrl: string | null) {
  if (!publicUrl) return;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return;
  await supabase.storage.from(BUCKET).remove([publicUrl.slice(index + marker.length)]);
}
