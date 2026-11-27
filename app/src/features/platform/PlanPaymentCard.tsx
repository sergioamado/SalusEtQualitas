import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Muted, SectionLabel, Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import type { ClinicRow } from '@/features/panel/clinic-context';
import { supabase } from '@/lib/supabase';

import { brDate, listPayments, money, PAYMENT_METHODS, STATUS_LABEL, STATUS_TONE, type Payment, type Plan, type PlatformSettings } from './api';

type AddOn = { name: string; price: number };
type Loaded = { plan: Plan | null; settings: PlatformSettings | null; payments: Payment[]; addOns: AddOn[] };

/** Módulos contratados pela clínica, com o preço que ela paga (combinado ou de tabela). */
async function loadAddOns(clinicId: string): Promise<AddOn[]> {
  const { data } = await supabase
    .from('clinic_modules')
    .select('price_monthly, module:modules ( name, price_monthly, active )')
    .eq('clinic_id', clinicId);
  type Row = { price_monthly: number | null; module: { name: string; price_monthly: number; active: boolean } | null };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.module?.active)
    .map((r) => ({ name: r.module!.name, price: Number(r.price_monthly ?? r.module!.price_monthly) }));
}

/** Para o gerente da clínica: plano, vencimento, como pagar e histórico. */
export function PlanPaymentCard({ clinic }: { clinic: ClinicRow }) {
  const c = usePalette();
  const [data, setData] = useState<Loaded | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      clinic.plan_id
        ? supabase.from('plans').select('*').eq('id', clinic.plan_id).maybeSingle().then((r) => (r.data as Plan | null) ?? null)
        : Promise.resolve(null),
      supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle().then((r) => (r.data as PlatformSettings | null) ?? null),
      listPayments(clinic.id).catch(() => [] as Payment[]),
      loadAddOns(clinic.id).catch(() => [] as AddOn[]),
    ]).then(([plan, settings, payments, addOns]) => active && setData({ plan, settings, payments, addOns }));
    return () => {
      active = false;
    };
  }, [clinic.id, clinic.plan_id]);

  if (!data) return null;
  const price = clinic.monthly_price ?? data.plan?.price_monthly ?? null;
  // Total do mês = plano + módulos adicionais (mesma conta do painel do gerente).
  const total = (price ?? 0) + data.addOns.reduce((sum, a) => sum + a.price, 0);
  const s = data.settings;

  return (
    <Card>
      <SectionLabel>Plano e pagamento</SectionLabel>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>{data.plan?.name ?? 'Sem plano definido'}</Text>
          {price != null ? <Muted>{money(price)} por mês</Muted> : null}
          {data.addOns.map((a) => (
            <Muted key={a.name}>
              + {a.name}: {a.price ? `${money(a.price)} por mês` : 'incluso'}
            </Muted>
          ))}
          {data.addOns.length ? (
            <Text style={{ color: c.text, fontWeight: '700', marginTop: 4 }}>Total: {money(total)} por mês</Text>
          ) : null}
        </View>
        <Badge label={STATUS_LABEL[clinic.status]} tone={STATUS_TONE[clinic.status]} />
      </View>
      {clinic.status === 'teste' && clinic.trial_ends_on ? <Muted>Teste grátis até {brDate(clinic.trial_ends_on)}.</Muted> : null}
      {clinic.next_due_date ? <Muted>Próximo vencimento: {brDate(clinic.next_due_date)}</Muted> : null}

      {s?.billing_pix_key ? (
        <View style={[styles.pix, { backgroundColor: c.surfaceMuted }]}>
          <Text style={{ color: c.textMuted, fontSize: 13, fontWeight: '600' }}>Pague por Pix</Text>
          <Text selectable style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>
            {s.billing_pix_key}
          </Text>
          {s.billing_beneficiary ? <Muted style={{ fontSize: 13 }}>Favorecido: {s.billing_beneficiary}</Muted> : null}
          <Button
            label={copied ? 'Chave copiada!' : 'Copiar chave Pix'}
            variant="secondary"
            onPress={async () => {
              await Clipboard.setStringAsync(s.billing_pix_key ?? '');
              setCopied(true);
            }}
          />
        </View>
      ) : null}
      {s?.billing_instructions ? <Muted>{s.billing_instructions}</Muted> : null}

      {data.payments.length ? (
        <>
          <SectionLabel>Pagamentos recebidos</SectionLabel>
          {data.payments.slice(0, 6).map((p) => (
            <View key={p.id} style={[styles.payment, { borderBottomColor: c.border }]}>
              <Text style={{ color: c.text, flex: 1 }}>
                {brDate(p.paid_on)}
                {p.reference ? ` · ${p.reference}` : ''}
              </Text>
              <Text style={{ color: c.textMuted }}>{PAYMENT_METHODS[p.method]}</Text>
              <Text style={{ color: c.text, fontWeight: '700' }}>{money(p.amount)}</Text>
            </View>
          ))}
        </>
      ) : null}

      <Pressable accessibilityRole="link" onPress={() => router.push('/painel/ajuda')} hitSlop={8}>
        <Text style={{ color: c.primary, fontWeight: '700' }}>Dúvidas sobre a cobrança? Fale com o suporte ›</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  pix: { borderRadius: 12, padding: Space.md, gap: 4 },
  payment: { flexDirection: 'row', gap: Space.md, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
});
