// ============================================================================
// MODELOS PRONTOS por área de atuação
// ----------------------------------------------------------------------------
// São só pontos de partida: a clínica copia, edita, apaga e acrescenta perguntas.
// Ficam no app (e não no banco) porque são iguais para todos; ao "usar", a cópia
// é gravada em record_templates e passa a ser da clínica.
// Para criar uma área nova (ex.: nutrição), basta acrescentar um item em PRESETS.
// ============================================================================
import type { FormField, TemplateKind } from './types';
import type { Vocabulary } from './vocab';

export type Preset = { kind: TemplateKind; name: string; description: string; fields: FormField[] };
export type PresetArea = { key: string; label: string; vocabulary: Vocabulary; templates: Preset[] };

// Perguntas que se repetem em várias áreas.
const saudeGeral: FormField[] = [
  { id: 'saude_secao', type: 'section', label: 'Saúde geral' },
  { id: 'alergias', type: 'yesno', label: 'Tem alguma alergia?' },
  { id: 'alergias_quais', type: 'text', label: 'Se sim, quais?' },
  { id: 'medicamentos', type: 'textarea', label: 'Usa algum medicamento? Quais?' },
  {
    id: 'condicoes',
    type: 'multi',
    label: 'Possui alguma destas condições?',
    options: ['Hipertensão', 'Diabetes', 'Problema cardíaco', 'Problema de circulação', 'Epilepsia', 'Gestante', 'Nenhuma'],
  },
  { id: 'cirurgias', type: 'textarea', label: 'Cirurgias ou internações anteriores' },
];

const objetivo: FormField = { id: 'objetivo', type: 'textarea', label: 'O que você espera do atendimento?' };

