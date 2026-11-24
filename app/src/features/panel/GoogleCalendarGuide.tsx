import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Field, Muted, Notice, SectionLabel, Text, ToggleRow } from '@/components/ui';
import { Radius, Space, usePalette } from '@/constants/theme';
import { callFunction } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const URL_CALENDAR = 'https://calendar.google.com/calendar/u/0/r';
const URL_CREATE = 'https://calendar.google.com/calendar/u/0/r/settings/createcalendar';
const URL_SETTINGS = 'https://calendar.google.com/calendar/u/0/r/settings';
const URL_APP_ANDROID = 'https://play.google.com/store/apps/details?id=com.google.android.calendar';
const URL_APP_IOS = 'https://apps.apple.com/app/google-calendar/id909319292';

/**
 * Aceita o ID da agenda e também os formatos que as pessoas costumam colar por engano:
 * o link "embed?src=...", o endereço público com "src=" ou um texto com espaços.
 */
export function normalizeCalendarId(input: string): string {
  const text = input.trim();
  const src = text.match(/[?&]src=([^&#\s]+)/);
  if (src) {
    try {
      return decodeURIComponent(src[1]).trim();
    } catch {
      return src[1];
    }
  }
  return text.replace(/^mailto:/i, '').replace(/\s+/g, '');
}

type Props = {
  clinicId: string;
  clinicName: string;
  savedCalendarId: string | null;
  savedEnabled: boolean;
  enabled: boolean;
  calendarId: string;
  onEnabled: (v: boolean) => void;
  onCalendarId: (v: string) => void;
  /** Recarrega a clínica depois de salvar. */
  onSaved: () => void;
};

/** Passo a passo para o gerente ligar o Google Agenda à clínica. Feito para quem nunca mexeu nas configurações do Google. */
export function GoogleCalendarGuide(props: Props) {
  const { clinicId, clinicName, savedCalendarId, savedEnabled, enabled, calendarId, onEnabled, onCalendarId, onSaved } = props;
  const c = usePalette();
  const [info, setInfo] = useState<{ email?: string; error?: string }>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const configured = savedEnabled && !!savedCalendarId;
  const [showSteps, setShowSteps] = useState(!configured);

  useEffect(() => {
    let active = true;
    callFunction<{ service_account_email: string }>('google-calendar-sync', { action: 'info' })
      .then((r) => active && setInfo({ email: r.service_account_email }))
      .catch((e: Error) => active && setInfo({ error: e.message }));
    return () => {
      active = false;
    };
  }, []);

  const copyEmail = async () => {
    if (!info?.email) return;
    await Clipboard.setStringAsync(info.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const saveAndTest = async () => {
    const id = normalizeCalendarId(calendarId);
    setResult(null);
    if (!id) return setResult({ tone: 'danger', text: 'Cole o ID da agenda (passo 5) antes de testar.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id))
      return setResult({
        tone: 'danger',
        text: 'Isso não parece um ID de agenda. Ele tem formato de e-mail: seu-email@gmail.com ou um código terminado em @group.calendar.google.com.',
      });
    onCalendarId(id);
    onEnabled(true);
    setBusy(true);
    try {
      const { error } = await supabase
        .from('clinics')
        .update({ google_notify_enabled: true, google_calendar_id: id })
        .eq('id', clinicId);
      if (error) throw new Error('Não foi possível salvar o ID da agenda.');
      await callFunction('google-calendar-sync', { action: 'test', clinic_id: clinicId });
      setResult({
        tone: 'success',
        text: 'Tudo certo! Criamos e apagamos um evento de teste na sua agenda. A partir de agora, cada agendamento aparece lá automaticamente.',
      });
      setShowSteps(false);
    } catch (e) {
      setResult({ tone: 'danger', text: explain((e as Error).message) });
    } finally {
      setBusy(false);
      onSaved();
    }
  };

  const disconnect = async () => {
    onEnabled(false);
    await supabase.from('clinics').update({ google_notify_enabled: false }).eq('id', clinicId);
    setResult(null);
    onSaved();
  };

  return (
    <Card style={{ gap: Space.md }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <SectionLabel>Google Agenda</SectionLabel>
        </View>
        {configured ? <Badge label="Conectado" tone="success" /> : <Badge label="Não conectado" />}
      </View>
      <Muted>
        Cada agendamento novo, remarcado ou cancelado aparece sozinho no seu Google Agenda, com aviso no celular 1 hora
        antes e e-mail 1 dia antes. É gratuito e funciona com qualquer conta Gmail.
      </Muted>

      {info?.error ? (
        <Notice tone="warning">
          A integração com o Google ainda não foi ativada no servidor do sistema. Avise o suporte (gerente do sistema).
          Detalhe: {info.error}
        </Notice>
      ) : null}

      {configured ? (
        <View style={{ gap: Space.sm }}>
          <Muted>
            Agenda conectada: <Text style={{ fontWeight: '700' }}>{savedCalendarId}</Text>
          </Muted>
          <View style={styles.buttons}>
            <Button label="Testar de novo" variant="secondary" loading={busy} onPress={saveAndTest} />
            <Button label="Desconectar" variant="secondary" onPress={disconnect} />
          </View>
          <Pressable accessibilityRole="button" onPress={() => setShowSteps((v) => !v)} hitSlop={6}>
            <Text style={[styles.link, { color: c.primary }]}>{showSteps ? 'Esconder passo a passo' : 'Ver passo a passo'}</Text>
          </Pressable>
        </View>
      ) : (
        <Notice tone="warning">
          Leva uns 5 minutos. Faça pelo computador: o aplicativo do Google Agenda no celular não tem a opção de
          compartilhar a agenda.
        </Notice>
      )}

      {result ? <Notice tone={result.tone}>{result.text}</Notice> : null}

      {showSteps ? (
        <View style={{ gap: Space.md }}>
          <Step n={1} title="Abra o Google Agenda">
            <Muted>
              Abra no computador e entre com a conta Google em que você quer receber os avisos (por exemplo, o Gmail da
              clínica).
            </Muted>
            <LinkButton label="Abrir Google Agenda" url={URL_CALENDAR} />
          </Step>

          <Step n={2} title="Crie uma agenda só para a clínica (recomendado)">
            <Muted>
              Assim os pacientes não se misturam com seus compromissos pessoais. Toque no botão abaixo, escreva um nome
              como <Text style={styles.bold}>“Agendamentos – {clinicName}”</Text> e clique em{' '}
              <Text style={styles.bold}>Criar agenda</Text>.
            </Muted>
            <Muted>Se preferir usar sua agenda principal, pode pular este passo.</Muted>
            <LinkButton label="Criar nova agenda" url={URL_CREATE} />
          </Step>

          <Step n={3} title="Abra as configurações da agenda">
            <Muted>
              Na coluna da esquerda, em <Text style={styles.bold}>Minhas agendas</Text>, passe o mouse sobre a agenda
              (a que você criou, ou a com o seu nome). Clique nos <Text style={styles.bold}>três pontinhos ⋮</Text> e
              depois em <Text style={styles.bold}>Configurações e compartilhamento</Text>.
            </Muted>
            <Muted>Outro caminho: pelo botão abaixo, clique no nome da agenda na lista da esquerda.</Muted>
            <LinkButton label="Abrir configurações do Google Agenda" url={URL_SETTINGS} />
          </Step>

          <Step n={4} title="Compartilhe com o sistema">
            <Muted>
              Role a página até <Text style={styles.bold}>Compartilhar com pessoas e grupos específicos</Text> e clique
              em <Text style={styles.bold}>+ Adicionar pessoas e grupos</Text>. Cole este e-mail:
            </Muted>
            <View style={[styles.emailBox, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
              <Text selectable style={styles.email}>
                {info?.email ?? (info?.error ? 'indisponível' : 'carregando…')}
              </Text>
            </View>
            <Button label={copied ? 'E-mail copiado ✓' : 'Copiar e-mail'} variant="secondary" disabled={!info?.email} onPress={copyEmail} />
            <Muted>
              Em <Text style={styles.bold}>Permissões</Text>, troque para{' '}
              <Text style={styles.bold}>Fazer alterações nos eventos</Text> e clique em{' '}
              <Text style={styles.bold}>Enviar</Text>.
            </Muted>
            <Notice tone="warning">
              Atenção: não deixe em “Ver todos os detalhes do evento”. Com essa opção o sistema não consegue colocar os
              agendamentos na agenda.
            </Notice>
            <Muted>
              Se o Google avisar que o e-mail é de fora da sua organização, pode confirmar. Esse e-mail é do sistema e
              só tem acesso a esta agenda.
            </Muted>
          </Step>

          <Step n={5} title="Copie o ID da agenda">
            <Muted>
              Na mesma página, role mais para baixo até <Text style={styles.bold}>Integrar agenda</Text>. O primeiro
              item é o <Text style={styles.bold}>ID da agenda</Text>. Selecione e copie.
            </Muted>
            <Muted>
              • Agenda criada no passo 2: um código longo terminado em{' '}
              <Text style={styles.bold}>@group.calendar.google.com</Text>.{'\n'}• Agenda principal: é o seu próprio
              e-mail (ex.: clinica@gmail.com).
            </Muted>
          </Step>

          <Step n={6} title="Cole aqui e teste">
            <Field
              label="ID da agenda"
              value={calendarId}
              onChangeText={onCalendarId}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="xxxx@group.calendar.google.com"
            />
            <Button label="Salvar e testar" loading={busy} disabled={!!info?.error} onPress={saveAndTest} />
            <Muted style={{ fontSize: 13 }}>
              O teste cria um evento rápido na sua agenda e apaga em seguida. Se acabou de compartilhar e der erro,
              espere 1 minuto e tente de novo.
            </Muted>
          </Step>

          <Step n={7} title="Receba os avisos no celular">
            <Muted>
              Instale o app <Text style={styles.bold}>Google Agenda</Text> e entre com a mesma conta. Se criou uma
              agenda separada, abra o menu ☰ do app e confira se ela está marcada. Deixe as notificações do app
              ativadas.
            </Muted>
            <View style={styles.buttons}>
              <LinkButton label="App para Android" url={URL_APP_ANDROID} />
              <LinkButton label="App para iPhone" url={URL_APP_IOS} />
            </View>
            <Muted style={{ fontSize: 13 }}>
              O Google não avisa no instante em que o evento é criado, só nos lembretes (1 hora e 1 dia antes). Para
              ver na hora que chegou um agendamento, use a aba Agendamentos deste painel.
            </Muted>
          </Step>
        </View>
      ) : null}

      <Troubleshooting />

      <ToggleRow
        label="Enviar agendamentos para o Google Agenda"
        description={enabled ? 'Ligado.' : 'Desligado: nada é enviado ao Google.'}
        value={enabled}
        onChange={onEnabled}
      />
      <Muted style={{ fontSize: 13 }}>
        LGPD: com a integração ligada, nome, telefone e serviço do paciente também ficam no Google Agenda da clínica.
        Compartilhe a agenda só com quem precisa.
      </Muted>
    </Card>
  );
}

/** Traduz os erros do teste em orientação prática. */
function explain(message: string): string {
  if (/não encontrada|sem permissão|not found|forbidden/i.test(message)) {
    return (
      'O Google não deixou o sistema usar esta agenda. Confira:\n' +
      '1) o e-mail do passo 4 foi colado inteiro, sem espaço;\n' +
      '2) a permissão é “Fazer alterações nos eventos”;\n' +
      '3) o ID colado é da mesma agenda que você compartilhou.\n' +
      'Se acabou de compartilhar, espere 1 minuto e teste de novo.'
    );
  }
  if (/conta de serviço|GOOGLE_SERVICE_ACCOUNT|configurad/i.test(message)) {
    return `A integração ainda não foi ativada no servidor. Avise o suporte. (${message})`;
  }
  return message;
}

function Troubleshooting() {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: Space.sm }}>
      <Pressable accessibilityRole="button" onPress={() => setOpen((v) => !v)} hitSlop={6}>
        <Text style={[styles.link, { color: c.primary }]}>{open ? '▾' : '▸'} Deu erro? Veja as soluções</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: Space.sm }}>
          <Problem title="“O Google não deixou o sistema usar esta agenda”">
            Quase sempre é a permissão. Volte ao passo 4 e confira se está em “Fazer alterações nos eventos”. Confira
            também se o ID (passo 5) é da mesma agenda que você compartilhou.
          </Problem>
          <Problem title="Não acho “Compartilhar com pessoas e grupos específicos”">
            Você provavelmente está no celular. Faça pelo computador ou, no navegador do celular, ative “Versão para
            computador”. Confira também se clicou no nome da agenda, e não em “Geral”.
          </Problem>
          <Problem title="Aparece “não é permitido compartilhar fora da organização”">
            Sua conta é de empresa (Google Workspace) e o administrador bloqueou. Peça para liberarem o compartilhamento
            externo de agendas, ou use uma conta Gmail comum.
          </Problem>
          <Problem title="O teste funcionou, mas não vejo os eventos no celular">
            No app Google Agenda, abra o menu ☰ e marque a agenda da clínica. Confira se a conta certa está conectada
            no app.
          </Problem>
          <Problem title="Um agendamento não foi para a agenda">
            O motivo aparece em vermelho no cartão do agendamento, na aba Agendamentos. Depois de corrigir, qualquer
            alteração no agendamento (por exemplo, aprovar) envia de novo.
          </Problem>
        </View>
      ) : null}
    </View>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const c = usePalette();
  return (
    <View style={[styles.step, { borderColor: c.border }]}>
      <View style={styles.stepHead}>
        <View style={[styles.stepNumber, { backgroundColor: c.primary }]}>
          <Text style={{ color: c.primaryText, fontWeight: '700' }}>{n}</Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      <View style={{ gap: Space.sm }}>{children}</View>
    </View>
  );
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.bold}>{title}</Text>
      <Muted>{children}</Muted>
    </View>
  );
}

function LinkButton({ label, url }: { label: string; url: string }) {
  return <Button label={`${label} ↗`} variant="secondary" onPress={() => WebBrowser.openBrowserAsync(url)} />;
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  link: { fontSize: 15, fontWeight: '600' },
  bold: { fontWeight: '700' },
  step: { borderWidth: 1, borderRadius: Radius.md, padding: Space.md, gap: Space.sm },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  emailBox: { borderWidth: 1, borderRadius: Radius.sm, padding: Space.md },
  email: { fontSize: 15, fontWeight: '600' },
});
