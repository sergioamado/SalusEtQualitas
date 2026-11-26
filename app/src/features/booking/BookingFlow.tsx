import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  Loading,
  Muted,
  Notice,
  OptionCard,
  SectionLabel,
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
import { BookingShell, SummaryCard, type ShellProps } from './BookingShell';
import { Avatar, ClinicHome } from './ClinicHome';
import { DetailsStep } from './DetailsStep';
import { whatsappUrl } from './links';
import { ServiceOption } from './ServiceOption';

type Step = 'home' | 'service' | 'modality' | 'professional' | 'datetime' | 'details' | 'done';
const ORDER: Step[] = ['service', 'modality', 'professional', 'datetime', 'details'];
const ANY = 'any';
const MAX_DAYS_SHOWN = 60;

/** Modalidade já definida quando o serviço só é oferecido em um local. */
const onlyModality = (p: PublicProcedure): Modality | null =>
  p.allows_clinic && !p.allows_home_care ? 'clinica' : !p.allows_clinic && p.allows_home_care ? 'residencial' : null;

export function BookingFlow({ clinic }: { clinic: PublicClinic }) {
  const [step, setStep] = useState<Step>('home');
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

  const chooseProcedure = (p: PublicProcedure) => {
    setProcedure(p);
    setSlot(null);
    setProfessionalId(ANY);
    setModality(onlyModality(p));
  };

  const goBack = () => {
    const index = ORDER.indexOf(step);
    setStep(index > 0 ? ORDER[index - 1] : 'home');
  };

  const goHome = () => {
    setResult(null);
    setStep('home');
  };

  const restart = () => {
    setProcedure(null);
    setModality(null);
    setProfessionalId(ANY);
    setSlot(null);
    setResult(null);
    setStep('service');
  };

  if (step === 'home') {
    return (
      <ClinicHome
        clinic={clinic}
        onBook={(p) => {
          if (p) {
            chooseProcedure(p);
            setStep(onlyModality(p) ? 'professional' : 'modality');
          } else setStep('service');
        }}
      />
    );
  }

  const chosenProfessional =
    slot?.professional_name ??
    (professionalId !== ANY
      ? professionals.find((p) => p.id === professionalId)?.name
      : professionals.length === 1
        ? professionals[0].name
        : ORDER.indexOf(step) > 2
          ? 'Qualquer profissional'
          : null) ??
    null;

  const shell: ShellProps = {
    clinic,
    stepIndex: step === 'done' ? ORDER.length : ORDER.indexOf(step),
    summary: { procedure, modality, professionalName: chosenProfessional, startsAt: slot?.starts_at ?? null },
    onBack: step === 'done' ? undefined : goBack,
    onHome: goHome,
  };

  if (step === 'done' && result) {
    return <DoneStep result={result} clinic={clinic} shell={shell} onRestart={restart} onHome={goHome} />;
  }

  if (step === 'service') {
    return (
      <BookingShell
        {...shell}
        footer={<Button label="Continuar" disabled={!procedure} onPress={() => setStep('modality')} />}>
        <StepTitle title="Qual serviço você deseja?" subtitle="Toque no serviço para selecionar." />
        {clinic.procedures.length === 0 ? (
          <Muted>Nenhum serviço disponível para agendamento online no momento.</Muted>
        ) : (
          clinic.procedures.map((p) => (
            <ServiceOption key={p.id} procedure={p} selected={procedure?.id === p.id} onPress={() => chooseProcedure(p)} />
          ))
        )}
      </BookingShell>
    );
  }

  if (step === 'modality' && procedure) {
    return (
      <BookingShell
        {...shell}
        footer={<Button label="Continuar" disabled={!modality} onPress={() => setStep('professional')} />}>
        <StepTitle title="Onde será o atendimento?" />
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
      </BookingShell>
    );
  }

  if (step === 'professional' && procedure && modality) {
    return (
      <BookingShell
        {...shell}
        footer={<Button label="Ver horários" disabled={professionals.length === 0} onPress={() => setStep('datetime')} />}>
        <StepTitle title="Com qual profissional?" />
        {professionals.length === 0 ? (
          <Notice tone="warning">Nenhum profissional disponível para esse serviço neste local.</Notice>
        ) : (
          <>
            {professionals.length > 1 ? (
              <ProfessionalOption
                name="Qualquer profissional"
                subtitle="Mostra mais opções de horário"
                selected={professionalId === ANY}
                onPress={() => {
                  setProfessionalId(ANY);
                  setSlot(null);
                }}
              />
            ) : null}
            {professionals.map((p) => (
              <ProfessionalOption
                key={p.id}
                name={p.name}
                subtitle={p.specialty}
                bio={p.bio}
                photoUrl={p.photo_url}
                selected={professionalId === p.id || (professionals.length === 1 && professionalId === ANY)}
                onPress={() => {
                  setProfessionalId(p.id);
                  setSlot(null);
                }}
              />
            ))}
          </>
        )}
      </BookingShell>
    );
  }

  if (step === 'datetime' && procedure && modality) {
    return (
      <BookingShell {...shell} footer={<Button label="Continuar" disabled={!slot} onPress={() => setStep('details')} />}>
        <StepTitle title="Escolha o dia e o horário" />
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
      </BookingShell>
    );
  }

  if (step === 'details' && procedure && modality && slot) {
    return (
      <DetailsStep
        shell={shell}
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
    <BookingShell {...shell}>
      <Button label="Começar agendamento" onPress={restart} />
    </BookingShell>
  );
}

function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Title>{title}</Title>
      {subtitle ? <Muted>{subtitle}</Muted> : null}
    </View>
  );
}

