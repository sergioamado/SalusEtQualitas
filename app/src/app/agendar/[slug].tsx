import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, Loading, Muted, Notice, Screen, Title } from '@/components/ui';
import { fetchClinic, type PublicClinic } from '@/features/booking/api';
import { BookingFlow } from '@/features/booking/BookingFlow';
import { BrandProvider } from '@/lib/brand';
import { supabase } from '@/lib/supabase';

/** RF08: link público de agendamento da clínica — /agendar/<slug> */
export default function PublicBookingScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [attempt, setAttempt] = useState(0);
  const key = `${slug}|${attempt}`;
  const [response, setResponse] = useState<{ key: string; clinic?: PublicClinic | null; error?: string }>();

  // Conta um acesso por abertura do link (só número, sem dados pessoais).
  useEffect(() => {
    if (slug) supabase.rpc('public_track_view', { p_slug: String(slug) }).then(() => {});
  }, [slug]);

  useEffect(() => {
    let active = true;
    fetchClinic(String(slug))
      .then((clinic) => active && setResponse({ key, clinic }))
      .catch((e: Error) => active && setResponse({ key, error: e.message }));
    return () => {
      active = false;
    };
  }, [slug, key]);

  const current = response?.key === key ? response : undefined;
  const clinic = current?.clinic;
  const error = current?.error ?? null;
  const load = () => setAttempt((n) => n + 1);

  const title = clinic ? `Agendar · ${clinic.name}` : 'Agendamento online';

  if (error) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Title>Não foi possível carregar</Title>
        <Notice tone="danger">{error}</Notice>
        <Button label="Tentar novamente" onPress={load} />
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Loading label="Carregando agenda…" />
      </Screen>
    );
  }

  if (!clinic) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Title>Link indisponível</Title>
        <Muted>Este link de agendamento não existe ou foi desativado pela clínica.</Muted>
      </Screen>
    );
  }

  return (
    <BrandProvider primary={clinic.primary_color} secondary={clinic.secondary_color} font={clinic.font_family}>
      <Stack.Screen options={{ title }} />
      <BookingFlow clinic={clinic} />
    </BrandProvider>
  );
}
