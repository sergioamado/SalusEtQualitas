import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
import { callFunction, useAuth } from '@/lib/auth';
import { createSelfProfessional, saveProfessional } from '@/lib/professionals';
import {
  dayError,
  defaultWeek,
  weekFromRows,
  weekSummary,
  type BreakRow,
  type HourRow,
  type WeekSchedule,
} from '@/lib/schedule';
import { supabase } from '@/lib/supabase';
import { pickAndUploadImage, removeUploadedImage } from '@/lib/upload';
import { Avatar } from '@/features/booking/ClinicHome';

import { ScheduleEditor } from './ScheduleEditor';

type Professional = {
  id: string;
  name: string;
  specialty: string | null;
  color: string | null;
  user_id: string | null;
  active: boolean;
  public_visible: boolean;
  home_care_enabled: boolean;
  travel_buffer_min: number;
  photo_url: string | null;
  bio: string | null;
};
type Member = { user_id: string; email: string | null; full_name: string | null; role: string };
type Data = {
  professionals: Professional[];
  services: { id: string; name: string; active: boolean; allows_home_care: boolean }[];
  procBy: Record<string, string[]>;
  weekBy: Record<string, WeekSchedule>;
  members: Member[];
};

const COLORS = ['#0E7C74', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#CA8A04', '#16A34A', '#475569'];

async function loadData(clinicId: string): Promise<Data> {
  const [p, s, m] = await Promise.all([
    supabase.from('professionals').select('*').eq('clinic_id', clinicId).order('name'),
    supabase.from('procedures').select('id,name,active,allows_home_care').eq('clinic_id', clinicId).order('sort_order').order('name'),
    callFunction<{ members: Member[] }>('admin-users', { action: 'list', clinic_id: clinicId }).catch(() => ({ members: [] })),
  ]);
  if (p.error ?? s.error) throw new Error((p.error ?? s.error)!.message);
  const professionals = (p.data ?? []) as Professional[];
  const ids = professionals.map((x) => x.id);
  const procBy: Record<string, string[]> = {};
  const weekBy: Record<string, WeekSchedule> = {};
  if (ids.length) {
    const [pp, wh, br] = await Promise.all([
      supabase.from('professional_procedures').select('professional_id,procedure_id').in('professional_id', ids),
      supabase.from('working_hours').select('professional_id,weekday,start_time,end_time').in('professional_id', ids),
      supabase.from('professional_breaks').select('professional_id,weekday,start_time,end_time,label').in('professional_id', ids),
    ]);
    const error = pp.error ?? wh.error ?? br.error;
    if (error) throw new Error(error.message);
    for (const r of pp.data ?? []) (procBy[r.professional_id] ??= []).push(r.procedure_id);
    for (const id of ids) {
      weekBy[id] = weekFromRows(
        ((wh.data ?? []) as (HourRow & { professional_id: string })[]).filter((r) => r.professional_id === id),
        ((br.data ?? []) as (BreakRow & { professional_id: string })[]).filter((r) => r.professional_id === id),
      );
    }
  }
  return { professionals, services: s.data ?? [], procBy, weekBy, members: m.members ?? [] };
}

/** Profissionais da clínica, com serviços que realizam e horário de atendimento (RF13). */
export function ProfessionalsManager({ clinicId }: { clinicId: string }) {
  const { session, memberships } = useAuth();
  const myId = session?.user.id ?? null;
  const iAmMember = memberships.some((m) => m.clinic_id === clinicId);
  const [version, setVersion] = useState(0);
  const key = `${clinicId}|${version}`;
  const [response, setResponse] = useState<{ key: string; data?: Data; error?: string }>();
  const [editing, setEditing] = useState<Professional | 'new' | null>(null);
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

  const current = response?.key === key ? response : response?.data ? response : undefined;
  const refresh = () => setVersion((v) => v + 1);

  if (!current) return <Loading label="Carregando profissionais…" />;
  if (current.error || !current.data) return <Notice tone="danger">{current.error ?? 'Erro ao carregar.'}</Notice>;
  const data = current.data;

  if (editing) {
    return (
      <ProfessionalForm
        clinicId={clinicId}
        professional={editing === 'new' ? null : editing}
        data={data}
        myId={myId}
        onClose={(text) => {
          setEditing(null);
          if (text) setMessage({ tone: 'success', text });
          refresh();
        }}
      />
    );
  }

  const meAsProfessional = myId ? data.professionals.find((p) => p.user_id === myId) : undefined;
  const memberName = (id: string | null) => {
    if (!id) return null;
    if (id === myId) return 'Você';
    const m = data.members.find((x) => x.user_id === id);
    return m?.full_name || m?.email || 'Login da equipe';
  };

  return (
    <View style={{ gap: Space.md }}>
      <Muted>
        Quem atende os pacientes, quais serviços cada um faz e em que dias e horários. O link de agendamento só mostra
        horários dentro desse expediente.
      </Muted>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {iAmMember && myId && !meAsProfessional ? (
        <SelfSetupCard
          clinicId={clinicId}
          userId={myId}
          defaultName={(session?.user.user_metadata?.full_name as string | undefined) ?? ''}
          firstOne={data.professionals.length === 0}
          onCreated={(id) => {
            setMessage({ tone: 'success', text: 'Pronto! Você agora aparece como profissional. Confira seus horários.' });
            refresh();
            // Abre o formulário para conferir os horários.
            loadData(clinicId).then((d) => {
              const p = d.professionals.find((x) => x.id === id);
              if (p) setEditing(p);
            });
          }}
        />
      ) : null}

      <Button label="+ Novo profissional" variant={data.professionals.length ? 'primary' : 'secondary'} onPress={() => setEditing('new')} />

      {data.professionals.map((p) => {
        const services = (data.procBy[p.id] ?? []).filter((id) => data.services.some((s) => s.id === id && s.active));
        const week = data.weekBy[p.id] ?? defaultWeek().map((d) => ({ ...d, enabled: false }));
        const login = memberName(p.user_id);
        const warn = !p.active
          ? null
          : services.length === 0
            ? 'Nenhum serviço marcado: não aparece no link.'
            : !week.some((d) => d.enabled)
              ? 'Sem horário de atendimento: nenhum horário é oferecido.'
              : null;
        return (
          <Card key={p.id} style={{ gap: Space.sm }}>
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: p.color ?? '#94A3B8' }]} />
              <View style={styles.flex}>
                <Text style={styles.name}>{p.name}</Text>
                {p.specialty ? <Muted>{p.specialty}</Muted> : null}
              </View>
            </View>
            <Muted>{weekSummary(week)}</Muted>
            <Muted>
              {services.length} serviço(s){p.home_care_enabled ? ` · atende em casa (deslocamento ${p.travel_buffer_min} min)` : ''}
            </Muted>
            <View style={styles.badges}>
              {!p.active ? <Badge label="Inativo" /> : p.public_visible ? <Badge label="No link" tone="success" /> : <Badge label="Só interno" />}
              {login ? <Badge label={login === 'Você' ? 'Você' : `Login: ${login}`} tone="primary" /> : <Badge label="Sem login" />}
            </View>
            {warn ? <Notice tone="warning">{warn}</Notice> : null}
            <Button label="Editar" variant="secondary" onPress={() => setEditing(p)} />
          </Card>
        );
      })}

      <RoomsManager clinicId={clinicId} />
    </View>
  );
}

