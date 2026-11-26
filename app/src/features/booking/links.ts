import { onlyDigits } from '@/lib/format';

/** Link do WhatsApp (wa.me) a partir de um telefone brasileiro. */
export function whatsappUrl(phone: string | null | undefined, text?: string): string | null {
  const digits = onlyDigits(phone ?? '');
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function instagramUrl(handle: string | null | undefined): string | null {
  const h = (handle ?? '').trim().replace(/^@/, '');
  if (!h) return null;
  return /^https?:\/\//.test(h) ? h : `https://instagram.com/${h}`;
}

export function mapsUrl(address: string | null | undefined): string | null {
  const a = (address ?? '').trim();
  return a ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}` : null;
}

export function telUrl(phone: string | null | undefined): string | null {
  const digits = onlyDigits(phone ?? '');
  return digits.length >= 8 ? `tel:${digits}` : null;
}

/** Iniciais para o avatar quando o profissional não tem foto. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}
