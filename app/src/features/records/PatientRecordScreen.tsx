// ============================================================================
// FICHA DO PACIENTE (prontuário) — /painel/<clínica>/pacientes/<paciente>
// ----------------------------------------------------------------------------
// Mostra: dados de contato, consentimento LGPD, registros (anamneses e
// evoluções) com adendos, atendimentos e — só para o dono — quem acessou.
// Cada abertura desta tela fica anotada no banco (patient_record → 'ver').
//
// Regras que vêm do banco (não daqui): quem pode abrir, que registro assinado
// não muda, que rascunho só aparece para quem escreveu (e para o dono).
// ============================================================================
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chip, Field, Loading, Muted, Notice, SectionLabel, Text } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { useClinic } from '@/features/panel/clinic-context';
import { formatDateTimeLong, maskPhone } from '@/lib/format';

import {
  ACTION_LABEL,
  addAddendum,
  deleteDraft,
  fetchActiveTemplates,
  fetchRecord,
  registerConsent,
  type PatientRecord,
  type RecordEntry,
} from './api';
import { AnswersView } from './AnswersView';
import { EntryEditor, type EditorState } from './EntryEditor';
import type { RecordTemplate, TemplateKind } from './types';
import { cap, vocab } from './vocab';

type Loaded = { record: PatientRecord; templates: RecordTemplate[] };

