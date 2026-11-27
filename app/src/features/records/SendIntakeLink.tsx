// ============================================================================
// ENVIAR A FICHA POR LINK (o paciente preenche sozinho, pelo celular)
// ----------------------------------------------------------------------------
// 1) A equipe escolhe o modelo de anamnese e toca em "Gerar link".
// 2) O banco cria um código secreto (vale 7 dias, uma única resposta) e guarda
//    só o "hash" dele — por isso o link aparece UMA vez, aqui na tela.
// 3) A equipe manda pelo WhatsApp (mensagem pronta) ou copia.
// 4) Quando o paciente responde, vira um registro assinado no prontuário.
// A recepção pode enviar, mas não consegue ler a resposta depois.
// ============================================================================
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Muted, Notice, Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { whatsappUrl } from '@/features/booking/links';
import { useClinic } from '@/features/panel/clinic-context';
import { formatDateTimeLong } from '@/lib/format';

import { createIntakeLink, fetchActiveTemplates, fetchIntakeLinks, intakeUrl, type IntakeLinkStatus } from './api';
import type { RecordTemplate } from './types';
import { vocab } from './vocab';

type Loaded = { templates: RecordTemplate[]; links: IntakeLinkStatus[] };

export function SendIntakeLink({
  contactId,
  fullName,
  phone,
  defaultTemplateId = null,
}: {
  contactId: string;
  fullName: string;
  phone: string | null;
  /** Modelo sugerido (ex.: o modelo ligado ao serviço do agendamento). */
  defaultTemplateId?: string | null;
}) {
  const { clinic } = useClinic();
  const words = vocab(clinic.record_vocabulary);
  const c = usePalette();

  // Fechado = só um botão. Assim o componente ocupa pouco espaço até ser usado.
  const [open, setOpen] = useState(false);
  const [response, setResponse] = useState<{ key: string; data?: Loaded; error?: string }>();
  const [picked, setPicked] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const key = `${contactId}|${link?.url ?? ''}`;

  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([fetchActiveTemplates(clinic.id), fetchIntakeLinks(contactId)])
      .then(([all, links]) => active && setResponse({ key, data: { templates: all.filter((t) => t.kind === 'anamnese'), links } }))
      .catch((e: Error) => active && setResponse({ key, error: e.message }));
    return () => {
      active = false;
    };
  }, [open, clinic.id, contactId, key]);

  if (!open) {
    return <Button label={`Enviar ${words.intake} por link`} variant="secondary" onPress={() => setOpen(true)} />;
  }

  const current = response?.key === key ? response : response?.data ? response : undefined;
  const templates = current?.data?.templates ?? [];
  // Escolha da pessoa > modelo sugerido pelo serviço > o primeiro da lista.
  const templateId =
    picked ?? (templates.some((t) => t.id === defaultTemplateId) ? defaultTemplateId : (templates[0]?.id ?? null));
  const last = current?.data?.links[0];
  const firstName = fullName.trim().split(/\s+/)[0] ?? '';

  const generate = async () => {
    if (!templateId) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await createIntakeLink(contactId, templateId);
      setLink({ url: intakeUrl(r.token), expires_at: r.expires_at });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const message = link
    ? `Olá, ${firstName}! Para agilizar seu atendimento em ${clinic.name}, preencha sua ${words.intake} por este link: ${link.url}\n` +
      `O link vale até ${formatDateTimeLong(link.expires_at, clinic.timezone)} e só pode ser enviado uma vez.`
    : '';
  const wa = link ? whatsappUrl(phone, message) : null;

  return (
    <Card style={{ gap: Space.sm }}>
      <Text style={styles.title}>Enviar {words.intake} por link</Text>
      <Muted>
        {firstName || `O(a) ${words.person}`} abre o link no celular, responde e envia. As respostas entram direto no{' '}
        {words.record}, assinadas por {firstName || 'ele(a)'}.
      </Muted>

      {!current ? (
        <Muted>Carregando…</Muted>
      ) : current.error ? (
        <Notice tone="danger">{current.error}</Notice>
      ) : templates.length === 0 ? (
        <Notice tone="warning">Nenhum modelo de {words.intake} ativo. Crie um em “Modelos de ficha”.</Notice>
      ) : (
        <>
          {last ? <Muted style={{ fontSize: 13 }}>{statusText(last, clinic.timezone)}</Muted> : null}

          {templates.length > 1 && !link ? (
            <View style={styles.row}>
              {templates.map((t) => (
                <Chip key={t.id} label={t.name} selected={t.id === templateId} onPress={() => setPicked(t.id)} />
              ))}
            </View>
          ) : null}

          {link ? (
            <View style={{ gap: Space.sm }}>
              <Notice tone="success">Link criado! Envie agora — por segurança ele não aparece de novo depois.</Notice>
              <Text selectable style={[styles.link, { color: c.primary }]}>
                {link.url}
              </Text>
              {wa ? <Button label="Enviar no WhatsApp" onPress={() => Linking.openURL(wa)} /> : null}
              <Button
                label={copied ? 'Mensagem copiada ✓' : 'Copiar mensagem com o link'}
                variant="secondary"
                onPress={async () => {
                  await Clipboard.setStringAsync(message);
                  setCopied(true);
                }}
              />
              {!phone ? <Muted style={{ fontSize: 13 }}>Sem telefone cadastrado: copie e envie por onde preferir.</Muted> : null}
            </View>
          ) : (
            <Button label="Gerar link" loading={busy} onPress={generate} />
          )}
        </>
      )}

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Fechar" variant="secondary" onPress={() => setOpen(false)} />
    </Card>
  );
}

function statusText(l: IntakeLinkStatus, timeZone: string) {
  const name = l.template_name ? `“${l.template_name}”` : 'Ficha';
  if (l.used_at) return `Último link: ${name} respondida em ${formatDateTimeLong(l.used_at, timeZone)}.`;
  if (new Date(l.expires_at) < new Date()) return `Último link: ${name} enviada em ${formatDateTimeLong(l.created_at, timeZone)}, venceu sem resposta.`;
  return `Último link: ${name} enviada em ${formatDateTimeLong(l.created_at, timeZone)} — aguardando resposta.`;
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  link: { fontSize: 14, fontWeight: '600' },
});
