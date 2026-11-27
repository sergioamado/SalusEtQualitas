// Vocabulário do módulo: o MESMO sistema fala "paciente/prontuário" numa
// fisioterapia e "cliente/ficha técnica" num salão. A clínica escolhe em
// "Modelos de ficha" (coluna clinics.record_vocabulary).

export type Vocabulary = 'saude' | 'beleza';

export type VocabWords = {
  person: string; // paciente / cliente
  people: string; // pacientes / clientes
  intake: string; // anamnese / ficha de avaliação
  session: string; // evolução / registro do atendimento
  record: string; // prontuário / ficha técnica
};

export const VOCAB: Record<Vocabulary, VocabWords> = {
  saude: {
    person: 'paciente',
    people: 'pacientes',
    intake: 'anamnese',
    session: 'evolução',
    record: 'prontuário',
  },
  beleza: {
    person: 'cliente',
    people: 'clientes',
    intake: 'ficha de avaliação',
    session: 'registro do atendimento',
    record: 'ficha técnica',
  },
};

export const VOCAB_LABEL: Record<Vocabulary, string> = {
  saude: 'Saúde — paciente, anamnese, prontuário',
  beleza: 'Beleza e bem-estar — cliente, ficha de avaliação, ficha técnica',
};

export function vocab(v: string | null | undefined): VocabWords {
  return VOCAB[v === 'beleza' ? 'beleza' : 'saude'];
}

/** Primeira letra maiúscula: "anamnese" -> "Anamnese". */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
