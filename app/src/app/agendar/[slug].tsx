// ============================================================================
// TELA PÚBLICA DE AGENDAMENTO — /agendar/<slug>
// ----------------------------------------------------------------------------
// É o link que a clínica divulga (Instagram, WhatsApp…). O paciente NÃO faz login.
// O "slug" é o apelido da clínica na URL (ex.: anarahealth).
// Esta tela só faz três coisas: busca os dados públicos da clínica, trata
// "carregando / erro / não existe" e entrega o resto para o <BookingFlow>.
// ============================================================================
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, Loading, Muted, Notice, Screen, Title } from '@/components/ui';
import { fetchClinic, type PublicClinic } from '@/features/booking/api';
import { BookingFlow } from '@/features/booking/BookingFlow';
import { BrandProvider } from '@/lib/brand';
import { supabase } from '@/lib/supabase';

/** RF08: link público de agendamento da clínica — /agendar/<slug> */
export default function PublicBookingScreen() {
  // Lê a parte variável da URL: o nome do arquivo [slug].tsx vira o parâmetro "slug".
  const { slug } = useLocalSearchParams<{ slug: string }>();

  // PADRÃO "RESPOSTA COM CHAVE" (usado em várias telas do projeto):
  // - `attempt` aumenta quando o usuário clica "Tentar novamente";
  // - `key` identifica QUAL pedido estamos esperando (slug + tentativa);
  // - a resposta guarda a key do pedido que a gerou.
  // Se a key da resposta não bate com a atual, a resposta é velha -> tratamos como
  // "carregando". Isso evita chamar setState para "limpar" dentro do useEffect
  // (o React Compiler reclama disso) e evita mostrar dados de outra clínica.
  const [attempt, setAttempt] = useState(0);
  const key = `${slug}|${attempt}`;
  const [response, setResponse] = useState<{ key: string; clinic?: PublicClinic | null; error?: string }>();

  // Conta um acesso por abertura do link (só número, sem dados pessoais).
  // (Alimenta o painel do gerente do sistema: "visitas ao link".)
  useEffect(() => {
    if (slug) supabase.rpc('public_track_view', { p_slug: String(slug) }).then(() => {});
  }, [slug]);

  useEffect(() => {
    // `active` evita gravar a resposta se o usuário já saiu da tela (ou trocou de
    // clínica) antes de ela chegar.
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

  // Os quatro estados possíveis de uma tela que carrega dados:
  // 1) deu erro
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

  // 2) ainda carregando
  if (!current) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Loading label="Carregando agenda…" />
      </Screen>
    );
  }

  // 3) carregou, mas a clínica não existe ou desligou o link
  if (!clinic) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Title>Link indisponível</Title>
        <Muted>Este link de agendamento não existe ou foi desativado pela clínica.</Muted>
      </Screen>
    );
  }

  // 4) tudo certo: aplica as cores/fonte da clínica (BrandProvider) e mostra o fluxo.
  return (
    <BrandProvider primary={clinic.primary_color} secondary={clinic.secondary_color} font={clinic.font_family}>
      <Stack.Screen options={{ title }} />
      <BookingFlow clinic={clinic} />
    </BrandProvider>
  );
}
