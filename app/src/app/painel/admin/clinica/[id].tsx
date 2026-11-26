import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Checkbox, Chip, Field, Loading, Muted, Notice, Screen, SectionLabel, Text, Title } from '@/components/ui';
import { Radius, Space, usePalette } from '@/constants/theme';
import {
  ago,
  brDate,
  deleteClinic,
  deletePayment,
  fetchNotes,
  fetchOverview,
  formatBytes,
  listPayments,
  listPlans,
  money,
  PAYMENT_METHODS,
  registerPayment,
  saveNotes,
  setClinicStatus,
  STATUS_LABEL,
  STATUS_TONE,
  updateSubscription,
  type OverviewClinic,
  type Payment,
  type PaymentMethod,
  type Plan,
} from '@/features/platform/api';
import { brToDateKey, dateKeyToBr, maskDate } from '@/lib/format';
import { portalBaseUrl } from '@/lib/supabase';

type Loaded = { key: string; clinic?: OverviewClinic | null; plans?: Plan[]; payments?: Payment[]; notes?: string; error?: string };
type Msg = { tone: 'success' | 'danger'; text: string } | null;

const parseMoney = (v: string) => {
  const n = Number(v.replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const moneyInput = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2).replace('.', ','));
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Gerente do sistema: tudo sobre uma clínica. */
export default function AdminClinicScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [version, setVersion] = useState(0);
  const key = `${id}|${version}`;
  const [loaded, setLoaded] = useState<Loaded>();
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let active = true;
    Promise.all([fetchOverview(), listPlans(), listPayments(String(id)), fetchNotes(String(id))])
      .then(([overview, plans, payments, notes]) => {
        if (!active) return;
        setLoaded({ key, clinic: overview.clinics.find((c) => c.id === id) ?? null, plans, payments, notes });
      })
      .catch((e: Error) => active && setLoaded({ key, error: e.message }));
    return () => {
      active = false;
    };
  }, [id, key]);

  // Mantém a tela durante recargas.
  const data = loaded?.key === key || loaded?.clinic?.id === id ? loaded : undefined;
  if (!data) {
    return (
      <Screen wide safeTop={false}>
        <Loading label="Carregando a clínica…" />
      </Screen>
    );
  }
  if (data.error || !data.clinic) {
    return (
      <Screen wide safeTop={false}>
        <Title>Clínica não encontrada</Title>
        {data.error ? <Notice tone="danger">{data.error}</Notice> : <Muted>Ela pode ter sido excluída.</Muted>}
        <Button label="Voltar para a lista" onPress={() => router.replace('/painel/admin')} />
      </Screen>
    );
  }
  const clinic = data.clinic;

  return (
    <Screen wide safeTop={false}>
      <Pressable accessibilityRole="link" onPress={() => router.replace('/painel/admin')} hitSlop={8}>
        <Text style={styles.back}>‹ Todas as clínicas</Text>
      </Pressable>
      <Header clinic={clinic} />

      <View style={styles.columns}>
        <View style={styles.col}>
          <StatusCard clinic={clinic} onChanged={reload} />
          <SubscriptionCard key={`sub-${key}`} clinic={clinic} plans={data.plans ?? []} onSaved={reload} />
          <PaymentsCard key={`pay-${key}`} clinic={clinic} payments={data.payments ?? []} onChanged={reload} />
        </View>
        <View style={styles.col}>
          <UsageCard clinic={clinic} />
          <NotesCard clinicId={clinic.id} initial={data.notes ?? ''} />
          <DangerCard clinic={clinic} />
        </View>
      </View>
    </Screen>
  );
}

