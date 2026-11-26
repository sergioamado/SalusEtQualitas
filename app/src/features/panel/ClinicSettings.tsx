import { Image } from 'expo-image';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Field,
  Muted,
  Notice,
  OptionCard,
  Screen,
  SectionLabel,
  Text,
  Title,
  ToggleRow,
} from '@/components/ui';
import { isHexColor, Radius, Space, usePalette } from '@/constants/theme';
import { ClinicHero } from '@/features/booking/ClinicHero';
import { BrandProvider, FONT_KEYS, FONT_OPTIONS, type FontKey } from '@/lib/brand';
import { maskPhone, onlyDigits } from '@/lib/format';
import { portalBaseUrl, supabase } from '@/lib/supabase';
import { pickAndUploadImage, removeUploadedImage } from '@/lib/upload';

import { useClinic, type ClinicRow } from './clinic-context';
import { GalleryManager } from './GalleryManager';
import { PlanPaymentCard } from '@/features/platform/PlanPaymentCard';
import { GoogleCalendarGuide, normalizeCalendarId } from './GoogleCalendarGuide';

const SWATCHES = [
  '#0E7C74', '#00838F', '#1565C0', '#5E35B1', '#6A1B9A', '#AD1457',
  '#C62828', '#EF6C00', '#2E7D32', '#8D6E63', '#37474F', '#13201F',
];

type Form = {
  name: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  email: string;
  address: string;
  welcome_message: string;
  about: string;
  primary_color: string;
  secondary_color: string;
  font_family: FontKey;
  public_booking_enabled: boolean;
  auto_confirm: boolean;
  google_notify_enabled: boolean;
  google_calendar_id: string;
};

function toForm(c: ClinicRow): Form {
  return {
    name: c.name,
    phone: c.phone ?? '',
    whatsapp: c.whatsapp ? maskPhone(c.whatsapp) : '',
    instagram: c.instagram ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    welcome_message: c.welcome_message ?? '',
    about: c.about ?? '',
    primary_color: c.primary_color,
    secondary_color: c.secondary_color,
    font_family: (c.font_family in FONT_OPTIONS ? c.font_family : 'system') as FontKey,
    public_booking_enabled: c.public_booking_enabled,
    auto_confirm: c.public_booking_status === 'agendado',
    google_notify_enabled: c.google_notify_enabled,
    google_calendar_id: c.google_calendar_id ?? '',
  };
}

