// ============================================================================
// ENVIO DE IMAGENS (logo, capa, galeria, serviços, fotos dos profissionais)
// ----------------------------------------------------------------------------
// Uma foto de celular tem 3–5 MB e 4000 px de largura — muito mais do que a tela
// mostra. Por isso, ANTES de enviar, o próprio aparelho:
//   1) diminui a imagem para o tamanho máximo daquele uso (tabela SIZES);
//   2) regrava em JPEG com qualidade 0,8 (o logo fica em PNG, para manter o
//      fundo transparente).
// Resultado: ~100–300 KB por imagem, em vez de 2–5 MB. Isso economiza o espaço
// do Supabase (o plano grátis tem 1 GB) e deixa a página da clínica mais rápida
// para o paciente, que muitas vezes está no 4G.
// Funciona igual no site, no Android e no iPhone (expo-image-manipulator).
// ============================================================================
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

const BUCKET = 'clinic-assets';
/** Limite DEPOIS de comprimir (o bucket também recusa acima de 5 MB). */
const MAX_BYTES = 5 * 1024 * 1024;

export type ImageKind = 'logo' | 'cover' | 'service' | 'gallery' | 'professional';

/**
 * Largura máxima (px) de cada uso. Pense no maior lugar onde a imagem aparece,
 * vezes 2 (telas de celular têm o dobro de pixels): a capa ocupa a largura toda
 * da tela; a foto do profissional é um círculo pequeno.
 */
const SIZES: Record<ImageKind, { width: number; aspect: [number, number] }> = {
  logo: { width: 512, aspect: [1, 1] },
  professional: { width: 600, aspect: [1, 1] },
  service: { width: 1200, aspect: [16, 9] },
  gallery: { width: 1400, aspect: [4, 3] },
  cover: { width: 1600, aspect: [16, 9] },
};

/**
 * Abre a galeria, prepara a imagem (reduz e comprime), envia para
 * clinic-assets/<clinicId>/ e devolve a URL pública.
 * Retorna null se o usuário desistir. Deve ser chamada a partir de um toque (exigência da web).
 */
export async function pickAndUploadImage(clinicId: string, kind: ImageKind): Promise<string | null> {
  const size = SIZES[kind];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: size.aspect,
    quality: 1, // a compressão de verdade é feita abaixo, uma vez só
  });
  if (result.canceled || !result.assets?.length) return null;

  const { body, contentType, ext } = await prepareImage(result.assets[0], kind);
  if (body.byteLength > MAX_BYTES) throw new Error('A imagem ficou grande demais mesmo depois de reduzida. Escolha outra.');

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

/** Reduz (nunca aumenta) e regrava a imagem no formato certo para o uso. */
async function prepareImage(asset: ImagePicker.ImagePickerAsset, kind: ImageKind) {
  const png = kind === 'logo';
  const context = ImageManipulator.manipulate(asset.uri);
  // Só diminui: uma imagem pequena continua do tamanho que é.
  if (asset.width > SIZES[kind].width) context.resize({ width: SIZES[kind].width });
  try {
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: png ? SaveFormat.PNG : SaveFormat.JPEG, compress: png ? 1 : 0.8 });
    const body = await (await fetch(saved.uri)).arrayBuffer();
    return { body, contentType: png ? 'image/png' : 'image/jpeg', ext: png ? 'png' : 'jpg' };
  } catch {
    throw new Error('Não foi possível ler esta imagem. Use uma foto JPG, PNG ou WEBP.');
  } finally {
    context.release();
  }
}

/** Apaga do Storage uma imagem antiga da clínica (ignora URLs de fora do bucket). */
export async function removeUploadedImage(publicUrl: string | null) {
  if (!publicUrl) return;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return;
  await supabase.storage.from(BUCKET).remove([publicUrl.slice(index + marker.length)]);
}
