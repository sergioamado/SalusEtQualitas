// Acesso ao Google Agenda com conta de serviço (sem SDK, só WebCrypto).
// O gerente compartilha a agenda dele com o e-mail da conta de serviço
// ("Fazer alterações nos eventos") e informa o ID da agenda no painel.

type ServiceAccount = { client_email: string; private_key: string };

let cached: { token: string; expires: number } | null = null;

export function serviceAccount(): ServiceAccount {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado nas Edge Functions.');
  return JSON.parse(raw);
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)),
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google OAuth: ${data.error_description ?? data.error ?? res.status}`);
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

export class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      res.status === 404 || res.status === 403
        ? 'Agenda não encontrada ou sem permissão. Compartilhe a agenda com o e-mail da conta de serviço com a opção "Fazer alterações nos eventos".'
        : data?.error?.message ?? `Erro ${res.status} no Google Agenda`;
    throw new GoogleError(res.status, msg);
  }
  return data;
}

export type CalendarEvent = {
  summary: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  reminders?: { useDefault: boolean; overrides?: { method: 'popup' | 'email'; minutes: number }[] };
};

const cal = (id: string) => encodeURIComponent(id);

export const google = {
  insert: (calendarId: string, event: CalendarEvent) =>
    call('POST', `/calendars/${cal(calendarId)}/events`, event) as Promise<{ id: string }>,
  patch: (calendarId: string, eventId: string, event: CalendarEvent) =>
    call('PATCH', `/calendars/${cal(calendarId)}/events/${cal(eventId)}`, event) as Promise<{ id: string }>,
  remove: (calendarId: string, eventId: string) =>
    call('DELETE', `/calendars/${cal(calendarId)}/events/${cal(eventId)}`),
};
