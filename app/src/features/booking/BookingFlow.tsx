import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  Loading,
  Muted,
  Notice,
  OptionCard,
  Screen,
  SectionLabel,
  SummaryRow,
  Text,
  Title,
} from '@/components/ui';
import { Radius, Space, usePalette } from '@/constants/theme';
import {
  addDays,
  dayAndMonth,
  formatDateLong,
  formatDateTimeLong,
  formatTime,
  todayInTimeZone,
  weekdayShort,
} from '@/lib/format';

import {
  BookingError,
  fetchSlots,
  type BookingResult,
  type Modality,
  type PublicClinic,
  type PublicProcedure,
  type Slot,
} from './api';
import { ClinicHero } from './ClinicHero';
import { DetailsStep } from './DetailsStep';
import { ServiceOption } from './ServiceOption';

type Step = 'service' | 'modality' | 'professional' | 'datetime' | 'details' | 'done';
const ORDER: Step[] = ['service', 'modality', 'professional', 'datetime', 'details'];
const ANY = 'any';
const MAX_DAYS_SHOWN = 60;

export function BookingFlow({ clinic }: { clinic: PublicClinic }) {
  const [step, setStep] = useState<Step>('service');
  const [procedure, setProcedure] = useState<PublicProcedure | null>(null);
  const [modality, setModality] = useState<Modality | null>(null);
  const [professionalId, setProfessionalId] = useState<string>(ANY);
  const [date, setDate] = useState(() => todayInTimeZone(clinic.timezone));
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const [result, setResult] = useState<BookingResult | null>(null);

  const professionals = useMemo(
    () =>
      clinic.professionals.filter(
        (p) =>
          procedure &&
          p.procedure_ids.includes(procedure.id) &&
          (modality !== 'residencial' || p.home_care_enabled),
      ),
    [clinic.professionals, procedure, modality],
  );

  const goBack = () => {
    const index = ORDER.indexOf(step);
    if (index > 0) setStep(ORDER[index - 1]);
  };

  const restart = () => {
    setProcedure(null);
    setModality(null);
    setProfessionalId(ANY);
    setSlot(null);
    setResult(null);
    setStep('service');
  };

  if (step === 'done' && result) {
    return <DoneStep result={result} clinic={clinic} onRestart={restart} />;
  }

  const header = <StepHeader clinic={clinic} step={step} onBack={step === 'service' ? undefined : goBack} />;

  if (step === 'service') {
    return (
      <Screen
        top={<ClinicHero clinic={clinic} />}
        footer={<Button label="Continuar" disabled={!procedure} onPress={() => setStep('modality')} />}>
        {header}
        <Title>Qual serviço você deseja?</Title>
        {clinic.procedures.length === 0 ? (
          <Muted>Nenhum serviço disponível para agendamento online no momento.</Muted>
        ) : (
          clinic.procedures.map((p) => (
            <ServiceOption
              key={p.id}
              procedure={p}
              selected={procedure?.id === p.id}
              onPress={() => {
                setProcedure(p);
                setSlot(null);
                setProfessionalId(ANY);
                // Pré-seleciona quando só existe uma modalidade possível.
                setModality(p.allows_clinic && !p.allows_home_care ? 'clinica'
                  : !p.allows_clinic && p.allows_home_care ? 'residencial'
                  : null);
              }}
            />
          ))
        )}
      </Screen>
    );
  }

  if (step === 'modality' && procedure) {
    return (
      <Screen
        footer={<Button label="Continuar" disabled={!modality} onPress={() => setStep('professional')} />}>
        {header}
        <Title>Onde será o atendimento?</Title>
        <OptionCard
          title="Na clínica"
          subtitle={clinic.address ?? 'Atendimento presencial na clínica'}
          selected={modality === 'clinica'}
          disabled={!procedure.allows_clinic}
          onPress={() => {
            setModality('clinica');
            setSlot(null);
          }}
        />
        <OptionCard
          title="Residencial (Home Care)"
          subtitle={
            procedure.allows_home_care
              ? 'O profissional vai até o seu endereço'
              : 'Este serviço não é oferecido em domicílio'
          }
          selected={modality === 'residencial'}
          disabled={!procedure.allows_home_care}
          onPress={() => {
            setModality('residencial');
            setSlot(null);
            setProfessionalId(ANY);
          }}
        />
      </Screen>
    );
  }

  if (step === 'professional' && procedure && modality) {
    return (
      <Screen footer={<Button label="Ver horários" onPress={() => setStep('datetime')} />}>
        {header}
        <Title>Com qual profissional?</Title>
        {professionals.length === 0 ? (
          <Notice tone="warning">Nenhum profissional disponível para esse serviço neste local.</Notice>
        ) : (
          <>
            {professionals.length > 1 ? (
              <OptionCard
                title="Qualquer profissional"
                subtitle="Mostra mais opções de horário"
                selected={professionalId === ANY}
                onPress={() => {
                  setProfessionalId(ANY);
                  setSlot(null);
                }}
              />
            ) : null}
            {professionals.map((p) => (
              <OptionCard
                key={p.id}
                title={p.name}
                subtitle={p.specialty}
                selected={professionalId === p.id || (professionals.length === 1 && professionalId === ANY)}
                onPress={() => {
                  setProfessionalId(p.id);
                  setSlot(null);
                }}
              />
            ))}
          </>
        )}
      </Screen>
    );
  }

  if (step === 'datetime' && procedure && modality) {
    return (
      <Screen footer={<Button label="Continuar" disabled={!slot} onPress={() => setStep('details')} />}>
        {header}
        <Title>Escolha o dia e o horário</Title>
        {slotNotice ? <Notice tone="warning">{slotNotice}</Notice> : null}
        <DateTimePicker
          clinic={clinic}
          procedure={procedure}
          modality={modality}
          professionalId={professionalId === ANY ? null : professionalId}
          date={date}
          onDateChange={(d) => {
            setDate(d);
            setSlot(null);
          }}
          slot={slot}
          onSlotChange={(s) => {
            setSlot(s);
            setSlotNotice(null);
          }}
        />
      </Screen>
    );
  }

  if (step === 'details' && procedure && modality && slot) {
    return (
      <DetailsStep
        header={header}
        clinic={clinic}
        procedure={procedure}
        modality={modality}
        slot={slot}
        onBooked={(r) => {
          setResult(r);
          setStep('done');
        }}
        onSlotTaken={(error: BookingError) => {
          setSlot(null);
          setSlotNotice(error.message);
          setStep('datetime');
        }}
      />
    );
  }

  // Estado inconsistente (ex.: recarregou no meio) — volta ao início.
  return (
    <Screen>
      {header}
      <Button label="Começar agendamento" onPress={restart} />
    </Screen>
  );
}