function ProfessionalOption({
  name,
  subtitle,
  bio,
  photoUrl,
  selected,
  onPress,
}: {
  name: string;
  subtitle?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  const c = usePalette();
  const any = photoUrl === undefined;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pro,
        { backgroundColor: selected ? c.primarySoft : c.surface, borderColor: selected ? c.primary : c.border },
        pressed && { opacity: 0.9 },
      ]}>
      {any ? (
        <View style={[styles.anyAvatar, { borderColor: c.primary }]}>
          <Text style={{ color: c.primary, fontSize: 22, fontWeight: '700' }}>+</Text>
        </View>
      ) : (
        <Avatar professional={{ name, photo_url: photoUrl ?? null }} size={56} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.proName, { color: c.text }]}>{name}</Text>
        {subtitle ? <Text style={{ color: c.textMuted, fontSize: 14 }}>{subtitle}</Text> : null}
        {bio ? (
          <Text numberOfLines={2} style={{ color: c.textMuted, fontSize: 13, lineHeight: 18 }}>
            {bio}
          </Text>
        ) : null}
      </View>
      <View style={[styles.radio, { borderColor: selected ? c.primary : c.border }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: c.primary }]} /> : null}
      </View>
    </Pressable>
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

      <Muted>{formatDateLong(date).replace(/^./, (ch) => ch.toUpperCase())}</Muted>

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
  shell,
  onRestart,
  onHome,
}: {
  result: BookingResult;
  clinic: PublicClinic;
  shell: ShellProps;
  onRestart: () => void;
  onHome: () => void;
}) {
  const c = usePalette();
  const confirmed = result.status === 'agendado';
  const wa = whatsappUrl(
    clinic.whatsapp,
    `Olá! Acabei de agendar ${result.procedure_name} para ${formatDateTimeLong(result.starts_at, clinic.timezone)}.`,
  );
  return (
    <BookingShell
      {...shell}
      footer={
        <View style={{ gap: Space.sm }}>
          {wa ? <Button label="Falar com a clínica no WhatsApp" onPress={() => Linking.openURL(wa)} /> : null}
          <Button label="Voltar à página da clínica" variant="secondary" onPress={onHome} />
        </View>
      }>
      <View style={styles.doneHead}>
        <View style={[styles.doneIcon, { backgroundColor: confirmed ? c.successSoft : c.warningSoft }]}>
          <Text style={{ fontSize: 34, color: confirmed ? c.success : c.warning }}>{confirmed ? '✓' : '⏳'}</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.doneTitle, { color: c.text }]}>
          {confirmed ? 'Agendamento confirmado!' : 'Solicitação enviada!'}
        </Text>
        <Text style={[styles.doneText, { color: c.textMuted }]}>
          {confirmed
            ? 'Seu horário está garantido. Você receberá os detalhes no WhatsApp e no e-mail informados.'
            : 'Seu horário está reservado. A clínica vai confirmar o agendamento pelo WhatsApp ou e-mail informados.'}
        </Text>
      </View>
      <SummaryCard
        clinic={clinic}
        title="Detalhes do agendamento"
        summary={{
          procedure: shell.summary.procedure,
          modality: result.modality,
          professionalName: result.professional_name,
          startsAt: result.starts_at,
        }}
      />
      {result.clinic_phone ? <Muted>Dúvidas ou remarcação: {result.clinic_phone}</Muted> : null}
      <Pressable accessibilityRole="button" onPress={onRestart} hitSlop={8}>
        <Text style={{ color: c.primary, fontWeight: '700', fontSize: 15 }}>Fazer outro agendamento</Text>
      </Pressable>
    </BookingShell>
  );
}

const styles = StyleSheet.create({
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
  doneHead: { alignItems: 'center', gap: Space.sm, paddingVertical: Space.lg },
  doneIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  doneText: { fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 460 },
  pro: { flexDirection: 'row', alignItems: 'center', gap: Space.md, borderWidth: 1.5, borderRadius: Radius.lg, padding: Space.md },
  proName: { fontSize: 16, fontWeight: '700' },
  anyAvatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
