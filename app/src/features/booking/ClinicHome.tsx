import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState, type ReactNode } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServiceMedia } from '@/components/ServiceMedia';
import { Text } from '@/components/ui';
import { mix, Radius, readableOn, Space, usePalette, type Palette } from '@/constants/theme';
import { formatDuration, formatPrice, maskPhone } from '@/lib/format';

import type { GalleryPhoto, PublicClinic, PublicProcedure, PublicProfessional } from './api';
import { initials, instagramUrl, mapsUrl, telUrl, whatsappUrl } from './links';

const MAX_WIDTH = 1120;
const WIDE = 900;

type SectionKey = 'espaco' | 'servicos' | 'equipe' | 'contato';

/**
 * Página inicial do link da clínica: capa com fotos, espaço, serviços, equipe e contato.
 * "Agendar" leva ao passo a passo (com o serviço já escolhido quando vem de um cartão).
 */
export function ClinicHome({
  clinic,
  onBook,
}: {
  clinic: PublicClinic;
  onBook: (procedure?: PublicProcedure) => void;
}) {
  const c = usePalette();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const pad = wide ? Space.xxl : 20;
  const inner = Math.min(width, MAX_WIDTH) - pad * 2;

  const scrollRef = useRef<ScrollViewInstance>(null);
  const offsets = useRef<Partial<Record<SectionKey, number>>>({});
  const [lightbox, setLightbox] = useState<number | null>(null);

  const gallery = (clinic.gallery ?? []).filter((p) => !!p?.url);
  const wa = whatsappUrl(clinic.whatsapp, `Olá! Vim pelo link de agendamento da ${clinic.name}.`);
  const hasContact = !!(clinic.address || clinic.phone || clinic.whatsapp || clinic.instagram || clinic.email);
  const homeCare = clinic.procedures.some((p) => p.allows_home_care);

  const goTo = (key: SectionKey) => {
    const y = offsets.current[key];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(y - 16, 0), animated: true });
  };

  const nav: { key: SectionKey; label: string; show: boolean }[] = [
    { key: 'espaco', label: 'O espaço', show: gallery.length > 0 },
    { key: 'servicos', label: 'Serviços', show: clinic.procedures.length > 0 },
    { key: 'equipe', label: 'Equipe', show: clinic.professionals.length > 0 },
    { key: 'contato', label: 'Contato', show: hasContact || !!clinic.about },
  ];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]} edges={['bottom']}>
      <ScrollView ref={scrollRef} style={styles.flex} showsVerticalScrollIndicator={false}>
        <Hero
          clinic={clinic}
          wide={wide}
          pad={pad}
          whatsapp={wa}
          nav={wide ? nav.filter((n) => n.show) : []}
          onNav={goTo}
          onBook={() => onBook()}
        />

        <Container pad={pad}>
          <Highlights clinic={clinic} wide={wide} homeCare={homeCare} />
        </Container>

        {gallery.length > 0 ? (
          <View onLayout={(e) => {
            offsets.current.espaco = e.nativeEvent.layout.y;
          }}>
            <Section pad={pad} eyebrow="Nosso espaço" title="Conheça a clínica">
              <Gallery photos={gallery} wide={wide} inner={inner} onOpen={setLightbox} />
            </Section>
          </View>
        ) : null}

        <View onLayout={(e) => {
            offsets.current.servicos = e.nativeEvent.layout.y;
          }}>
          <Section
            pad={pad}
            eyebrow="Serviços"
            title="O que fazemos por você"
            subtitle="Escolha um serviço para ver os horários livres.">
            {clinic.procedures.length === 0 ? (
              <Text style={{ color: c.textMuted }}>Nenhum serviço disponível para agendamento online no momento.</Text>
            ) : (
              <Grid inner={inner} cols={width >= 1000 ? 3 : width >= 640 ? 2 : 1}>
                {clinic.procedures.map((p) => (
                  <ServiceCard key={p.id} procedure={p} onPress={() => onBook(p)} />
                ))}
              </Grid>
            )}
          </Section>
        </View>

        {clinic.professionals.length > 0 ? (
          <View onLayout={(e) => {
            offsets.current.equipe = e.nativeEvent.layout.y;
          }}>
            <Section
              pad={pad}
              eyebrow={clinic.professionals.length === 1 ? 'Quem atende' : 'Equipe'}
              title={clinic.professionals.length === 1 ? 'Prazer, eu cuido de você' : 'Quem vai cuidar de você'}
              tinted>
              {clinic.professionals.length === 1 ? (
                <SoloProfessional professional={clinic.professionals[0]} wide={wide} />
              ) : (
                <Grid inner={inner} cols={width >= 1000 ? 4 : width >= 640 ? 3 : 2}>
                  {clinic.professionals.map((p) => (
                    <TeamCard key={p.id} professional={p} />
                  ))}
                </Grid>
              )}
            </Section>
          </View>
        ) : null}

        {hasContact || clinic.about ? (
          <View onLayout={(e) => {
            offsets.current.contato = e.nativeEvent.layout.y;
          }}>
            <Section pad={pad} eyebrow="Sobre nós" title={clinic.about ? `Sobre a ${clinic.name}` : 'Onde estamos'}>
              <View style={[styles.aboutRow, { flexDirection: wide ? 'row' : 'column' }]}>
                {clinic.about ? (
                  <View style={wide ? styles.flex : undefined}>
                    <Text style={[styles.about, { color: c.text }]}>{clinic.about}</Text>
                  </View>
                ) : null}
                {hasContact ? (
                  <View style={wide ? { width: clinic.about ? 380 : '100%' } : undefined}>
                    <ContactCard clinic={clinic} whatsapp={wa} />
                  </View>
                ) : null}
              </View>
            </Section>
          </View>
        ) : null}

        <CtaBand clinic={clinic} pad={pad} onBook={() => onBook()} />
        <Footer clinic={clinic} pad={pad} />
      </ScrollView>

      {!wide ? (
        <View style={[styles.stickyBar, { backgroundColor: c.surface, borderTopColor: c.border }]}>
          <PrimaryButton label="Agendar horário" onPress={() => onBook()} style={styles.flex} />
          {wa ? <OutlineButton label="WhatsApp" onPress={() => Linking.openURL(wa)} /> : null}
        </View>
      ) : null}

      <Lightbox photos={gallery} index={lightbox} onChange={setLightbox} />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------
