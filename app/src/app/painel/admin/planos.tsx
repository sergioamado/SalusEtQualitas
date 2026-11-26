import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Field, Loading, Muted, Notice, Screen, SectionLabel, Text, Title, ToggleRow } from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { deletePlan, listPlans, money, savePlan, type Plan } from '@/features/platform/api';

const parseMoney = (v: string) => Number(v.replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));

/** Planos que o gerente do sistema oferece às clínicas. */
export default function PlansScreen() {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; plans?: Plan[]; error?: string }>();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listPlans()
      .then((plans) => active && setLoaded({ key: version, plans }))
      .catch((e: Error) => active && setLoaded({ key: version, error: e.message }));
    return () => {
      active = false;
    };
  }, [version]);

  const close = (message?: string) => {
    setEditing(null);
    setNotice(message ?? null);
    setVersion((v) => v + 1);
  };

  return (
    <Screen wide safeTop={false}>
      <Title>Planos</Title>
      <Muted>
        Os planos aparecem ao criar uma clínica e na assinatura de cada uma. Mudar o valor de um plano muda a cobrança de
        todas as clínicas nele, exceto as que têm um valor especial combinado.
      </Muted>
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {editing ? (
        <PlanForm plan={editing === 'new' ? null : editing} onClose={close} />
      ) : (
        <Button label="+ Novo plano" onPress={() => setEditing('new')} />
      )}

      {loaded?.error ? (
        <Notice tone="danger">{loaded.error}</Notice>
      ) : !loaded?.plans ? (
        <Loading />
      ) : loaded.plans.length === 0 ? (
        <Muted>Nenhum plano ainda. Exemplo: “Essencial · R$ 89,90 · até 2 profissionais”.</Muted>
      ) : (
        loaded.plans.map((p) => <PlanCard key={p.id} plan={p} onEdit={() => setEditing(p)} />)
      )}
    </Screen>
  );
}

function PlanCard({ plan, onEdit }: { plan: Plan; onEdit: () => void }) {
  const c = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onEdit}>
      <Card>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>{plan.name}</Text>
            {plan.description ? <Muted>{plan.description}</Muted> : null}
            <Muted>
              {plan.max_professionals ? `Até ${plan.max_professionals} profissionais` : 'Profissionais ilimitados'}
            </Muted>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>{money(plan.price_monthly)}</Text>
            <Muted style={{ fontSize: 13 }}>por mês</Muted>
            {!plan.active ? <Badge label="Inativo" /> : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function PlanForm({ plan, onClose }: { plan: Plan | null; onClose: (message?: string) => void }) {
  const c = usePalette();
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [price, setPrice] = useState(plan ? plan.price_monthly.toFixed(2).replace('.', ',') : '');
  const [maxPros, setMaxPros] = useState(plan?.max_professionals ? String(plan.max_professionals) : '');
  const [active, setActive] = useState(plan?.active ?? true);
  const [order, setOrder] = useState(String(plan?.sort_order ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    setError(null);
    const value = parseMoney(price);
    if (name.trim().length < 2) return setError('Informe o nome do plano.');
    if (!Number.isFinite(value) || value < 0) return setError('Informe o valor mensal.');
    const max = maxPros.trim() ? Number(maxPros) : null;
    if (max != null && (!Number.isInteger(max) || max < 1)) return setError('Limite de profissionais inválido.');
    setBusy(true);
    try {
      await savePlan({
        id: plan?.id,
        name: name.trim(),
        description: description.trim() || null,
        price_monthly: value,
        max_professionals: max,
        active,
        sort_order: Number(order) || 0,
      });
      onClose(plan ? 'Plano atualizado.' : 'Plano criado.');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await deletePlan(plan.id);
      onClose('Plano excluído. As clínicas que estavam nele ficaram “sem plano”.');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionLabel>{plan ? 'Editar plano' : 'Novo plano'}</SectionLabel>
      <Field label="Nome" value={name} onChangeText={setName} placeholder="Ex.: Essencial" />
      <Field
        label="Descrição (opcional)"
        value={description}
        onChangeText={(v) => setDescription(v.slice(0, 300))}
        placeholder="Ex.: Para clínicas de até 2 profissionais"
      />
      <View style={styles.formRow}>
        <Field label="Valor mensal (R$)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={styles.flex} />
        <Field
          label="Máx. de profissionais"
          value={maxPros}
          onChangeText={(v) => setMaxPros(v.replace(/\D/g, '').slice(0, 3))}
          keyboardType="number-pad"
          placeholder="Vazio = ilimitado"
          style={styles.flex}
        />
        <Field
          label="Ordem"
          value={order}
          onChangeText={(v) => setOrder(v.replace(/\D/g, '').slice(0, 3))}
          keyboardType="number-pad"
          style={styles.flex}
        />
      </View>
      <ToggleRow
        label="Disponível para novas clínicas"
        description="Desative para parar de oferecer, sem mexer em quem já usa."
        value={active}
        onChange={setActive}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={styles.formRow}>
        <View style={styles.flex}>
          <Button label="Salvar plano" loading={busy} onPress={save} />
        </View>
        <View style={styles.flex}>
          <Button label="Cancelar" variant="secondary" onPress={() => onClose()} />
        </View>
      </View>
      {plan ? (
        confirmDelete ? (
          <View style={styles.formRow}>
            <Pressable accessibilityRole="button" onPress={remove} hitSlop={8}>
              <Text style={{ color: c.danger, fontWeight: '700' }}>Confirmar exclusão do plano</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(false)} hitSlop={8}>
              <Text style={{ color: c.textMuted, fontWeight: '600' }}>Manter</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} hitSlop={8}>
            <Text style={{ color: c.danger, fontWeight: '600' }}>Excluir plano</Text>
          </Pressable>
        )
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 140 },
});
