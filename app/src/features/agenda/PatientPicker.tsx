import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Field, Muted, SectionLabel, Text } from '@/components/ui';
import { Radius, Space, usePalette } from '@/constants/theme';
import { maskPhone } from '@/lib/format';

import { searchContacts, type ContactHit } from './api';

export type PatientValue =
  | { kind: 'existing'; contact: ContactHit }
  | { kind: 'new'; full_name: string; phone: string; email: string }
  | null;

/** Escolhe um paciente já cadastrado (busca por nome, telefone ou e-mail) ou cadastra um novo na hora. */
export function PatientPicker({
  clinicId,
  value,
  onChange,
  error,
}: {
  clinicId: string;
  value: PatientValue;
  onChange: (v: PatientValue) => void;
  error?: string | null;
}) {
  const c = usePalette();
  const [term, setTerm] = useState('');
  const [response, setResponse] = useState<{ term: string; hits: ContactHit[] }>();

  useEffect(() => {
    if (term.trim().length < 2) return;
    let active = true;
    const t = setTimeout(() => {
      searchContacts(clinicId, term).then((hits) => active && setResponse({ term, hits }));
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [clinicId, term]);

  const hits = response?.term === term ? response.hits : [];

  if (value?.kind === 'existing') {
    const p = value.contact;
    return (
      <View style={{ gap: Space.xs }}>
        <SectionLabel>Paciente</SectionLabel>
        <View style={[styles.selected, { borderColor: c.primary, backgroundColor: c.primarySoft }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{p.full_name}</Text>
            <Muted>{[p.phone ? maskPhone(p.phone) : null, p.email].filter(Boolean).join(' · ') || 'Sem contato'}</Muted>
          </View>
          <Pressable accessibilityRole="button" onPress={() => onChange(null)} hitSlop={8}>
            <Text style={{ color: c.primary, fontWeight: '600' }}>Trocar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (value?.kind === 'new') {
    return (
      <View style={{ gap: Space.sm }}>
        <SectionLabel>Novo paciente</SectionLabel>
        <Field
          label="Nome completo"
          value={value.full_name}
          onChangeText={(full_name) => onChange({ ...value, full_name })}
          autoCapitalize="words"
          error={error}
        />
        <Field
          label="WhatsApp / telefone"
          value={value.phone}
          onChangeText={(t) => onChange({ ...value, phone: maskPhone(t) })}
          keyboardType="phone-pad"
          placeholder="(11) 91234-5678"
        />
        <Field
          label="E-mail (opcional)"
          value={value.email}
          onChangeText={(email) => onChange({ ...value, email })}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Muted style={{ fontSize: 13 }}>
          Se o telefone ou e-mail já estiver cadastrado, o sistema usa o cadastro existente (sem duplicar).
        </Muted>
        <Pressable accessibilityRole="button" onPress={() => onChange(null)} hitSlop={8}>
          <Text style={{ color: c.primary, fontWeight: '600' }}>← Buscar paciente cadastrado</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: Space.sm }}>
      <Field
        label="Paciente"
        value={term}
        onChangeText={setTerm}
        placeholder="Buscar por nome, telefone ou e-mail"
        autoCorrect={false}
        error={error}
      />
      {hits.map((h) => (
        <Pressable
          key={h.id}
          accessibilityRole="button"
          onPress={() => onChange({ kind: 'existing', contact: h })}
          style={({ pressed }) => [styles.hit, { borderColor: c.border, backgroundColor: pressed ? c.surfaceMuted : c.surface }]}>
          <Text style={styles.name}>{h.full_name}</Text>
          <Muted>{[h.phone ? maskPhone(h.phone) : null, h.email].filter(Boolean).join(' · ')}</Muted>
        </Pressable>
      ))}
      {term.trim().length >= 2 && response?.term === term && hits.length === 0 ? <Muted>Nenhum paciente encontrado.</Muted> : null}
      <Button
        label="+ Cadastrar novo paciente"
        variant="secondary"
        onPress={() => {
          const digits = term.replace(/\D/g, '');
          const looksPhone = digits.length >= 8 && digits.length === term.replace(/[\s()+-]/g, '').length;
          onChange({
            kind: 'new',
            full_name: looksPhone || term.includes('@') ? '' : term.trim(),
            phone: looksPhone ? maskPhone(digits) : '',
            email: term.includes('@') ? term.trim() : '',
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  selected: { flexDirection: 'row', alignItems: 'center', gap: Space.md, borderWidth: 1.5, borderRadius: Radius.md, padding: Space.md },
  hit: { borderWidth: 1, borderRadius: Radius.md, padding: Space.md, gap: 2 },
  name: { fontSize: 16, fontWeight: '700' },
});
