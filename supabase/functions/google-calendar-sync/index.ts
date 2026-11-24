// Sincroniza agendamentos com o Google Agenda do gerente da clínica.
//
// Duas formas de chamada:
//  1. Gatilho do banco (pg_net) com header x-webhook-secret: { appointment_id }
//  2. Painel (usuário logado):  { action: 'info' }  -> e-mail da conta de serviço
//                               { action: 'test', clinic_id } -> cria e apaga um evento de teste
import { google, GoogleError, serviceAccount, type CalendarEvent } from '../_shared/google.ts';
import { corsHeaders, json, requireUser, serviceClient } from '../_shared/http.ts';

const STATUS_LABEL: Record<string, string> = {
  reservado: 'Aguardando confirmação',
  agendado: 'Agendado',
  confirmado: 'Confirmado pelo paciente',
  nao_compareceu: 'Não compareceu',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};
// Cores do Google Agenda: 5 amarelo, 10 verde, 9 azul, 11 vermelho, 8 cinza
const STATUS_COLOR: Record<string, string> = {
  reservado: '5',
  agendado: '9',
  confirmado: '10',
  nao_compareceu: '11',
  concluido: '8',
};
const CHANNEL_LABEL: Record<string, string> = {
  portal: 'Link de agendamento',
  interno: 'Recepção',
  whatsapp: 'WhatsApp',
  telefone: 'Telefone',
  instagram: 'Instagram',
  outro: 'Outro',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const secret = Deno.env.get('SALUS_WEBHOOK_SECRET');
  if (secret && req.headers.get('x-webhook-secret') === secret && typeof body.appointment_id === 'string') {
    return syncAppointment(body.appointment_id);
  }

  // Chamadas do painel
  const auth = await requireUser(req);
  if (!auth) return json({ error: 'Não autenticado' }, 401);

  if (body.action === 'info') {
    try {
      return json({ service_account_email: serviceAccount().client_email });
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  }

  if (body.action === 'test' && typeof body.clinic_id === 'string') {
    const { data: allowed } = await auth.client.rpc('can_manage_clinic', { p_clinic_id: body.clinic_id });
    if (!allowed) return json({ error: 'Sem permissão' }, 403);
    const { data: clinic } = await serviceClient()
      .from('clinics')
      .select('google_calendar_id, timezone')
      .eq('id', body.clinic_id)
      .single();
    if (!clinic?.google_calendar_id) return json({ error: 'Informe e salve o ID da agenda primeiro.' }, 400);
    try {
      const start = new Date(Date.now() + 3600_000);
      const ev = await google.insert(clinic.google_calendar_id, {
        summary: 'Teste Salus Et Qualitas',
        start: { dateTime: start.toISOString(), timeZone: clinic.timezone },
        end: { dateTime: new Date(start.getTime() + 900_000).toISOString(), timeZone: clinic.timezone },
      });
      await google.remove(clinic.google_calendar_id, ev.id);
      return json({ ok: true });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  return json({ error: 'Ação desconhecida' }, 400);
});

async function syncAppointment(appointmentId: string) {
  const db = serviceClient();
  const { data: a, error } = await db
    .from('appointments')
    .select(`
      id, status, modality, channel, starts_at, ends_at, google_event_id, notes, price,
      address_street, address_number, address_complement, address_district, address_city, address_state, address_cep,
      clinic:clinics!inner ( name, address, timezone, google_notify_enabled, google_calendar_id ),
      contact:contacts!appointments_contact_id_clinic_id_fkey ( full_name, phone, email ),
      procedure:procedures!appointments_procedure_id_clinic_id_fkey ( name ),
      professional:professionals!appointments_professional_id_clinic_id_fkey ( name ),
      room:rooms!appointments_room_id_clinic_id_fkey ( name )
    `)
    .eq('id', appointmentId)
    .single();
  if (error || !a) return json({ error: error?.message ?? 'Agendamento não encontrado' }, 404);

  // deno-lint-ignore no-explicit-any
  const r = a as any;
  const calendarId: string | null = r.clinic.google_notify_enabled ? r.clinic.google_calendar_id : null;
  if (!calendarId) return json({ skipped: 'integração desativada' });

  const mark = (fields: Record<string, unknown>) =>
    db.from('appointments').update(fields).eq('id', appointmentId);

  try {
    if (r.status === 'cancelado') {
      if (r.google_event_id) {
        await google.remove(calendarId, r.google_event_id).catch((e) => {
          if (!(e instanceof GoogleError && (e.status === 404 || e.status === 410))) throw e;
        });
      }
      await mark({ google_event_id: null, google_synced_at: new Date().toISOString(), google_sync_error: null });
      return json({ ok: true, removed: true });
    }

    const event = buildEvent(r);
    let eventId: string = r.google_event_id;
    if (eventId) {
      try {
        await google.patch(calendarId, eventId, event);
      } catch (e) {
        if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) {
          eventId = (await google.insert(calendarId, event)).id; // apagaram no Google: recria
        } else throw e;
      }
    } else {
      eventId = (await google.insert(calendarId, event)).id;
    }
    await mark({ google_event_id: eventId, google_synced_at: new Date().toISOString(), google_sync_error: null });
    return json({ ok: true, event_id: eventId });
  } catch (e) {
    await mark({ google_sync_error: (e as Error).message.slice(0, 500) });
    return json({ error: (e as Error).message }, 502);
  }
}

// deno-lint-ignore no-explicit-any
function buildEvent(r: any): CalendarEvent {
  const home = r.modality === 'residencial';
  const address = home
    ? [
        `${r.address_street}, ${r.address_number}`,
        r.address_complement,
        r.address_district,
        `${r.address_city}/${r.address_state}`,
        r.address_cep,
      ].filter(Boolean).join(' - ')
    : r.clinic.address ?? r.clinic.name;
  const phone = r.contact?.phone ? String(r.contact.phone) : '';

  const lines = [
    `Status: ${STATUS_LABEL[r.status] ?? r.status}`,
    `Paciente: ${r.contact?.full_name ?? '-'}`,
    phone ? `WhatsApp: https://wa.me/55${phone}` : null,
    r.contact?.email ? `E-mail: ${r.contact.email}` : null,
    `Profissional: ${r.professional?.name ?? '-'}`,
    `Local: ${home ? 'Residencial (Home Care)' : `Na clínica${r.room?.name ? ` — ${r.room.name}` : ''}`}`,
    `Origem: ${CHANNEL_LABEL[r.channel] ?? r.channel}`,
    r.notes ? `Observações: ${r.notes}` : null,
  ].filter(Boolean);

  const prefix = r.status === 'reservado' ? '⏳ ' : '';
  return {
    summary: `${prefix}${r.procedure?.name ?? 'Atendimento'} · ${r.contact?.full_name ?? ''}`.trim(),
    description: lines.join('\n'),
    location: address,
    colorId: STATUS_COLOR[r.status],
    start: { dateTime: r.starts_at, timeZone: r.clinic.timezone },
    end: { dateTime: r.ends_at, timeZone: r.clinic.timezone },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'email', minutes: 24 * 60 },
      ],
    },
  };
}
