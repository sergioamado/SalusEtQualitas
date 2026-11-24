import { onlyDigits } from './format';

export type CepAddress = {
  street: string;
  district: string;
  city: string;
  state: string;
};

export type CepResult =
  | { ok: true; address: CepAddress }
  | { ok: false; reason: 'invalid' | 'not_found' | 'network' };

/** RF12 / RNF02: busca de endereço pelo CEP na API pública ViaCEP. */
export async function lookupCep(cep: string, timeoutMs = 6000): Promise<CepResult> {
  const digits = onlyDigits(cep);
  if (digits.length !== 8) return { ok: false, reason: 'invalid' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: res.status === 400 ? 'invalid' : 'network' };
    const data = await res.json();
    if (data.erro) return { ok: false, reason: 'not_found' };
    return {
      ok: true,
      address: {
        street: data.logradouro ?? '',
        district: data.bairro ?? '',
        city: data.localidade ?? '',
        state: data.uf ?? '',
      },
    };
  } catch {
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
