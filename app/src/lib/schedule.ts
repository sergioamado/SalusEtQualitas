import { isValidTime, shortTime } from './format';

/** 0 = domingo … 6 = sábado (igual ao banco). */
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAY_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
/** Ordem de exibição: começa na segunda. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export type DaySchedule = {
  enabled: boolean;
  start: string;
  end: string;
  /** Pausa opcional (ex.: almoço). Vazio = sem pausa. */
  breakStart: string;
  breakEnd: string;
};
export type WeekSchedule = DaySchedule[]; // índice = weekday

export type HourRow = { weekday: number; start_time: string; end_time: string };
export type BreakRow = { weekday: number; start_time: string; end_time: string; label?: string | null };

const OFF: DaySchedule = { enabled: false, start: '08:00', end: '18:00', breakStart: '', breakEnd: '' };

/** Seg a sex 08h–18h com almoço 12h–13h. */
export function defaultWeek(): WeekSchedule {
  return Array.from({ length: 7 }, (_, d) =>
    d >= 1 && d <= 5 ? { enabled: true, start: '08:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' } : { ...OFF },
  );
}

/** Converte as linhas do banco para o editor (um período + uma pausa por dia). */
export function weekFromRows(hours: HourRow[], breaks: BreakRow[]): WeekSchedule {
  return Array.from({ length: 7 }, (_, d) => {
    const h = hours.filter((x) => x.weekday === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (!h.length) return { ...OFF };
    const start = shortTime(h[0].start_time);
    const end = shortTime(h[h.length - 1].end_time);
    // Dois períodos no mesmo dia (ex.: 08–12 e 14–18) viram um período com pausa.
    let breakStart = '';
    let breakEnd = '';
    const b = breaks.find((x) => x.weekday === d);
    if (h.length > 1) {
      breakStart = shortTime(h[0].end_time);
      breakEnd = shortTime(h[1].start_time);
    } else if (b) {
      breakStart = shortTime(b.start_time);
      breakEnd = shortTime(b.end_time);
    }
    return { enabled: true, start, end, breakStart, breakEnd };
  });
}

export function weekToRows(week: WeekSchedule) {
  const hours: { weekday: number; start: string; end: string }[] = [];
  const breaks: { weekday: number; start: string; end: string; label: string }[] = [];
  week.forEach((d, weekday) => {
    if (!d.enabled) return;
    hours.push({ weekday, start: d.start, end: d.end });
    if (d.breakStart && d.breakEnd) breaks.push({ weekday, start: d.breakStart, end: d.breakEnd, label: 'Pausa' });
  });
  return { hours, breaks };
}

/** Mensagem de erro do dia, ou null se estiver ok. */
export function dayError(d: DaySchedule): string | null {
  if (!d.enabled) return null;
  if (!isValidTime(d.start) || !isValidTime(d.end)) return 'Use o formato 08:00.';
  if (d.end <= d.start) return 'O fim precisa ser depois do início.';
  const hasBreak = d.breakStart || d.breakEnd;
  if (hasBreak) {
    if (!isValidTime(d.breakStart) || !isValidTime(d.breakEnd)) return 'Pausa: use o formato 12:00 (ou deixe vazio).';
    if (d.breakEnd <= d.breakStart) return 'O fim da pausa precisa ser depois do início.';
    if (d.breakStart <= d.start || d.breakEnd >= d.end) return 'A pausa precisa ficar dentro do horário.';
  }
  return null;
}

/** Resumo curto: "Seg–Sex 08:00–18:00 · Sáb 08:00–12:00". */
export function weekSummary(week: WeekSchedule): string {
  const parts: string[] = [];
  let i = 0;
  while (i < WEEK_ORDER.length) {
    const d = week[WEEK_ORDER[i]];
    if (!d.enabled) {
      i++;
      continue;
    }
    const label = `${d.start}–${d.end}`;
    let j = i;
    while (j + 1 < WEEK_ORDER.length) {
      const n = week[WEEK_ORDER[j + 1]];
      if (!n.enabled || `${n.start}–${n.end}` !== label) break;
      j++;
    }
    const days = i === j ? WEEKDAY_SHORT[WEEK_ORDER[i]] : `${WEEKDAY_SHORT[WEEK_ORDER[i]]}–${WEEKDAY_SHORT[WEEK_ORDER[j]]}`;
    parts.push(`${days} ${label}`);
    i = j + 1;
  }
  return parts.length ? parts.join(' · ') : 'Sem horário de atendimento';
}
