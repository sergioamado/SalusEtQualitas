import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Field, Loading, Muted, Notice, Screen, SectionLabel, Title, ToggleRow } from '@/components/ui';
import { Space } from '@/constants/theme';
import {
  BLOCK_REASON,
  checkCaptchaReady,
  fetchProtectionStats,
  fetchSettings,
  saveSettings,
  type PlatformSettings,
  type ProtectionStats,
} from '@/features/platform/api';
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
      <Title>Suporte, cobrança e proteção</Title>
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
    const limits = [s.protect_ip_hour, s.protect_ip_day, s.protect_contact_day, s.protect_active_per_contact, s.protect_clinic_hour];
    if (limits.some((n) => !Number.isInteger(n) || n < 1)) return setMsg({ tone: 'danger', text: 'Os limites da proteção precisam ser maiores que zero.' });
    if (s.captcha_enabled && !text(s.captcha_site_key))
      return setMsg({ tone: 'danger', text: 'Para exigir o captcha, informe a chave do site (Site Key) do Turnstile.' });
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
        protect_ip_hour: s.protect_ip_hour,
        protect_ip_day: s.protect_ip_day,
        protect_contact_day: s.protect_contact_day,
        protect_active_per_contact: s.protect_active_per_contact,
        protect_clinic_hour: s.protect_clinic_hour,
        captcha_enabled: s.captcha_enabled,
        captcha_site_key: text(s.captcha_site_key),
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
        <ProtectionCard s={s} set={set} />
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        <Button label="Salvar configurações" loading={busy} onPress={save} />
      </View>
    </View>
  );
}

function NumberField({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <Field
      label={label}
      value={value ? String(value) : ''}
      onChangeText={(v) => onChange(Number(v.replace(/\D/g, '').slice(0, 4) || 0))}
      keyboardType="number-pad"
      style={styles.flex}
      hint={hint}
    />
  );
}

/** Limites do link público, captcha e tentativas barradas. */
function ProtectionCard({
  s,
  set,
}: {
  s: PlatformSettings;
  set: <K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) => void;
}) {
  const [stats, setStats] = useState<ProtectionStats | null>(null);
  const [checking, setChecking] = useState(false);
  const [captchaNote, setCaptchaNote] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchProtectionStats()
      .then((r) => active && setStats(r))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card>
      <SectionLabel>Proteção do link de agendamento</SectionLabel>
      {stats ? (
        <View style={{ gap: 4 }}>
          <Muted>
            Últimas 24 h: {stats.bookings_24h} agendamentos pelo link · {stats.blocked_24h} tentativas barradas. Últimos 7
            dias: {stats.blocked_7d} barradas.
          </Muted>
          {Object.entries(stats.by_reason).map(([reason, n]) => (
            <Muted key={reason} style={{ fontSize: 13 }}>
              • {BLOCK_REASON[reason] ?? reason}: {n}
            </Muted>
          ))}
          {stats.by_clinic.length ? (
            <Muted style={{ fontSize: 13 }}>
              Clínicas mais visadas: {stats.by_clinic.map((c) => `${c.name} (${c.n})`).join(', ')}
            </Muted>
          ) : null}
        </View>
      ) : null}
      <Muted style={{ fontSize: 13 }}>
        Limites aplicados no servidor (valem até para robôs que não passam pelo site). Conexões, e-mails e telefones ficam
        guardados só embaralhados e são apagados em 7 dias.
      </Muted>
      <View style={styles.row}>
        <NumberField label="Pedidos por conexão / hora" value={s.protect_ip_hour} onChange={(n) => set('protect_ip_hour', n)} />
        <NumberField label="Pedidos por conexão / dia" value={s.protect_ip_day} onChange={(n) => set('protect_ip_day', n)} />
      </View>
      <View style={styles.row}>
        <NumberField
          label="Pedidos por e-mail ou telefone / dia"
          value={s.protect_contact_day}
          onChange={(n) => set('protect_contact_day', n)}
        />
        <NumberField
          label="Horários em aberto por paciente"
          value={s.protect_active_per_contact}
          onChange={(n) => set('protect_active_per_contact', n)}
          hint="Na mesma clínica, contando só os futuros."
        />
      </View>
      <NumberField
        label="Pedidos por clínica / hora (freio contra ataque)"
        value={s.protect_clinic_hour}
        onChange={(n) => set('protect_clinic_hour', n)}
      />

      <ToggleRow
        label="Exigir captcha (“não sou um robô”)"
        description="Cloudflare Turnstile, grátis. Na maioria das vezes confirma sozinho, sem o paciente clicar em nada."
        value={s.captcha_enabled}
        onChange={async (v) => {
          setCaptchaNote(null);
          if (!v) return set('captcha_enabled', false);
          setChecking(true);
          const ready = await checkCaptchaReady();
          setChecking(false);
          if (ready) set('captcha_enabled', true);
          else
            setCaptchaNote(
              'Ainda não dá para ligar: falta publicar a função public-book com a chave secreta (TURNSTILE_SECRET_KEY) no Supabase. Veja o passo a passo no README.',
            );
        }}
      />
      {checking ? <Muted style={{ fontSize: 13 }}>Conferindo a configuração…</Muted> : null}
      {captchaNote ? <Notice tone="warning">{captchaNote}</Notice> : null}
      <Field
        label="Chave do site (Site Key) do Turnstile"
        value={s.captcha_site_key ?? ''}
        onChangeText={(v) => set('captcha_site_key', v.trim())}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="0x4AAAAAAA…"
      />
      {s.captcha_enabled ? (
        <Muted style={{ fontSize: 13 }}>
          Configuração conferida. Clique em “Salvar configurações” para valer. Para desligar, é só desmarcar e salvar.
        </Muted>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.lg, alignItems: 'flex-start' },
  col: { flexGrow: 1, flexBasis: 380, gap: Space.lg },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  flex: { flex: 1, minWidth: 160 },
});