export function PatientRecordScreen({ contactId, appointmentId }: { contactId: string; appointmentId: string | null }) {
  const { clinic, role } = useClinic();
  const words = vocab(clinic.record_vocabulary);
  const c = usePalette();

  const [version, setVersion] = useState(0);
  const key = `${contactId}|${version}`;
  const [response, setResponse] = useState<{ key: string; data?: Loaded; error?: string }>();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  // Veio da agenda (?atendimento=…): mostra o convite para registrar aquele atendimento.
  const [fromAgenda, setFromAgenda] = useState(appointmentId);

  useEffect(() => {
    let active = true;
    Promise.all([fetchRecord(contactId), fetchActiveTemplates(clinic.id)])
      .then(([record, templates]) => active && setResponse({ key, data: { record, templates } }))
      .catch((e: Error) => active && setResponse({ key, error: e.message }));
    return () => {
      active = false;
    };
  }, [contactId, clinic.id, key]);

  const current = response?.key === key ? response : response?.data ? response : undefined;
  const refresh = (text?: string) => {
    if (text) setMessage({ tone: 'success', text });
    setVersion((v) => v + 1);
  };
  const back = () => router.replace(`/painel/${clinic.id}/pacientes` as never);

  if (!current) return <Loading label={`Abrindo ${words.record}…`} />;
  if (current.error || !current.data) {
    return (
      <View style={{ gap: Space.md }}>
        <Notice tone="danger">{current.error ?? 'Erro ao carregar.'}</Notice>
        {role === 'profissional' ? (
          <Muted>
            Para atender alguém novo, marque o atendimento na agenda com você como profissional (pode ser um encaixe). O{' '}
            {words.record} é liberado na hora.
          </Muted>
        ) : null}
        <Button label={`Voltar para ${words.people}`} variant="secondary" onPress={back} />
      </View>
    );
  }

  const { record, templates } = current.data;
  const ct = record.contact;
  const canWrite = record.can_write && (record.is_owner || role === 'profissional');
  const byKind = (k: TemplateKind) => templates.filter((t) => t.kind === k);

  if (editor) {
    return (
      <EntryEditor
        state={editor}
        contactId={ct.id}
        appointments={record.appointments}
        timeZone={clinic.timezone}
        words={words}
        onClose={(text) => {
          setEditor(null);
          setFromAgenda(null);
          if (text) refresh(text);
        }}
      />
    );
  }

  const start = (kind: TemplateKind, t: RecordTemplate | null, appt: string | null) =>
    setEditor({
      id: null,
      kind,
      templateId: t?.id ?? null,
      title: t?.name ?? (kind === 'anamnese' ? cap(words.intake) : cap(words.session)),
      fields: t?.fields ?? [],
      answers: {},
      notes: '',
      appointmentId: appt,
    });

  const agendaAppt = fromAgenda ? record.appointments.find((a) => a.id === fromAgenda) : null;

  return (
    <View style={{ gap: Space.md }}>
      <Pressable accessibilityRole="link" onPress={back} hitSlop={8}>
        <Text style={{ color: c.primary, fontWeight: '600' }}>← {cap(words.people)}</Text>
      </Pressable>

      {/* Cabeçalho */}
      <Card style={{ gap: Space.sm }}>
        <Text style={styles.title}>{ct.full_name}</Text>
        <Muted>{[ct.phone ? maskPhone(ct.phone) : null, ct.email].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}</Muted>
        {ct.phone ? (
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button label="WhatsApp" variant="secondary" onPress={() => Linking.openURL(`https://wa.me/55${ct.phone}`)} />
            </View>
            <View style={styles.grow}>
              <Button label="Ligar" variant="secondary" onPress={() => Linking.openURL(`tel:${ct.phone}`)} />
            </View>
          </View>
        ) : null}
        <ConsentBox
          consentAt={ct.health_consent_at}
          person={words.person}
          timeZone={clinic.timezone}
          onRegister={async () => {
            try {
              await registerConsent(ct.id);
              refresh('Consentimento registrado.');
            } catch (e) {
              setMessage({ tone: 'danger', text: (e as Error).message });
            }
          }}
        />
      </Card>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {!record.can_write ? (
        <Notice tone="warning">O módulo Pacientes está desativado: dá para consultar, mas não registrar nada novo.</Notice>
      ) : null}

      {/* Veio da agenda */}
      {canWrite && agendaAppt ? (
        <Card style={{ gap: Space.sm }}>
          <Text style={styles.cardTitle}>Registrar o atendimento</Text>
          <Muted>
            {agendaAppt.procedure_name} · {formatDateTimeLong(agendaAppt.starts_at, clinic.timezone)}
          </Muted>
          <View style={styles.row}>
            {byKind('evolucao').map((t) => (
              <Chip key={t.id} label={t.name} onPress={() => start('evolucao', t, agendaAppt.id)} />
            ))}
            <Chip label="Texto livre" onPress={() => start('evolucao', null, agendaAppt.id)} />
          </View>
        </Card>
      ) : null}

      {/* Novo registro */}
      {canWrite ? (
        <Card style={{ gap: Space.sm }}>
          <Text style={styles.cardTitle}>Novo registro</Text>
          <SectionLabel>{cap(words.intake)}</SectionLabel>
          {byKind('anamnese').length ? (
            <View style={styles.row}>
              {byKind('anamnese').map((t) => (
                <Chip key={t.id} label={t.name} onPress={() => start('anamnese', t, null)} />
              ))}
            </View>
          ) : (
            <Muted>Nenhum modelo de {words.intake} ativo. Crie em “Modelos de ficha”.</Muted>
          )}
          <SectionLabel>{cap(words.session)}</SectionLabel>
          <View style={styles.row}>
            {byKind('evolucao').map((t) => (
              <Chip key={t.id} label={t.name} onPress={() => start('evolucao', t, null)} />
            ))}
            <Chip label="Texto livre" onPress={() => start('evolucao', null, null)} />
          </View>
        </Card>
      ) : null}

      {/* Registros */}
      <SectionLabel>{cap(words.record)} ({record.entries.length})</SectionLabel>
      {record.entries.length === 0 ? <Muted>Nenhum registro ainda.</Muted> : null}
      {record.entries.map((e, i) => (
        <EntryCard
          key={e.id}
          entry={e}
          initiallyOpen={i === 0}
          timeZone={clinic.timezone}
          appointment={record.appointments.find((a) => a.id === e.appointment_id) ?? null}
          canWrite={canWrite}
          canEditDraft={canWrite && (e.mine || record.is_owner)}
          words={words}
          onEdit={() =>
            setEditor({
              id: e.id,
              kind: e.kind,
              templateId: e.template_id,
              title: e.title,
              fields: e.fields,
              answers: e.answers,
              notes: e.notes ?? '',
              appointmentId: e.appointment_id,
            })
          }
          onChanged={refresh}
          onError={(text) => setMessage({ tone: 'danger', text })}
        />
      ))}

      {/* Atendimentos */}
      <SectionLabel>Atendimentos ({record.appointments.length})</SectionLabel>
      {record.appointments.length === 0 ? <Muted>Nenhum atendimento agendado.</Muted> : null}
      {record.appointments.slice(0, 30).map((a) => (
        <View key={a.id} style={[styles.apptRow, { borderBottomColor: c.border }]}>
          <View style={styles.grow}>
            <Text style={{ fontWeight: '600' }}>{a.procedure_name}</Text>
            <Muted style={{ fontSize: 13 }}>
              {formatDateTimeLong(a.starts_at, clinic.timezone)} · {a.professional_name}
            </Muted>
          </View>
          {a.status === 'cancelado' ? <Badge label="Cancelado" /> : null}
        </View>
      ))}

      {/* Auditoria (só o dono) */}
      {record.access_log ? <AccessLog log={record.access_log} timeZone={clinic.timezone} /> : null}
    </View>
  );
}

