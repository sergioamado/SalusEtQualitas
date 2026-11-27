import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Card, Chip, Field, Loading, Muted, Notice, Screen, SectionLabel, Text, Title } from '@/components/ui';
import { Radius, Space, usePalette } from '@/constants/theme';
import { StatTile } from '@/features/dashboard/charts';
import {
  ago,
  brDate,
  fetchOverview,
  formatBytes,
  FREE_LIMITS,
  listPlans,
  money,
  STATUS_LABEL,
  STATUS_TONE,
  type Overview,
  type OverviewClinic,
  type Plan,
} from '@/features/platform/api';
import { NewClinicForm, slugify } from '@/features/platform/NewClinicForm';

type Filter = 'todas' | 'problemas' | 'atraso' | 'teste' | 'suspensas';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'problemas', label: 'Com problemas' },
  { key: 'atraso', label: 'Pagamento atrasado' },
  { key: 'teste', label: 'Em teste' },
  { key: 'suspensas', label: 'Suspensas/canceladas' },
];

/** Gerente do sistema: todas as clínicas, consumo do servidor, cobrança e saúde dos links. */
export default function AdminScreen() {
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('todas');
  const [response, setResponse] = useState<{ key: number; data?: Overview; plans?: Plan[]; error?: string }>();

  useEffect(() => {
    let active = true;
    Promise.all([fetchOverview(), listPlans()])
      .then(([data, plans]) => active && setResponse({ key: version, data, plans }))
      .catch((e: Error) => active && setResponse({ key: version, error: e.message }));
    return () => {
      active = false;
    };
  }, [version]);

  const data = response?.data;
  const filtered = useMemo(() => {
    const term = slugify(search);
    return (data?.clinics ?? []).filter((c) => {
      if (term && !slugify(c.name).includes(term) && !c.slug.includes(term)) return false;
      if (filter === 'problemas') return c.problems.length > 0;
      if (filter === 'atraso') return c.status === 'ativa' && c.days_overdue > 0;
      if (filter === 'teste') return c.status === 'teste';
      if (filter === 'suspensas') return c.status === 'suspensa' || c.status === 'cancelada';
      return true;
    });
  }, [data, search, filter]);

  return (
    <Screen wide safeTop={false}>
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Title>Clínicas e uso</Title>
          {data ? <Muted>Atualizado {new Date(data.generated_at).toLocaleTimeString('pt-BR').slice(0, 5)}</Muted> : null}
        </View>
        <Pressable accessibilityRole="button" onPress={() => setVersion((v) => v + 1)} hitSlop={8}>
          <Text style={{ fontWeight: '700' }}>↻ Atualizar</Text>
        </Pressable>
      </View>

      {response?.error ? (
        <Notice tone="danger">{response.error}</Notice>
      ) : !data ? (
        <Loading label="Carregando a visão geral…" />
      ) : (
        <>
          <Kpis data={data} />
          <ServerCard data={data} />

          <NewClinicForm
            plans={response?.plans ?? []}
            onCreated={(id) => {
              setVersion((v) => v + 1);
              router.push(`/painel/admin/clinica/${id}`);
            }}
          />

          <SectionLabel>Clínicas ({data.clinics.length})</SectionLabel>
          <View style={styles.chips}>
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </View>
          <Field label="Buscar" value={search} onChangeText={setSearch} placeholder="Nome ou link" />
          {filtered.length === 0 ? (
            <Muted>Nenhuma clínica encontrada.</Muted>
          ) : (
            filtered.map((item) => <ClinicRowCard key={item.id} item={item} />)
          )}
        </>
      )}
    </Screen>
  );
}

