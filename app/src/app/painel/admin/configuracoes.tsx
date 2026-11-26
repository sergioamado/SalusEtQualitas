import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Field, Loading, Muted, Notice, Screen, SectionLabel, Title } from '@/components/ui';
import { Space } from '@/constants/theme';
import { fetchSettings, saveSettings, type PlatformSettings } from '@/features/platform/api';
import { isValidEmail, maskPhone, onlyDigits } from '@/lib/format';

/** Contato de suporte e dados de cobrança mostrados às clínicas. */
export default function PlatformSettingsScreen() {
  const [loaded, setLoaded] = useState<{ settings?: PlatformSettings; error?: string }>();

  useEffect(() => {
    let active = true;
    fetchSettings()
      .then((settings) => active && setLoaded({ settings }))
      .catch((e: Error) => active && setLoaded({ error: e.message }));
    return () => {
      active = false;
    };
  }, []);

  return (
    <Screen wide safeTop={false}>
      <Title>Suporte e cobrança</Title>
      {loaded?.error ? (
        <Notice tone="danger">{loaded.error}</Notice>
      ) : !loaded?.settings ? (
        <Loading />
      ) : (
        <SettingsForm initial={loaded.settings} />
      )}
    </Screen>
  );
}

function SettingsForm({ initial }: { initial: PlatformSettings }) {
  const [s, setS] = useState<PlatformSettings>({
    ...initial,
    support_whatsapp: initial.support_whatsapp ? maskPhone(initial.support_whatsapp) : '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const set = <K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const text = (v: string | null | undefined) => (v ?? '').trim() || null;

  const save = async () => {
    setMsg(null);
    if (s.support_email && !isValidEmail(s.support_email)) return setMsg({ tone: 'danger', text: 'E-mail de suporte inválido.' });
    const grace = Number(s.grace_days);
    const remind = Number(s.remind_days);
    if (!Number.isInteger(grace) || grace < 0 || grace > 60) return setMsg({ tone: 'danger', text: 'Tolerância: de 0 a 60 dias.' });
    if (!Number.isInteger(remind) || remind < 0 || remind > 30) return setMsg({ tone: 'danger', text: 'Aviso: de 0 a 30 dias.' });
    setBusy(true);
    try {
      await saveSettings({
        product_name: s.product_name.trim() || 'Salus Et Qualitas',
        support_email: text(s.support_email)?.toLowerCase() ?? null,
        support_whatsapp: onlyDigits(s.support_whatsapp ?? '') || null,
        support_phone: text(s.support_phone),
        support_hours: text(s.support_hours),
        support_message: text(s.support_message),
        billing_pix_key: text(s.billing_pix_key),
        billing_beneficiary: text(s.billing_beneficiary),
        billing_instructions: text(s.billing_instructions),
        grace_days: grace,
        remind_days: remind,
      });
      setMsg({ tone: 'success', text: 'Configurações salvas.' });
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.columns}>
      <View style={styles.col}>
        <Card>
          <SectionLabel>Contato de suporte</SectionLabel>
          <Muted style={{ fontSize: 13 }}>
            Aparece para as clínicas em “Ajuda” no painel, nos avisos de suspensão e na tela de login.
          </Muted>
          <Field label="Nome do sistema" value={s.product_name} onChangeText={(v) => set('product_name', v)} />
          <Field
            label="E-mail de suporte"
            value={s.support_email ?? ''}
            onChangeText={(v) => set('support_email', v)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="suporte@seudominio.com.br"
          />
          <View style={styles.row}>
            <Field
              label="WhatsApp de suporte"
              value={s.support_whatsapp ?? ''}
              onChangeText={(v) => set('support_whatsapp', maskPhone(v))}
              keyboardType="phone-pad"
              style={styles.flex}
            />
            <Field
              label="Telefone (opcional)"
              value={s.support_phone ?? ''}
              onChangeText={(v) => set('support_phone', v)}
              keyboardType="phone-pad"
              style={styles.flex}
            />
          </View>
          <Field
            label="Horário de atendimento"
            value={s.support_hours ?? ''}
            onChangeText={(v) => set('support_hours', v.slice(0, 120))}
            placeholder="Ex.: Seg a sex, 9h às 18h"
          />
          <Field
            label="Mensagem para as clínicas (opcional)"
            value={s.support_message ?? ''}
            onChangeText={(v) => set('support_message', v.slice(0, 500))}
            multiline
            placeholder="Ex.: Respondemos em até 1 dia útil."
          />
        </Card>
      </View>

      <View style={styles.col}>
        <Card>
          <SectionLabel>Cobrança</SectionLabel>
          <Muted style={{ fontSize: 13 }}>
            O gerente de cada clínica vê esses dados em Clínica e aparência → Plano e pagamento, para pagar a mensalidade.
          </Muted>
          <Field
            label="Chave Pix"
            value={s.billing_pix_key ?? ''}
            onChangeText={(v) => set('billing_pix_key', v)}
            autoCapitalize="none"
            placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
          />
          <Field
            label="Nome do favorecido"
            value={s.billing_beneficiary ?? ''}
            onChangeText={(v) => set('billing_beneficiary', v)}
          />
          <Field
            label="Instruções de pagamento"
            value={s.billing_instructions ?? ''}
            onChangeText={(v) => set('billing_instructions', v.slice(0, 1000))}
            multiline
            placeholder="Ex.: Após pagar, envie o comprovante pelo WhatsApp de suporte."
          />
          <View style={styles.row}>
            <Field
              label="Avisar a clínica (dias antes)"
              value={String(s.remind_days)}
              onChangeText={(v) => set('remind_days', Number(v.replace(/\D/g, '').slice(0, 2) || 0))}
              keyboardType="number-pad"
              style={styles.flex}
              hint="Aviso no painel antes do vencimento."
            />
            <Field
              label="Tolerância (dias de atraso)"
              value={String(s.grace_days)}
              onChangeText={(v) => set('grace_days', Number(v.replace(/\D/g, '').slice(0, 2) || 0))}
              keyboardType="number-pad"
              style={styles.flex}
              hint="Depois disso, o link é suspenso automaticamente."
            />
          </View>
        </Card>
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        <Button label="Salvar configurações" loading={busy} onPress={save} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.lg, alignItems: 'flex-start' },
  col: { flexGrow: 1, flexBasis: 380, gap: Space.lg },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  flex: { flex: 1, minWidth: 160 },
});