function StepHeader({ clinic, step, onBack }: { clinic: PublicClinic; step: Step; onBack?: () => void }) {
  const c = usePalette();
  const index = ORDER.indexOf(step);
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            onPress={onBack}
            hitSlop={12}
            style={styles.back}>
            <Text style={[styles.backText, { color: c.primary }]}>‹ Voltar</Text>
          </Pressable>
        ) : null}
        {clinic.logo_url && step !== 'service' ? (
          <Image source={{ uri: clinic.logo_url }} style={styles.miniLogo} contentFit="contain" />
        ) : null}
        <Text numberOfLines={1} style={[styles.clinicName, { color: c.textMuted }]}>
          {clinic.name}
        </Text>
        <Text style={[styles.stepCount, { color: c.textMuted }]}>
          {index + 1}/{ORDER.length}
        </Text>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: c.surfaceMuted }]}>
        <View
          style={[
            styles.progressFill,
            { backgroundColor: c.primary, width: `${((index + 1) / ORDER.length) * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

function DateTimePicker({
  clinic,
  procedure,
  modality,
  professionalId,
  date,
  onDateChange,
  slot,
  onSlotChange,
}: {
  clinic: PublicClinic;
  procedure: PublicProcedure;
  modality: Modality;
  professionalId: string | null;
  date: string;
  onDateChange: (date: string) => void;
  slot: Slot | null;
  onSlotChange: (slot: Slot) => void;
}) {
  const c = usePalette();
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = [procedure.id, modality, date, professionalId, reloadKey].join('|');
  // Resultado associado à requisição que o gerou: se a chave mudou, ainda está carregando.
  const [response, setResponse] = useState<{ key: string; slots?: Slot[]; error?: string } | null>(null);
  const current = response?.key === requestKey ? response : null;
  const slots = current?.slots ?? null;
  const error = current?.error ?? null;

  const days = useMemo(() => {
    const today = todayInTimeZone(clinic.timezone);
    const count = Math.min(clinic.max_days_ahead, MAX_DAYS_SHOWN) + 1;
    return Array.from({ length: count }, (_, i) => addDays(today, i));
  }, [clinic.timezone, clinic.max_days_ahead]);

  useEffect(() => {
    let active = true;
    fetchSlots({ slug: clinic.slug, procedureId: procedure.id, modality, date, professionalId })
      .then((list) => active && setResponse({ key: requestKey, slots: list }))
      .catch((e: Error) => active && setResponse({ key: requestKey, error: e.message }));
    return () => {
      active = false;
    };
  }, [clinic.slug, procedure.id, modality, date, professionalId, requestKey]);

  // "Qualquer profissional": um horário aparece uma vez, com o primeiro profissional livre.
  const groups = useMemo(() => {
    if (!slots) return [];
    const unique = new Map<string, Slot>();
    for (const s of slots) if (!unique.has(s.starts_at)) unique.set(s.starts_at, s);
    const buckets: { label: string; items: Slot[] }[] = [
      { label: 'Manhã', items: [] },
      { label: 'Tarde', items: [] },
      { label: 'Noite', items: [] },
    ];
    for (const s of unique.values()) {
      const hour = Number(formatTime(s.starts_at, clinic.timezone).slice(0, 2));
      buckets[hour < 12 ? 0 : hour < 18 ? 1 : 2].items.push(s);
    }
    return buckets.filter((b) => b.items.length > 0);
  }, [slots, clinic.timezone]);

  return (
    <View style={{ gap: Space.md }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.days}
        accessibilityRole="radiogroup">
        {days.map((d) => {
          const selected = d === date;
          const { day, month } = dayAndMonth(d);
          return (
            <Pressable
              key={d}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={formatDateLong(d)}
              onPress={() => onDateChange(d)}
              style={[
                styles.day,
                {
                  backgroundColor: selected ? c.primary : c.surface,
                  borderColor: selected ? c.primary : c.border,
                },
              ]}>
              <Text style={[styles.dayWeek, { color: selected ? c.primaryText : c.textMuted }]}>
                {weekdayShort(d)}
              </Text>
              <Text style={[styles.dayNum, { color: selected ? c.primaryText : c.text }]}>{day}</Text>
              <Text style={[styles.dayWeek, { color: selected ? c.primaryText : c.textMuted }]}>{month}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Muted style={{ textTransform: 'capitalize' }}>{formatDateLong(date)}</Muted>

      {error ? (
        <>
          <Notice tone="danger">{error}</Notice>
          <Button label="Tentar novamente" variant="secondary" onPress={() => setReloadKey((k) => k + 1)} />
        </>
      ) : slots === null ? (
        <Loading label="Buscando horários livres…" />
      ) : groups.length === 0 ? (
        <Notice tone="warning">Não há horários livres neste dia. Toque em outro dia acima.</Notice>
      ) : (
        groups.map((g) => (
          <View key={g.label} style={{ gap: Space.sm }}>
            <SectionLabel>{g.label}</SectionLabel>
            <View style={styles.slotGrid}>
              {g.items.map((s) => (
                <Chip
                  key={s.starts_at}
                  label={formatTime(s.starts_at, clinic.timezone)}
                  selected={slot?.starts_at === s.starts_at}
                  onPress={() => onSlotChange(s)}
                />
              ))}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function DoneStep({
  result,
  clinic,
  onRestart,
}: {
  result: BookingResult;
  clinic: PublicClinic;
  onRestart: () => void;
}) {
  const c = usePalette();
  const confirmed = result.status === 'agendado';
  return (
    <Screen footer={<Button label="Fazer outro agendamento" variant="secondary" onPress={onRestart} />}>
      <View style={[styles.doneIcon, { backgroundColor: confirmed ? c.successSoft : c.warningSoft }]}>
        <Text style={{ fontSize: 32, color: confirmed ? c.success : c.warning }}>{confirmed ? '✓' : '⏳'}</Text>
      </View>
      <Title>{confirmed ? 'Agendamento confirmado!' : 'Solicitação enviada!'}</Title>
      <Muted>
        {confirmed
          ? 'Seu horário está garantido. Você receberá os detalhes no WhatsApp e no e-mail informados.'
          : 'Seu horário está reservado. A clínica vai confirmar o agendamento pelo WhatsApp ou e-mail informados.'}
      </Muted>
      <View style={[styles.summary, { backgroundColor: c.surface, borderColor: c.border }]}>
        <SummaryRow label="Serviço" value={result.procedure_name} />
        <SummaryRow label="Profissional" value={result.professional_name} />
        <SummaryRow label="Quando" value={formatDateTimeLong(result.starts_at, clinic.timezone)} />
        <SummaryRow
          label="Local"
          value={result.modality === 'residencial' ? 'No seu endereço (Home Care)' : result.clinic_address ?? result.clinic_name}
        />
      </View>
      {result.clinic_phone ? <Muted>Dúvidas ou remarcação: {result.clinic_phone}</Muted> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: Space.sm, marginBottom: Space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 32 },
  back: { paddingVertical: Space.xs },
  backText: { fontSize: 16, fontWeight: '600' },
  clinicName: { flex: 1, fontSize: 14, fontWeight: '600' },
  miniLogo: { width: 28, height: 28, borderRadius: 6 },
  stepCount: { fontSize: 13, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  days: { gap: Space.sm, paddingVertical: Space.xs },
  day: {
    width: 62,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    gap: 2,
  },
  dayWeek: { fontSize: 12, textTransform: 'capitalize' },
  dayNum: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Space.xl,
  },
  summary: { borderWidth: 1, borderRadius: Radius.lg, padding: Space.lg, gap: Space.md },
});
