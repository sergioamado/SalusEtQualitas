import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Chip, Field, Loading, Muted, Notice, SectionLabel, Text } from '@/components/ui';
import { MaxPanelWidth, Radius, Space, usePalette } from '@/constants/theme';
import { useClinic } from '@/features/panel/clinic-context';
import { useAuth } from '@/lib/auth';
import { addDays, dayAndMonth, formatDateLong, formatTime, onlyDigits, weekdayShort } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { fromLocal, hhmmToMinutes, startOfWeek, toLocal, weekdayOf } from '@/lib/tz';

import {
  loadRange,
  loadSetup,
  saveAppointment,
  SaveError,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_ORDER,
  type AgendaAppointment,
  type AgendaEvent,
  type AgendaSetup,
  type Status,
} from './api';
import { AppointmentDetail } from './AppointmentDetail';
import { AppointmentForm, type FormInitial } from './AppointmentForm';
import { EventForm } from './EventForm';
import { TimeGrid, type GridColumn } from './TimeGrid';

type View_ = 'day' | 'week' | 'list';
const DEFAULT_STATUSES: Status[] = ['reservado', 'agendado', 'confirmado', 'concluido', 'nao_compareceu'];
const FALLBACK_COLORS = ['#0E7C74', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#CA8A04', '#16A34A', '#475569'];

type Filters = {
  statuses: Status[];
  professionalIds: string[];
  procedureId: string | null;
  roomId: string | null;
  patient: string;
};

export function AgendaScreen() {
  const { clinic, role } = useClinic();
  const { session } = useAuth();
  const c = usePalette();
  const tz = clinic.timezone;
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const today = toLocal(new Date(), tz).date;

  const [view, setView] = useState<View_>(wide ? 'week' : 'day');
  const [anchor, setAnchor] = useState(today);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);

  // Cadastros (profissionais, serviços, horários). As abas usam router.replace,
  // então voltar de "Profissionais e horários" recarrega esta tela do zero.
  const setupKey = clinic.id;
  const [setupRes, setSetupRes] = useState<{ key: string; data?: AgendaSetup; error?: string }>();
  useEffect(() => {
    let active = true;
    loadSetup(clinic.id)
      .then((data) => active && setSetupRes({ key: setupKey, data }))
      .catch((e: Error) => active && setSetupRes({ key: setupKey, error: e.message }));
    return () => {
      active = false;
    };
  }, [clinic.id, setupKey]);
  const setup = setupRes?.data;

  // Período visível
  const first = view === 'day' ? anchor : startOfWeek(anchor);
  const days = view === 'day' ? 1 : 7;
  const last = addDays(first, days);

  const [version, setVersion] = useState(0);
  const rangeKey = `${clinic.id}|${first}|${last}|${version}`;
  const [rangeRes, setRangeRes] = useState<{
    key: string;
    data?: Awaited<ReturnType<typeof loadRange>>;
    error?: string;
  }>();
  useEffect(() => {
    let active = true;
    loadRange(clinic.id, tz, first, last)
      .then((data) => active && setRangeRes({ key: rangeKey, data }))
      .catch((e: Error) => active && setRangeRes({ key: rangeKey, error: e.message }));
    return () => {
      active = false;
    };
  }, [clinic.id, tz, first, last, rangeKey]);
  // Mantém os dados anteriores na tela enquanto recarrega (sem "piscar").
  const range = rangeRes?.data;

  // RNF03: tempo real — qualquer mudança (inclusive do link público) atualiza a agenda.
  // COMO FUNCIONA: abrimos um "canal" com o Supabase Realtime e pedimos "me avise
  // quando mudar algo nestas tabelas, só desta clínica". A cada aviso, aumentamos
  // `version`, o que faz a agenda buscar os dados de novo.
  // DEBOUNCE: se chegarem 10 avisos seguidos (ex.: arrastar vários horários),
  // esperamos 300 ms de silêncio e recarregamos UMA vez só, em vez de 10.
  // useRef guarda o temporizador sem redesenhar a tela.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bump = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => setVersion((v) => v + 1), 300);
    };
    const channel = supabase
      .channel(`agenda-${clinic.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${clinic.id}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_events', filter: `clinic_id=eq.${clinic.id}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist', filter: `clinic_id=eq.${clinic.id}` }, bump)
      .subscribe();
    // Limpeza ao sair da tela: fecha o canal (senão ficaria escutando para sempre).
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      supabase.removeChannel(channel);
    };
  }, [clinic.id]);

  // Janelas
  const [detail, setDetail] = useState<AgendaAppointment | null>(null);
  const [form, setForm] = useState<FormInitial | null>(null);
  const [eventForm, setEventForm] = useState<{ event?: AgendaEvent; initial?: { date: string; minutes?: number; professionalId?: string | null } } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ a: AgendaAppointment; professionalId: string; startsAt: string; text: string } | null>(null);
  const [moving, setMoving] = useState(false);

  const myProfessional = setup?.professionals.find((p) => p.user_id && p.user_id === session?.user.id) ?? null;
  // Filtro padrão: quem é profissional (e não gerente) abre na própria agenda.
  const effectiveFilters: Filters = filters ?? {
    statuses: DEFAULT_STATUSES,
    professionalIds: myProfessional && role === 'profissional' ? [myProfessional.id] : [],
    procedureId: null,
    roomId: null,
    patient: '',
  };
  const setF = (patch: Partial<Filters>) => setFilters({ ...effectiveFilters, ...patch });

  const colorFor = useMemo(() => {
    const map = new Map<string, string>();
    (setup?.professionals ?? []).forEach((p, i) => map.set(p.id, p.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]));
    return (id: string) => map.get(id) ?? '#94A3B8';
  }, [setup]);

  if (!setup) {
    return (
      <View style={[styles.flex, { backgroundColor: c.background }]}>
        {setupRes?.error ? <Notice tone="danger">{setupRes.error}</Notice> : <Loading label="Carregando agenda…" />}
      </View>
    );
  }

  const visiblePros = setup.professionals.filter(
    (p) => p.active && (effectiveFilters.professionalIds.length === 0 || effectiveFilters.professionalIds.includes(p.id)),
  );
  const visibleIds = new Set(visiblePros.map((p) => p.id));

  const term = effectiveFilters.patient.trim().toLowerCase();
  const termDigits = onlyDigits(term);
  const appointments = (range?.appointments ?? []).filter(
    (a) =>
      effectiveFilters.statuses.includes(a.status) &&
      (effectiveFilters.professionalIds.length === 0 || effectiveFilters.professionalIds.includes(a.professional_id)) &&
      (!effectiveFilters.procedureId || a.procedure_id === effectiveFilters.procedureId) &&
      (!effectiveFilters.roomId || a.room_id === effectiveFilters.roomId) &&
      (!term ||
        (a.contact?.full_name ?? '').toLowerCase().includes(term) ||
        (termDigits.length >= 3 && (a.contact?.phone ?? '').includes(termDigits))),
  );
  const events = (range?.events ?? []).filter(
    (e) => e.professional_id === null || effectiveFilters.professionalIds.length === 0 || effectiveFilters.professionalIds.includes(e.professional_id),
  );

  const toRanges = (rows: { start_time: string; end_time: string }[]) =>
    rows.map((r) => [hhmmToMinutes(r.start_time.slice(0, 5)), hhmmToMinutes(r.end_time.slice(0, 5))] as [number, number]);
  const hoursOf = (profId: string, weekday: number) => toRanges(setup.hours.filter((h) => h.professional_id === profId && h.weekday === weekday));
  const breaksOf = (profId: string, weekday: number) => toRanges(setup.breaks.filter((h) => h.professional_id === profId && h.weekday === weekday));

  // Colunas
  let columns: GridColumn[] = [];
  if (view === 'day') {
    const wd = weekdayOf(anchor);
    columns = visiblePros.map((p) => ({
      key: `${anchor}|${p.id}`,
      label: p.name,
      date: anchor,
      professionalId: p.id,
      isToday: anchor === today,
      working: hoursOf(p.id, wd),
      breaks: breaksOf(p.id, wd),
    }));
  } else if (view === 'week') {
    for (let i = 0; i < 7; i++) {
      const date = addDays(first, i);
      const wd = weekdayOf(date);
      const working = visiblePros.flatMap((p) => hoursOf(p.id, wd));
      const busy = appointments.some((a) => toLocal(a.starts_at, tz).date === date);
      // Sábado e domingo só aparecem se alguém atende ou há agendamentos.
      if ((wd === 0 || wd === 6) && working.length === 0 && !busy) continue;
      const dm = dayAndMonth(date);
      columns.push({
        key: date,
        label: `${weekdayShort(date)} ${dm.day}`,
        sublabel: dm.month,
        date,
        professionalId: null,
        isToday: date === today,
        working,
        breaks: visiblePros.length === 1 ? breaksOf(visiblePros[0].id, wd) : [],
      });
    }
  }

  // Faixa de horas visível: expediente ±1h, incluindo agendamentos fora dele.
  const allWorking = columns.flatMap((col) => col.working);
  const apptMinutes = appointments.flatMap((a) => [toLocal(a.starts_at, tz).minutes, toLocal(a.ends_at, tz).minutes || 24 * 60]);
  const minStart = Math.min(...allWorking.map((w) => w[0]), ...apptMinutes, 8 * 60);
  const maxEnd = Math.max(...allWorking.map((w) => w[1]), ...apptMinutes, 18 * 60);
  const startMin = Math.max(0, Math.floor(minStart / 60) * 60 - 60);
  const endMin = Math.min(24 * 60, Math.ceil(maxEnd / 60) * 60 + 60);

  const step = view === 'day' ? 1 : 7;
  const periodLabel =
    view === 'day'
      ? wide
        ? capitalize(formatDateLong(anchor))
        : `${capitalize(weekdayShort(anchor))}, ${dayAndMonth(anchor).day} ${dayAndMonth(anchor).month}`
      : `${dayAndMonth(first).day} ${dayAndMonth(first).month} – ${dayAndMonth(addDays(first, 6)).day} ${dayAndMonth(addDays(first, 6)).month}`;

  const refresh = (text?: string) => {
    if (text) setMessage({ tone: 'success', text });
    setVersion((v) => v + 1);
  };

  const doMove = async (a: AgendaAppointment, professionalId: string, startsAt: string, force: boolean) => {
    setMoving(true);
    try {
      await saveAppointment({ id: a.id, clinic_id: clinic.id, professional_id: professionalId, starts_at: startsAt, force });
      setPendingMove(null);
      refresh(`Remarcado para ${formatDateLong(toLocal(startsAt, tz).date)} às ${formatTime(startsAt, tz)}.`);
    } catch (e) {
      if (e instanceof SaveError && e.soft) setPendingMove({ a, professionalId, startsAt, text: e.message });
      else {
        setPendingMove(null);
        setMessage({ tone: 'danger', text: `Não foi possível remarcar: ${(e as Error).message}` });
        setVersion((v) => v + 1);
      }
    } finally {
      setMoving(false);
    }
  };

  const activeFilterCount =
    (effectiveFilters.statuses.length !== DEFAULT_STATUSES.length || effectiveFilters.statuses.some((s) => !DEFAULT_STATUSES.includes(s)) ? 1 : 0) +
    (effectiveFilters.professionalIds.length ? 1 : 0) +
    (effectiveFilters.procedureId ? 1 : 0) +
    (effectiveFilters.roomId ? 1 : 0) +
    (term ? 1 : 0);

  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: c.background }]}>
      {/* Barra superior */}
      <View style={[styles.toolbarWrap, { borderBottomColor: c.border }]}>
        <View style={styles.toolbar}>
          <View style={styles.nav}>
            <NavButton label="‹" accessibilityLabel="Anterior" onPress={() => setAnchor(addDays(anchor, -step))} />
            <Button label="Hoje" variant="secondary" onPress={() => setAnchor(today)} />
            <NavButton label="›" accessibilityLabel="Próximo" onPress={() => setAnchor(addDays(anchor, step))} />
            <Text style={[styles.period, { color: c.text }]} numberOfLines={1}>
              {periodLabel}
            </Text>
          </View>
          <View style={styles.nav}>
            <Segmented
              value={view}
              options={[
                { key: 'day', label: 'Dia' },
                { key: 'week', label: 'Semana' },
                { key: 'list', label: 'Lista' },
              ]}
              onChange={(v) => setView(v as View_)}
            />
          </View>
        </View>
        <View style={styles.toolbar}>
          <View style={styles.nav}>
            <Button
              label="+ Agendar"
              onPress={() => setForm({ date: anchor, professionalId: visiblePros.length === 1 ? visiblePros[0].id : null })}
            />
            <Button label="+ Bloqueio" variant="secondary" onPress={() => setEventForm({ initial: { date: anchor } })} />
          </View>
          <View style={styles.nav}>
            <Pressable accessibilityRole="button" onPress={() => router.push(`/painel/${clinic.id}/espera` as never)} hitSlop={6}>
              <Text style={[styles.link, { color: c.primary }]}>
                Lista de espera{range?.waitlistCount ? ` (${range.waitlistCount})` : ''}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setShowFilters((v) => !v)} hitSlop={6}>
              <Text style={[styles.link, { color: c.primary }]}>
                Filtros{activeFilterCount ? ` (${activeFilterCount})` : ''} {showFilters ? '▴' : '▾'}
              </Text>
            </Pressable>
          </View>
        </View>

        {showFilters ? <FiltersPanel setup={setup} filters={effectiveFilters} onChange={setF} onReset={() => setFilters(null)} /> : null}

        {message ? (
          <Pressable onPress={() => setMessage(null)} style={styles.message}>
            <Notice tone={message.tone}>{message.text} (toque para fechar)</Notice>
          </Pressable>
        ) : null}
        {rangeRes?.error ? <Notice tone="danger">{rangeRes.error}</Notice> : null}
        {setup.professionals.filter((p) => p.active).length === 0 ? (
          <Notice tone="warning">
            Nenhum profissional cadastrado. Vá em “Profissionais e horários” (se você mesmo atende, toque em “Sim, eu atendo”).
          </Notice>
        ) : null}
      </View>

      {!range ? (
        <Loading label="Carregando agendamentos…" />
      ) : view === 'list' ? (
        <AgendaList
          first={first}
          days={7}
          tz={tz}
          today={today}
          appointments={appointments}
          events={events}
          setup={setup}
          colorFor={colorFor}
          onPress={setDetail}
          onPressEvent={(e) => setEventForm({ event: e })}
        />
      ) : columns.length === 0 ? (
        <Muted style={{ padding: Space.lg }}>Nenhum profissional para mostrar com os filtros atuais.</Muted>
      ) : (
        <TimeGrid
          columns={columns}
          appointments={appointments}
          events={events}
          timeZone={tz}
          startMin={startMin}
          endMin={endMin}
          minColumnWidth={view === 'day' ? 160 : 120}
          colorFor={colorFor}
          nameFor={(id) => setup.professionals.find((p) => p.id === id)?.name ?? ''}
          procedureName={(id) => setup.procedures.find((p) => p.id === id)?.name ?? ''}
          showProfessionalName={view === 'week' && visibleIds.size > 1}
          dragEnabled={Platform.OS === 'web'}
          onPressSlot={(col, minutes) =>
            setForm({ date: col.date, minutes, professionalId: col.professionalId ?? (visiblePros.length === 1 ? visiblePros[0].id : null) })
          }
          onPressAppointment={setDetail}
          onPressEvent={(e) => setEventForm({ event: e })}
          onMove={(a, col, minutes) => doMove(a, col.professionalId ?? a.professional_id, fromLocal(col.date, minutes, tz), false)}
        />
      )}

      {view !== 'list' && Platform.OS === 'web' ? (
        <Muted style={styles.hint}>Dica: clique num horário vazio para agendar; arraste um agendamento para remarcar.</Muted>
      ) : view !== 'list' ? (
        <Muted style={styles.hint}>Toque num horário vazio para agendar, ou num agendamento para ver e remarcar.</Muted>
      ) : null}

      {/* Janelas */}
      {detail ? (
        <AppointmentDetail
          clinicId={clinic.id}
          timeZone={tz}
          setup={setup}
          appointment={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setForm({ appointment: detail });
            setDetail(null);
          }}
          onChanged={(text) => {
            setDetail(null);
            refresh(text);
          }}
          onOpenWaitlist={() => {
            setDetail(null);
            router.push(`/painel/${clinic.id}/espera` as never);
          }}
        />
      ) : null}

      {form ? (
        <AppointmentForm
          clinicId={clinic.id}
          timeZone={tz}
          setup={setup}
          initial={form}
          onClose={(saved) => {
            setForm(null);
            if (saved) refresh(saved.message);
          }}
        />
      ) : null}

      {eventForm ? (
        <EventForm
          clinicId={clinic.id}
          timeZone={tz}
          setup={setup}
          event={eventForm.event}
          initial={eventForm.initial}
          onClose={(text) => {
            setEventForm(null);
            if (text) refresh(text);
          }}
        />
      ) : null}

      <Modal visible={!!pendingMove} transparent animationType="fade" onRequestClose={() => setPendingMove(null)}>
        {pendingMove ? (
          <View style={styles.confirmWrap}>
            <View style={[styles.confirm, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={styles.confirmTitle}>Encaixar neste horário?</Text>
              <Muted>
                {pendingMove.text} Novo horário: {formatDateLong(toLocal(pendingMove.startsAt, tz).date)} às{' '}
                {formatTime(pendingMove.startsAt, tz)}.
              </Muted>
              <Button
                label="Sim, encaixar"
                loading={moving}
                onPress={() => doMove(pendingMove.a, pendingMove.professionalId, pendingMove.startsAt, true)}
              />
              <Button label="Não, deixar como estava" variant="secondary" onPress={() => setPendingMove(null)} />
            </View>
          </View>
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

/** "terça-feira, 24 de novembro" -> "Terça-feira, 24 de novembro" */
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function NavButton({ label, accessibilityLabel, onPress }: { label: string; accessibilityLabel: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.navBtn, { borderColor: c.border, backgroundColor: pressed ? c.surfaceMuted : c.surface }]}>
      <Text style={[styles.navText, { color: c.text }]}>{label}</Text>
    </Pressable>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: { key: string; label: string }[]; onChange: (k: string) => void }) {
  const c = usePalette();
  return (
    <View style={[styles.segmented, { borderColor: c.border }]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.key)}
            style={[styles.segment, { backgroundColor: active ? c.primary : 'transparent' }]}>
            <Text style={{ color: active ? c.primaryText : c.text, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FiltersPanel({
  setup,
  filters,
  onChange,
  onReset,
}: {
  setup: AgendaSetup;
  filters: Filters;
  onChange: (p: Partial<Filters>) => void;
  onReset: () => void;
}) {
  const c = usePalette();
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <View style={[styles.filters, { borderColor: c.border, backgroundColor: c.surface }]}>
      <Field
        label="Paciente"
        value={filters.patient}
        onChangeText={(patient) => onChange({ patient })}
        placeholder="Nome ou telefone"
        autoCorrect={false}
      />
      <SectionLabel>Situação</SectionLabel>
      <View style={styles.chips}>
        {STATUS_ORDER.map((s) => (
          <Chip key={s} label={STATUS_LABEL[s]} selected={filters.statuses.includes(s)} onPress={() => onChange({ statuses: toggle(filters.statuses, s) })} />
        ))}
      </View>
      {setup.professionals.filter((p) => p.active).length > 1 ? (
        <>
          <SectionLabel>Profissional</SectionLabel>
          <View style={styles.chips}>
            <Chip label="Todos" selected={filters.professionalIds.length === 0} onPress={() => onChange({ professionalIds: [] })} />
            {setup.professionals
              .filter((p) => p.active)
              .map((p) => (
                <Chip key={p.id} label={p.name} selected={filters.professionalIds.includes(p.id)} onPress={() => onChange({ professionalIds: toggle(filters.professionalIds, p.id) })} />
              ))}
          </View>
        </>
      ) : null}
      <SectionLabel>Serviço</SectionLabel>
      <View style={styles.chips}>
        <Chip label="Todos" selected={!filters.procedureId} onPress={() => onChange({ procedureId: null })} />
        {setup.procedures
          .filter((p) => p.active)
          .map((p) => (
            <Chip key={p.id} label={p.name} selected={filters.procedureId === p.id} onPress={() => onChange({ procedureId: filters.procedureId === p.id ? null : p.id })} />
          ))}
      </View>
      {setup.rooms.length ? (
        <>
          <SectionLabel>Sala</SectionLabel>
          <View style={styles.chips}>
            <Chip label="Todas" selected={!filters.roomId} onPress={() => onChange({ roomId: null })} />
            {setup.rooms.map((r) => (
              <Chip key={r.id} label={r.name} selected={filters.roomId === r.id} onPress={() => onChange({ roomId: filters.roomId === r.id ? null : r.id })} />
            ))}
          </View>
        </>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onReset} hitSlop={6}>
        <Text style={[styles.link, { color: c.primary }]}>Limpar filtros</Text>
      </Pressable>
    </View>
  );
}

function AgendaList({
  first,
  days,
  tz,
  today,
  appointments,
  events,
  setup,
  colorFor,
  onPress,
  onPressEvent,
}: {
  first: string;
  days: number;
  tz: string;
  today: string;
  appointments: AgendaAppointment[];
  events: AgendaEvent[];
  setup: AgendaSetup;
  colorFor: (id: string) => string;
  onPress: (a: AgendaAppointment) => void;
  onPressEvent: (e: AgendaEvent) => void;
}) {
  const c = usePalette();
  const dates = Array.from({ length: days }, (_, i) => addDays(first, i));
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {dates.map((date) => {
        const items = appointments.filter((a) => toLocal(a.starts_at, tz).date === date);
        const dayEvents = events.filter((e) => toLocal(e.starts_at, tz).date <= date && toLocal(e.ends_at, tz).date >= date && !(toLocal(e.ends_at, tz).date === date && toLocal(e.ends_at, tz).minutes === 0));
        return (
          <View key={date} style={{ gap: Space.xs }}>
            <Text style={[styles.listDay, { color: date === today ? c.primary : c.text }]}>
              {capitalize(formatDateLong(date))}
              {date === today ? ' · hoje' : ''}
            </Text>
            {dayEvents.map((e) => (
              <Pressable key={e.id} onPress={() => onPressEvent(e)} style={[styles.listEvent, { borderColor: c.border }]}>
                <Muted>
                  ⛔ {e.title}
                  {e.professional_id ? ` · ${setup.professionals.find((p) => p.id === e.professional_id)?.name ?? ''}` : ' · clínica inteira'}
                </Muted>
              </Pressable>
            ))}
            {items.length === 0 && dayEvents.length === 0 ? <Muted>Nenhum agendamento.</Muted> : null}
            {items.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="button"
                onPress={() => onPress(a)}
                style={({ pressed }) => [
                  styles.listItem,
                  { borderColor: c.border, borderLeftColor: colorFor(a.professional_id), backgroundColor: pressed ? c.surfaceMuted : c.surface },
                ]}>
                <Text style={[styles.listTime, { color: c.text }]}>{formatTime(a.starts_at, tz)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: c.text, textDecorationLine: a.status === 'cancelado' ? 'line-through' : 'none' }}>
                    {a.contact?.full_name ?? 'Paciente'}
                    {a.modality === 'residencial' ? ' 🏠' : ''}
                  </Text>
                  <Muted>
                    {setup.procedures.find((p) => p.id === a.procedure_id)?.name ?? ''} ·{' '}
                    {setup.professionals.find((p) => p.id === a.professional_id)?.name ?? ''}
                  </Muted>
                </View>
                <Badge label={STATUS_LABEL[a.status]} tone={a.status === 'reservado' ? 'warning' : a.status === 'confirmado' ? 'success' : a.status === 'nao_compareceu' ? 'danger' : 'neutral'} />
                <View style={[styles.dot, { backgroundColor: STATUS_COLOR[a.status] }]} />
              </Pressable>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  toolbarWrap: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: Space.sm },
  toolbar: {
    width: '100%',
    maxWidth: MaxPanelWidth + 400,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
  },
  nav: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexWrap: 'wrap' },
  navBtn: { width: 40, height: 40, borderWidth: 1, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  navText: { fontSize: 22, fontWeight: '700', lineHeight: 24 },
  period: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: Radius.md, overflow: 'hidden' },
  segment: { paddingHorizontal: Space.md, paddingVertical: Space.sm },
  link: { fontSize: 15, fontWeight: '600' },
  filters: {
    marginHorizontal: Space.lg,
    marginTop: Space.sm,
    padding: Space.md,
    gap: Space.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    maxWidth: MaxPanelWidth,
    alignSelf: 'center',
    width: '100%',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  message: { paddingHorizontal: Space.lg, paddingTop: Space.sm, maxWidth: MaxPanelWidth, alignSelf: 'center', width: '100%' },
  hint: { fontSize: 12, textAlign: 'center', paddingVertical: 4 },
  list: { padding: Space.lg, gap: Space.lg, maxWidth: MaxPanelWidth, alignSelf: 'center', width: '100%' },
  listDay: { fontSize: 16, fontWeight: '700' },
  listEvent: { borderWidth: 1, borderStyle: 'dashed', borderRadius: Radius.md, padding: Space.sm },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: Space.md, borderWidth: 1, borderLeftWidth: 5, borderRadius: Radius.md, padding: Space.md },
  listTime: { fontSize: 16, fontWeight: '700', width: 52 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  confirmWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: Space.lg },
  confirm: { width: '100%', maxWidth: 440, borderWidth: 1, borderRadius: Radius.lg, padding: Space.lg, gap: Space.sm },
  confirmTitle: { fontSize: 18, fontWeight: '700' },
});
