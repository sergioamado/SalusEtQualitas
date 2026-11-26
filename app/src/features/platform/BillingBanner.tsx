import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { MaxPanelWidth, Space, usePalette } from '@/constants/theme';
import type { ClinicRow } from '@/features/panel/clinic-context';
import { supabase } from '@/lib/supabase';

import { brDate, daysUntil } from './api';

/** Prazos de aviso e tolerância definidos pelo gerente do sistema. */
function useBillingRules() {
  const [rules, setRules] = useState({ remind: 5, grace: 7 });
  useEffect(() => {
    let active = true;
    supabase
      .from('platform_settings')
      .select('remind_days, grace_days')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setRules({ remind: data.remind_days as number, grace: data.grace_days as number });
      });
    return () => {
      active = false;
    };
  }, []);
  return rules;
}

/**
 * Faixa no topo do painel da clínica:
 *  - suspensa/cancelada: para todos;
 *  - teste terminando, vencimento próximo ou atrasado: só para quem gerencia.
 */
export function BillingBanner({ clinic, canManage }: { clinic: ClinicRow; canManage: boolean }) {
  const c = usePalette();
  const rules = useBillingRules();

  let tone: 'danger' | 'warning' | 'info' | null = null;
  let text = '';
  if (clinic.status === 'suspensa' || clinic.status === 'cancelada') {
    tone = 'danger';
    text = `${clinic.status === 'suspensa' ? 'Clínica suspensa' : 'Assinatura cancelada'}${
      clinic.suspended_reason ? `: ${clinic.suspended_reason}` : ''
    }. O link de agendamento está fora do ar; a agenda interna continua acessível.`;
  } else if (canManage && clinic.status === 'teste' && clinic.trial_ends_on) {
    const d = daysUntil(clinic.trial_ends_on) ?? 0;
    tone = d <= rules.remind ? 'warning' : 'info';
    text =
      d >= 0
        ? `Período de teste até ${brDate(clinic.trial_ends_on)} (${d === 0 ? 'termina hoje' : `faltam ${d} ${d === 1 ? 'dia' : 'dias'}`}).`
        : `O período de teste terminou em ${brDate(clinic.trial_ends_on)}. O link será suspenso em ${Math.max(rules.grace + d, 0)} dias se não houver pagamento.`;
  } else if (canManage && clinic.status === 'ativa' && clinic.next_due_date) {
    const d = daysUntil(clinic.next_due_date) ?? 99;
    if (d < 0) {
      tone = 'danger';
      const left = rules.grace + d;
      text = `Mensalidade vencida em ${brDate(clinic.next_due_date)}. ${
        left > 0 ? `O link será suspenso em ${left} ${left === 1 ? 'dia' : 'dias'}.` : 'O link pode ser suspenso a qualquer momento.'
      }`;
    } else if (d <= rules.remind) {
      tone = 'warning';
      text = `Mensalidade vence ${d === 0 ? 'hoje' : `em ${d} ${d === 1 ? 'dia' : 'dias'}`} (${brDate(clinic.next_due_date)}).`;
    }
  }
  if (!tone) return null;

  const colors = {
    danger: [c.dangerSoft, c.danger],
    warning: [c.warningSoft, c.warning],
    info: [c.primarySoft, c.primary],
  }[tone];

  return (
    <View style={{ backgroundColor: colors[0] }}>
      <View style={styles.inner}>
        <Text style={[styles.text, { color: colors[1] }]}>{text}</Text>
        {canManage && clinic.status !== 'cancelada' ? (
          <Pressable accessibilityRole="link" onPress={() => router.push(`/painel/${clinic.id}/configuracoes`)} hitSlop={8}>
            <Text style={[styles.link, { color: colors[1] }]}>Ver pagamento ›</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="link" onPress={() => router.push('/painel/ajuda')} hitSlop={8}>
          <Text style={[styles.link, { color: colors[1] }]}>Falar com o suporte ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: {
    width: '100%',
    maxWidth: MaxPanelWidth,
    alignSelf: 'center',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Space.md,
  },
  text: { flexGrow: 1, flexShrink: 1, flexBasis: 280, fontSize: 14, fontWeight: '600' },
  link: { fontSize: 14, fontWeight: '700' },
});
