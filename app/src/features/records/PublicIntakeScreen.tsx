// ============================================================================
// TELA PÚBLICA DA FICHA — o paciente preenche pelo link (/ficha/<código>)
// ----------------------------------------------------------------------------
// Sem login. O "código" do link é a única chave: o banco confere se ele existe,
// se não venceu e se ainda não foi usado (public_intake). Ao enviar
// (public_intake_submit), o banco confere as obrigatórias de novo, exige o
// consentimento LGPD e "queima" o link — ele não abre uma segunda vez.
// Reaproveita o mesmo FormRenderer do painel: a ficha é igual nos dois lados.
// ============================================================================
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Checkbox, Loading, Muted, Notice, Screen, Text, Title } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { BrandProvider } from '@/lib/brand';

import { fetchPublicIntake, RecordError, submitPublicIntake, type PublicIntake } from './api';
import { FormRenderer } from './FormRenderer';
import { missingRequired, type Answers } from './types';
import { vocab } from './vocab';

export function PublicIntakeScreen({ token }: { token: string }) {
  const [attempt, setAttempt] = useState(0);
  const key = `${token}|${attempt}`;
  const [response, setResponse] = useState<{ key: string; data?: PublicIntake; error?: RecordError }>();

  useEffect(() => {
    let active = true;
    fetchPublicIntake(token)
      .then((data) => active && setResponse({ key, data }))
      .catch((e: RecordError) => active && setResponse({ key, error: e }));
    return () => {
      active = false;
    };
  }, [token, key]);

  const current = response?.key === key ? response : undefined;

  if (!current) {
    return (
      <Screen>
        <Loading label="Abrindo sua ficha…" />
      </Screen>
    );
  }
  if (current.error || !current.data) {
    const code = current.error?.code;
    const final = code === 'INTAKE_USED' || code === 'INTAKE_EXPIRED' || code === 'INTAKE_NOT_FOUND';
    return (
      <Screen>
        <Title>{code === 'INTAKE_USED' ? 'Ficha já enviada' : 'Link indisponível'}</Title>
        <Notice tone={code === 'INTAKE_USED' ? 'success' : 'warning'}>{current.error?.message ?? 'Erro ao abrir.'}</Notice>
        {final ? null : <Button label="Tentar novamente" onPress={() => setAttempt((n) => n + 1)} />}
      </Screen>
    );
  }

  const d = current.data;
  return (
    // Cores e fonte da clínica, iguais às da página de agendamento.
    <BrandProvider primary={d.clinic.primary_color} secondary={d.clinic.secondary_color} font={d.clinic.font_family}>
      <IntakeForm token={token} data={d} />
    </BrandProvider>
  );
}

function IntakeForm({ token, data }: { token: string; data: PublicIntake }) {
  const c = usePalette();
  const words = vocab(data.clinic.vocabulary);
  const [answers, setAnswers] = useState<Answers>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Screen>
        <Brand data={data} />
        <View style={styles.done}>
          <View style={[styles.doneIcon, { backgroundColor: c.successSoft }]}>
            <Text style={{ fontSize: 34, color: c.success }}>✓</Text>
          </View>
          <Title>Ficha enviada!</Title>
          <Muted style={{ textAlign: 'center' }}>
            Obrigado, {data.first_name}. Suas respostas foram entregues com segurança a {data.clinic.name}. Pode fechar esta
            página.
          </Muted>
        </View>
      </Screen>
    );
  }

  const send = async () => {
    const miss = missingRequired(data.fields, answers);
    if (miss.length) {
      setMissing(miss);
      setError(`Faltam ${miss.length} pergunta(s) obrigatória(s), marcadas em vermelho.`);
      return;
    }
    if (!consent) {
      setError('Para enviar, marque a autorização no final da página.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await submitPublicIntake(token, answers, consent);
      setSent(true);
    } catch (e) {
      const err = e as RecordError;
      if (err.fieldId) setMissing([err.fieldId]);
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={{ gap: Space.sm }}>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button label="Enviar respostas" loading={busy} onPress={send} />
        </View>
      }>
      <Brand data={data} />
      <View style={{ gap: Space.xs }}>
        <Title>{data.title}</Title>
        <Muted>
          Olá, {data.first_name}! Responda com calma: leva poucos minutos e ajuda a preparar o seu atendimento. As perguntas
          com * são obrigatórias.
        </Muted>
        {data.description ? <Muted>{data.description}</Muted> : null}
      </View>

      <Card>
        <FormRenderer
          fields={data.fields}
          answers={answers}
          missing={missing}
          onChange={(id, v) => {
            setAnswers((a) => ({ ...a, [id]: v }));
            if (missing.includes(id)) setMissing((m) => m.filter((x) => x !== id));
          }}
        />
      </Card>

      {/* LGPD: dado de saúde é "dado sensível" — precisa de autorização clara. */}
      <Card style={{ gap: Space.sm }}>
        <Checkbox checked={consent} onChange={setConsent}>
          Autorizo {data.clinic.name} a guardar estas informações de saúde ({words.record}), para uso exclusivo no meu
          atendimento, com acesso restrito aos profissionais que me atenderem.
        </Checkbox>
      </Card>
      <Muted style={{ fontSize: 13 }}>
        Este link é pessoal e só pode ser enviado uma vez. Depois de enviar, as respostas não podem ser alteradas por aqui —
        se precisar corrigir algo, avise a clínica.
      </Muted>
    </Screen>
  );
}

function Brand({ data }: { data: PublicIntake }) {
  const c = usePalette();
  return (
    <View style={[styles.brand, { borderBottomColor: c.border }]}>
      {data.clinic.logo_url ? <Image source={{ uri: data.clinic.logo_url }} style={styles.logo} contentFit="contain" /> : null}
      <Text style={[styles.brandName, { color: c.text }]}>{data.clinic.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingBottom: Space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: { width: 40, height: 40 },
  brandName: { fontSize: 18, fontWeight: '700', flexShrink: 1 },
  done: { alignItems: 'center', gap: Space.md, paddingVertical: Space.xl },
  doneIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
});
