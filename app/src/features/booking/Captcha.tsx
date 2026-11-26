import { useEffect, useId } from 'react';
import { Platform, View } from 'react-native';

import { Notice } from '@/components/ui';

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};
type TurnstileWindow = Window & { turnstile?: Turnstile };

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile> | null = null;

/** Carrega o script do Cloudflare Turnstile uma única vez. */
function loadTurnstile(): Promise<Turnstile> {
  const w = window as TurnstileWindow;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = SCRIPT;
      tag.async = true;
      tag.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('turnstile')));
      tag.onerror = () => {
        loading = null;
        reject(new Error('turnstile'));
      };
      document.head.appendChild(tag);
    });
  }
  return loading;
}

/**
 * "Não sou um robô" (Cloudflare Turnstile). Na maioria das vezes confirma sozinho,
 * sem a pessoa precisar clicar. Mude `round` para gerar um token novo (cada token vale uma vez).
 */
export function Captcha({
  siteKey,
  round,
  onToken,
}: {
  siteKey: string;
  round: number;
  onToken: (token: string | null) => void;
}) {
  const domId = `captcha-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        const el = document.getElementById(domId);
        if (cancelled || !el) return;
        widgetId = t.render(el, {
          sitekey: siteKey,
          language: 'pt-br',
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      onToken(null);
      const t = (window as TurnstileWindow).turnstile;
      if (widgetId && t) t.remove(widgetId);
    };
  }, [siteKey, round, domId, onToken]);

  if (Platform.OS !== 'web') {
    return <Notice tone="warning">Para concluir o agendamento, abra o link da clínica no navegador.</Notice>;
  }
  return <View nativeID={domId} style={{ minHeight: 70 }} />;
}
