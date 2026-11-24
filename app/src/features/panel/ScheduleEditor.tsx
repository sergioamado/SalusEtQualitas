import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Muted, Text } from '@/components/ui';
import { Radius, Space, usePalette, useBrandFonts } from '@/constants/theme';
import { maskTime } from '@/lib/format';
import { dayError, WEEK_ORDER, WEEKDAY_LONG, type DaySchedule, type WeekSchedule } from '@/lib/schedule';

/** Horário semanal (RF13): um período por dia e uma pausa opcional. */
export function ScheduleEditor({ value, onChange }: { value: WeekSchedule; onChange: (next: WeekSchedule) => void }) {
  const c = usePalette();
  const set = (weekday: number, patch: Partial<DaySchedule>) =>
    onChange(value.map((d, i) => (i === weekday ? { ...d, ...patch } : d)));

  const copyToAll = (weekday: number) => {
    const src = value[weekday];
    onChange(value.map((d, i) => (i === weekday || !d.enabled ? d : { ...src })));
  };

  return (
    <View style={{ gap: Space.sm }}>
      {WEEK_ORDER.map((weekday) => {
        const d = value[weekday];
        const error = dayError(d);
        return (
          <View key={weekday} style={[styles.day, { borderColor: error ? c.danger : c.border }]}>
            <View style={styles.head}>
              <Text style={[styles.dayName, { color: d.enabled ? c.text : c.textMuted }]}>{WEEKDAY_LONG[weekday]}</Text>
              <Muted>{d.enabled ? 'Atende' : 'Fechado'}</Muted>
              <Switch
                accessibilityLabel={`Atende ${WEEKDAY_LONG[weekday]}`}
                value={d.enabled}
                onValueChange={(enabled) => set(weekday, { enabled })}
                trackColor={{ true: c.primary, false: c.border }}
                thumbColor="#FFFFFF"
              />
            </View>
            {d.enabled ? (
              <>
                <View style={styles.times}>
                  <TimeInput label="Início" value={d.start} onChange={(start) => set(weekday, { start })} />
                  <TimeInput label="Fim" value={d.end} onChange={(end) => set(weekday, { end })} />
                  <TimeInput label="Pausa de" value={d.breakStart} placeholder="12:00" onChange={(breakStart) => set(weekday, { breakStart })} />
                  <TimeInput label="até" value={d.breakEnd} placeholder="13:00" onChange={(breakEnd) => set(weekday, { breakEnd })} />
                </View>
                {error ? <Text style={{ color: c.danger, fontSize: 13 }}>{error}</Text> : null}
                <Pressable accessibilityRole="button" onPress={() => copyToAll(weekday)} hitSlop={6}>
                  <Text style={[styles.copy, { color: c.primary }]}>Copiar para os outros dias que atende</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function TimeInput({
  label,
  value,
  placeholder = '08:00',
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const c = usePalette();
  const fonts = useBrandFonts();
  return (
    <View style={styles.timeBox}>
      <Text style={[styles.timeLabel, { color: c.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(t) => onChange(maskTime(t))}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        keyboardType="number-pad"
        maxLength={5}
        style={[
          styles.timeInput,
          { color: c.text, borderColor: c.border, backgroundColor: c.surface },
          fonts && { fontFamily: fonts.regular },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  day: { borderWidth: 1, borderRadius: Radius.md, padding: Space.md, gap: Space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  dayName: { flex: 1, fontSize: 16, fontWeight: '700' },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  timeBox: { gap: 2, minWidth: 72, flexGrow: 1, flexBasis: 72 },
  timeLabel: { fontSize: 12, fontWeight: '600' },
  timeInput: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
  copy: { fontSize: 14, fontWeight: '600' },
});