export function ClinicSettings() {
  const { clinic, reload, canManage } = useClinic();
  const c = usePalette();
  const [form, setForm] = useState<Form>(() => toForm(clinic));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  if (!canManage) {
    return (
      <Screen wide safeTop={false}>
        <Notice tone="warning">Somente o gerente da clínica pode alterar estas configurações.</Notice>
      </Screen>
    );
  }

  const portalUrl = `${portalBaseUrl()}/agendar/${clinic.slug}`;
  const suspended = clinic.status === 'suspensa' || clinic.status === 'cancelada';
  const colorsValid = isHexColor(form.primary_color) && isHexColor(form.secondary_color);

  const save = async () => {
    setMessage(null);
    if (form.name.trim().length < 2) return setMessage({ tone: 'danger', text: 'Informe o nome da clínica.' });
    if (!colorsValid) return setMessage({ tone: 'danger', text: 'Use cores no formato #RRGGBB.' });
    if (form.google_notify_enabled && !form.google_calendar_id.trim())
      return setMessage({ tone: 'danger', text: 'Informe o ID da agenda do Google ou desative a integração.' });
    setSaving(true);
    const { error } = await supabase
      .from('clinics')
      .update({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        whatsapp: onlyDigits(form.whatsapp) || null,
        instagram: form.instagram.trim().replace(/^@/, '') || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        welcome_message: form.welcome_message.trim() || null,
        about: form.about.trim() || null,
        primary_color: form.primary_color.toUpperCase(),
        secondary_color: form.secondary_color.toUpperCase(),
        font_family: form.font_family,
        ...(suspended ? {} : { public_booking_enabled: form.public_booking_enabled }),
        public_booking_status: form.auto_confirm ? 'agendado' : 'reservado',
        google_notify_enabled: form.google_notify_enabled,
        google_calendar_id: normalizeCalendarId(form.google_calendar_id) || null,
      })
      .eq('id', clinic.id);
    setSaving(false);
    if (error) setMessage({ tone: 'danger', text: 'Não foi possível salvar. Tente novamente.' });
    else {
      setMessage({ tone: 'success', text: 'Alterações salvas.' });
      reload();
    }
  };

  const uploadImage = async (kind: 'logo' | 'cover') => {
    setMessage(null);
    setUploading(kind);
    try {
      const url = await pickAndUploadImage(clinic.id, kind);
      if (!url) return;
      const column = kind === 'logo' ? 'logo_url' : 'cover_url';
      const { error } = await supabase.from('clinics').update({ [column]: url }).eq('id', clinic.id);
      if (error) throw new Error('A imagem foi enviada, mas não foi possível salvá-la.');
      await removeUploadedImage(clinic[column]);
      reload();
      setMessage({ tone: 'success', text: kind === 'logo' ? 'Logomarca atualizada.' : 'Foto de fundo atualizada.' });
    } catch (e) {
      setMessage({ tone: 'danger', text: (e as Error).message });
    } finally {
      setUploading(null);
    }
  };

  const removeImage = async (kind: 'logo' | 'cover') => {
    const column = kind === 'logo' ? 'logo_url' : 'cover_url';
    const old = clinic[column];
    const { error } = await supabase.from('clinics').update({ [column]: null }).eq('id', clinic.id);
    if (!error) {
      await removeUploadedImage(old);
      reload();
    }
  };

  return (
    <Screen
      wide
      safeTop={false}
      footer={
        <View style={{ gap: Space.sm }}>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <Button label="Salvar alterações" loading={saving} onPress={save} />
        </View>
      }>
      <Title>Clínica e aparência</Title>

      <View style={styles.columns}>
        <View style={styles.col}>
          {/* ---------------- Link público ---------------- */}
          <Card>
            <SectionLabel>Link de agendamento</SectionLabel>
            <Text selectable style={[styles.link, { color: c.primary }]}>
              {portalUrl}
            </Text>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button label="Abrir" variant="secondary" onPress={() => Linking.openURL(portalUrl)} />
              </View>
              {Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard ? (
                <View style={styles.flex}>
                  <Button
                    label="Copiar link"
                    variant="secondary"
                    onPress={() => {
                      navigator.clipboard.writeText(portalUrl);
                      setMessage({ tone: 'success', text: 'Link copiado.' });
                    }}
                  />
                </View>
              ) : null}
            </View>
            {suspended ? (
              <Notice tone="warning">
                O link está fora do ar porque a clínica está {clinic.status === 'suspensa' ? 'suspensa' : 'com a assinatura cancelada'}.
                Ele volta sozinho quando a clínica for reativada.
              </Notice>
            ) : (
              <ToggleRow
                label="Agendamento online ativo"
                description="Desligue para tirar o link do ar temporariamente."
                value={form.public_booking_enabled}
                onChange={(v) => set('public_booking_enabled', v)}
              />
            )}
            <ToggleRow
              label="Confirmar automaticamente"
              description={
                form.auto_confirm
                  ? 'Agendamentos do link entram como "Agendado".'
                  : 'Agendamentos do link entram como "Aguardando aprovação" da recepção.'
              }
              value={form.auto_confirm}
              onChange={(v) => set('auto_confirm', v)}
            />
          </Card>

          {/* ---------------- Dados ---------------- */}
          <Card>
            <SectionLabel>Dados da clínica</SectionLabel>
            <Field label="Nome" value={form.name} onChangeText={(v) => set('name', v)} />
            <Field
              label="Mensagem de boas-vindas"
              value={form.welcome_message}
              onChangeText={(v) => set('welcome_message', v.slice(0, 280))}
              placeholder="Ex.: Agende sua avaliação em poucos cliques!"
              multiline
              hint={`${form.welcome_message.length}/280`}
            />
            <Field
              label="Sobre a clínica"
              value={form.about}
              onChangeText={(v) => set('about', v.slice(0, 1500))}
              placeholder="Conte a história da clínica, a forma de atender, diferenciais, convênios aceitos…"
              multiline
              hint={`${form.about.length}/1500 · aparece na seção “Sobre” do link`}
            />
            <Field label="Endereço" value={form.address} onChangeText={(v) => set('address', v)} />
            <View style={styles.row}>
              <Field
                label="Telefone"
                value={form.phone}
                onChangeText={(v) => set('phone', v)}
                keyboardType="phone-pad"
                style={styles.flex}
              />
              <Field
                label="WhatsApp"
                value={form.whatsapp}
                onChangeText={(v) => set('whatsapp', maskPhone(v))}
                keyboardType="phone-pad"
                style={styles.flex}
              />
            </View>
            <View style={styles.row}>
              <Field
                label="Instagram"
                value={form.instagram}
                onChangeText={(v) => set('instagram', v)}
                autoCapitalize="none"
                placeholder="@suaclinica"
                style={styles.flex}
              />
              <Field
                label="E-mail"
                value={form.email}
                onChangeText={(v) => set('email', v)}
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.flex}
              />
            </View>
          </Card>

          {/* ---------------- Imagens ---------------- */}
          <Card>
            <SectionLabel>Logomarca e foto de fundo</SectionLabel>
            <ImageSlot
              label="Logomarca"
              hint="Quadrada, PNG com fundo transparente fica melhor. Até 5 MB."
              url={clinic.logo_url}
              square
              loading={uploading === 'logo'}
              onPick={() => uploadImage('logo')}
              onRemove={() => removeImage('logo')}
            />
            <ImageSlot
              label="Foto de fundo (capa)"
              hint="Horizontal (16:9), é a foto grande do topo do link. Use a melhor foto da clínica (recepção ou fachada). Até 5 MB."
              url={clinic.cover_url}
              loading={uploading === 'cover'}
              onPick={() => uploadImage('cover')}
              onRemove={() => removeImage('cover')}
            />
          </Card>

          <GalleryManager clinicId={clinic.id} photos={clinic.gallery ?? []} onChanged={reload} />

          <PlanPaymentCard clinic={clinic} />
        </View>

        <View style={styles.col}>
          {/* ---------------- Cores e fonte ---------------- */}
          <Card>
            <SectionLabel>Cores</SectionLabel>
            <ColorField
              label="Cor principal (botões e destaques)"
              value={form.primary_color}
              onChange={(v) => set('primary_color', v)}
            />
            <ColorField
              label="Cor secundária (capa sem foto)"
              value={form.secondary_color}
              onChange={(v) => set('secondary_color', v)}
            />
          </Card>

          <Card>
            <SectionLabel>Fonte</SectionLabel>
            <View style={{ gap: Space.sm }}>
              {FONT_KEYS.map((key) => (
                <BrandProvider key={key} font={key}>
                  <OptionCard
                    title={FONT_OPTIONS[key].label}
                    subtitle={FONT_OPTIONS[key].description}
                    selected={form.font_family === key}
                    onPress={() => set('font_family', key)}
                  />
                </BrandProvider>
              ))}
            </View>
          </Card>

          {/* ---------------- Prévia ---------------- */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <BrandProvider
              primary={isHexColor(form.primary_color) ? form.primary_color : null}
              secondary={isHexColor(form.secondary_color) ? form.secondary_color : null}
              font={form.font_family}>
              <ClinicHero
                compact
                clinic={{
                  name: form.name || clinic.name,
                  logo_url: clinic.logo_url,
                  cover_url: clinic.cover_url,
                  welcome_message: form.welcome_message || null,
                }}
              />
              <View style={{ padding: Space.lg, gap: Space.md }}>
                <Muted>Prévia do link de agendamento</Muted>
                <OptionCard title="Consulta de avaliação" subtitle="45 min" aside="R$ 150,00" selected onPress={() => {}} />
                <Button label="Continuar" onPress={() => {}} />
              </View>
            </BrandProvider>
          </Card>

          <GoogleCalendarGuide
            clinicId={clinic.id}
            clinicName={clinic.name}
            savedCalendarId={clinic.google_calendar_id}
            savedEnabled={clinic.google_notify_enabled}
            onSaved={reload}
            enabled={form.google_notify_enabled}
            calendarId={form.google_calendar_id}
            onEnabled={(v) => set('google_notify_enabled', v)}
            onCalendarId={(v) => set('google_calendar_id', v)}
          />
        </View>
      </View>
    </Screen>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const c = usePalette();
  return (
    <View style={{ gap: Space.sm }}>
      <View style={styles.swatches}>
        {SWATCHES.map((s) => {
          const selected = s.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={s}
              accessibilityRole="radio"
              accessibilityLabel={`Cor ${s}`}
              accessibilityState={{ selected }}
              onPress={() => onChange(s)}
              style={[
                styles.swatch,
                { backgroundColor: s, borderColor: selected ? c.text : 'transparent' },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.row}>
        <View style={[styles.colorPreview, { backgroundColor: isHexColor(value) ? value : 'transparent', borderColor: c.border }]} />
        <Field
          label={label}
          value={value}
          onChangeText={(v) => onChange(v.startsWith('#') ? v.slice(0, 7) : `#${v}`.slice(0, 7))}
          autoCapitalize="characters"
          autoCorrect={false}
          error={isHexColor(value) ? null : 'Formato #RRGGBB'}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

function ImageSlot({
  label,
  hint,
  url,
  square,
  loading,
  onPick,
  onRemove,
}: {
  label: string;
  hint: string;
  url: string | null;
  square?: boolean;
  loading: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  const c = usePalette();
  return (
    <View style={{ gap: Space.sm }}>
      <Text style={[styles.slotLabel, { color: c.text }]}>{label}</Text>
      <View style={styles.row}>
        <View
          style={[
            square ? styles.thumbSquare : styles.thumbWide,
            { backgroundColor: c.surfaceMuted, borderColor: c.border },
          ]}>
          {url ? (
            <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit={square ? 'contain' : 'cover'} />
          ) : (
            <Muted style={{ fontSize: 12 }}>Sem imagem</Muted>
          )}
        </View>
        <View style={[styles.flex, { gap: Space.sm }]}>
          <Button label={url ? 'Trocar' : 'Escolher imagem'} variant="secondary" loading={loading} onPress={onPick} />
          {url ? <Button label="Remover" variant="secondary" onPress={onRemove} /> : null}
        </View>
      </View>
      <Muted style={{ fontSize: 13 }}>{hint}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.lg },
  col: { flexGrow: 1, flexBasis: 380, gap: Space.lg },
  link: { fontSize: 15, fontWeight: '600' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
  colorPreview: { width: 50, height: 50, borderRadius: Radius.md, borderWidth: 1, marginTop: 24 },
  slotLabel: { fontSize: 15, fontWeight: '600' },
  thumbSquare: {
    width: 96,
    height: 96,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbWide: {
    width: 160,
    height: 90,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
