import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, Field, Loading, Muted, Notice, Screen, Text, Title } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { CHANNEL_LABEL, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, type Channel, type Status } from '@/features/agenda/api';
import { useClinic } from '@/features/panel/clinic-context';
import { addDays, brToDateKey, dateKeyToBr, dayAndMonth, formatDateLong, formatPrice, maskDate, maskPhone, weekdayShort } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { startOfWeek, toLocal } from '@/lib/tz';

import { BarList, ChartCard, ColumnChart, StatTile } from './charts';

type Preset = 'week' | 'fortnight' | 'month' | 'year' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'week', label: 'Semana' },
  { key: 'fortnight', label: 'Quinzena' },
  { key: 'month', label: 'Mês' },
  { key: 'year', label: 'Ano' },
  { key: 'custom', label: 'Intervalo' },
];
const MAX_DAYS = 400;

type IdleInfo = { available_min: number; booked_min: number; idle_pct: number | null };
type IdleOverview = { key: 'week' | 'fortnight' | 'month' | 'year'; from: string; to: string; idle: IdleInfo }[];
const OVERVIEW_LABEL: Record<IdleOverview[number]['key'], string> = {
  week: 'Semana',
  fortnight: 'Quinzena',
  month: 'Mês',
  year: 'Ano',
};

type Dashboard = {
  range: { from: string; to: string; bucket: 'day' | 'week' | 'month' };
  total: number;
  total_previous: number;
  cancelled: number;
  by_status: Partial<Record<Status, number>>;
  idle: IdleInfo;
  waitlist: { waiting: number; added: number; fitted: number };
  frequent_patients: { id: string; full_name: string; phone: string | null; n: number; last_at: string }[];
  sales: null | {
    done: number;
    expected: number;
    no_show: number;
    by_procedure: { name: string; n: number; total: number }[];
  };
  by_insurance: { label: string; n: number }[];
  by_channel: { label: Channel; n: number }[];
  by_period: { bucket: string; n: number }[];
};

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Intervalo [de, até) para o preset, deslocado `offset` períodos para trás/frente. */
function rangeFor(preset: Exclude<Preset, 'custom'>, today: string, offset: number): { from: string; to: string; label: string } {
  const [y, m] = today.split('-').map(Number);
  if (preset === 'week') {
    const from = addDays(startOfWeek(today), offset * 7);
    const to = addDays(from, 7);
    const a = dayAndMonth(from);
    const b = dayAndMonth(addDays(to, -1));
    return { from, to, label: `${a.day} ${a.month} – ${b.day} ${b.month}` };
  }
  if (preset === 'month') {
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    const from = d.toISOString().slice(0, 10);
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    return { from, to, label: `${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}` };
  }
  if (preset === 'year') {
    const year = y + offset;
    return { from: `${year}-01-01`, to: `${year + 1}-01-01`, label: String(year) };
  }
  // Quinzena: 1–15 ou 16 ao fim do mês. Cada passo de offset anda meia quinzena do calendário.
  const d0 = Number(today.slice(8, 10));
  const index = (y * 12 + (m - 1)) * 2 + (d0 > 15 ? 1 : 0) + offset;
  const month = Math.floor(index / 2);
  const second = index % 2 === 1;
  const yy = Math.floor(month / 12);
  const mm = month % 12;
  const first = new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(yy, mm + 1, 1)).toISOString().slice(0, 10);
  const from = second ? addDays(first, 15) : first;
  const to = second ? next : addDays(first, 15);
  return {
    from,
    to,
    label: `${second ? '2ª' : '1ª'} quinzena de ${MONTHS[mm]} (${Number(from.slice(8, 10))} a ${Number(addDays(to, -1).slice(8, 10))})`,
  };
}

