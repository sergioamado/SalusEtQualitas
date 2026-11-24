import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Muted, Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';

/** Número de destaque (KPI). */
export function StatTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  const c = usePalette();
  return (
    <Card style={styles.tile}>
      <Text style={[styles.tileLabel, { color: c.textMuted }]}>{label}</Text>
      <Text style={[styles.tileValue, { color: c.text }]}>{value}</Text>
      {detail ? (
        <Text style={[styles.tileDetail, { color: tone === 'good' ? c.success : tone === 'bad' ? c.danger : c.textMuted }]}>
          {detail}
        </Text>
      ) : null}
    </Card>
  );
}

export function ChartCard({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  const c = usePalette();
  return (
    <Card style={styles.chartCard}>
      <View style={styles.chartHead}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.chartTitle, { color: c.text }]}>{title}</Text>
          {subtitle ? <Muted style={{ fontSize: 13 }}>{subtitle}</Muted> : null}
        </View>
        {action}
      </View>
      {children}
    </Card>
  );
}

/**
 * Barras horizontais com rótulo e valor escritos (a cor nunca é a única pista).
 * Uma série só: todas as barras com a mesma cor, salvo quando cada item tem cor própria (ex.: situação).
 */
export function BarList({
  items,
  color,
  format = (n) => String(n),
  empty = 'Sem dados no período.',
}: {
  items: { label: string; value: number; color?: string; hint?: string; display?: string }[];
  color: string;
  format?: (n: number) => string;
  empty?: string;
}) {
  const c = usePalette();
  if (!items.length || items.every((i) => i.value === 0 && !i.display)) return <Muted>{empty}</Muted>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <View style={{ gap: Space.sm }}>
      {items.map((i) => (
        <View key={i.label} accessible accessibilityLabel={`${i.label}: ${i.display ?? format(i.value)}`} style={{ gap: 3 }}>
          <View style={styles.barLabelRow}>
            <Text numberOfLines={1} style={[styles.barLabel, { color: c.text }]}>
              {i.label}
              {i.hint ? <Text style={{ color: c.textMuted, fontWeight: '400' }}> · {i.hint}</Text> : null}
            </Text>
            <Text style={[styles.barValue, { color: c.text }]}>{i.display ?? format(i.value)}</Text>
          </View>
          <View style={[styles.track, { backgroundColor: c.surfaceMuted }]}>
            <View
              style={[
                styles.bar,
                { width: `${Math.max((i.value / max) * 100, i.value > 0 ? 2 : 0)}%`, backgroundColor: i.color ?? color },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Colunas por período. Passe o mouse (web) ou toque numa coluna para ver o valor;
 * "Ver tabela" mostra os números de todas.
 */
export function ColumnChart({
  items,
  color,
  unit,
}: {
  items: { key: string; label: string; long: string; value: number }[];
  color: string;
  unit: (n: number) => string;
}) {
  const c = usePalette();
  const [active, setActive] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  if (!items.length) return <Muted>Sem dados no período.</Muted>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((s, i) => s + i.value, 0);
  const current = items.find((i) => i.key === active);
  const showEvery = items.length <= 10 ? 1 : items.length <= 20 ? 2 : Math.ceil(items.length / 8);
  const HEIGHT = 150;

  return (
    <View style={{ gap: Space.sm }}>
      <Text style={[styles.readout, { color: current ? c.text : c.textMuted }]}>
        {current ? `${current.long}: ${unit(current.value)}` : `Total: ${unit(total)} · toque numa coluna para ver o valor`}
      </Text>

      {table ? (
        <View style={{ gap: 2 }}>
          {items.map((i) => (
            <View key={i.key} style={[styles.tableRow, { borderBottomColor: c.border }]}>
              <Text style={{ color: c.text, flex: 1 }}>{i.long}</Text>
              <Text style={{ color: c.text, fontWeight: '700' }}>{i.value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View>
          <View style={[styles.columns, { height: HEIGHT, borderBottomColor: c.border }]}>
            {/* Linha de referência no meio, discreta */}
            {max >= 2 ? (
              <>
                <View style={[styles.gridLine, { bottom: (HEIGHT - 16) / 2, backgroundColor: c.border }]} />
                <Text style={[styles.gridLabel, { bottom: (HEIGHT - 16) / 2 + 2, color: c.textMuted }]}>
                  {Number.isInteger(max / 2) ? max / 2 : (max / 2).toFixed(1).replace('.', ',')}
                </Text>
              </>
            ) : null}
            <Text style={[styles.gridLabel, { top: 0, color: c.textMuted }]}>{max}</Text>
            {items.map((i) => {
              const h = (i.value / max) * (HEIGHT - 16);
              const on = active === i.key;
              return (
                <Pressable
                  key={i.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${i.long}: ${unit(i.value)}`}
                  onPress={() => setActive(on ? null : i.key)}
                  onHoverIn={() => setActive(i.key)}
                  onHoverOut={() => setActive((k) => (k === i.key ? null : k))}
                  style={styles.colHit}>
                  <View
                    style={[
                      styles.col,
                      {
                        height: Math.max(h, i.value > 0 ? 3 : 0),
                        backgroundColor: color,
                        opacity: active && !on ? 0.45 : 1,
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
          <View style={styles.colLabels}>
            {items.map((i, idx) => (
              <Text key={i.key} numberOfLines={1} style={[styles.colLabel, { color: c.textMuted }]}>
                {idx % showEvery === 0 ? i.label : ''}
              </Text>
            ))}
          </View>
        </View>
      )}

      <Pressable accessibilityRole="button" onPress={() => setTable((v) => !v)} hitSlop={6}>
        <Text style={[styles.link, { color: c.primary }]}>{table ? 'Ver gráfico' : 'Ver tabela'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: 180, gap: 2 },
  tileLabel: { fontSize: 13, fontWeight: '600' },
  tileValue: { fontSize: 30, fontWeight: '700', lineHeight: 36 },
  tileDetail: { fontSize: 13 },
  chartCard: { flexGrow: 1, flexBasis: 320, gap: Space.md },
  chartHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  chartTitle: { fontSize: 16, fontWeight: '700' },
  barLabelRow: { flexDirection: 'row', alignItems: 'baseline', gap: Space.sm },
  barLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  barValue: { fontSize: 14, fontWeight: '700' },
  track: { height: 10, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 10, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  readout: { fontSize: 14, fontWeight: '600', minHeight: 20 },
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1, paddingLeft: 24 },
  gridLine: { position: 'absolute', left: 24, right: 0, height: StyleSheet.hairlineWidth },
  gridLabel: { position: 'absolute', left: 0, fontSize: 10 },
  colHit: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  col: { width: '80%', maxWidth: 36, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  colLabels: { flexDirection: 'row', gap: 2, paddingLeft: 24, marginTop: 4 },
  colLabel: { flex: 1, fontSize: 10, textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  link: { fontSize: 14, fontWeight: '600' },
});
