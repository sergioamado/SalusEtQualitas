export const onlyDigits = (value: string) => value.replace(/\D/g, '');

export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function maskCep(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export const isValidEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

export const isValidFullName = (value: string) =>
  value.trim().split(/\s+/).filter((part) => part.length > 0).length >= 2 && value.trim().length >= 3;

export const isValidPhone = (value: string) => {
  const len = onlyDigits(value).length;
  return len === 10 || len === 11;
};

export function formatPrice(value: number | null | undefined): string | null {
  if (value == null) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// ---------------------------------------------------------------------
// Datas: trabalhamos com "datas locais da clínica" no formato YYYY-MM-DD,
// independente do fuso do aparelho do paciente.
// ---------------------------------------------------------------------

/** Data de hoje (YYYY-MM-DD) no fuso informado. */
export function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateKeyToUtcNoon(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDays(key: string, days: number): string {
  const date = dateKeyToUtcNoon(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekdayShort(key: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
    .format(dateKeyToUtcNoon(key))
    .replace('.', '');
}

export function dayAndMonth(key: string): { day: string; month: string } {
  const date = dateKeyToUtcNoon(key);
  return {
    day: String(date.getUTCDate()),
    month: new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
      .format(date)
      .replace('.', ''),
  };
}

export function formatDateLong(key: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dateKeyToUtcNoon(key));
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

export function formatDateTimeLong(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------
// Horários (HH:MM)
// ---------------------------------------------------------------------

/** Máscara de hora: digitar 0830 vira "08:30". */
export function maskTime(value: string): string {
  const d = onlyDigits(value).slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

export const isValidTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** "08:00:00" (Postgres) -> "08:00" */
export const shortTime = (value: string) => value.slice(0, 5);

// ---------------------------------------------------------------------
// Datas digitadas (DD/MM/AAAA)
// ---------------------------------------------------------------------

export function maskDate(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "31/12/2026" -> "2026-12-31" (ou null se inválida). */
export function brToDateKey(value: string): string | null {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (date.getUTCDate() !== Number(dd) || date.getUTCMonth() !== Number(mm) - 1) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** "2026-12-31" -> "31/12/2026" */
export const dateKeyToBr = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