function Header({ clinic }: { clinic: OverviewClinic }) {
  const link = `${portalBaseUrl()}/agendar/${clinic.slug}`;
  return (
    <View style={{ gap: Space.sm }}>
      <View style={styles.titleRow}>
        <Title>{clinic.name}</Title>
        <Badge label={STATUS_LABEL[clinic.status]} tone={STATUS_TONE[clinic.status]} />
      </View>
      <Muted>
        {link} · cliente desde {brDate(clinic.created_at)}
      </Muted>
      <View style={styles.actions}>
        <Button label="Abrir painel da clínica" variant="secondary" onPress={() => router.push(`/painel/${clinic.id}`)} />
        <Button label="Abrir link de agendamento" variant="secondary" onPress={() => Linking.openURL(link)} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------
// Situação
// ---------------------------------------------------------------------
function StatusCard({ clinic, onChanged }: { clinic: OverviewClinic; onChanged: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const stopped = clinic.status === 'suspensa' || clinic.status === 'cancelada';

  const change = async (status: OverviewClinic['status'], why?: string) => {
    setMsg(null);
    setBusy(true);
    try {
      await setClinicStatus(clinic.id, status, why ?? null);
      setReason('');
      onChanged();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionLabel>Situação</SectionLabel>
      {stopped ? (
        <>
          <Notice tone="warning">
            {STATUS_LABEL[clinic.status]}
            {clinic.suspended_reason ? `: ${clinic.suspended_reason}` : ''}. O link de agendamento está fora do ar. A
            equipe ainda entra no painel e vê um aviso.
          </Notice>
          <Button label="Reativar clínica" loading={busy} onPress={() => change('ativa')} />
        </>
      ) : (
        <>
          <Muted>
            {clinic.status === 'teste'
              ? `Em período de teste até ${brDate(clinic.trial_ends_on)}.`
              : 'Ativa: link e painel funcionando normalmente.'}{' '}
            Suspender tira o link do ar, sem apagar nada.
          </Muted>
          <Field
            label="Motivo (aparece para a clínica)"
            value={reason}
            onChangeText={setReason}
            placeholder="Ex.: Pagamento em atraso"
          />
          <View style={styles.actions}>
            <Button
              label="Suspender"
              variant="secondary"
              loading={busy}
              onPress={() => change('suspensa', reason.trim() || 'Suspensa pelo suporte')}
            />
            <Button
              label="Cancelar assinatura"
              variant="secondary"
              onPress={() => change('cancelada', reason.trim() || 'Assinatura cancelada')}
            />
            {clinic.status === 'teste' ? <Button label="Marcar como ativa" variant="secondary" onPress={() => change('ativa')} /> : null}
          </View>
        </>
      )}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------
// Assinatura
// ---------------------------------------------------------------------
function SubscriptionCard({ clinic, plans, onSaved }: { clinic: OverviewClinic; plans: Plan[]; onSaved: () => void }) {
  const plan = plans.find((p) => p.id === clinic.plan_id) ?? null;
  const [planId, setPlanId] = useState<string | null>(clinic.plan_id);
  const [price, setPrice] = useState(
    plan && clinic.price === plan.price_monthly ? '' : moneyInput(clinic.price),
  );
  const [dueDay, setDueDay] = useState(clinic.due_day ? String(clinic.due_day) : '');
  const [nextDue, setNextDue] = useState(clinic.next_due_date ? dateKeyToBr(clinic.next_due_date) : '');
  const [trialEnd, setTrialEnd] = useState(clinic.trial_ends_on ? dateKeyToBr(clinic.trial_ends_on) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const chosen = plans.find((p) => p.id === planId) ?? null;

  const save = async () => {
    setMsg(null);
    const priceNum = price.trim() ? parseMoney(price) : null;
    if (priceNum != null && (Number.isNaN(priceNum) || priceNum < 0)) return setMsg({ tone: 'danger', text: 'Valor mensal inválido.' });
    const day = dueDay.trim() ? Number(dueDay) : null;
    if (day != null && (!Number.isInteger(day) || day < 1 || day > 28))
      return setMsg({ tone: 'danger', text: 'Dia de vencimento: de 1 a 28.' });
    const next = nextDue.trim() ? brToDateKey(nextDue) : null;
    if (nextDue.trim() && !next) return setMsg({ tone: 'danger', text: 'Próximo vencimento: use DD/MM/AAAA.' });
    const trial = trialEnd.trim() ? brToDateKey(trialEnd) : null;
    if (trialEnd.trim() && !trial) return setMsg({ tone: 'danger', text: 'Fim do teste: use DD/MM/AAAA.' });
    setBusy(true);
    try {
      await updateSubscription(clinic.id, {
        plan_id: planId,
        monthly_price: priceNum,
        due_day: day,
        next_due_date: next,
        trial_ends_on: trial,
      });
      setMsg({ tone: 'success', text: 'Assinatura salva.' });
      onSaved();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionLabel>Assinatura</SectionLabel>
      <View style={styles.chips}>
        <Chip label="Sem plano" selected={planId === null} onPress={() => setPlanId(null)} />
        {plans.map((p) => (
          <Chip
            key={p.id}
            label={`${p.name} · ${money(p.price_monthly)}${p.active ? '' : ' (inativo)'}`}
            selected={planId === p.id}
            onPress={() => setPlanId(p.id)}
          />
        ))}
      </View>
      {plans.length === 0 ? <Muted>Cadastre planos na aba Planos.</Muted> : null}
      <Field
        label="Valor mensal combinado"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder={chosen ? moneyInput(chosen.price_monthly) : '0,00'}
        hint={chosen ? 'Deixe vazio para usar o valor do plano. Preencha só para um preço especial.' : 'Em reais.'}
      />
      <View style={styles.row}>
        <Field
          label="Dia do vencimento"
          value={dueDay}
          onChangeText={(v) => setDueDay(v.replace(/\D/g, '').slice(0, 2))}
          keyboardType="number-pad"
          placeholder="10"
          style={styles.flex}
        />
        <Field
          label="Próximo vencimento"
          value={nextDue}
          onChangeText={(v) => setNextDue(maskDate(v))}
          keyboardType="number-pad"
          placeholder="DD/MM/AAAA"
          style={styles.flex}
        />
        <Field
          label="Fim do teste"
          value={trialEnd}
          onChangeText={(v) => setTrialEnd(maskDate(v))}
          keyboardType="number-pad"
          placeholder="DD/MM/AAAA"
          style={styles.flex}
        />
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Button label="Salvar assinatura" loading={busy} onPress={save} />
    </Card>
  );
}

// ---------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------
function PaymentsCard({ clinic, payments, onChanged }: { clinic: OverviewClinic; payments: Payment[]; onChanged: () => void }) {
  const c = usePalette();
  const [amount, setAmount] = useState(moneyInput(clinic.price));
  const [paidOn, setPaidOn] = useState(dateKeyToBr(todayKey()));
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [reference, setReference] = useState('');
  const [advance, setAdvance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const submit = async () => {
    setMsg(null);
    const value = parseMoney(amount);
    if (!(value > 0)) return setMsg({ tone: 'danger', text: 'Informe o valor recebido.' });
    const date = brToDateKey(paidOn);
    if (!date) return setMsg({ tone: 'danger', text: 'Data do pagamento: use DD/MM/AAAA.' });
    setBusy(true);
    try {
      const r = await registerPayment({
        clinicId: clinic.id,
        amount: value,
        paidOn: date,
        method,
        reference: reference.trim() || null,
        notes: null,
        advance,
      });
      setMsg({
        tone: 'success',
        text: `Pagamento registrado.${r.next_due_date ? ` Próximo vencimento: ${brDate(r.next_due_date)}.` : ''}`,
      });
      setReference('');
      onChanged();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deletePayment(id);
      setConfirmId(null);
      onChanged();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    }
  };

  return (
    <Card>
      <SectionLabel>Registrar pagamento recebido</SectionLabel>
      <View style={styles.row}>
        <Field label="Valor (R$)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={styles.flex} />
        <Field
          label="Pago em"
          value={paidOn}
          onChangeText={(v) => setPaidOn(maskDate(v))}
          keyboardType="number-pad"
          style={styles.flex}
        />
        <Field label="Referência" value={reference} onChangeText={setReference} placeholder="Ex.: 11/2026" style={styles.flex} />
      </View>
      <View style={styles.chips}>
        {(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((m) => (
          <Chip key={m} label={PAYMENT_METHODS[m]} selected={method === m} onPress={() => setMethod(m)} />
        ))}
      </View>
      <Checkbox checked={advance} onChange={setAdvance}>
        Avançar o vencimento em 1 mês (de {brDate(clinic.next_due_date)} para o mês seguinte). Se estiver suspensa por
        atraso ou fim do teste, a clínica é reativada.
      </Checkbox>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Button label="Registrar pagamento" loading={busy} onPress={submit} />

      <SectionLabel>Histórico</SectionLabel>
      {payments.length === 0 ? (
        <Muted>Nenhum pagamento registrado.</Muted>
      ) : (
        payments.map((p) => (
          <View key={p.id} style={[styles.payment, { borderBottomColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{money(p.amount)}</Text>
              <Muted style={{ fontSize: 13 }}>
                {brDate(p.paid_on)} · {PAYMENT_METHODS[p.method]}
                {p.reference ? ` · ref. ${p.reference}` : ''}
              </Muted>
            </View>
            {confirmId === p.id ? (
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" onPress={() => remove(p.id)} hitSlop={6}>
                  <Text style={{ color: c.danger, fontWeight: '700' }}>Apagar</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setConfirmId(null)} hitSlop={6}>
                  <Text style={{ color: c.textMuted, fontWeight: '600' }}>Manter</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Apagar pagamento" onPress={() => setConfirmId(p.id)} hitSlop={6}>
                <Text style={{ color: c.textMuted }}>✕</Text>
              </Pressable>
            )}
          </View>
        ))
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// Uso e saúde do link
// ---------------------------------------------------------------------
function UsageCard({ clinic }: { clinic: OverviewClinic }) {
  const c = usePalette();
  const rows: [string, string][] = [
    ['Agendamentos nos últimos 30 dias', String(clinic.appts_30d)],
    ['… feitos pelo link', String(clinic.portal_30d)],
    ['Acessos ao link (30 dias)', String(clinic.views_30d)],
    ['Próximos agendamentos', String(clinic.upcoming)],
    ['Agendamentos no total', String(clinic.appts_total)],
    ['Pacientes cadastrados', String(clinic.contacts)],
    [
      'Profissionais ativos',
      clinic.max_professionals ? `${clinic.professionals} de ${clinic.max_professionals} do plano` : String(clinic.professionals),
    ],
    ['Logins da equipe', String(clinic.members)],
    ['Serviços no link', String(clinic.public_services)],
    ['Arquivos (fotos)', formatBytes(clinic.storage_bytes)],
    ['Último movimento', ago(clinic.last_activity)],
    ['Equipe entrou pela última vez', ago(clinic.last_sign_in)],
    ['Google Agenda', clinic.google_notify_enabled ? `ligado · ${clinic.google_errors_30d} erros em 30 dias` : 'desligado'],
    ['Último pagamento', brDate(clinic.last_payment)],
  ];
  return (
    <Card>
      <SectionLabel>Uso e saúde do link</SectionLabel>
      {clinic.problems.length ? (
        clinic.problems.map((p) => (
          <View key={p} style={[styles.problem, { backgroundColor: c.warningSoft }]}>
            <Text style={{ color: c.warning, fontWeight: '600' }}>⚠ {p}</Text>
          </View>
        ))
      ) : (
        <Notice tone="success">Link funcionando e sem pendências.</Notice>
      )}
      {rows.map(([label, value]) => (
        <View key={label} style={[styles.usageRow, { borderBottomColor: c.border }]}>
          <Text style={{ color: c.textMuted, flex: 1 }}>{label}</Text>
          <Text style={{ color: c.text, fontWeight: '700' }}>{value}</Text>
        </View>
      ))}
    </Card>
  );
}

function NotesCard({ clinicId, initial }: { clinicId: string; initial: string }) {
  const [notes, setNotes] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await saveNotes(clinicId, notes);
      setMsg({ tone: 'success', text: 'Anotações salvas.' });
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <SectionLabel>Anotações internas</SectionLabel>
      <Field
        label="Só você vê"
        value={notes}
        onChangeText={(v) => setNotes(v.slice(0, 4000))}
        multiline
        placeholder="Contato do responsável, combinados, histórico de atendimento…"
      />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Button label="Salvar anotações" variant="secondary" loading={busy} onPress={save} />
    </Card>
  );
}

// ---------------------------------------------------------------------
// Exclusão definitiva
// ---------------------------------------------------------------------
function DangerCard({ clinic }: { clinic: OverviewClinic }) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleteUsers, setDeleteUsers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      await deleteClinic(clinic.id, typed.trim(), deleteUsers);
      router.replace('/painel/admin');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card style={{ borderColor: c.danger }}>
      <SectionLabel>Excluir clínica</SectionLabel>
      <Muted>
        Apaga para sempre a clínica, os {clinic.appts_total} agendamentos, os {clinic.contacts} pacientes, serviços,
        profissionais, pagamentos e fotos. Não dá para desfazer. Se for só uma pausa, prefira Suspender ou Cancelar.
      </Muted>
      {!open ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={[styles.dangerBtn, { borderColor: c.danger }]}>
          <Text style={{ color: c.danger, fontWeight: '700' }}>Quero excluir esta clínica</Text>
        </Pressable>
      ) : (
        <>
          <Field
            label={`Para confirmar, digite o link: ${clinic.slug}`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Checkbox checked={deleteUsers} onChange={setDeleteUsers}>
            Apagar também os logins da equipe que não pertencem a nenhuma outra clínica.
          </Checkbox>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Pressable
            accessibilityRole="button"
            disabled={typed.trim() !== clinic.slug || busy}
            onPress={run}
            style={[
              styles.dangerBtn,
              { backgroundColor: c.danger, borderColor: c.danger, opacity: typed.trim() === clinic.slug && !busy ? 1 : 0.4 },
            ]}>
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{busy ? 'Excluindo…' : 'Excluir definitivamente'}</Text>
          </Pressable>
          <Button label="Desistir" variant="secondary" onPress={() => setOpen(false)} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  back: { fontSize: 15, fontWeight: '600', opacity: 0.8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, alignItems: 'center' },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.lg, alignItems: 'flex-start' },
  col: { flexGrow: 1, flexBasis: 380, gap: Space.lg },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  flex: { flex: 1, minWidth: 140 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  payment: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  usageRow: { flexDirection: 'row', gap: Space.md, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  problem: { borderRadius: Radius.md, paddingHorizontal: Space.md, paddingVertical: Space.sm },
  dangerBtn: { borderWidth: 1.5, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
});