// Capa
// ---------------------------------------------------------------------
function Hero({
  clinic,
  wide,
  pad,
  whatsapp,
  nav,
  onNav,
  onBook,
}: {
  clinic: PublicClinic;
  wide: boolean;
  pad: number;
  whatsapp: string | null;
  nav: { key: SectionKey; label: string }[];
  onNav: (key: SectionKey) => void;
  onBook: () => void;
}) {
  const c = usePalette();
  const hasCover = !!clinic.cover_url;
  const ink = hasCover ? '#FFFFFF' : c.secondaryText;
  const plain = hasCover ? null : ([c.secondary, mix(c.secondary, c.primary, 0.55)] as const);

  return (
    <View style={[styles.hero, { minHeight: wide ? 560 : 500 }]}>
      {hasCover ? (
        <>
          <Image
            source={{ uri: clinic.cover_url! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={250}
            accessibilityIgnoresInvertColors
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.78)']}
            locations={[0, 0.35, 1]}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : (
        <LinearGradient colors={plain!} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}

      {/* Barra superior */}
      <View style={[styles.heroBar, { paddingHorizontal: pad }]}>
        <View style={styles.brand}>
          {clinic.logo_url ? (
            <View style={styles.logoChip}>
              <Image source={{ uri: clinic.logo_url }} style={styles.fill} contentFit="contain" />
            </View>
          ) : null}
          <Text numberOfLines={1} style={[styles.brandName, { color: ink }]}>
            {clinic.name}
          </Text>
        </View>
        {nav.length ? (
          <View style={styles.navLinks}>
            {nav.map((n) => (
              <Pressable key={n.key} accessibilityRole="link" onPress={() => onNav(n.key)} hitSlop={8}>
                <Text style={[styles.navLink, { color: ink }]}>{n.label}</Text>
              </Pressable>
            ))}
            <PrimaryButton label="Agendar" onPress={onBook} compact />
          </View>
        ) : null}
      </View>

      {/* Chamada principal */}
      <View style={[styles.heroBody, { paddingHorizontal: pad, paddingBottom: wide ? 96 : 80 }]}>
        <View style={{ maxWidth: 680, gap: Space.md }}>
          {clinic.logo_url ? (
            <View style={[styles.logoBig, wide && { width: 88, height: 88 }]}>
              <Image
                source={{ uri: clinic.logo_url }}
                style={styles.fill}
                contentFit="contain"
                accessibilityLabel={`Logomarca ${clinic.name}`}
              />
            </View>
          ) : null}
          <Text accessibilityRole="header" style={[styles.heroTitle, { color: ink }, wide && styles.heroTitleWide]}>
            {clinic.name}
          </Text>
          <Text style={[styles.heroText, { color: ink }, wide && { fontSize: 19, lineHeight: 28 }]}>
            {clinic.welcome_message || 'Agende seu horário online, de forma rápida e segura.'}
          </Text>
          <View style={styles.heroActions}>
            <PrimaryButton label="Agendar horário" onPress={onBook} large />
            {whatsapp ? (
              <OutlineButton label="Falar no WhatsApp" onPress={() => Linking.openURL(whatsapp)} onDark large />
            ) : null}
          </View>
          {clinic.address ? (
            <Text numberOfLines={2} style={[styles.heroAddress, { color: ink }]}>
              {clinic.address}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Highlights({ clinic, wide, homeCare }: { clinic: PublicClinic; wide: boolean; homeCare: boolean }) {
  const c = usePalette();
  const items = [
    { title: 'Agende online', text: 'A qualquer hora, em poucos passos.' },
    {
      title: clinic.auto_confirm ? 'Confirmação na hora' : 'Confirmação rápida',
      text: clinic.auto_confirm ? 'Seu horário fica garantido.' : 'A clínica confirma pelo WhatsApp.',
    },
    {
      title: homeCare ? 'Na clínica ou em casa' : 'Atendimento na clínica',
      text: homeCare ? 'Alguns serviços vão até você.' : 'Ambiente preparado para você.',
    },
  ];
  return (
    <View
      style={[
        styles.highlights,
        { backgroundColor: c.surface, borderColor: c.border, flexDirection: wide ? 'row' : 'column' },
      ]}>
      {items.map((i, idx) => (
        <View
          key={i.title}
          style={[
            styles.highlight,
            wide && styles.flex,
            idx > 0 && (wide ? { borderLeftWidth: 1, borderLeftColor: c.border } : { borderTopWidth: 1, borderTopColor: c.border }),
          ]}>
          <View style={[styles.dot, { backgroundColor: c.primary }]} />
          <View style={styles.flex}>
            <Text style={[styles.highlightTitle, { color: c.text }]}>{i.title}</Text>
            <Text style={[styles.highlightText, { color: c.textMuted }]}>{i.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------
function Container({ pad, children }: { pad: number; children: ReactNode }) {
  return <View style={[styles.container, { paddingHorizontal: pad }]}>{children}</View>;
}

function Section({
  pad,
  eyebrow,
  title,
  subtitle,
  tinted,
  children,
}: {
  pad: number;
  eyebrow: string;
  title: string;
  subtitle?: string;
  tinted?: boolean;
  children: ReactNode;
}) {
  const c = usePalette();
  return (
    <View style={[styles.section, tinted && { backgroundColor: c.primarySoft }]}>
      <Container pad={pad}>
        <View style={styles.sectionHead}>
          <Text style={[styles.eyebrow, { color: c.primary }]}>{eyebrow.toUpperCase()}</Text>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.text }]}>
            {title}
          </Text>
          {subtitle ? <Text style={[styles.sectionSub, { color: c.textMuted }]}>{subtitle}</Text> : null}
        </View>
        {children}
      </Container>
    </View>
  );
}

/** Grade de cartões com largura calculada (funciona igual na web e no celular). */
function Grid({ inner, cols, children }: { inner: number; cols: number; children: ReactNode[] }) {
  const gap = Space.lg;
  const w = Math.floor((inner - gap * (cols - 1)) / cols);
  return (
    <View style={[styles.grid, { gap }]}>
      {children.map((child, i) => (
        <View key={i} style={{ width: w }}>
          {child}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------
// Galeria
// ---------------------------------------------------------------------
function Gallery({
  photos,
  wide,
  inner,
  onOpen,
}: {
  photos: GalleryPhoto[];
  wide: boolean;
  inner: number;
  onOpen: (index: number) => void;
}) {
  const gap = Space.sm;

  if (!wide) {
    const w = Math.min(inner * 0.82, 340);
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={w + gap}
        decelerationRate="fast"
        contentContainerStyle={{ gap }}
        style={styles.bleed}>
        {photos.map((p, i) => (
          <Photo key={p.url + i} photo={p} style={{ width: w, height: 230 }} onPress={() => onOpen(i)} />
        ))}
      </ScrollView>
    );
  }

  const H = 440;
  if (photos.length === 1) return <Photo photo={photos[0]} style={{ height: H }} onPress={() => onOpen(0)} />;
  if (photos.length === 2)
    return (
      <View style={[styles.row, { gap }]}>
        {photos.map((p, i) => (
          <Photo key={p.url + i} photo={p} style={{ flex: 1, height: H * 0.8 }} onPress={() => onOpen(i)} />
        ))}
      </View>
    );

  // Mosaico: foto grande à esquerda e até 4 menores à direita.
  const side = photos.slice(1, 5);
  const twoCols = side.length === 4;
  const sideW = Math.floor(((inner - gap) * (twoCols ? 1 : 2)) / (twoCols ? 2 : 5));
  const mainW = inner - gap - sideW;
  const rows = twoCols ? 2 : side.length;
  const tileW = twoCols ? Math.floor((sideW - gap) / 2) : sideW;
  const tileH = Math.floor((H - gap * (rows - 1)) / rows);
  const rest = photos.length - 5;
  return (
    <View style={[styles.row, { gap, height: H }]}>
      <Photo photo={photos[0]} style={{ width: mainW, height: H }} onPress={() => onOpen(0)} />
      <View style={[styles.grid, { width: sideW, gap }]}>
        {side.map((p, i) => {
          const last = i === side.length - 1 && rest > 0;
          return (
            <Photo
              key={p.url + i}
              photo={p}
              style={{ width: tileW, height: tileH }}
              onPress={() => onOpen(i + 1)}
              overlay={
                last ? (
                  <View style={[StyleSheet.absoluteFill, styles.more]}>
                    <Text style={styles.moreText}>+{rest} fotos</Text>
                  </View>
                ) : null
              }
            />
          );
        })}
      </View>
    </View>
  );
}

function Photo({
  photo,
  style,
  onPress,
  overlay,
}: {
  photo: GalleryPhoto;
  style: object;
  onPress: () => void;
  overlay?: ReactNode;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={photo.caption || 'Foto da clínica'}
      onPress={onPress}
      style={({ pressed }) => [styles.photo, { backgroundColor: c.surfaceMuted }, style, pressed && { opacity: 0.9 }]}>
      <Image source={{ uri: photo.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      {photo.caption && !overlay ? (
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.6)']} style={styles.caption}>
          <Text numberOfLines={1} style={styles.captionText}>
            {photo.caption}
          </Text>
        </LinearGradient>
      ) : null}
      {overlay}
    </Pressable>
  );
}

function Lightbox({
  photos,
  index,
  onChange,
}: {
  photos: GalleryPhoto[];
  index: number | null;
  onChange: (i: number | null) => void;
}) {
  const open = index != null && !!photos[index];
  const photo = open ? photos[index] : null;
  const go = (d: number) => index != null && onChange((index + d + photos.length) % photos.length);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onChange(null)}>
      <View style={styles.lightbox}>
        {photo ? (
          <Image source={{ uri: photo.url }} style={styles.lightboxImage} contentFit="contain" />
        ) : null}
        <View style={styles.lightboxBar}>
          <Text style={styles.lightboxCount}>
            {index != null ? index + 1 : 0} / {photos.length}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={() => onChange(null)} hitSlop={12}>
            <Text style={styles.lightboxClose}>✕</Text>
          </Pressable>
        </View>
        {photos.length > 1 ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="Foto anterior" onPress={() => go(-1)} style={[styles.arrow, { left: 12 }]}>
              <Text style={styles.arrowText}>‹</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Próxima foto" onPress={() => go(1)} style={[styles.arrow, { right: 12 }]}>
              <Text style={styles.arrowText}>›</Text>
            </Pressable>
          </>
        ) : null}
        {photo?.caption ? <Text style={styles.lightboxCaption}>{photo.caption}</Text> : null}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Serviços e equipe
// ---------------------------------------------------------------------
function ServiceCard({ procedure: p, onPress }: { procedure: PublicProcedure; onPress: () => void }) {
  const c = usePalette();
  const price = formatPrice(p.price);
  const hasMedia = !!(p.image_url || p.video_url);
  const where = p.allows_clinic && p.allows_home_care ? 'Na clínica ou em casa' : p.allows_home_care ? 'Em casa' : 'Na clínica';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Agendar ${p.name}`}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.card,
        { backgroundColor: c.surface, borderColor: hovered ? c.primary : c.border },
        hovered && styles.cardHover,
        pressed && { opacity: 0.92 },
      ]}>
      {hasMedia ? (
        <ServiceMedia imageUrl={p.image_url} videoUrl={p.video_url} height={190} rounded={false} />
      ) : (
        <Placeholder label={p.name} height={190} />
      )}
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, { color: c.text }]}>{p.name}</Text>
        {p.description ? (
          <Text numberOfLines={3} style={[styles.cardText, { color: c.textMuted }]}>
            {p.description}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Tag label={formatDuration(p.duration_min)} />
          <Tag label={where} />
        </View>
        <View style={[styles.cardFoot, { borderTopColor: c.border }]}>
          <Text style={[styles.price, { color: c.text }]}>{price ?? 'Consulte o valor'}</Text>
          <View style={[styles.pill, { backgroundColor: c.primary }]}>
            <Text style={[styles.pillText, { color: c.primaryText }]}>Agendar</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function Placeholder({ label, height }: { label: string; height: number }) {
  const c = usePalette();
  return (
    <LinearGradient
      colors={[mix(c.primarySoft, c.primary, 0.15), mix(c.primarySoft, c.primary, 0.45)]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ height, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[styles.placeholderLetter, { color: readableOn(mix(c.primarySoft, c.primary, 0.3)) }]}>
        {label.trim().charAt(0).toUpperCase()}
      </Text>
    </LinearGradient>
  );
}

function Tag({ label }: { label: string }) {
  const c = usePalette();
  return (
    <View style={[styles.tag, { backgroundColor: c.surfaceMuted }]}>
      <Text style={[styles.tagText, { color: c.textMuted }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ professional: p, size }: { professional: Pick<PublicProfessional, 'name' | 'photo_url'>; size: number }) {
  const c = usePalette();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: c.primary }]}>
      {p.photo_url ? (
        <Image source={{ uri: p.photo_url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`Foto de ${p.name}`} />
      ) : (
        <Text style={{ color: c.primaryText, fontSize: size * 0.36, fontWeight: '700' }}>{initials(p.name)}</Text>
      )}
    </View>
  );
}

function TeamCard({ professional: p }: { professional: PublicProfessional }) {
  const c = usePalette();
  return (
    <View style={[styles.team, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Avatar professional={p} size={96} />
      <Text style={[styles.teamName, { color: c.text }]}>{p.name}</Text>
      {p.specialty ? <Text style={[styles.teamRole, { color: c.primary }]}>{p.specialty}</Text> : null}
      {p.bio ? (
        <Text numberOfLines={4} style={[styles.teamBio, { color: c.textMuted }]}>
          {p.bio}
        </Text>
      ) : null}
    </View>
  );
}

function SoloProfessional({ professional: p, wide }: { professional: PublicProfessional; wide: boolean }) {
  const c = usePalette();
  return (
    <View
      style={[
        styles.solo,
        { backgroundColor: c.surface, borderColor: c.border, flexDirection: wide ? 'row' : 'column' },
      ]}>
      <Avatar professional={p} size={wide ? 160 : 120} />
      <View style={[{ gap: Space.sm }, wide ? styles.flex : { alignItems: 'center' }]}>
        <Text style={[styles.soloName, { color: c.text }, !wide && { textAlign: 'center' }]}>{p.name}</Text>
        {p.specialty ? (
          <Text style={[styles.teamRole, { color: c.primary }, !wide && { textAlign: 'center' }]}>{p.specialty}</Text>
        ) : null}
        {p.bio ? (
          <Text style={[styles.about, { color: c.textMuted }, !wide && { textAlign: 'center' }]}>{p.bio}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------
// Contato, chamada final e rodapé
// ---------------------------------------------------------------------
function ContactCard({ clinic, whatsapp }: { clinic: PublicClinic; whatsapp: string | null }) {
  const c = usePalette();
  const rows: { label: string; value: string; action?: string; url: string | null }[] = [];
  if (clinic.address) rows.push({ label: 'Endereço', value: clinic.address, action: 'Como chegar', url: mapsUrl(clinic.address) });
  if (clinic.whatsapp)
    rows.push({ label: 'WhatsApp', value: maskPhone(clinic.whatsapp), action: 'Conversar', url: whatsapp });
  if (clinic.phone) rows.push({ label: 'Telefone', value: clinic.phone, action: 'Ligar', url: telUrl(clinic.phone) });
  if (clinic.instagram)
    rows.push({
      label: 'Instagram',
      value: `@${clinic.instagram.replace(/^@/, '')}`,
      action: 'Seguir',
      url: instagramUrl(clinic.instagram),
    });
  if (clinic.email) rows.push({ label: 'E-mail', value: clinic.email, action: 'Escrever', url: `mailto:${clinic.email}` });

  return (
    <View style={[styles.contact, { backgroundColor: c.surface, borderColor: c.border }]}>
      {rows.map((r, i) => (
        <View key={r.label} style={[styles.contactRow, i > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}>
          <View style={styles.flex}>
            <Text style={[styles.contactLabel, { color: c.textMuted }]}>{r.label}</Text>
            <Text selectable style={[styles.contactValue, { color: c.text }]}>
              {r.value}
            </Text>
          </View>
          {r.url && r.action ? (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(r.url!)} hitSlop={8}>
              <Text style={[styles.contactAction, { color: c.primary }]}>{r.action} ›</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function CtaBand({ clinic, pad, onBook }: { clinic: PublicClinic; pad: number; onBook: () => void }) {
  const c = usePalette();
  return (
    <LinearGradient colors={[c.primary, mix(c.primary, c.secondary, 0.35)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <Container pad={pad}>
        <View style={styles.cta}>
          <Text style={[styles.ctaTitle, { color: c.primaryText }]}>Pronto para cuidar de você?</Text>
          <Text style={[styles.ctaText, { color: c.primaryText }]}>
            Escolha o serviço, o dia e o horário. Leva menos de um minuto.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onBook}
            style={({ pressed }) => [styles.ctaButton, { backgroundColor: c.primaryText }, pressed && { opacity: 0.9 }]}>
            <Text style={[styles.ctaButtonText, { color: c.primary }]}>Agendar na {clinic.name}</Text>
          </Pressable>
        </View>
      </Container>
    </LinearGradient>
  );
}

function Footer({ clinic, pad }: { clinic: PublicClinic; pad: number }) {
  const c = usePalette();
  return (
    <View style={{ backgroundColor: c.secondary }}>
      <Container pad={pad}>
        <View style={styles.footer}>
          <Text style={[styles.footerName, { color: c.secondaryText }]}>{clinic.name}</Text>
          {clinic.address ? <Text style={[styles.footerText, { color: c.secondaryText }]}>{clinic.address}</Text> : null}
          <Text style={[styles.footerText, { color: c.secondaryText }]}>
            © {new Date().getFullYear()} · Agendamento online por Salus Et Qualitas
          </Text>
        </View>
      </Container>
    </View>
  );
}

// ---------------------------------------------------------------------
// Botões
// ---------------------------------------------------------------------
function PrimaryButton({
  label,
  onPress,
  large,
  compact,
  style,
}: {
  label: string;
  onPress: () => void;
  large?: boolean;
  compact?: boolean;
  style?: object;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        large && styles.btnLarge,
        compact && styles.btnCompact,
        { backgroundColor: c.primary },
        style,
        pressed && { opacity: 0.88 },
      ]}>
      <Text style={[styles.btnText, { color: c.primaryText }, large && { fontSize: 17 }]}>{label}</Text>
    </Pressable>
  );
}

function OutlineButton({
  label,
  onPress,
  onDark,
  large,
}: {
  label: string;
  onPress: () => void;
  onDark?: boolean;
  large?: boolean;
}) {
  const c: Palette = usePalette();
  const color = onDark ? '#FFFFFF' : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        large && styles.btnLarge,
        { borderWidth: 1.5, borderColor: onDark ? 'rgba(255,255,255,0.85)' : c.border, backgroundColor: onDark ? 'rgba(255,255,255,0.08)' : 'transparent' },
        pressed && { opacity: 0.85 },
      ]}>
      <Text style={[styles.btnText, { color }, large && { fontSize: 17 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fill: { width: '100%', height: '100%' },
  row: { flexDirection: 'row' },
  container: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },

  hero: { width: '100%', overflow: 'hidden', justifyContent: 'space-between' },
  heroBar: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
    paddingTop: Space.lg,
  },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  logoChip: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFFFFF', padding: 4 },
  brandName: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  navLinks: { flexDirection: 'row', alignItems: 'center', gap: Space.xl },
  navLink: { fontSize: 15, fontWeight: '600' },
  heroBody: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingTop: Space.xxl },
  logoBig: { width: 72, height: 72, borderRadius: 18, backgroundColor: '#FFFFFF', padding: 8 },
  heroTitle: { fontSize: 36, lineHeight: 42, fontWeight: '700' },
  heroTitleWide: { fontSize: 54, lineHeight: 60 },
  heroText: { fontSize: 17, lineHeight: 25, opacity: 0.95 },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md, marginTop: Space.sm },
  heroAddress: { fontSize: 14, opacity: 0.85 },

  highlights: {
    marginTop: -48,
    borderWidth: 1,
    borderRadius: Radius.lg,
    boxShadow: '0 12px 32px rgba(0,0,0,0.10)',
  },
  highlight: { flexDirection: 'row', gap: Space.md, padding: Space.lg, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  highlightTitle: { fontSize: 15, fontWeight: '700' },
  highlightText: { fontSize: 14, lineHeight: 20 },

  section: { paddingVertical: 56 },
  sectionHead: { gap: 6, marginBottom: Space.xl },
  eyebrow: { fontSize: 13, fontWeight: '700', letterSpacing: 1.5 },
  sectionTitle: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  sectionSub: { fontSize: 16, lineHeight: 23 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  bleed: { marginHorizontal: -20, paddingHorizontal: 20 },

  photo: { borderRadius: Radius.lg, overflow: 'hidden' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Space.md, paddingTop: Space.xl },
  captionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  more: { backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  moreText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },

  lightbox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  lightboxImage: { width: '100%', height: '80%' },
  lightboxBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Space.lg,
  },
  lightboxCount: { color: '#FFFFFF', fontSize: 15 },
  lightboxClose: { color: '#FFFFFF', fontSize: 26 },
  lightboxCaption: { position: 'absolute', bottom: 32, color: '#FFFFFF', fontSize: 16, paddingHorizontal: Space.xl, textAlign: 'center' },
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { color: '#FFFFFF', fontSize: 36, lineHeight: 40 },

  card: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden', height: '100%' },
  cardHover: { boxShadow: '0 10px 28px rgba(0,0,0,0.10)', transform: [{ translateY: -2 }] },
  cardBody: { padding: Space.lg, gap: Space.sm, flexGrow: 1 },
  cardTitle: { fontSize: 18, fontWeight: '700' },
  cardText: { fontSize: 14, lineHeight: 21 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  tag: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { fontSize: 12, fontWeight: '600' },
  cardFoot: {
    marginTop: 'auto',
    paddingTop: Space.md,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  price: { fontSize: 17, fontWeight: '700' },
  pill: { borderRadius: Radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
  pillText: { fontSize: 14, fontWeight: '700' },
  placeholderLetter: { fontSize: 64, fontWeight: '700', opacity: 0.6 },

  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  team: { borderWidth: 1, borderRadius: Radius.lg, padding: Space.lg, alignItems: 'center', gap: 6, height: '100%' },
  teamName: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: Space.sm },
  teamRole: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  teamBio: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  solo: { borderWidth: 1, borderRadius: Radius.lg, padding: Space.xl, gap: Space.xl, alignItems: 'center' },
  soloName: { fontSize: 24, fontWeight: '700' },

  aboutRow: { gap: Space.xl, alignItems: 'flex-start' },
  about: { fontSize: 16, lineHeight: 26 },
  contact: { borderWidth: 1, borderRadius: Radius.lg, paddingHorizontal: Space.lg },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md },
  contactLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  contactValue: { fontSize: 15, lineHeight: 21 },
  contactAction: { fontSize: 14, fontWeight: '700' },

  cta: { paddingVertical: 56, alignItems: 'center', gap: Space.md },
  ctaTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700', textAlign: 'center' },
  ctaText: { fontSize: 16, textAlign: 'center', opacity: 0.92 },
  ctaButton: { borderRadius: Radius.pill, paddingHorizontal: 28, paddingVertical: 16, marginTop: Space.sm },
  ctaButtonText: { fontSize: 17, fontWeight: '700' },

  footer: { paddingVertical: Space.xl, gap: 4 },
  footerName: { fontSize: 16, fontWeight: '700' },
  footerText: { fontSize: 13, opacity: 0.75 },

  stickyBar: { flexDirection: 'row', gap: Space.sm, padding: Space.md, borderTopWidth: 1 },
  btn: { borderRadius: Radius.pill, paddingHorizontal: 20, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  btnLarge: { paddingHorizontal: 26, paddingVertical: 16 },
  btnCompact: { paddingVertical: 9, paddingHorizontal: 18 },
  btnText: { fontSize: 15, fontWeight: '700' },
});