function Kpis({ data }: { data: Overview }) {
  const t = data.totals;
  const statusDetail = (['ativa', 'teste', 'suspensa', 'cancelada'] as const)
    .filter((s) => t.by_status[s])
    .map((s) => `${t.by_status[s]} ${STATUS_LABEL[s].toLowerCase()}`)
    .join(' · ');
  return (
    <View style={styles.tiles}>
      <StatTile label="Clínicas" value={String(t.clinics)} detail={statusDetail || undefined} />
      <StatTile label="Receita mensal prevista" value={money(t.mrr)} detail="Soma das clínicas ativas" />
      <StatTile label="Recebido neste mês" value={money(t.received_month)} />
      <StatTile
        label="Pagamentos atrasados"
        value={String(t.overdue)}
        detail={t.overdue ? `Suspende após ${data.grace_days} dias de atraso` : 'Nenhum atraso'}
        tone={t.overdue ? 'bad' : 'good'}
      />
      <StatTile
        label="Clínicas com problemas"
        value={String(t.with_problems)}
        tone={t.with_problems ? 'bad' : 'good'}
        detail={t.with_problems ? 'Veja os avisos na lista' : 'Tudo certo'}
      />
      <StatTile
        label="Agendamentos (30 dias)"
        value={String(t.appts_30d)}
        detail={`${t.portal_30d} pelo link · ${t.views_30d} acessos ao link`}
      />
    </View>
  );
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const c = usePalette();
  const pct = Math.min(used / limit, 1);
  const color = pct > 0.85 ? c.danger : pct > 0.6 ? c.warning : c.primary;
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.usageHead}>
        <Text style={{ color: c.text, fontWeight: '600', flex: 1 }}>{label}</Text>
        <Text style={{ color: c.text, fontWeight: '700' }}>
          {formatBytes(used)} <Text style={{ color: c.textMuted, fontWeight: '400' }}>de {formatBytes(limit)}</Text>
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: c.surfaceMuted }]}>
        <View style={[styles.fill, { width: `${Math.max(pct * 100, 1)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function ServerCard({ data }: { data: Overview }) {
  const t = data.totals;
  return (
    <Card>
      <SectionLabel>Consumo do servidor (Supabase)</SectionLabel>
      <UsageBar label="Banco de dados" used={t.db_bytes} limit={FREE_LIMITS.db_bytes} />
      <UsageBar label="Arquivos (fotos e logos)" used={t.storage_bytes} limit={FREE_LIMITS.storage_bytes} />
      <Muted style={{ fontSize: 13 }}>
        {t.users} logins cadastrados. Os limites mostrados são os do plano grátis do Supabase. Tráfego e chamadas da API
        aparecem no painel do Supabase, em Reports.
      </Muted>
    </Card>
  );
}

function ClinicRowCard({ item }: { item: OverviewClinic }) {
  const c = usePalette();
  const overdue = item.status === 'ativa' && item.days_overdue > 0;
  const billing =
    item.status === 'teste'
      ? `Teste até ${brDate(item.trial_ends_on)}`
      : item.next_due_date
        ? overdue
          ? `Vencido há ${item.days_overdue} ${item.days_overdue === 1 ? 'dia' : 'dias'} (${brDate(item.next_due_date)})`
          : `Vence ${brDate(item.next_due_date)}`
        : 'Sem vencimento';
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/painel/admin/clinica/${item.id}`)}>
      {({ pressed }) => (
        <Card style={[{ gap: Space.sm }, pressed && { opacity: 0.85 }]}>
          <View style={styles.rowTop}>
            <View style={{ flex: 1, minWidth: 180 }}>
              <Text style={[styles.name, { color: c.text }]}>{item.name}</Text>
              <Muted>/agendar/{item.slug}</Muted>
            </View>
            <Badge label={STATUS_LABEL[item.status]} tone={STATUS_TONE[item.status]} />
          </View>
          <Text style={{ color: overdue ? c.danger : c.textMuted, fontSize: 14, fontWeight: overdue ? '700' : '400' }}>
            {[
              item.plan_name ?? (item.price ? null : 'Sem plano'),
              // Módulos adicionais aparecem pelo nome: "+ Pacientes e prontuário".
              ...(item.modules ?? []).map((m) => `+ ${m.name}`),
              item.total_price ? `${money(item.total_price)}/mês` : null,
            ]
              .filter(Boolean)
              .join(' · ')}{' '}
            · {billing}
          </Text>
          <View style={styles.metrics}>
            <Metric label="Agend. 30 dias" value={item.appts_30d} />
            <Metric label="Pelo link" value={item.portal_30d} />
            <Metric label="Acessos ao link" value={item.views_30d} />
            <Metric label="Pacientes" value={item.contacts} />
            <Metric label="Profissionais" value={item.professionals} />
            <Metric label="Arquivos" value={formatBytes(item.storage_bytes)} />
          </View>
          <Muted style={{ fontSize: 13 }}>
            Último movimento {ago(item.last_activity)} · Equipe entrou {ago(item.last_sign_in)}
          </Muted>
          {item.problems.length ? (
            <View style={styles.chips}>
              {item.problems.map((p) => (
                <View key={p} style={[styles.problem, { backgroundColor: c.warningSoft }]}>
                  <Text style={{ color: c.warning, fontSize: 13, fontWeight: '600' }}>⚠ {p}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      )}
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  const c = usePalette();
  return (
    <View style={styles.metric}>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: c.textMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  usageHead: { flexDirection: 'row', alignItems: 'baseline', gap: Space.sm },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md, flexWrap: 'wrap' },
  name: { fontSize: 17, fontWeight: '700' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.lg },
  metric: { minWidth: 90 },
  problem: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
