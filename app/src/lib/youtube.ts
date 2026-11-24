/**
 * Extrai o ID de um vídeo do YouTube a partir dos formatos mais comuns:
 * youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, /embed/ID, /live/ID.
 */
export function youTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const match = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
      id = match?.[2] ?? null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** Link padronizado que é gravado no banco. */
export const youTubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** Miniatura pública do vídeo (não precisa de chave de API). */
export const youTubeThumbnail = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
