/**
 * Conversões entre instantes (ISO/UTC) e "hora local da clínica".
 * A agenda sempre mostra o horário da clínica, mesmo que o aparelho esteja em outro fuso.
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** Data (YYYY-MM-DD) e minutos desde 00:00 no fuso da clínica. */
export function toLocal(iso: string | Date, timeZone: string): { date: string; minutes: number } {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = Object.fromEntries(formatter(timeZone).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Diferença (ms) entre o relógio local do fuso e UTC naquele instante. */
function offsetMs(utcMs: number, timeZone: string): number {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Data local + minutos (no fuso da clínica) -> ISO em UTC. */
export function fromLocal(date: string, minutes: number, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let utc = guess - offsetMs(guess, timeZone);
  // Ajuste para horário de verão (o offset pode mudar entre o palpite e o resultado).
  const second = guess - offsetMs(utc, timeZone);
  if (second !== utc) utc = second;
  return new Date(utc).toISOString();
}

export const minutesToHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const hhmmToMinutes = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** Dia da semana (0 = domingo) de uma data YYYY-MM-DD. */
export const weekdayOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** Segunda-feira da semana da data. */
export function startOfWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const back = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}
