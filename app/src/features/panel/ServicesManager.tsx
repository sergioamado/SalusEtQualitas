import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ServiceMedia } from '@/components/ServiceMedia';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  Field,
  Loading,
  Muted,
  Notice,
  SectionLabel,
  Text,
  ToggleRow,
} from '@/components/ui';
import { Space, usePalette } from '@/constants/theme';
import { formatDuration, formatPrice } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { pickAndUploadImage, removeUploadedImage } from '@/lib/upload';
import { youTubeId, youTubeWatchUrl } from '@/lib/youtube';

type Service = {
  id: string;
  name: string;
  description: string | null;
  duration_min: number;
  price: number | null;
  allows_clinic: boolean;
  allows_home_care: boolean;
  requires_room: boolean;
  public_visible: boolean;
  active: boolean;
  image_url: string | null;
  video_url: string | null;
  sort_order: number;
};
type Named = { id: string; name: string; active: boolean };
type Data = {
  services: Service[];
  professionals: Named[];
  rooms: Named[];
  /** procedure_id -> ids */
  profBy: Record<string, string[]>;
  roomBy: Record<string, string[]>;
};

const DURATIONS = [15, 30, 45, 60, 90, 120];

async function loadData(clinicId: string): Promise<Data> {
  const [s, p, r] = await Promise.all([
    supabase.from('procedures').select('*').eq('clinic_id', clinicId).order('sort_order').order('name'),
    supabase.from('professionals').select('id,name,active').eq('clinic_id', clinicId).order('name'),
    supabase.from('rooms').select('id,name,active').eq('clinic_id', clinicId).order('name'),
  ]);
  const error = s.error ?? p.error ?? r.error;
  if (error) throw new Error(error.message);
  const services = (s.data ?? []) as Service[];
  const ids = services.map((x) => x.id);
  const profBy: Record<string, string[]> = {};
  const roomBy: Record<string, string[]> = {};
  if (ids.length) {
    const [pp, pr] = await Promise.all([
      supabase.from('professional_procedures').select('procedure_id,professional_id').in('procedure_id', ids),
      supabase.from('procedure_rooms').select('procedure_id,room_id').in('procedure_id', ids),
    ]);
    if (pp.error ?? pr.error) throw new Error((pp.error ?? pr.error)!.message);
    for (const row of pp.data ?? []) (profBy[row.procedure_id] ??= []).push(row.professional_id);
    for (const row of pr.data ?? []) (roomBy[row.procedure_id] ??= []).push(row.room_id);
  }
  return {
    services,
    professionals: (p.data ?? []) as Named[],
    rooms: (r.data ?? []) as Named[],
    profBy,
    roomBy,
  };
}