function fmtShort(from: string, toExclusive: string) {
  const a = dayAndMonth(from);
  const b = dayAndMonth(addDays(toExclusive, -1));
  const yearA = from.slice(0, 4);
  const yearB = addDays(toExclusive, -1).slice(0, 4);
  return `${a.day} ${a.month}${yearA !== yearB ? ` ${yearA}` : ''} – ${b.day} ${b.month}${yearA !== yearB ? ` ${yearB}` : ''}`;
}

function hours(min: number) {
  const h = min / 60;
  return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1).replace('.', ',')} h`;
}

/** RF14: visão geral da agenda com filtros (semana por padrão). */
export function DashboardScreen() {
  const { clinic } = useClinic();
  const c = usePalette();
  const today = toLocal(new Date(), clinic.timezone).date;
  const [preset, setPreset] = useState<Preset>('week');
  const [offset, setOffset] = useState(0);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [pros, setPros] = useState<{ id: string; name: string }[]>([]);
  // Intervalo escolhido pelo usuário (datas digitadas e o intervalo aplicado).
  const [customFrom, setCustomFrom] = useState(dateKeyToBr(addDays(today, -29)));
  const [customTo, setCustomTo] = useState(dateKeyToBr(today));
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);

  const range =
    preset === 'custom'
      ? custom
        ? { ...custom, label: fmtShort(custom.from, custom.to) }
        : rangeFor('week', today, 0)
      : rangeFor(preset, today, offset);

  const applyCustom = () => {
    const from = brToDateKey(customFrom);
    const last = brToDateKey(customTo);
    if (!from || !last) return setCustomError('Use datas no formato DD/MM/AAAA.');
    if (last < from) return setCustomError('A data final precisa ser igual ou depois da inicial.');
    const to = addDays(last, 1);
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
    if (days > MAX_DAYS) return setCustomError(`Escolha no máximo ${MAX_DAYS} dias.`);
    setCustomError(null);
    setCustom({ from, to });
  };

  // Ociosidade da semana, quinzena, mês e ano da data de referência:
  // hoje, se estiver dentro do período escolhido; senão, o último dia dele.
  const lastDay = addDays(range.to, -1);
  const ref = today >= range.from && today <= lastDay ? today : lastDay;
  const overviewKey = `${clinic.id}|${ref}|${professionalId ?? ''}`;
  const [overview, setOverview] = useState<{ key: string; data?: IdleOverview }>();
  useEffect(() => {
    let active = true;
    supabase
      .rpc('clinic_idle_overview', { p_clinic_id: clinic.id, p_ref: ref, p_professional_id: professionalId })
      .then(({ data }) => active && setOverview({ key: overviewKey, data: (data ?? []) as IdleOverview }));
    return () => {
      active = false;
    };
  }, [clinic.id, ref, professionalId, overviewKey]);

  const key = `${clinic.id}|${range.from}|${range.to}|${professionalId ?? ''}`;
  const [response, setResponse] = useState<{ key: string; data?: Dashboard; error?: string }>();

  useEffect(() => {
    let active = true;
    supabase
      .from('professionals')
      .select('id,name')
      .eq('clinic_id', clinic.id)
      .eq('active', true)
      .order('name')
      .then(({ data }) => active && setPros(data ?? []));
    return () => {
      active = false;
    };
  }, [clinic.id]);

  useEffect(() => {
    let active = true;
    supabase
      .rpc('clinic_dashboard', {
        p_clinic_id: clinic.id,
        p_from: range.from,
        p_to: range.to,
        p_professional_id: professionalId,
      })
      .then(({ data, error }) => {
        if (!active) return;
        setResponse(error ? { key, error: error.message } : { key, data: data as Dashboard });
      });
    return () => {
      active = false;
    };
  }, [clinic.id, range.from, range.to, professionalId, key]);

  // Mantém os números anteriores enquanto carrega o novo período.
  const d = response?.data;
  const loading = response?.key !== key;

  const delta = d ? d.total - d.total_previous : 0;
  const noShow = d?.by_status.nao_compareceu ?? 0;
  const bucketItems = d ? periodItems(d) : [];

  return (
    <Screen wide safeTop={false}>
      <Title>Dashboard</Title>

      {/* Filtros, numa linha acima de tudo */}
      <View style={styles.filters}>
        <View style={styles.row}>
          {PRESETS.map((p) => (
            <Chip
              key={p.key}
              label={p.label}
              selected={preset === p.key}
              onPress={() => {
                setPreset(p.key);
                setOffset(0);
              }}
            />
          ))}
        </View>
        {preset === 'custom' ? (
          <View style={{ gap: Space.sm }}>
            <View style={styles.row}>
              <Field
                label="De"
                value={customFrom}
                onChangeText={(t) => setCustomFrom(maskDate(t))}
                keyboardType="number-pad"
                placeholder="DD/MM/AAAA"
                style={styles.dateField}
              />
              <Field
                label="Até"
                value={customTo}
                onChangeText={(t) => setCustomTo(maskDate(t))}
                keyboardType="number-pad"
                placeholder="DD/MM/AAAA"
                style={styles.dateField}
              />
              <View style={styles.applyBtn}>
                <Button label="Aplicar" onPress={applyCustom} />
              </View>
            </View>
            {customError ? <Notice tone="danger">{customError}</Notice> : null}
            {custom ? (
              <Text style={[styles.period, { color: c.text, textAlign: 'left' }]}>{range.label}</Text>
            ) : (
              <Muted>Escolha as datas e toque em Aplicar (até {MAX_DAYS} dias).</Muted>
            )}
          </View>
        ) : (
          <View style={styles.row}>
            <Button label="‹" variant="secondary" onPress={() => setOffset((o) => o - 1)} />
            <Text style={[styles.period, { color: c.text }]}>{range.label}</Text>
            <Button label="›" variant="secondary" disabled={offset >= 0} onPress={() => setOffset((o) => Math.min(o + 1, 0))} />
            {loading && d ? <Muted>Atualizando…</Muted> : null}
          </View>
        )}
        {pros.length > 1 ? (
          <View style={styles.row}>
            <Chip label="Todos os profissionais" selected={!professionalId} onPress={() => setProfessionalId(null)} />
            {pros.map((p) => (
              <Chip key={p.id} label={p.name} selected={professionalId === p.id} onPress={() => setProfessionalId(p.id)} />
            ))}
          </View>
        ) : null}
      </View>

      {response?.error ? <Notice tone="danger">{response.error}</Notice> : null}
      {!d ? (
        <Loading label="Calculando…" />
      ) : (
        <View style={{ gap: Space.lg, opacity: loading ? 0.6 : 1 }}>
          {/* Números principais */}
          <View style={styles.tiles}>
            <StatTile
              label="Agendamentos"
              value={String(d.total)}
              tone={delta > 0 ? 'good' : delta < 0 ? 'bad' : 'neutral'}
              detail={
                d.total_previous || d.total
                  ? `${delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : ''}${delta === 0 ? 'igual ao' : delta} ${delta === 0 ? '' : 'vs. '}período anterior (${d.total_previous})`
                  : 'Nenhum no período'
              }
            />
            <StatTile
              label="Ociosidade da agenda"
              value={d.idle.idle_pct === null ? '—' : `${d.idle.idle_pct}%`}
              tone={d.idle.idle_pct !== null && d.idle.idle_pct > 60 ? 'bad' : 'neutral'}
              detail={
                d.idle.available_min
                  ? `${hours(Math.max(d.idle.available_min - d.idle.booked_min, 0))} livres de ${hours(d.idle.available_min)} de expediente`
                  : 'Sem expediente cadastrado no período'
              }
            />
            <StatTile
              label="Lista de espera"
              value={String(d.waitlist.waiting)}
              detail={`aguardando · ${d.waitlist.added} entraram no período`}
            />
            <StatTile
              label="Cancelamentos e faltas"
              value={String(d.cancelled + noShow)}
              tone={d.cancelled + noShow > 0 ? 'bad' : 'neutral'}
              detail={`${d.cancelled} cancelado(s) · ${noShow} não compareceu`}
            />
          </View>

          {/* Ociosidade por período: semana, quinzena, mês, ano (+ intervalo escolhido) */}
          <ChartCard
            title="Ociosidade por período"
            subtitle={`Quanto do expediente ficou sem paciente, nos períodos que contêm ${formatDateLong(ref)}`}>
            {overview?.data ? (
              <BarList
                color={c.primary}
                format={(n) => `${n}%`}
                items={[
                  ...overview.data.map((o) => ({
                    label: OVERVIEW_LABEL[o.key],
                    value: o.idle.idle_pct ?? 0,
                    display: o.idle.idle_pct === null ? '—' : undefined,
                    hint: o.idle.available_min
                      ? `${fmtShort(o.from, o.to)} · ${hours(Math.max(o.idle.available_min - o.idle.booked_min, 0))} livres de ${hours(o.idle.available_min)}`
                      : `${fmtShort(o.from, o.to)} · sem expediente`,
                  })),
                  ...(preset === 'custom' && custom
                    ? [
                        {
                          label: 'Intervalo escolhido',
                          value: d.idle.idle_pct ?? 0,
                          display: d.idle.idle_pct === null ? '—' : undefined,
                          hint: `${range.label} · ${hours(Math.max(d.idle.available_min - d.idle.booked_min, 0))} livres de ${hours(d.idle.available_min)}`,
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <Loading />
            )}
          </ChartCard>

          {d.sales ? (
            <View style={styles.tiles}>
              <StatTile label="Vendas realizadas" value={formatPrice(d.sales.done) ?? 'R$ 0,00'} detail="atendimentos concluídos" />
              <StatTile label="Vendas previstas" value={formatPrice(d.sales.expected) ?? 'R$ 0,00'} detail="agendados, confirmados e aguardando" />
              <StatTile
                label="Perdido com faltas"
                value={formatPrice(d.sales.no_show) ?? 'R$ 0,00'}
                tone={d.sales.no_show > 0 ? 'bad' : 'neutral'}
                detail="pacientes que não compareceram"
              />
            </View>
          ) : null}

          <View style={styles.grid}>
            <ChartCard title="Agendamentos por período" subtitle={bucketSubtitle(d.range.bucket)}>
              <ColumnChart items={bucketItems} color={c.primary} unit={(n) => `${n} agendamento${n === 1 ? '' : 's'}`} />
            </ChartCard>

            <ChartCard title="Por situação">
              <BarList
                color={c.primary}
                items={STATUS_ORDER.map((s) => ({ label: STATUS_LABEL[s], value: d.by_status[s] ?? 0, color: STATUS_COLOR[s] })).filter(
                  (i) => i.value > 0,
                )}
              />
            </ChartCard>
          </View>

          <View style={styles.grid}>
            <ChartCard title="Por convênio">
              <BarList color={c.primary} items={d.by_insurance.map((i) => ({ label: i.label, value: i.n }))} />
            </ChartCard>
            <ChartCard title="Por canal" subtitle="Como o paciente marcou">
              <BarList color={c.primary} items={d.by_channel.map((i) => ({ label: CHANNEL_LABEL[i.label] ?? i.label, value: i.n }))} />
            </ChartCard>
          </View>

          <View style={styles.grid}>
            <ChartCard title="Pacientes frequentes" subtitle="2 ou mais agendamentos no período">
              {d.frequent_patients.length === 0 ? (
                <Muted>Nenhum paciente voltou mais de uma vez neste período.</Muted>
              ) : (
                <View style={{ gap: Space.sm }}>
                  {d.frequent_patients.map((p) => (
                    <View key={p.id} style={[styles.patient, { borderBottomColor: c.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.text, fontWeight: '700' }}>{p.full_name}</Text>
                        <Muted style={{ fontSize: 13 }}>
                          Último: {formatDateLong(toLocal(p.last_at, clinic.timezone).date)}
                          {p.phone ? ` · ${maskPhone(p.phone)}` : ''}
                        </Muted>
                      </View>
                      <Text style={{ color: c.text, fontWeight: '700' }}>{p.n}×</Text>
                      {p.phone ? (
                        <Pressable
                          accessibilityRole="link"
                          accessibilityLabel={`WhatsApp de ${p.full_name}`}
                          onPress={() => Linking.openURL(`https://wa.me/55${p.phone}`)}
                          hitSlop={6}>
                          <Text style={{ color: c.primary, fontWeight: '600' }}>WhatsApp</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
            </ChartCard>

            {d.sales ? (
              <ChartCard title="Vendas por serviço" subtitle="Atendimentos concluídos">
                <BarList
                  color={c.primary}
                  format={(n) => formatPrice(n) ?? ''}
                  items={d.sales.by_procedure.map((p) => ({ label: p.name, value: Number(p.total), hint: `${p.n}×` }))}
                  empty="Nenhum atendimento concluído no período. Marque como “Concluído” na agenda para contar aqui."
                />
              </ChartCard>
            ) : null}
          </View>

          <Muted style={{ fontSize: 13 }}>
            Ociosidade = parte do expediente dos profissionais (descontando pausas e bloqueios) sem agendamento no período, inclusive
            os dias que ainda vão acontecer. Conta a partir do cadastro de cada profissional. Cancelados não contam como agendamento.
          </Muted>
        </View>
      )}
    </Screen>
  );
}