function SelfSetupCard({
  clinicId,
  userId,
  defaultName,
  firstOne,
  onCreated,
}: {
  clinicId: string;
  userId: string;
  defaultName: string;
  firstOne: boolean;
  onCreated: (id: string) => void;
}) {
  const c = usePalette();
  const [name, setName] = useState(defaultName);
  const [specialty, setSpecialty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (name.trim().length < 2) return setError('Informe o seu nome como o paciente vai ver.');
    setBusy(true);
    setError(null);
    try {
      onCreated(await createSelfProfessional(clinicId, userId, name.trim(), specialty.trim()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: Space.sm, borderColor: c.primary }}>
      <Text style={styles.name}>{firstOne ? 'Você mesmo(a) atende os pacientes?' : 'Você também atende os pacientes?'}</Text>
      <Muted>
        Em clínicas pequenas é comum a mesma pessoa ser gerente, recepção e profissional. Com um toque você passa a
        aparecer no link de agendamento, usando o mesmo login. Começa com segunda a sexta, 8h às 18h (almoço 12h–13h) e
        todos os serviços. Dá para ajustar depois.
      </Muted>
      <Field label="Seu nome (como o paciente vê)" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label="Especialidade (opcional)" value={specialty} onChangeText={setSpecialty} placeholder="Ex.: Fisioterapeuta" />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Sim, eu atendo" loading={busy} onPress={submit} />
    </Card>
  );
}

// ---------------------------------------------------------------------
// Formulário do profissional
// ---------------------------------------------------------------------

function ProfessionalForm({
  clinicId,
  professional,
  data,
  myId,
  onClose,
}: {
  clinicId: string;
  professional: Professional | null;
  data: Data;
  myId: string | null;
  onClose: (message?: string) => void;
}) {
  const c = usePalette();
  const p = professional;
  const [name, setName] = useState(p?.name ?? '');
  const [specialty, setSpecialty] = useState(p?.specialty ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(p?.photo_url ?? null);
  const [bio, setBio] = useState(p?.bio ?? '');
  const [uploading, setUploading] = useState(false);
  // Fotos enviadas neste formulário e ainda não salvas: apagadas se não forem usadas.
  const [pending, setPending] = useState<string[]>([]);
  const [color, setColor] = useState(p?.color ?? COLORS[data.professionals.length % COLORS.length]);
  const [userId, setUserId] = useState<string | null>(p?.user_id ?? null);
  const [active, setActive] = useState(p?.active ?? true);
  const [visible, setVisible] = useState(p?.public_visible ?? true);
  const [homeCare, setHomeCare] = useState(p?.home_care_enabled ?? false);
  const [buffer, setBuffer] = useState(String(p?.travel_buffer_min ?? 30));
  const [procIds, setProcIds] = useState<string[]>(
    p ? (data.procBy[p.id] ?? []) : data.services.filter((s) => s.active).map((s) => s.id),
  );
  const [week, setWeek] = useState<WeekSchedule>(p ? (data.weekBy[p.id] ?? defaultWeek()) : defaultWeek());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const bufferNum = Number(buffer);
  const weekInvalid = week.some((d) => dayError(d));
  const linkedElsewhere = (uid: string) => data.professionals.some((x) => x.user_id === uid && x.id !== p?.id);

  const save = async () => {
    setError(null);
    if (name.trim().length < 2) return setError('Informe o nome do profissional.');
    if (weekInvalid) return setError('Confira os horários destacados em vermelho.');
    if (homeCare && (!Number.isInteger(bufferNum) || bufferNum < 0 || bufferNum > 240))
      return setError('Deslocamento: de 0 a 240 minutos.');
    setSaving(true);
    try {
      await saveProfessional({
        id: p?.id,
        clinic_id: clinicId,
        name: name.trim(),
        specialty: specialty.trim() || null,
        photo_url: photoUrl,
        bio: bio.trim() || null,
        color,
        user_id: userId,
        active,
        public_visible: visible,
        home_care_enabled: homeCare,
        travel_buffer_min: homeCare ? bufferNum : (p?.travel_buffer_min ?? 30),
        procedure_ids: procIds,
        week,
      });
      // Limpa as fotos que não ficaram em uso (as testadas e a antiga, se trocou).
      const unused = [...pending, p?.photo_url ?? null].filter((u): u is string => !!u && u !== photoUrl);
      await Promise.all(unused.map((u) => removeUploadedImage(u)));
      onClose(p ? 'Profissional atualizado.' : 'Profissional criado.');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!p) return;
    setSaving(true);
    const { error: e } = await supabase.from('professionals').delete().eq('id', p.id);
    if (e) {
      setSaving(false);
      setConfirmDelete(false);
      setError(
        e.code === '23503'
          ? 'Este profissional já tem agendamentos e não pode ser excluído. Desative-o: ele some do link, mas o histórico fica guardado.'
          : `Não foi possível excluir. ${e.message}`,
      );
      return;
    }
    await Promise.all([...pending, p.photo_url].filter((u): u is string => !!u).map((u) => removeUploadedImage(u)));
    onClose('Profissional excluído.');
  };

  const pickPhoto = async () => {
    setError(null);
    setUploading(true);
    try {
      const url = await pickAndUploadImage(clinicId, 'professional');
      if (url) {
        setPending((l) => [...l, url]);
        setPhotoUrl(url);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const toggle = (id: string) => setProcIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  return (
    <View style={{ gap: Space.md }}>
      <Text style={styles.formTitle}>{p ? 'Editar profissional' : 'Novo profissional'}</Text>

      <Card style={{ gap: Space.md }}>
        <Field label="Nome (como o paciente vê)" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Especialidade (opcional)" value={specialty} onChangeText={setSpecialty} placeholder="Ex.: Fisioterapeuta" />
        <View style={{ gap: Space.sm }}>
          <SectionLabel>Foto (aparece no link de agendamento)</SectionLabel>
          <View style={styles.photoRow}>
            <Avatar professional={{ name: name || '?', photo_url: photoUrl }} size={72} />
            <View style={{ flex: 1, gap: Space.sm }}>
              <Button
                label={photoUrl ? 'Trocar foto' : 'Escolher foto'}
                variant="secondary"
                loading={uploading}
                onPress={pickPhoto}
              />
              {photoUrl ? <Button label="Remover foto" variant="secondary" onPress={() => setPhotoUrl(null)} /> : null}
            </View>
          </View>
          <Muted style={{ fontSize: 13 }}>Foto de rosto, quadrada, com boa luz. Sem foto, aparecem as iniciais.</Muted>
        </View>
        <Field
          label="Apresentação curta (opcional)"
          value={bio}
          onChangeText={(v) => setBio(v.slice(0, 300))}
          multiline
          placeholder="Ex.: Fisioterapeuta há 10 anos, especialista em coluna e pós-operatório."
          hint={`${bio.length}/300`}
        />
        <View style={{ gap: Space.xs }}>
          <SectionLabel>Cor na agenda</SectionLabel>
          <View style={styles.colors}>
            {COLORS.map((hex) => (
              <Pressable
                key={hex}
                accessibilityRole="radio"
                accessibilityState={{ selected: color === hex }}
                accessibilityLabel={`Cor ${hex}`}
                onPress={() => setColor(hex)}
                style={[styles.swatch, { backgroundColor: hex, borderColor: color === hex ? c.text : 'transparent' }]}
              />
            ))}
          </View>
        </View>
      </Card>

      <Card style={{ gap: Space.sm }}>
        <SectionLabel>Login no sistema</SectionLabel>
        <Muted>
          Ligue a um login da equipe para a pessoa ver a própria agenda. Na clínica pequena, escolha “Você”. Para criar
          um login novo, use a aba Equipe e acessos.
        </Muted>
        <View style={styles.chips}>
          <Chip label="Sem login" selected={userId === null} onPress={() => setUserId(null)} />
          {data.members.map((m) =>
            linkedElsewhere(m.user_id) ? null : (
              <Chip
                key={m.user_id}
                label={m.user_id === myId ? 'Você' : m.full_name || m.email || 'Login'}
                selected={userId === m.user_id}
                onPress={() => setUserId(m.user_id)}
              />
            ),
          )}
        </View>
      </Card>

      <Card style={{ gap: Space.sm }}>
        <SectionLabel>Serviços que realiza</SectionLabel>
        {data.services.length === 0 ? (
          <Muted>Nenhum serviço cadastrado ainda. Cadastre na aba Serviços.</Muted>
        ) : (
          <>
            <View style={styles.chips}>
              <Chip label="Marcar todos" onPress={() => setProcIds(data.services.filter((s) => s.active).map((s) => s.id))} />
              <Chip label="Desmarcar todos" onPress={() => setProcIds([])} />
            </View>
            {data.services.map((s) => (
              <Checkbox key={s.id} checked={procIds.includes(s.id)} onChange={() => toggle(s.id)}>
                {s.name}
                {s.active ? '' : ' (desativado)'}
              </Checkbox>
            ))}
          </>
        )}
      </Card>

      <Card style={{ gap: Space.sm }}>
        <SectionLabel>Horário de atendimento</SectionLabel>
        <Muted>Digite só os números: 0830 vira 08:30. A pausa (almoço) é opcional.</Muted>
        <ScheduleEditor value={week} onChange={setWeek} />
      </Card>

      <Card style={{ gap: Space.sm }}>
        <SectionLabel>Atendimento residencial</SectionLabel>
        <ToggleRow
          label="Atende na casa do paciente"
          description="Os serviços residenciais só aparecem com profissionais que atendem em casa."
          value={homeCare}
          onChange={setHomeCare}
        />
        {homeCare ? (
          <Field
            label="Tempo de deslocamento (minutos)"
            value={buffer}
            onChangeText={(t) => setBuffer(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            hint="Reservado antes e depois de cada visita, para não encavalar horários."
          />
        ) : null}
      </Card>

      <Card style={{ gap: Space.sm }}>
        <SectionLabel>Disponibilidade</SectionLabel>
        <ToggleRow
          label="Aparece no link de agendamento"
          description="Desligado: só a equipe agenda com este profissional."
          value={visible}
          onChange={setVisible}
        />
        <ToggleRow
          label="Ativo"
          description="Desativado: some do link e da agenda; o histórico fica guardado."
          value={active}
          onChange={setActive}
        />
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={p ? 'Salvar alterações' : 'Criar profissional'} loading={saving} onPress={save} />
      <Button
        label="Cancelar"
        variant="secondary"
        disabled={saving}
        onPress={async () => {
          await Promise.all(pending.map((u) => removeUploadedImage(u)));
          onClose();
        }}
      />

      {p ? (
        confirmDelete ? (
          <Card style={{ gap: Space.sm, borderColor: c.danger }}>
            <Text style={{ color: c.danger, fontWeight: '700' }}>Excluir “{p.name}”?</Text>
            <Muted>Não dá para desfazer. Se já houver agendamentos, prefira desativar.</Muted>
            <Button label="Sim, excluir" loading={saving} onPress={remove} />
            <Button label="Não" variant="secondary" onPress={() => setConfirmDelete(false)} />
          </Card>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={styles.deleteLink}>
            <Text style={{ color: c.danger, fontWeight: '600' }}>Excluir profissional</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------
// Salas
// ---------------------------------------------------------------------

type Room = { id: string; name: string; active: boolean };

function RoomsManager({ clinicId }: { clinicId: string }) {
  const [version, setVersion] = useState(0);
  const key = `${clinicId}|${version}`;
  const [response, setResponse] = useState<{ key: string; rooms?: Room[]; error?: string }>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from('rooms')
      .select('id,name,active')
      .eq('clinic_id', clinicId)
      .order('name')
      .then(({ data, error: e }) => {
        if (active) setResponse(e ? { key, error: e.message } : { key, rooms: (data ?? []) as Room[] });
      });
    return () => {
      active = false;
    };
  }, [clinicId, key]);

  const current = response?.key === key ? response : response?.rooms ? response : undefined;
  const refresh = () => setVersion((v) => v + 1);

  const add = async () => {
    if (name.trim().length < 1) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from('rooms').insert({ clinic_id: clinicId, name: name.trim() });
    setBusy(false);
    if (e) return setError('Não foi possível criar a sala.');
    setName('');
    refresh();
  };

  const setActive = async (room: Room, value: boolean) => {
    await supabase.from('rooms').update({ active: value }).eq('id', room.id);
    refresh();
  };

  const remove = async (room: Room) => {
    setError(null);
    const { error: e } = await supabase.from('rooms').delete().eq('id', room.id);
    if (e) setError(e.code === '23503' ? `“${room.name}” já tem agendamentos. Desative em vez de excluir.` : 'Não foi possível excluir.');
    refresh();
  };

  return (
    <Card style={{ gap: Space.sm, marginTop: Space.md }}>
      <SectionLabel>Salas</SectionLabel>
      <Muted>
        Só cadastre salas se vários profissionais dividem o espaço. Se só uma pessoa atende, ou há uma sala só, pode deixar
        vazio e desligar “Precisa de sala” nos serviços.
      </Muted>
      {!current ? <Loading /> : null}
      {current?.error ? <Notice tone="danger">{current.error}</Notice> : null}
      {current?.rooms?.map((r) => (
        <View key={r.id} style={styles.roomRow}>
          <View style={styles.flex}>
            <ToggleRow label={r.name} description={r.active ? 'Ativa' : 'Inativa'} value={r.active} onChange={(v) => setActive(r, v)} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Excluir ${r.name}`} onPress={() => remove(r)} hitSlop={8}>
            <Text style={styles.removeRoom}>Excluir</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.roomRow}>
        <Field label="Nova sala" value={name} onChangeText={setName} placeholder="Ex.: Sala 1" style={styles.flex} />
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Adicionar sala" variant="secondary" loading={busy} disabled={!name.trim()} onPress={add} />
    </Card>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', gap: Space.md, alignItems: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7 },
  name: { fontSize: 17, fontWeight: '700' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 3 },
  formTitle: { fontSize: 20, fontWeight: '700' },
  deleteLink: { alignSelf: 'center', padding: Space.sm },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  removeRoom: { color: '#B42318', fontWeight: '600' },
});