/** Cadastro dos serviços da clínica: o que aparece no link de agendamento, foto e vídeo. */
export function ServicesManager({ clinicId }: { clinicId: string }) {
  const [version, setVersion] = useState(0);
  const key = `${clinicId}|${version}`;
  const [response, setResponse] = useState<{ key: string; data?: Data; error?: string }>();
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    loadData(clinicId)
      .then((data) => active && setResponse({ key, data }))
      .catch((e: Error) => active && setResponse({ key, error: e.message }));
    return () => {
      active = false;
    };
  }, [clinicId, key]);

  // Mantém a lista na tela enquanto recarrega.
  const current = response?.key === key ? response : response?.data ? response : undefined;
  const refresh = () => setVersion((v) => v + 1);

  if (!current) return <Loading label="Carregando serviços…" />;
  if (current.error || !current.data) return <Notice tone="danger">{current.error ?? 'Erro ao carregar.'}</Notice>;
  const data = current.data;

  if (editing) {
    const service = editing === 'new' ? null : editing;
    return (
      <ServiceForm
        clinicId={clinicId}
        service={service}
        data={data}
        nextOrder={data.services.length ? Math.max(...data.services.map((s) => s.sort_order)) + 1 : 0}
        onClose={(text) => {
          setEditing(null);
          if (text) setMessage({ tone: 'success', text });
          refresh();
        }}
      />
    );
  }

  const setVisible = async (s: Service, value: boolean) => {
    setMessage(null);
    const { error } = await supabase.from('procedures').update({ public_visible: value }).eq('id', s.id);
    if (error) setMessage({ tone: 'danger', text: 'Não foi possível alterar. Tente novamente.' });
    refresh();
  };

  const move = async (index: number, delta: -1 | 1) => {
    const list = [...data.services];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    const results = await Promise.all(
      list.map((s, i) => (s.sort_order === i ? null : supabase.from('procedures').update({ sort_order: i }).eq('id', s.id))),
    );
    if (results.some((r) => r?.error)) setMessage({ tone: 'danger', text: 'Não foi possível mudar a ordem.' });
    refresh();
  };

  const activeProfessionals = data.professionals.filter((p) => p.active);
  const onPortal = data.services.filter(
    (s) => s.active && s.public_visible && (data.profBy[s.id] ?? []).some((id) => activeProfessionals.some((p) => p.id === id)),
  ).length;

  return (
    <View style={{ gap: Space.md }}>
      <Muted>
        Escolha quais serviços aparecem no link de agendamento. A ordem da lista é a mesma que o paciente vê.{' '}
        {onPortal} de {data.services.length} serviço(s) aparecem hoje no link.
      </Muted>
      {data.professionals.length === 0 ? (
        <Notice tone="warning">
          Esta clínica ainda não tem profissionais. Um serviço só aparece no link quando alguém o realiza. Se você mesmo(a)
          atende, vá em Profissionais e horários e toque em “Sim, eu atendo”.
        </Notice>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button label="+ Novo serviço" onPress={() => setEditing('new')} />

      {data.services.length === 0 ? <Muted>Nenhum serviço cadastrado ainda.</Muted> : null}

      {data.services.map((s, index) => {
        const profs = (data.profBy[s.id] ?? []).filter((id) => activeProfessionals.some((p) => p.id === id));
        const problem = !s.active
          ? null
          : profs.length === 0
            ? 'Sem profissional: não aparece no link.'
            : s.allows_clinic && s.requires_room && data.rooms.filter((r) => r.active).length === 0
              ? 'Precisa de sala, mas a clínica não tem salas ativas.'
              : null;
        return (
          <Card key={s.id} style={{ gap: Space.sm }}>
            <View style={styles.row}>
              {s.image_url || s.video_url ? (
                <View style={styles.thumb}>
                  <ServiceMedia imageUrl={s.image_url} videoUrl={s.video_url} height={64} showPlay={false} />
                </View>
              ) : null}
              <View style={styles.flex}>
                <Text style={styles.name}>{s.name}</Text>
                <Muted>
                  {[formatDuration(s.duration_min), formatPrice(s.price), modalityLabel(s)].filter(Boolean).join(' · ')}
                </Muted>
                <View style={styles.badges}>
                  {!s.active ? <Badge label="Desativado" /> : s.public_visible ? <Badge label="No link" tone="success" /> : <Badge label="Só interno" />}
                  {s.video_url ? <Badge label="Vídeo" tone="primary" /> : null}
                  {s.image_url ? <Badge label="Foto" tone="primary" /> : null}
                </View>
              </View>
              <View style={styles.order}>
                <OrderButton label="↑" disabled={index === 0} onPress={() => move(index, -1)} />
                <OrderButton label="↓" disabled={index === data.services.length - 1} onPress={() => move(index, 1)} />
              </View>
            </View>
            {problem ? <Notice tone="warning">{problem}</Notice> : null}
            {s.active ? (
              <ToggleRow
                label="Disponível no link de agendamento"
                value={s.public_visible}
                onChange={(v) => setVisible(s, v)}
              />
            ) : null}
            <Button label="Editar" variant="secondary" onPress={() => setEditing(s)} />
          </Card>
        );
      })}
    </View>
  );
}

function modalityLabel(s: Service) {
  if (s.allows_clinic && s.allows_home_care) return 'Clínica e residencial';
  return s.allows_home_care ? 'Residencial' : 'Na clínica';
}

function OrderButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '↑' ? 'Mover para cima' : 'Mover para baixo'}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={[styles.orderBtn, { borderColor: c.border, opacity: disabled ? 0.3 : 1 }]}>
      <Text style={{ color: c.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------

function ServiceForm({
  clinicId,
  service,
  data,
  nextOrder,
  onClose,
}: {
  clinicId: string;
  service: Service | null;
  data: Data;
  nextOrder: number;
  onClose: (message?: string) => void;
}) {
  const c = usePalette();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [duration, setDuration] = useState(String(service?.duration_min ?? 60));
  const [price, setPrice] = useState(service?.price != null ? String(service.price).replace('.', ',') : '');
  const [allowsClinic, setAllowsClinic] = useState(service?.allows_clinic ?? true);
  const [allowsHome, setAllowsHome] = useState(service?.allows_home_care ?? false);
  const [requiresRoom, setRequiresRoom] = useState(service?.requires_room ?? data.rooms.length > 0);
  const [visible, setVisible] = useState(service?.public_visible ?? true);
  const [active, setActive] = useState(service?.active ?? true);
  const [imageUrl, setImageUrl] = useState(service?.image_url ?? null);
  const [video, setVideo] = useState(service?.video_url ?? '');
  const [profIds, setProfIds] = useState<string[]>(
    service ? (data.profBy[service.id] ?? []) : data.professionals.filter((p) => p.active).map((p) => p.id),
  );
  const [roomIds, setRoomIds] = useState<string[]>(service ? (data.roomBy[service.id] ?? []) : []);
  // Imagens enviadas neste formulário que ainda não foram salvas (apagadas se o usuário cancelar).
  const [pending, setPending] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const durationNum = Number(duration);
  const priceNum = price.trim() ? Number(price.replace(/\./g, '').replace(',', '.')) : null;
  const videoId = youTubeId(video);
  const errors = {
    name: name.trim().length < 2 ? 'Informe o nome do serviço.' : null,
    duration:
      !Number.isInteger(durationNum) || durationNum < 5 || durationNum > 720 ? 'Entre 5 e 720 minutos.' : null,
    price: priceNum != null && (!Number.isFinite(priceNum) || priceNum < 0) ? 'Valor inválido. Ex.: 150,00' : null,
    video: video.trim() && !videoId ? 'Cole um link do YouTube (youtube.com/watch?v=… ou youtu.be/…).' : null,
    modality: !allowsClinic && !allowsHome ? 'Marque pelo menos um local de atendimento.' : null,
    description: description.length > 600 ? 'Máximo de 600 caracteres.' : null,
  };
  const valid = !Object.values(errors).some(Boolean);
  const [touched, setTouched] = useState(false);
  const show = (e: string | null) => (touched ? e : null);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const pickImage = async () => {
    setError(null);
    setUploading(true);
    try {
      const url = await pickAndUploadImage(clinicId, 'service');
      if (url) {
        setPending((p) => [...p, url]);
        setImageUrl(url);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const cancel = async () => {
    await Promise.all(pending.map((u) => removeUploadedImage(u)));
    onClose();
  };

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setError(null);
    const row = {
      clinic_id: clinicId,
      name: name.trim(),
      description: description.trim() || null,
      duration_min: durationNum,
      price: priceNum,
      allows_clinic: allowsClinic,
      allows_home_care: allowsHome,
      requires_room: allowsClinic && requiresRoom,
      public_visible: visible,
      active,
      image_url: imageUrl,
      video_url: videoId ? youTubeWatchUrl(videoId) : null,
    };
    try {
      let id = service?.id;
      if (id) {
        const { error: e } = await supabase.from('procedures').update(row).eq('id', id);
        if (e) throw e;
      } else {
        const { data: created, error: e } = await supabase
          .from('procedures')
          .insert({ ...row, sort_order: nextOrder })
          .select('id')
          .single();
        if (e) throw e;
        id = created.id as string;
      }

      // Quem realiza e em quais salas: substitui a lista anterior.
      const d1 = await supabase.from('professional_procedures').delete().eq('procedure_id', id);
      if (d1.error) throw d1.error;
      if (profIds.length) {
        const i1 = await supabase
          .from('professional_procedures')
          .insert(profIds.map((pid) => ({ procedure_id: id, professional_id: pid })));
        if (i1.error) throw i1.error;
      }
      const d2 = await supabase.from('procedure_rooms').delete().eq('procedure_id', id);
      if (d2.error) throw d2.error;
      const rooms = row.requires_room ? roomIds : [];
      if (rooms.length) {
        const i2 = await supabase.from('procedure_rooms').insert(rooms.map((rid) => ({ procedure_id: id, room_id: rid })));
        if (i2.error) throw i2.error;
      }

      // Limpa imagens que não ficaram em uso.
      const unused = [...pending, service?.image_url ?? null].filter((u): u is string => !!u && u !== imageUrl);
      await Promise.all(unused.map((u) => removeUploadedImage(u)));
      onClose(service ? 'Serviço atualizado.' : 'Serviço criado.');
    } catch (e) {
      const msg = (e as { message?: string }).message ?? '';
      setError(
        /row-level security|permission/i.test(msg)
          ? 'Somente o gerente da clínica pode alterar serviços.'
          : `Não foi possível salvar. ${msg}`,
      );
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!service) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from('procedures').delete().eq('id', service.id);
    if (e) {
      setSaving(false);
      setConfirmDelete(false);
      setError(
        e.code === '23503'
          ? 'Este serviço já tem agendamentos e não pode ser excluído. Desative-o: ele some do link, mas o histórico fica guardado.'
          : `Não foi possível excluir. ${e.message}`,
      );
      return;
    }
    await Promise.all([...pending, service.image_url].filter((u): u is string => !!u).map((u) => removeUploadedImage(u)));
    onClose('Serviço excluído.');
  };

  return (
    <View style={{ gap: Space.md }}>
      <Text style={styles.formTitle}>{service ? 'Editar serviço' : 'Novo serviço'}</Text>

      <Card style={{ gap: Space.md }}>
        <Field label="Nome do serviço" value={name} onChangeText={setName} placeholder="Ex.: Fisioterapia" error={show(errors.name)} />
        <Field
          label="Descrição (opcional)"
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="O que o paciente precisa saber sobre este serviço"
          hint={`${description.length}/600`}
          error={show(errors.description)}
        />
        <View style={{ gap: Space.xs }}>
          <SectionLabel>Duração</SectionLabel>
          <View style={styles.chips}>
            {DURATIONS.map((d) => (
              <Chip key={d} label={formatDuration(d)} selected={durationNum === d} onPress={() => setDuration(String(d))} />
            ))}
          </View>
          <Field
            label="Minutos"
            value={duration}
            onChangeText={(t) => setDuration(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            error={show(errors.duration)}
          />
        </View>
        <Field
          label="Preço (opcional)"
          value={price}
          onChangeText={(t) => setPrice(t.replace(/[^\d,.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="Ex.: 150,00"
          hint="Deixe em branco para não mostrar o preço."
          error={show(errors.price)}
        />
      </Card>

      <Card style={{ gap: Space.md }}>
        <SectionLabel>Foto e vídeo</SectionLabel>
        <Muted>Aparecem para o paciente na hora de escolher o serviço. Use uma foto horizontal (JPG, PNG ou WEBP, até 5 MB).</Muted>
        <ServiceMedia imageUrl={imageUrl} videoUrl={videoId ? youTubeWatchUrl(videoId) : null} height={180} />
        <View style={styles.chips}>
          <Button label={imageUrl ? 'Trocar foto' : 'Escolher foto'} variant="secondary" loading={uploading} onPress={pickImage} />
          {imageUrl ? <Button label="Remover foto" variant="secondary" onPress={() => setImageUrl(null)} /> : null}
        </View>
        <Field
          label="Link do YouTube (opcional)"
          value={video}
          onChangeText={setVideo}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://www.youtube.com/watch?v=…"
          hint={videoId ? 'Vídeo reconhecido ✓' : 'Também vale link de Shorts ou youtu.be.'}
          error={video.trim() && !videoId ? errors.video : null}
        />
      </Card>

      <Card style={{ gap: Space.sm }}>
        <SectionLabel>Onde é atendido</SectionLabel>
        <Checkbox checked={allowsClinic} onChange={setAllowsClinic}>Na clínica</Checkbox>
        <Checkbox checked={allowsHome} onChange={setAllowsHome}>Residencial (Home Care)</Checkbox>
        {show(errors.modality) ? <Notice tone="danger">{errors.modality}</Notice> : null}
        {allowsClinic ? (
          <>
            <ToggleRow
              label="Precisa de sala"
              description="Ligado: o horário só é oferecido se houver sala livre."
              value={requiresRoom}
              onChange={setRequiresRoom}
            />
            {requiresRoom ? (
              data.rooms.length === 0 ? (
                <Notice tone="warning">A clínica não tem salas cadastradas. Desligue “Precisa de sala” ou cadastre salas.</Notice>
              ) : (
                <View style={{ gap: Space.xs }}>
                  <Muted>Em quais salas? (nenhuma marcada = qualquer sala)</Muted>
                  {data.rooms.map((r) => (
                    <Checkbox key={r.id} checked={roomIds.includes(r.id)} onChange={() => setRoomIds((l) => toggle(l, r.id))}>
                      {r.name}
                      {r.active ? '' : ' (inativa)'}
                    </Checkbox>
                  ))}
                </View>
              )
            ) : null}
          </>
        ) : null}
      </Card>

      <Card style={{ gap: Space.sm }}>
        <SectionLabel>Quem realiza</SectionLabel>
        {data.professionals.length === 0 ? (
          <Notice tone="warning">Nenhum profissional cadastrado. Sem profissional, o serviço não aparece no link.</Notice>
        ) : (
          data.professionals.map((p) => (
            <Checkbox key={p.id} checked={profIds.includes(p.id)} onChange={() => setProfIds((l) => toggle(l, p.id))}>
              {p.name}
              {p.active ? '' : ' (inativo)'}
            </Checkbox>
          ))
        )}
      </Card>

      <Card style={{ gap: Space.sm }}>
        <SectionLabel>Disponibilidade</SectionLabel>
        <ToggleRow
          label="Disponível no link de agendamento"
          description="Desligado: só a equipe agenda este serviço pelo painel."
          value={visible}
          onChange={setVisible}
        />
        <ToggleRow
          label="Serviço ativo"
          description="Desativado: some do link e da agenda, mas o histórico fica guardado."
          value={active}
          onChange={setActive}
        />
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {touched && !valid ? <Notice tone="danger">Confira os campos destacados.</Notice> : null}
      <Button label={service ? 'Salvar alterações' : 'Criar serviço'} loading={saving} disabled={uploading} onPress={save} />
      <Button label="Cancelar" variant="secondary" disabled={saving} onPress={cancel} />

      {service ? (
        confirmDelete ? (
          <Card style={{ gap: Space.sm, borderColor: c.danger }}>
            <Text style={{ color: c.danger, fontWeight: '700' }}>Excluir “{service.name}”?</Text>
            <Muted>Não dá para desfazer. Se já houver agendamentos, prefira desativar.</Muted>
            <Button label="Sim, excluir" loading={saving} onPress={remove} />
            <Button label="Não" variant="secondary" onPress={() => setConfirmDelete(false)} />
          </Card>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={styles.deleteLink}>
            <Text style={{ color: c.danger, fontWeight: '600' }}>Excluir serviço</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', gap: Space.md, alignItems: 'center' },
  thumb: { width: 96 },
  name: { fontSize: 17, fontWeight: '700' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs, marginTop: 4 },
  order: { gap: Space.xs },
  orderBtn: { width: 36, height: 32, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  formTitle: { fontSize: 20, fontWeight: '700' },
  deleteLink: { alignSelf: 'center', padding: Space.sm },
});
