import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type ScrollViewInstance,
} from 'react-native';

import { Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { minutesToHHMM, toLocal } from '@/lib/tz';

import { STATUS_COLOR, STATUS_LABEL, type AgendaAppointment, type AgendaEvent } from './api';
import { gaps, placeInLanes } from './layout';

export type GridColumn = {
  key: string;
  label: string;
  sublabel?: string;
  date: string;
  /** Coluna de um profissional (visão Dia). Nulo = todos (visão Semana). */
  professionalId: string | null;
  isToday?: boolean;
  /** Intervalos de expediente [início, fim) em minutos; o resto fica sombreado. */
  working: [number, number][];
  /** Pausas (sombra mais leve). */
  breaks: [number, number][];
};

const PX_PER_MIN = 1.1;
/** Hora em que o último arrasto terminou: o navegador dispara um "clique" ao soltar, que deve ser ignorado. */
let lastDragEnd = 0;
function markDragEnd() {
  lastDragEnd = Date.now();
}
function justDragged() {
  return Date.now() - lastDragEnd < 500;
}
const SNAP = 15;
const GUTTER = 52;

type Props = {
  columns: GridColumn[];
  appointments: AgendaAppointment[];
  events: AgendaEvent[];
  timeZone: string;
  startMin: number;
  endMin: number;
  minColumnWidth: number;
  colorFor: (professionalId: string) => string;
  nameFor: (professionalId: string) => string;
  procedureName: (procedureId: string) => string;
  showProfessionalName: boolean;
  dragEnabled: boolean;
  onPressSlot: (column: GridColumn, minutes: number) => void;
  onPressAppointment: (a: AgendaAppointment) => void;
  onPressEvent: (e: AgendaEvent) => void;
  onMove: (a: AgendaAppointment, column: GridColumn, minutes: number) => void;
};

export function TimeGrid(props: Props) {
  const { columns, startMin, endMin, minColumnWidth, timeZone } = props;
  const c = usePalette();
  const [colWidth, setColWidth] = useState(minColumnWidth);
  const height = (endMin - startMin) * PX_PER_MIN;
  const hours: number[] = [];
  for (let m = Math.ceil(startMin / 60) * 60; m < endMin; m += 60) hours.push(m);

  const [now, setNow] = useState(() => toLocal(new Date(), timeZone));
  useEffect(() => {
    const t = setInterval(() => setNow(toLocal(new Date(), timeZone)), 60_000);
    return () => clearInterval(t);
  }, [timeZone]);

  // Rola até perto da hora atual (ou do início do expediente) ao abrir.
  const scrollRef = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    const target = columns.some((col) => col.isToday) ? now.minutes - 60 : startMin;
    const y = Math.max(0, (Math.min(Math.max(target, startMin), endMin) - startMin) * PX_PER_MIN);
    const t = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 50);
    return () => clearTimeout(t);
    // Só ao trocar de período/coluna, não a cada minuto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.map((col) => col.key).join('|'), startMin]);

  return (
    <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }} showsHorizontalScrollIndicator>
      <View style={{ flex: 1, minWidth: GUTTER + columns.length * minColumnWidth }}>
        {/* Cabeçalho */}
        <View style={[styles.headerRow, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
          <View style={{ width: GUTTER }} />
          {columns.map((col) => (
            <View key={col.key} style={[styles.headerCell, { borderLeftColor: c.border }]}>
              <Text numberOfLines={1} style={[styles.headerLabel, { color: col.isToday ? c.primary : c.text }]}>
                {col.label}
              </Text>
              {col.sublabel ? (
                <Text numberOfLines={1} style={[styles.headerSub, { color: c.textMuted }]}>
                  {col.sublabel}
                </Text>
              ) : null}
              {eventsInColumn(props.events, col, timeZone, startMin, endMin)
                .filter((x) => x.start <= startMin && x.end >= endMin)
                .map(({ e }) => (
                  <Pressable key={e.id} accessibilityRole="button" onPress={() => props.onPressEvent(e)} hitSlop={4}>
                    <Text numberOfLines={1} style={[styles.headerEvent, { color: c.danger }]}>
                      ⛔ {e.title}
                    </Text>
                  </Pressable>
                ))}
            </View>
          ))}
        </View>

        <ScrollView ref={scrollRef} style={{ flex: 1 }} showsVerticalScrollIndicator>
          <View style={{ flexDirection: 'row', height }}>
            {/* Horas */}
            <View style={{ width: GUTTER }}>
              {hours.map((m) => (
                <Text key={m} style={[styles.hourLabel, { top: (m - startMin) * PX_PER_MIN - 7, color: c.textMuted }]}>
                  {minutesToHHMM(m)}
                </Text>
              ))}
            </View>

            <View style={{ flex: 1, flexDirection: 'row' }} onLayout={(e) => setColWidth(e.nativeEvent.layout.width / Math.max(columns.length, 1))}>
              {columns.map((col, index) => (
                <DayColumn
                  key={col.key}
                  {...props}
                  column={col}
                  index={index}
                  colWidth={colWidth}
                  height={height}
                  hours={hours}
                  nowMinutes={col.isToday ? now.minutes : null}
                />
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

/** Bloqueios que aparecem numa coluna, recortados à faixa de horas visível. */
function eventsInColumn(events: AgendaEvent[], column: GridColumn, timeZone: string, startMin: number, endMin: number) {
  return events
    .filter(
      (e) =>
        (column.professionalId === null || e.professional_id === null || e.professional_id === column.professionalId) &&
        toLocal(e.starts_at, timeZone).date <= column.date &&
        toLocal(e.ends_at, timeZone).date >= column.date,
    )
    .map((e) => {
      const s = toLocal(e.starts_at, timeZone);
      const en = toLocal(e.ends_at, timeZone);
      return {
        e,
        start: Math.max(s.date < column.date ? startMin : s.minutes, startMin),
        end: Math.min(en.date > column.date ? endMin : en.minutes, endMin),
      };
    })
    .filter((x) => x.end > x.start);
}

function DayColumn(
  props: Props & {
    column: GridColumn;
    index: number;
    colWidth: number;
    height: number;
    hours: number[];
    nowMinutes: number | null;
  },
) {
  const { column, startMin, endMin, timeZone, appointments, events, height, hours, nowMinutes } = props;
  const c = usePalette();
  const y = (m: number) => (m - startMin) * PX_PER_MIN;

  const inColumn = (a: AgendaAppointment) =>
    toLocal(a.starts_at, timeZone).date === column.date &&
    (column.professionalId === null || a.professional_id === column.professionalId);

  const placed = placeInLanes(
    appointments.filter(inColumn).map((a) => {
      const s = toLocal(a.starts_at, timeZone).minutes;
      const e = toLocal(a.ends_at, timeZone);
      return { item: a, start: s, end: e.date === column.date ? Math.max(e.minutes, s + 15) : 24 * 60 };
    }),
  );

  const columnEvents = eventsInColumn(events, column, timeZone, startMin, endMin);

  const onPressBackground = (ev: GestureResponderEvent) => {
    // Celular: locationY. Navegador: offsetY (o react-native-web não preenche locationY no clique).
    // Os desenhos dentro da coluna ignoram toques, então a posição é sempre relativa à coluna.
    const ne = ev.nativeEvent as unknown as { locationY?: number; offsetY?: number };
    const py = Number.isFinite(ne.locationY) ? ne.locationY! : Number.isFinite(ne.offsetY) ? ne.offsetY! : null;
    if (py === null) return;
    const minutes = startMin + Math.floor(py / PX_PER_MIN / SNAP) * SNAP;
    props.onPressSlot(column, Math.min(Math.max(minutes, startMin), endMin - SNAP));
  };

  return (
    <View style={[styles.column, { height, borderLeftColor: c.border }]}>
      <Pressable
        accessibilityLabel={`Agendar em ${column.label}`}
        style={StyleSheet.absoluteFill}
        onPress={onPressBackground}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {gaps(startMin, endMin, column.working).map(([s, e]) => (
            <View key={`off-${s}`} style={[styles.off, { top: y(s), height: (e - s) * PX_PER_MIN, backgroundColor: c.surfaceMuted }]} />
          ))}
          {column.breaks.map(([s, e]) => (
            <View key={`br-${s}`} style={[styles.off, { top: y(s), height: (e - s) * PX_PER_MIN, backgroundColor: c.surfaceMuted, opacity: 0.6 }]} />
          ))}
          {hours.map((m) => (
            <View key={m} style={[styles.hourLine, { top: y(m), backgroundColor: c.border }]} />
          ))}
        </View>
      </Pressable>

      {columnEvents.map(({ e, start, end }) => (
        <Pressable
          key={e.id}
          accessibilityRole="button"
          accessibilityLabel={`Bloqueio: ${e.title}`}
          onPress={() => props.onPressEvent(e)}
          style={[styles.event, { top: y(start), height: Math.max((end - start) * PX_PER_MIN, 18), borderColor: c.textMuted }]}>
          <Text numberOfLines={2} style={[styles.eventText, { color: c.textMuted }]}>
            ⛔ {e.title}
          </Text>
        </Pressable>
      ))}

      {placed.map((p) => (
        <AppointmentBlock
          key={p.item.id}
          {...props}
          a={p.item}
          top={y(p.start)}
          blockHeight={Math.max((p.end - p.start) * PX_PER_MIN - 2, 20)}
          leftPct={(p.lane / p.lanes) * 100}
          widthPct={100 / p.lanes}
          startMinutes={p.start}
        />
      ))}

      {nowMinutes !== null && nowMinutes >= startMin && nowMinutes <= endMin ? (
        <View pointerEvents="none" style={[styles.now, { top: y(nowMinutes) }]} />
      ) : null}
    </View>
  );
}

function AppointmentBlock(
  props: Props & {
    a: AgendaAppointment;
    column: GridColumn;
    index: number;
    colWidth: number;
    top: number;
    blockHeight: number;
    leftPct: number;
    widthPct: number;
    startMinutes: number;
  },
) {
  const { a, top, blockHeight, leftPct, widthPct, startMinutes, dragEnabled, colorFor } = props;
  const c = usePalette();
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const color = colorFor(a.professional_id);
  const cancelled = a.status === 'cancelado';
  const canDrag = dragEnabled && !cancelled && a.status !== 'concluido';

  const { columns, onMove, index, column, colWidth } = props;
  const responder = useMemo(
    () =>
      PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => setDrag({ dx: g.dx, dy: g.dy }),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, g) => {
        setDrag(null);
        markDragEnd();
        const deltaMin = Math.round(g.dy / PX_PER_MIN / SNAP) * SNAP;
        const deltaCol = Math.round(g.dx / Math.max(colWidth, 1));
        const target = columns[Math.min(Math.max(index + deltaCol, 0), columns.length - 1)];
        const minutes = Math.min(Math.max(startMinutes + deltaMin, 0), 24 * 60 - SNAP);
        if (deltaMin === 0 && target.key === column.key) return;
        onMove(a, target, minutes);
      },
      onPanResponderTerminate: () => {
        setDrag(null);
        markDragEnd();
      },
    }),
    [a, columns, onMove, index, column, colWidth, startMinutes],
  );

  const preview = drag
    ? (() => {
        const deltaMin = Math.round(drag.dy / PX_PER_MIN / SNAP) * SNAP;
        return minutesToHHMM(Math.min(Math.max(startMinutes + deltaMin, 0), 24 * 60 - SNAP));
      })()
    : null;

  const time = `${minutesToHHMM(startMinutes)}`;
  const procedure = props.procedureName(a.procedure_id);

  return (
    <View
      {...(canDrag ? responder.panHandlers : {})}
      style={[
        styles.block,
        {
          top,
          height: blockHeight,
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          backgroundColor: c.surface,
          borderLeftColor: color,
          opacity: cancelled ? 0.5 : 1,
          zIndex: drag ? 10 : 1,
          transform: drag ? [{ translateX: drag.dx }, { translateY: drag.dy }] : undefined,
        },
        drag && styles.dragging,
        Platform.OS === 'web' && canDrag ? ({ cursor: drag ? 'grabbing' : 'grab', userSelect: 'none' } as object) : null,
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${time} ${a.contact?.full_name ?? ''}, ${procedure}, ${STATUS_LABEL[a.status]}`}
        onPress={() => {
          if (justDragged()) return;
          props.onPressAppointment(a);
        }}
        style={[styles.blockInner, { backgroundColor: `${color}1F` }]}>
        <View style={styles.blockTop}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[a.status] }]} />
          <Text numberOfLines={1} style={[styles.blockTime, { color: c.text }]}>
            {preview ? `→ ${preview}` : time}
            {a.modality === 'residencial' ? ' 🏠' : ''}
          </Text>
        </View>
        <Text numberOfLines={blockHeight > 48 ? 2 : 1} style={[styles.blockName, { color: c.text, textDecorationLine: cancelled ? 'line-through' : 'none' }]}>
          {a.contact?.full_name ?? 'Paciente'}
        </Text>
        {blockHeight > 56 ? (
          <Text numberOfLines={1} style={[styles.blockSub, { color: c.textMuted }]}>
            {procedure}
            {props.showProfessionalName ? ` · ${props.nameFor(a.professional_id)}` : ''}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  headerCell: {
    flex: 1,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.xs,
    alignItems: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  headerLabel: { fontSize: 14, fontWeight: '700' },
  headerSub: { fontSize: 12 },
  headerEvent: { fontSize: 12, fontWeight: '700' },
  hourLabel: { position: 'absolute', right: 6, fontSize: 11 },
  column: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, position: 'relative' },
  off: { position: 'absolute', left: 0, right: 0 },
  hourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  event: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 6,
    padding: 4,
    backgroundColor: 'rgba(100,116,139,0.12)',
  },
  eventText: { fontSize: 12, fontWeight: '600' },
  block: { position: 'absolute', paddingHorizontal: 1, borderLeftWidth: 4, borderRadius: 6, overflow: 'hidden' },
  blockInner: { flex: 1, paddingHorizontal: 5, paddingVertical: 3, gap: 1 },
  blockTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  blockTime: { fontSize: 11, fontWeight: '700' },
  blockName: { fontSize: 12, fontWeight: '600' },
  blockSub: { fontSize: 11 },
  dragging: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  now: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: '#DC2626' },
});