export const PRESETS: PresetArea[] = [
  {
    key: 'fisioterapia',
    label: 'Fisioterapia',
    vocabulary: 'saude',
    templates: [
      {
        kind: 'anamnese',
        name: 'Anamnese de fisioterapia',
        description: 'Avaliação inicial: queixa, dor, histórico e hábitos.',
        fields: [
          { id: 'queixa_secao', type: 'section', label: 'Queixa principal' },
          { id: 'queixa', type: 'textarea', label: 'Qual é a sua queixa principal?', required: true },
          { id: 'inicio', type: 'text', label: 'Desde quando sente isso?' },
          { id: 'dor', type: 'scale', label: 'Nível de dor hoje', help: '0 = sem dor, 10 = pior dor possível', required: true },
          {
            id: 'regiao',
            type: 'multi',
            label: 'Onde sente a dor?',
            options: ['Cervical (pescoço)', 'Ombro', 'Coluna torácica', 'Lombar', 'Quadril', 'Joelho', 'Tornozelo/pé', 'Punho/mão', 'Outro'],
          },
          { id: 'piora', type: 'textarea', label: 'O que piora ou melhora a dor?' },
          { id: 'tratamento_anterior', type: 'yesno', label: 'Já fez fisioterapia para isso antes?' },
          { id: 'exames', type: 'textarea', label: 'Exames realizados (raio-x, ressonância…) e resultados' },
          ...saudeGeral,
          { id: 'habitos_secao', type: 'section', label: 'Hábitos' },
          { id: 'atividade', type: 'choice', label: 'Pratica atividade física?', options: ['Não', '1–2 vezes por semana', '3 ou mais vezes por semana'] },
          { id: 'profissao', type: 'text', label: 'Profissão / posição de trabalho' },
          objetivo,
        ],
      },
      {
        kind: 'evolucao',
        name: 'Evolução da sessão',
        description: 'Registro de cada sessão de fisioterapia.',
        fields: [
          { id: 'dor_antes', type: 'scale', label: 'Dor no início da sessão', required: true },
          { id: 'condutas', type: 'textarea', label: 'Condutas / técnicas aplicadas', required: true },
          { id: 'dor_depois', type: 'scale', label: 'Dor ao final da sessão' },
          { id: 'resposta', type: 'choice', label: 'Resposta ao tratamento', options: ['Melhorou', 'Manteve', 'Piorou'] },
          { id: 'orientacoes', type: 'textarea', label: 'Orientações / exercícios para casa' },
        ],
      },
    ],
  },
  {
    key: 'massagem',
    label: 'Massagem / massoterapia',
    vocabulary: 'beleza',
    templates: [
      {
        kind: 'anamnese',
        name: 'Ficha de avaliação para massagem',
        description: 'Contraindicações, áreas de tensão e preferências.',
        fields: [
          {
            id: 'motivo',
            type: 'choice',
            label: 'Principal motivo da massagem',
            options: ['Relaxamento', 'Dor / tensão muscular', 'Drenagem', 'Recuperação esportiva', 'Outro'],
            required: true,
          },
          {
            id: 'areas',
            type: 'multi',
            label: 'Áreas de tensão ou desconforto',
            options: ['Pescoço', 'Ombros', 'Costas', 'Lombar', 'Pernas', 'Pés', 'Braços', 'Cabeça'],
          },
          { id: 'pressao', type: 'choice', label: 'Pressão preferida', options: ['Leve', 'Média', 'Forte'] },
          ...saudeGeral,
          {
            id: 'contra_secao',
            type: 'section',
            label: 'Cuidados',
          },
          { id: 'varizes', type: 'yesno', label: 'Tem varizes, trombose ou problema de circulação?' },
          { id: 'lesao', type: 'yesno', label: 'Tem alguma lesão, inflamação ou ferida na pele?' },
          { id: 'evitar', type: 'text', label: 'Alguma região que NÃO devemos tocar?' },
          { id: 'oleos', type: 'yesno', label: 'Tem sensibilidade a óleos ou aromas?' },
          objetivo,
        ],
      },
      {
        kind: 'evolucao',
        name: 'Registro da sessão de massagem',
        description: 'Técnica, áreas trabalhadas e retorno do cliente.',
        fields: [
          { id: 'tecnica', type: 'text', label: 'Técnica utilizada', required: true },
          { id: 'areas_trab', type: 'textarea', label: 'Áreas trabalhadas' },
          { id: 'produtos', type: 'text', label: 'Óleos / produtos usados' },
          { id: 'satisfacao', type: 'scale', label: 'Como o cliente se sentiu ao final', help: '0 = nada bem, 10 = ótimo' },
          { id: 'obs', type: 'textarea', label: 'Observações para a próxima sessão' },
        ],
      },
    ],
  },
  {
    key: 'estetica',
    label: 'Estética',
    vocabulary: 'beleza',
    templates: [
      {
        kind: 'anamnese',
        name: 'Ficha de avaliação estética',
        description: 'Pele, alergias, uso de ácidos e rotina de cuidados.',
        fields: [
          { id: 'queixa', type: 'textarea', label: 'O que deseja tratar ou melhorar?', required: true },
          { id: 'pele_secao', type: 'section', label: 'Pele' },
          { id: 'tipo_pele', type: 'choice', label: 'Tipo de pele', options: ['Normal', 'Seca', 'Oleosa', 'Mista', 'Sensível', 'Não sei'] },
          {
            id: 'condicoes_pele',
            type: 'multi',
            label: 'Apresenta',
            options: ['Acne', 'Manchas', 'Melasma', 'Rosácea', 'Flacidez', 'Linhas de expressão', 'Cicatrizes', 'Nenhuma'],
          },
          { id: 'acidos', type: 'yesno', label: 'Usa ácidos ou retinoides (ex.: ácido glicólico, tretinoína)?' },
          { id: 'isotretinoina', type: 'yesno', label: 'Usou isotretinoína (Roacutan) nos últimos 6 meses?' },
          { id: 'sol', type: 'choice', label: 'Exposição ao sol', options: ['Pouca', 'Moderada', 'Muita'] },
          { id: 'protetor', type: 'yesno', label: 'Usa protetor solar todos os dias?' },
          { id: 'procedimentos', type: 'textarea', label: 'Procedimentos estéticos anteriores (peeling, laser, toxina…)' },
          ...saudeGeral,
          { id: 'rotina', type: 'textarea', label: 'Rotina de cuidados em casa (produtos que usa)' },
        ],
      },
      {
        kind: 'evolucao',
        name: 'Registro do procedimento estético',
        description: 'Procedimento, produtos, parâmetros e reação.',
        fields: [
          { id: 'procedimento', type: 'text', label: 'Procedimento realizado', required: true },
          { id: 'produtos', type: 'textarea', label: 'Produtos e concentrações / parâmetros do equipamento' },
          { id: 'reacao', type: 'choice', label: 'Reação imediata', options: ['Nenhuma', 'Vermelhidão leve', 'Ardência', 'Outra'] },
          { id: 'obs', type: 'textarea', label: 'Observações' },
          { id: 'retorno', type: 'date', label: 'Retorno sugerido' },
        ],
      },
    ],
  },
  {
    key: 'cabelo',
    label: 'Cabeleireira / salão',
    vocabulary: 'beleza',
    templates: [
      {
        kind: 'anamnese',
        name: 'Ficha de avaliação capilar',
        description: 'Histórico químico, alergias e preferências.',
        fields: [
          { id: 'tipo_fio', type: 'choice', label: 'Tipo de cabelo', options: ['Liso', 'Ondulado', 'Cacheado', 'Crespo'] },
          { id: 'estado', type: 'multi', label: 'Como está o cabelo hoje?', options: ['Saudável', 'Seco', 'Oleoso', 'Quebradiço', 'Com queda', 'Com caspa'] },
          { id: 'quimica_secao', type: 'section', label: 'Histórico químico' },
          {
            id: 'quimicas',
            type: 'multi',
            label: 'Já fez no cabelo (últimos 12 meses)',
            options: ['Coloração', 'Descoloração / mechas', 'Progressiva / alisamento', 'Relaxamento', 'Permanente', 'Henna', 'Nenhuma'],
          },
          { id: 'quimica_quando', type: 'text', label: 'Quando foi a última química e qual produto?' },
          { id: 'alergia_tinta', type: 'yesno', label: 'Já teve alergia ou irritação com tinta ou química?', required: true },
          { id: 'couro', type: 'yesno', label: 'Tem ferida, sensibilidade ou dermatite no couro cabeludo?' },
          { id: 'gestante', type: 'yesno', label: 'Está grávida ou amamentando?' },
          { id: 'desejo', type: 'textarea', label: 'O que deseja fazer hoje?', required: true },
        ],
      },
      {
        kind: 'evolucao',
        name: 'Ficha técnica do serviço',
        description: 'Fórmula da cor, produtos, tempo de pausa e resultado.',
        fields: [
          { id: 'servico', type: 'text', label: 'Serviço realizado', required: true },
          { id: 'formula', type: 'textarea', label: 'Fórmula (marca, tons, volume do oxidante, proporção)' },
          { id: 'pausa', type: 'number', label: 'Tempo de pausa (minutos)' },
          { id: 'teste_mecha', type: 'yesno', label: 'Fez teste de mecha / de toque?' },
          { id: 'resultado', type: 'textarea', label: 'Resultado e observações para a próxima vez' },
          { id: 'retorno', type: 'date', label: 'Retorno sugerido' },
        ],
      },
    ],
  },
];
