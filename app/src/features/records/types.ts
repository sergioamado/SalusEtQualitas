// ============================================================================
// MÓDULO PACIENTES — tipos compartilhados
// ----------------------------------------------------------------------------
// Uma "ficha" (modelo) é só uma LISTA DE PERGUNTAS guardada em JSON no banco
// (record_templates.fields). Como as perguntas são dados — e não código —, cada
// clínica monta a sua sem precisarmos programar nada novo. Isso é o que torna o
// módulo "genérico": fisioterapia, estética e salão usam o mesmo sistema.
// As regras do formato são conferidas também no banco (_valid_fields).
// ============================================================================

export type FieldType = 'section' | 'text' | 'textarea' | 'yesno' | 'choice' | 'multi' | 'scale' | 'number' | 'date';

export type FormField = {
  /** Identificador fixo (a resposta fica guardada com este nome). Não muda ao renomear a pergunta. */
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  /** Texto de ajuda embaixo da pergunta. */
  help?: string;
  /** Opções de 'choice' (uma) e 'multi' (várias). */
  options?: string[];
};

/** Valor de uma resposta, conforme o tipo da pergunta. */
export type AnswerValue = string | number | boolean | string[] | null;
export type Answers = Record<string, AnswerValue>;

/** 'anamnese' = ficha inicial; 'evolucao' = registro de cada atendimento. */
export type TemplateKind = 'anamnese' | 'evolucao';

export type RecordTemplate = {
  id: string;
  clinic_id: string;
  kind: TemplateKind;
  name: string;
  description: string | null;
  fields: FormField[];
  active: boolean;
  sort_order: number;
};

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  section: 'Título de seção',
  text: 'Resposta curta',
  textarea: 'Resposta longa',
  yesno: 'Sim / Não',
  choice: 'Escolha uma opção',
  multi: 'Várias opções',
  scale: 'Escala 0 a 10',
  number: 'Número',
  date: 'Data',
};

/** Limites iguais aos do banco (migration 20261127000000_modulo_pacientes). */
export const LIMITS = { fields: 80, options: 30, label: 200 } as const;

/** Cria um id novo e válido para uma pergunta (letras minúsculas, números e _). */
export function newFieldId(existing: string[]): string {
  for (;;) {
    const id = `f_${Math.random().toString(36).slice(2, 8)}`;
    if (!existing.includes(id)) return id;
  }
}

/** Uma resposta está "vazia"? (mesma regra do banco) */
export function isEmptyAnswer(v: AnswerValue | undefined): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** Ids das perguntas obrigatórias sem resposta. */
export function missingRequired(fields: FormField[], answers: Answers): string[] {
  return fields.filter((f) => f.type !== 'section' && f.required && isEmptyAnswer(answers[f.id])).map((f) => f.id);
}

/** Confere o modelo antes de salvar; devolve a mensagem do primeiro problema, ou null. */
export function templateProblem(name: string, fields: FormField[]): string | null {
  if (name.trim().length < 2) return 'Dê um nome à ficha.';
  if (fields.filter((f) => f.type !== 'section').length === 0) return 'Adicione pelo menos uma pergunta.';
  if (fields.length > LIMITS.fields) return `Uma ficha pode ter no máximo ${LIMITS.fields} itens.`;
  for (const [i, f] of fields.entries()) {
    const n = i + 1;
    if (!f.label.trim()) return `O item ${n} está sem texto.`;
    if (f.label.length > LIMITS.label) return `O item ${n} tem texto longo demais.`;
    if (f.type === 'choice' || f.type === 'multi') {
      const opts = (f.options ?? []).filter((o) => o.trim());
      if (opts.length === 0) return `“${f.label}”: escreva pelo menos uma opção.`;
      if (opts.length > LIMITS.options) return `“${f.label}”: no máximo ${LIMITS.options} opções.`;
      if (new Set(opts).size !== opts.length) return `“${f.label}”: há opções repetidas.`;
    }
  }
  return null;
}

/** Limpa o modelo para gravar: tira espaços, opções vazias e campos que não se aplicam. */
export function cleanFields(fields: FormField[]): FormField[] {
  return fields.map((f) => {
    const out: FormField = { id: f.id, type: f.type, label: f.label.trim() };
    if (f.type !== 'section' && f.required) out.required = true;
    if (f.help?.trim()) out.help = f.help.trim();
    if (f.type === 'choice' || f.type === 'multi') out.options = (f.options ?? []).map((o) => o.trim()).filter(Boolean);
    return out;
  });
}