function ConsentBox({
  consentAt,
  person,
  timeZone,
  onRegister,
}: {
  consentAt: string | null;
  person: string;
  timeZone: string;
  onRegister: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (consentAt) return <Badge label={`Consentimento LGPD em ${formatDateTimeLong(consentAt, timeZone)}`} tone="success" />;
  return (
    <View style={{ gap: Space.sm }}>
      <Notice tone="warning">
        Consentimento para dados de saúde ainda não registrado. Pela LGPD, peça a autorização do(a) {person} antes de guardar
        informações de saúde.
      </Notice>
      {asking ? (
        <>
          <Muted>
            Confirme apenas se o(a) {person} autorizou (por escrito, no papel ou por mensagem) o uso dos dados de saúde para o
            atendimento.
          </Muted>
          <Button label={`Sim, o(a) ${person} autorizou`} onPress={onRegister} />
          <Button label="Voltar" variant="secondary" onPress={() => setAsking(false)} />
        </>
      ) : (
        <Button label="Registrar consentimento" variant="secondary" onPress={() => setAsking(true)} />
      )}
    </View>
  );
}

function EntryCard({
  entry: e,
  initiallyOpen,
  timeZone,
  appointment,
  canWrite,
  canEditDraft,
  words,
  onEdit,
  onChanged,
  onError,
}: {
  entry: RecordEntry;
  initiallyOpen: boolean;
  timeZone: string;
  appointment: { starts_at: string; procedure_name: string } | null;
  canWrite: boolean;
  canEditDraft: boolean;
  words: ReturnType<typeof vocab>;
  onEdit: () => void;
  onChanged: (text: string) => void;
  onError: (text: string) => void;
}) {
  const c = usePalette();
  const [open, setOpen] = useState(initiallyOpen);
  const [addendum, setAddendum] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const signed = e.status === 'assinado';

  const sendAddendum = async () => {
    if (!addendum || addendum.trim().length < 2) return;
    setBusy(true);
    try {
      await addAddendum(e.id, addendum.trim());
      setAddendum(null);
      onChanged('Adendo registrado.');
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteDraft(e.id);
      onChanged('Rascunho excluído.');
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: Space.sm }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
        <View style={styles.row}>
          <Badge label={e.kind === 'anamnese' ? cap(words.intake) : cap(words.session)} tone="primary" />
          {signed ? <Badge label="Assinado" tone="success" /> : <Badge label="Rascunho" tone="warning" />}
          {e.source === 'link' ? <Badge label="Preenchido pelo link" /> : null}
          <View style={styles.spacer} />
          <Text style={{ color: c.textMuted }}>{open ? '▲' : '▼'}</Text>
        </View>
        <Text style={[styles.cardTitle, { marginTop: Space.xs }]}>{e.title}</Text>
        <Muted style={{ fontSize: 13 }}>
          {signed
            ? `Assinado por ${e.signed_name} em ${formatDateTimeLong(e.signed_at!, timeZone)}`
            : `Rascunho de ${formatDateTimeLong(e.updated_at, timeZone)}`}
          {appointment ? ` · Atendimento: ${appointment.procedure_name}, ${formatDateTimeLong(appointment.starts_at, timeZone)}` : ''}
        </Muted>
      </Pressable>

      {open ? (
        <View style={{ gap: Space.md }}>
          {e.fields.length ? <AnswersView fields={e.fields} answers={e.answers} /> : null}
          {e.notes ? (
            <View style={{ gap: 2 }}>
              <Text style={{ color: c.textMuted, fontSize: 13 }}>Anotações</Text>
              <Text style={{ fontSize: 16, lineHeight: 22 }}>{e.notes}</Text>
            </View>
          ) : null}

          {e.addenda.map((a) => (
            <View key={a.id} style={[styles.addendum, { borderLeftColor: c.primary, backgroundColor: c.surfaceMuted }]}>
              <Text style={{ fontSize: 13, color: c.textMuted }}>
                Adendo de {a.author_name} · {formatDateTimeLong(a.created_at, timeZone)}
              </Text>
              <Text style={{ fontSize: 15, lineHeight: 21 }}>{a.body}</Text>
            </View>
          ))}

          {/* Ações */}
          {!signed && canEditDraft ? (
            <View style={styles.row}>
              <View style={styles.grow}>
                <Button label="Continuar / assinar" onPress={onEdit} />
              </View>
              <View style={styles.grow}>
                {confirmDelete ? (
                  <Button label="Confirmar exclusão" variant="secondary" loading={busy} onPress={remove} />
                ) : (
                  <Button label="Excluir rascunho" variant="secondary" onPress={() => setConfirmDelete(true)} />
                )}
              </View>
            </View>
          ) : null}

          {signed && canWrite ? (
            addendum === null ? (
              <Button label="Adicionar adendo" variant="secondary" onPress={() => setAddendum('')} />
            ) : (
              <View style={{ gap: Space.sm }}>
                <Field
                  label="Adendo"
                  hint="Use para corrigir ou complementar. O registro original continua visível."
                  value={addendum}
                  onChangeText={setAddendum}
                  multiline
                  maxLength={5000}
                />
                <Button label="Salvar adendo" loading={busy} disabled={addendum.trim().length < 2} onPress={sendAddendum} />
                <Button label="Cancelar" variant="secondary" onPress={() => setAddendum(null)} />
              </View>
            )
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function AccessLog({ log, timeZone }: { log: { user_name: string | null; action: string; at: string }[]; timeZone: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: Space.sm }}>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)}>
        <Text style={styles.cardTitle}>Quem acessou {open ? '▲' : '▼'}</Text>
        <Muted style={{ fontSize: 13 }}>Só você (dono da clínica) vê este histórico. Últimos {log.length} acessos.</Muted>
      </Pressable>
      {open
        ? log.map((l, i) => (
            <Muted key={i} style={{ fontSize: 14 }}>
              {formatDateTimeLong(l.at, timeZone)} — {l.user_name ?? 'Alguém'} {ACTION_LABEL[l.action] ?? l.action}
            </Muted>
          ))
        : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700' },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.sm },
  grow: { flexGrow: 1, flexBasis: 0, minWidth: 140 },
  spacer: { flex: 1 },
  apptRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  addendum: { borderLeftWidth: 3, padding: Space.sm, gap: 2, borderRadius: 6 },
});