function bucketSubtitle(bucket: Dashboard['range']['bucket']) {
  return bucket === 'day' ? 'Por dia' : bucket === 'week' ? 'Por semana' : 'Por mês';
}

/** Preenche os buracos (dias/semanas/meses sem agendamento aparecem com zero). */
function periodItems(d: Dashboard) {
  const counts = new Map(d.by_period.map((p) => [p.bucket, p.n]));
  const items: { key: string; label: string; long: string; value: number }[] = [];
  const { from, to, bucket } = d.range;
  if (bucket === 'day') {
    for (let k = from; k < to; k = addDays(k, 1)) {
      const dm = dayAndMonth(k);
      items.push({ key: k, label: to <= addDays(from, 8) ? `${weekdayShort(k)} ${dm.day}` : dm.day, long: formatDateLong(k), value: counts.get(k) ?? 0 });
    }
  } else if (bucket === 'week') {
    for (let k = startOfWeek(from); k < to; k = addDays(k, 7)) {
      const dm = dayAndMonth(k);
      items.push({ key: k, label: `${dm.day} ${dm.month}`, long: `Semana de ${dm.day} ${dm.month}`, value: counts.get(k) ?? 0 });
    }
  } else {
    const [y0, m0] = from.split('-').map(Number);
    for (let i = 0; ; i++) {
      const dt = new Date(Date.UTC(y0, m0 - 1 + i, 1));
      const k = dt.toISOString().slice(0, 10);
      if (k >= to) break;
      items.push({ key: k, label: MONTHS[dt.getUTCMonth()], long: `${MONTHS[dt.getUTCMonth()]} de ${dt.getUTCFullYear()}`, value: counts.get(k) ?? 0 });
    }
  }
  return items;
}

const styles = StyleSheet.create({
  filters: { gap: Space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.sm },
  period: { fontSize: 16, fontWeight: '700', minWidth: 140, textAlign: 'center' },
  dateField: { flexGrow: 1, flexBasis: 150, maxWidth: 220 },
  applyBtn: { justifyContent: 'flex-end', paddingTop: 22 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md, alignItems: 'flex-start' },
  patient: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingBottom: Space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
});
