import type { FormField, MedicalEntry, MedicalForm } from '@all/medical-records';
import { z } from 'zod';

// Especialidades que a clínica liga nas configurações do módulo. Nenhuma ligada = só a estética
// básica (anamnese, evolução e pacotes). Fichas clínicas vão para o prontuário (só inclusão);
// cadastros (produtos, lotes, termos, registros profissionais) ficam nas tabelas do módulo.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const careDate = isoDate.refine((d) => d <= today(), 'A data do atendimento não pode ser no futuro');
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const specialtyKeys = ['harmonization', 'whitening', 'plastic_surgery', 'micropigmentation', 'laser', 'trichology'] as const;
export type SpecialtyKey = (typeof specialtyKeys)[number];

export const specialtyLabel: Record<SpecialtyKey, string> = {
  harmonization: 'Harmonização facial',
  whitening: 'Clareamento dental',
  plastic_surgery: 'Cirurgia plástica',
  micropigmentation: 'Micropigmentação',
  laser: 'Depilação a laser e corporal',
  trichology: 'Tricologia (capilar)',
};

export const specialtyDescription: Record<SpecialtyKey, string> = {
  harmonization: 'Toxina botulínica, preenchedores, bioestimuladores e fios, com mapa facial e rastreio de lote.',
  whitening: 'Consultório, caseiro ou combinado, com cor inicial e final na escala VITA. Exige CRO.',
  plastic_surgery: 'Avaliação, pré-operatório, orçamento em partes, cirurgia na agenda e pós-operatório. Exige CRM e RQE.',
  micropigmentation: 'Sobrancelhas, lábios, capilar e olhos, com pigmento e lote, desenho aprovado e retoque.',
  laser: 'Sessões por área com fototipo e parâmetros do aparelho; usa as salas/equipamentos da agenda.',
  trichology: 'Anamnese capilar, tricoscopia com fotos por região, diagnóstico e protocolo em sessões.',
};

// ---- Registro profissional (conselho) ---------------------------------------------------------

export const councils = ['CRM', 'CRO', 'CRBM', 'CRF', 'COREN', 'CREFITO', 'CRBio', 'other'] as const;
export type Council = (typeof councils)[number];
export const councilLabel: Record<Council, string> = {
  CRM: 'CRM (médico)',
  CRO: 'CRO (dentista)',
  CRBM: 'CRBM (biomédico)',
  CRF: 'CRF (farmacêutico)',
  COREN: 'COREN (enfermagem)',
  CREFITO: 'CREFITO (fisioterapeuta)',
  CRBio: 'CRBio (biólogo)',
  other: 'Outro conselho',
};
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;

/**
 * Registro exigido do profissional que assina a ficha: conselhos aceitos e se precisa de RQE
 * (registro de qualificação de especialista). Sem regra = qualquer profissional da agenda.
 */
export const specialtyRequirement: Partial<Record<SpecialtyKey, { councils: Council[]; rqeForms?: string[]; message: string }>> = {
  whitening: { councils: ['CRO'], message: 'Clareamento dental exige profissional com CRO' },
  // Avaliação e descrição cirúrgica (e a marcação da cirurgia) pedem também o RQE do cirurgião.
  plastic_surgery: { councils: ['CRM'], rqeForms: ['aesthetics.surgery.evaluation', 'aesthetics.surgery.report'], message: 'Cirurgia plástica exige médico com CRM (e RQE do cirurgião na avaliação e na cirurgia)' },
  harmonization: {
    councils: ['CRM', 'CRO', 'CRBM', 'CRF', 'COREN'],
    message: 'Injetáveis exigem profissional com registro em conselho de saúde (CRM, CRO, CRBM, CRF ou COREN)',
  },
};

export const credentialInput = z.object({
  council: z.enum(councils),
  number: z.string().trim().min(2, 'Informe o número do registro').max(20),
  uf: z.enum(UFS, { errorMap: () => ({ message: 'UF inválida' }) }),
  /** Registro de Qualificação de Especialista (CRM), quando houver. */
  rqe: optText(20),
  specialty: optText(80),
});
export type CredentialInput = z.infer<typeof credentialInput>;

export interface ProfessionalCredential {
  /** Profissional da agenda. */
  resourceId: string;
  name: string;
  active: boolean;
  teamMemberId: string | null;
  credential: (CredentialInput & { label: string }) | null;
}

/** "CRO-SP 12345" / "CRM-SP 123456 · RQE 7890". */
export function credentialText(c: { council: string; uf: string; number: string; rqe?: string | null }) {
  const council = c.council === 'other' ? 'Registro' : c.council;
  return `${council}-${c.uf} ${c.number}${c.rqe ? ` · RQE ${c.rqe}` : ''}`;
}

// ---- Produtos injetáveis, pigmentos e lotes (rastreabilidade Anvisa) ---------------------------

export const productKinds = ['toxin', 'filler', 'biostimulator', 'thread', 'pigment', 'whitening_gel', 'implant', 'hair_drug', 'other'] as const;
export type ProductKind = (typeof productKinds)[number];
export const productKindLabel: Record<ProductKind, string> = {
  toxin: 'Toxina botulínica',
  filler: 'Preenchedor (ácido hialurônico)',
  biostimulator: 'Bioestimulador de colágeno',
  thread: 'Fio de sustentação',
  pigment: 'Pigmento (micropigmentação)',
  whitening_gel: 'Gel clareador',
  implant: 'Prótese / implante',
  hair_drug: 'Ativo capilar (intradermoterapia)',
  other: 'Outro',
};
/** Que produtos cada especialidade usa (para filtrar a lista ao registrar). */
export const kindsBySpecialty: Record<SpecialtyKey, ProductKind[]> = {
  harmonization: ['toxin', 'filler', 'biostimulator', 'thread', 'other'],
  whitening: ['whitening_gel', 'other'],
  plastic_surgery: ['implant', 'other'],
  micropigmentation: ['pigment', 'other'],
  laser: ['other'],
  trichology: ['hair_drug', 'other'],
};

export const productUnits = ['U', 'ml', 'fio', 'g', 'un'] as const;
export type ProductUnit = (typeof productUnits)[number];
export const productUnitLabel: Record<ProductUnit, string> = { U: 'Unidades (U)', ml: 'Mililitros (ml)', fio: 'Fios', g: 'Gramas (g)', un: 'Unidades (peças)' };

export const productInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  brand: optText(80),
  kind: z.enum(productKinds),
  unit: z.enum(productUnits),
  /** Registro na Anvisa (13 dígitos, ou o texto como está no rótulo). */
  anvisaRegistration: optText(30),
  /** Quanto vem em cada frasco/seringa (ex.: 100 U, 1 ml): converte o uso em baixa no estoque. */
  unitsPerPackage: z.coerce.number().positive('Informe um número maior que zero').max(100_000).nullish(),
  /** Produto do estoque (vendas) que recebe a baixa a cada uso. */
  salesProductId: z.string().uuid().nullish(),
  active: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productInput>;

/** Lote novo: de um produto existente ou, na importação por planilha, do produto pelo nome. */
export const lotInput = z
  .object({
    productId: z.string().uuid().nullish(),
    product: productInput.partial({ unit: true, kind: true }).nullish(),
    lot: z.string().trim().min(1, 'Informe o lote').max(40),
    expiresOn: isoDate,
    receivedOn: isoDate.nullish(),
    /** Quantidade recebida, na unidade do produto (só informativo; o saldo de estoque é do módulo de vendas). */
    quantity: z.coerce.number().min(0).max(1_000_000).nullish(),
    notes: optText(300),
  })
  .refine((l) => l.productId || l.product?.name, { message: 'Escolha o produto', path: ['productId'] });
export type LotInput = z.infer<typeof lotInput>;

export interface AesLot {
  id: string;
  lot: string;
  expiresOn: string;
  receivedOn: string | null;
  quantity: number | null;
  /** Já usado em pacientes, na unidade do produto. */
  used: number;
  expired: boolean;
  notes: string | null;
}

export interface AesProduct extends Omit<ProductInput, 'unitsPerPackage' | 'salesProductId'> {
  id: string;
  unitsPerPackage: number | null;
  salesProductId: string | null;
  salesProductName: string | null;
  lots: AesLot[];
}

export interface LotUsage {
  id: string;
  customer: { id: string; name: string };
  amount: number;
  unit: string;
  usedOn: string;
  specialty: SpecialtyKey;
  entryId: string;
  /** Estorno de uma ficha retificada: a quantidade vem negativa e aponta para o uso corrigido. */
  reversalOf: string | null;
}

/** Rastreio de um lote: quem recebeu, quando e quanto (recall da Anvisa). */
export interface LotTrace {
  product: { id: string; name: string; brand: string | null; anvisaRegistration: string | null };
  lot: AesLot;
  usages: LotUsage[];
}

// ---- Termos de consentimento -------------------------------------------------------------------

export const consentTemplateInput = z.object({
  specialty: z.enum(specialtyKeys).nullish(),
  title: z.string().trim().min(3, 'Informe o título').max(120),
  /** Texto do termo; {{paciente}}, {{procedimento}}, {{profissional}} e {{data}} são preenchidos ao aceitar. */
  body: z.string().trim().min(20, 'Escreva o texto do termo').max(9_000, 'O texto pode ter no máximo 9.000 caracteres'),
  active: z.boolean().default(true),
});
export type ConsentTemplateInput = z.infer<typeof consentTemplateInput>;

export interface ConsentTemplate extends ConsentTemplateInput {
  id: string;
  /** Modelo que veio com a especialidade (editável, mas não duplicado). */
  key: string | null;
  /** Sobe a cada edição; o aceite guarda o texto e a versão do momento. */
  version: number;
  updatedAt: string;
}

/** Variáveis do termo, trocadas no texto que fica no prontuário. */
export function fillConsent(body: string, vars: { paciente: string; procedimento: string; profissional: string; data: string }) {
  return body.replace(/\{\{\s*(paciente|procedimento|profissional|data)\s*\}\}/g, (_, k: keyof typeof vars) => vars[k]);
}

/** Assinatura desenhada na tela: PNG em data URL (até ~70 KB; a tela reduz a imagem). */
const signature = z
  .string()
  .max(95_000, 'Assinatura grande demais: limpe e assine de novo')
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Assinatura inválida');

export const consentAcceptInput = z.object({
  customerId: z.string().uuid('Escolha o paciente'),
  templateId: z.string().uuid('Escolha o termo'),
  /** Especialidade do aceite quando o modelo vale para todas (ex.: uso de imagem). */
  specialty: z.enum(specialtyKeys).nullish(),
  procedure: z.string().trim().min(2, 'Informe o procedimento').max(160),
  professionalId: z.string().uuid('Escolha o profissional'),
  caseId: z.string().uuid().nullish(),
  /** Quem assinou (o paciente ou o responsável legal). */
  signedBy: z.string().trim().min(3, 'Informe quem assina').max(120),
  signature: signature.nullish(),
  occurredOn: careDate.optional(),
});
export type ConsentAcceptInput = z.infer<typeof consentAcceptInput>;

// ---- Fotos padronizadas -------------------------------------------------------------------------

export const photoAngles = ['Frontal', 'Perfil direito', 'Perfil esquerdo', 'Oblíqua direita', 'Oblíqua esquerda', 'Superior', 'Posterior', 'Detalhe'] as const;
export const photoPhases = ['Antes', 'Durante', 'Depois', 'Retorno'] as const;
/** Regiões sugeridas por especialidade (a região é texto livre: a clínica pode usar outra). */
export const photoRegions: Record<SpecialtyKey, string[]> = {
  harmonization: ['Face inteira', 'Terço superior', 'Terço médio', 'Terço inferior', 'Lábios', 'Mandíbula e mento'],
  whitening: ['Sorriso', 'Arcada superior', 'Arcada inferior'],
  plastic_surgery: ['Face', 'Mamas', 'Abdome', 'Glúteos', 'Coxas', 'Braços', 'Dorso'],
  micropigmentation: ['Sobrancelhas', 'Lábios', 'Olhos', 'Couro cabeludo'],
  laser: ['Axilas', 'Virilha', 'Pernas', 'Buço', 'Rosto', 'Costas', 'Braços'],
  trichology: ['Vértex', 'Frontal', 'Temporal direita', 'Temporal esquerda', 'Occipital', 'Linha de implantação'],
};

export const photoMeta = z.object({
  customerId: z.string().uuid(),
  specialty: z.enum(specialtyKeys),
  region: z.string().trim().min(2, 'Informe a região').max(60),
  angle: z.enum(photoAngles),
  phase: z.enum(photoPhases),
  caseId: z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null),
  occurredOn: careDate.optional(),
});
export type PhotoMeta = z.infer<typeof photoMeta>;

// ---- Casos (tratamento em andamento por especialidade) -----------------------------------------

export const surgeryStages = ['evaluation', 'preop', 'scheduled', 'operated', 'postop', 'discharged'] as const;
export type SurgeryStage = (typeof surgeryStages)[number];
export const surgeryStageLabel: Record<SurgeryStage, string> = {
  evaluation: 'Avaliação',
  preop: 'Pré-operatório',
  scheduled: 'Cirurgia marcada',
  operated: 'Operado(a)',
  postop: 'Pós-operatório',
  discharged: 'Alta',
};

export const caseInput = z.object({
  customerId: z.string().uuid('Escolha o paciente'),
  specialty: z.enum(specialtyKeys),
  title: z.string().trim().min(3, 'Descreva o tratamento').max(160),
  /** Profissional responsável (agenda). Na cirurgia, o cirurgião. */
  professionalId: z.string().uuid().nullish(),
  plannedSessions: z.coerce.number().int().min(1).max(100).nullish(),
  startedOn: careDate.optional(),
  notes: optText(2000),
});
export type CaseInput = z.infer<typeof caseInput>;
export const caseUpdateInput = caseInput.omit({ customerId: true, specialty: true }).partial();
export type CaseUpdateInput = z.infer<typeof caseUpdateInput>;

export const caseCloseInput = z.object({
  status: z.enum(['finished', 'cancelled']),
  reason: optText(300),
});

export const stageInput = z.object({ stage: z.enum(surgeryStages) });

export const budgetKinds = ['surgeon', 'anesthetist', 'hospital', 'implant', 'materials', 'other'] as const;
export type BudgetKind = (typeof budgetKinds)[number];
export const budgetKindLabel: Record<BudgetKind, string> = {
  surgeon: 'Honorários do cirurgião',
  anesthetist: 'Anestesista',
  hospital: 'Hospital / centro cirúrgico',
  implant: 'Prótese / implante',
  materials: 'Materiais e medicamentos',
  other: 'Outros',
};

const money = z.coerce.number().min(0, 'Valor inválido').max(10_000_000).multipleOf(0.01, 'Use no máximo 2 casas decimais');

export const budgetItemInput = z.object({
  kind: z.enum(budgetKinds),
  description: z.string().trim().min(2, 'Descreva o item').max(160),
  amount: money,
  /** `clinic`: a clínica cobra (vira "a receber"); `third_party`: o paciente paga direto ao prestador. */
  billedBy: z.enum(['clinic', 'third_party']).default('clinic'),
});
export type BudgetItemInput = z.infer<typeof budgetItemInput>;
export const budgetInput = z.object({ items: z.array(budgetItemInput).min(1, 'Inclua ao menos um item').max(30), validUntil: isoDate.nullish() });
export type BudgetInput = z.infer<typeof budgetInput>;
export const budgetApproveInput = z.object({
  installments: z.coerce.number().int().min(1).max(24).default(1),
  /** Padrão: hoje. */
  firstDueOn: isoDate.optional(),
  approvedOn: careDate.optional(),
});
export type BudgetApproveInput = z.infer<typeof budgetApproveInput>;

export interface SurgeryTeamMember {
  role: string;
  name: string;
  teamMemberId?: string | null;
}

export const surgeryScheduleInput = z.object({
  /** Cirurgião (profissional da agenda). */
  resourceId: z.string().uuid('Escolha o cirurgião'),
  serviceId: z.string().uuid('Escolha o procedimento da agenda'),
  startsAt: z.coerce.date(),
  /** Sala/centro cirúrgico cadastrado na agenda (opcional). */
  roomId: z.string().uuid().nullish(),
  /** Hospital ou clínica onde acontece (texto). */
  location: z.string().trim().min(2, 'Informe o local').max(160),
  team: z
    .array(z.object({ role: z.string().trim().min(2).max(60), name: z.string().trim().min(2).max(120), teamMemberId: z.string().uuid().nullish() }))
    .max(12)
    .default([]),
  /** "Marcar mesmo assim": fora do expediente ou em folga, só com shared.scheduling.manage. */
  overrideSchedule: z.boolean().optional(),
});
export type SurgeryScheduleInput = z.infer<typeof surgeryScheduleInput>;

export interface CaseBudget {
  items: BudgetItemInput[];
  status: 'draft' | 'approved';
  validUntil: string | null;
  approvedOn: string | null;
  installments: number | null;
  clinicTotal: number;
  thirdPartyTotal: number;
}

export interface AesCase {
  id: string;
  customer: { id: string; name: string };
  specialty: SpecialtyKey;
  title: string;
  status: 'active' | 'finished' | 'cancelled';
  stage: SurgeryStage | null;
  professional: { id: string; name: string } | null;
  plannedSessions: number | null;
  /** Fichas de sessão registradas no prontuário para este caso. */
  doneSessions: number;
  startedOn: string;
  finishedOn: string | null;
  closeReason: string | null;
  notes: string | null;
  budget: CaseBudget | null;
  /** Cirurgia marcada; `status` e `startsAt` vêm da agenda (remarcar pela agenda vale aqui). */
  surgery: { appointmentId: string; startsAt: string; status: string; location: string; team: SurgeryTeamMember[] } | null;
  /** Há termo de consentimento aceito ligado a este caso. */
  consentAccepted: boolean;
  /** Pacotes vendidos a partir deste tratamento (ex.: drenagem do pós-operatório). */
  packages: { id: string; service: string; totalSessions: number; usedSessions: number; status: 'active' | 'finished' | 'cancelled' }[];
  createdAt: string;
}

// ---- Fichas (registros no prontuário) ----------------------------------------------------------

/**
 * Ficha clínica de uma especialidade: entra no prontuário junto com o uso dos lotes, na mesma
 * transação. O uso sai dos próprios campos: todo item (ou a ficha) com `lotId` vira uso do lote
 * com a `amount` informada, e produto, lote e validade são preenchidos pelo cadastro.
 */
export const specialtyRecordInput = z.object({
  specialty: z.enum(specialtyKeys),
  formKey: z.string().min(1).max(80),
  customerId: z.string().uuid('Escolha o paciente'),
  caseId: z.string().uuid().nullish(),
  /** Profissional da agenda que fez o procedimento (o registro do conselho vai junto). */
  professionalId: z.string().uuid().nullish(),
  appointmentId: z.string().uuid().nullish(),
  occurredOn: careDate.optional(),
  data: z.record(z.unknown()).default({}),
  notes: z.string().trim().max(20_000).nullish(),
});
export type SpecialtyRecordInput = z.infer<typeof specialtyRecordInput>;

export interface SpecialtyOverview {
  enabled: SpecialtyKey[];
  /** Dias até o retorno/retoque, das configurações. */
  returnDays: { harmonization: number; micropigmentation: number };
}

export interface PatientSpecialtyData {
  entries: MedicalEntry[];
  cases: AesCase[];
}

const VITA = ['B1', 'A1', 'B2', 'D2', 'A2', 'C1', 'C2', 'D4', 'A3', 'D3', 'B3', 'A3,5', 'B4', 'C3', 'A4', 'C4'];
/** Escala VITA clássica, da mais clara para a mais escura (ordem de valor). */
export const vitaShades = VITA;

const professionalFields: FormField[] = [
  { key: 'professional', label: 'Profissional', type: 'text', hint: 'Preenchido com o nome e o registro do conselho' },
  { key: 'professionalId', label: 'Profissional (id)', type: 'text', hidden: true },
  { key: 'caseId', label: 'Caso', type: 'text', hidden: true },
];
const lotFields = (product = 'Produto'): FormField[] => [
  { key: 'product', label: product, type: 'text' },
  { key: 'lot', label: 'Lote', type: 'text' },
  { key: 'expiresOn', label: 'Validade', type: 'date' },
  { key: 'lotId', label: 'Lote (id)', type: 'text', hidden: true },
];

const form = (key: string, label: string, fields: FormField[]): MedicalForm => ({ key, moduleKey: 'aesthetics', label, subjectTypes: ['customer'], fields, managed: true });

/**
 * Fichas das especialidades, todas "geridas": entram pela tela da estética, que confere o
 * registro do profissional, o lote e a especialidade ligada. Retificar continua pelo prontuário.
 */
export const specialtyForms: Record<SpecialtyKey | 'common', MedicalForm[]> = {
  common: [
    form('aesthetics.consent', 'Termo de consentimento', [
      { key: 'term', label: 'Termo', type: 'text', required: true },
      { key: 'version', label: 'Versão do modelo', type: 'number' },
      { key: 'specialty', label: 'Especialidade', type: 'text' },
      { key: 'procedure', label: 'Procedimento', type: 'text', required: true },
      { key: 'text', label: 'Texto aceito', type: 'textarea', required: true },
      { key: 'signedBy', label: 'Assinado por', type: 'text', required: true },
      { key: 'signature', label: 'Assinatura desenhada na tela', type: 'boolean' },
      { key: 'templateId', label: 'Modelo (id)', type: 'text', hidden: true },
      ...professionalFields,
    ]),
    form('aesthetics.photo', 'Foto clínica', [
      { key: 'specialty', label: 'Especialidade', type: 'text' },
      { key: 'region', label: 'Região', type: 'text', required: true },
      { key: 'angle', label: 'Ângulo', type: 'select', options: [...photoAngles], required: true },
      { key: 'phase', label: 'Momento', type: 'select', options: [...photoPhases], required: true },
      { key: 'caseId', label: 'Caso', type: 'text', hidden: true },
    ]),
    form('aesthetics.complication', 'Intercorrência', [
      { key: 'specialty', label: 'Especialidade', type: 'text' },
      {
        key: 'kind',
        label: 'Tipo',
        type: 'select',
        required: true,
        options: ['Equimose / hematoma', 'Edema', 'Nódulo', 'Assimetria', 'Ptose', 'Oclusão vascular', 'Reação alérgica', 'Infecção', 'Queimadura', 'Hiperpigmentação', 'Seroma', 'Deiscência', 'Outra'],
      },
      { key: 'severity', label: 'Gravidade', type: 'select', options: ['Leve', 'Moderada', 'Grave'] },
      { key: 'description', label: 'O que aconteceu', type: 'textarea', required: true },
      { key: 'conduct', label: 'Conduta', type: 'textarea' },
      { key: 'resolved', label: 'Resolvida', type: 'boolean' },
      ...professionalFields,
    ]),
  ],
  harmonization: [
    form('aesthetics.harmonization', 'Aplicação de injetáveis', [
      {
        key: 'procedure',
        label: 'Procedimento',
        type: 'select',
        required: true,
        options: ['Toxina botulínica', 'Preenchimento (ácido hialurônico)', 'Bioestimulador de colágeno', 'Fios de sustentação', 'Outro'],
      },
      {
        key: 'points',
        label: 'Pontos de aplicação',
        type: 'list',
        required: true,
        itemFields: [
          { key: 'region', label: 'Região', type: 'text', required: true },
          ...lotFields(),
          { key: 'amount', label: 'Quantidade', type: 'number', required: true },
          { key: 'unit', label: 'Unidade', type: 'text' },
          { key: 'x', label: 'x', type: 'number', hidden: true },
          { key: 'y', label: 'y', type: 'number', hidden: true },
        ],
      },
      { key: 'technique', label: 'Técnica', type: 'select', options: ['Agulha', 'Cânula', 'Agulha e cânula'] },
      { key: 'dilution', label: 'Diluição / preparo', type: 'text', hint: 'Ex.: 100 U em 2,5 ml de SF 0,9%' },
      { key: 'anesthesia', label: 'Anestesia', type: 'text' },
      { key: 'reaction', label: 'Reação imediata', type: 'text' },
      { key: 'complications', label: 'Intercorrências', type: 'textarea' },
      { key: 'guidance', label: 'Orientações passadas', type: 'textarea' },
      { key: 'returnOn', label: 'Retorno / retoque previsto', type: 'date' },
      ...professionalFields,
    ]),
  ],
  whitening: [
    form('aesthetics.whitening', 'Sessão de clareamento', [
      { key: 'type', label: 'Tipo', type: 'select', required: true, options: ['Consultório', 'Caseiro', 'Combinado'] },
      { key: 'session', label: 'Sessão', type: 'number' },
      { key: 'shadeBefore', label: 'Cor inicial (VITA)', type: 'select', options: VITA },
      { key: 'shadeAfter', label: 'Cor final (VITA)', type: 'select', options: VITA },
      ...lotFields('Gel clareador'),
      { key: 'amount', label: 'Quantidade de gel', type: 'number', hint: 'Na unidade do produto. Com lote escolhido é obrigatória: entra no rastreio e baixa o estoque' },
      { key: 'concentration', label: 'Concentração', type: 'text', hint: 'Ex.: peróxido de hidrogênio 35%, carbamida 16%' },
      { key: 'exposure', label: 'Tempo de aplicação', type: 'text', hint: 'Ex.: 3 × 15 min' },
      { key: 'barrier', label: 'Barreira gengival', type: 'boolean' },
      { key: 'sensitivity', label: 'Sensibilidade', type: 'select', options: ['Nenhuma', 'Leve', 'Moderada', 'Intensa'] },
      { key: 'tray', label: 'Moldeira', type: 'select', options: ['Não se aplica', 'Moldagem feita', 'Moldeira entregue', 'Moldeira ajustada'] },
      { key: 'guidance', label: 'Orientações passadas', type: 'textarea' },
      ...professionalFields,
    ]),
  ],
  plastic_surgery: [
    form('aesthetics.surgery.evaluation', 'Avaliação cirúrgica', [
      { key: 'complaint', label: 'Queixa principal', type: 'textarea', required: true },
      { key: 'procedure', label: 'Cirurgia proposta', type: 'text', required: true },
      { key: 'history', label: 'Histórico médico e cirúrgico', type: 'textarea' },
      { key: 'medications', label: 'Medicamentos em uso', type: 'text' },
      { key: 'allergies', label: 'Alergias', type: 'text' },
      { key: 'smoker', label: 'Fumante', type: 'boolean' },
      { key: 'weight', label: 'Peso', type: 'number', unit: 'kg' },
      { key: 'height', label: 'Altura', type: 'number', unit: 'm' },
      { key: 'plan', label: 'Plano cirúrgico', type: 'textarea' },
      ...professionalFields,
    ]),
    form('aesthetics.surgery.preop', 'Pré-operatório', [
      {
        key: 'exams',
        label: 'Exames',
        type: 'list',
        itemFields: [
          { key: 'exam', label: 'Exame', type: 'text', required: true },
          { key: 'date', label: 'Data', type: 'date' },
          { key: 'result', label: 'Resultado', type: 'text' },
          { key: 'ok', label: 'Normal / liberado', type: 'boolean' },
        ],
      },
      { key: 'asa', label: 'Risco anestésico (ASA)', type: 'select', options: ['ASA I', 'ASA II', 'ASA III', 'ASA IV'] },
      { key: 'cardioRisk', label: 'Risco cirúrgico cardiológico', type: 'select', options: ['Baixo', 'Intermediário', 'Alto'] },
      { key: 'cardioClearance', label: 'Liberação do cardiologista', type: 'boolean' },
      { key: 'anesthetist', label: 'Anestesista', type: 'text' },
      { key: 'anesthesiaType', label: 'Anestesia prevista', type: 'select', options: ['Geral', 'Raquidiana', 'Peridural', 'Sedação + local', 'Local'] },
      { key: 'anesthesiaClearance', label: 'Avaliação anestésica: liberado(a)', type: 'boolean' },
      { key: 'released', label: 'Liberado(a) para a cirurgia', type: 'boolean' },
      ...professionalFields,
    ]),
    form('aesthetics.surgery.report', 'Descrição cirúrgica', [
      { key: 'procedure', label: 'Cirurgia realizada', type: 'text', required: true },
      { key: 'location', label: 'Local', type: 'text' },
      { key: 'team', label: 'Equipe', type: 'text' },
      { key: 'anesthesia', label: 'Anestesia', type: 'text' },
      { key: 'duration', label: 'Duração', type: 'number', unit: 'min' },
      {
        key: 'implants',
        label: 'Próteses e implantes',
        type: 'list',
        itemFields: [...lotFields('Prótese / implante'), { key: 'size', label: 'Tamanho / volume', type: 'text' }, { key: 'amount', label: 'Quantidade', type: 'number' }],
      },
      { key: 'description', label: 'Descrição', type: 'textarea', required: true },
      { key: 'complications', label: 'Intercorrências', type: 'textarea' },
      ...professionalFields,
    ]),
    form('aesthetics.surgery.postop', 'Retorno pós-operatório', [
      { key: 'day', label: 'Dia de pós-operatório', type: 'number' },
      { key: 'wound', label: 'Ferida operatória', type: 'select', options: ['Boa cicatrização', 'Seroma', 'Hematoma', 'Deiscência', 'Sinais de infecção'] },
      { key: 'drain', label: 'Dreno', type: 'text' },
      { key: 'pain', label: 'Dor (0 a 10)', type: 'number' },
      { key: 'garment', label: 'Cinta / malha compressiva', type: 'boolean' },
      { key: 'guidance', label: 'Orientações', type: 'textarea' },
      { key: 'nextReturn', label: 'Próximo retorno', type: 'date' },
      ...professionalFields,
    ]),
  ],
  micropigmentation: [
    form('aesthetics.micropigmentation', 'Micropigmentação', [
      { key: 'area', label: 'Área', type: 'select', required: true, options: ['Sobrancelhas', 'Lábios', 'Capilar', 'Olhos (delineado)'] },
      { key: 'session', label: 'Sessão', type: 'select', options: ['1ª sessão', 'Retoque', 'Manutenção anual', 'Correção'] },
      {
        key: 'technique',
        label: 'Técnica',
        type: 'select',
        options: ['Fio a fio (nanoblading)', 'Microblading', 'Shadow / powder', 'Lip blush', 'Neutralização labial', 'Delineado', 'Tricopigmentação', 'Outra'],
      },
      {
        key: 'pigments',
        label: 'Pigmentos',
        type: 'list',
        required: true,
        itemFields: [...lotFields('Pigmento'), { key: 'color', label: 'Cor', type: 'text' }, { key: 'amount', label: 'Quantidade', type: 'number' }],
      },
      { key: 'needle', label: 'Agulha / configuração', type: 'text', hint: 'Ex.: nano 0,18 mm, 1RL' },
      { key: 'designApproved', label: 'Desenho aprovado pela cliente (foto anexada)', type: 'boolean', required: true },
      { key: 'anesthesia', label: 'Anestésico tópico', type: 'text' },
      { key: 'reaction', label: 'Reação', type: 'text' },
      { key: 'guidance', label: 'Orientações passadas', type: 'textarea' },
      { key: 'retouchOn', label: 'Retoque previsto', type: 'date' },
      ...professionalFields,
    ]),
  ],
  laser: [
    form('aesthetics.laser', 'Sessão de laser', [
      { key: 'phototype', label: 'Fototipo (Fitzpatrick)', type: 'select', required: true, options: ['I', 'II', 'III', 'IV', 'V', 'VI'] },
      { key: 'device', label: 'Equipamento', type: 'text', hint: 'Sala/equipamento da agenda' },
      { key: 'roomId', label: 'Equipamento (id)', type: 'text', hidden: true },
      { key: 'session', label: 'Sessão', type: 'number' },
      {
        key: 'areas',
        label: 'Áreas e parâmetros',
        type: 'list',
        required: true,
        itemFields: [
          { key: 'area', label: 'Área', type: 'text', required: true },
          { key: 'fluence', label: 'Fluência', type: 'number', unit: 'J/cm²' },
          { key: 'pulse', label: 'Pulso', type: 'number', unit: 'ms' },
          { key: 'spot', label: 'Spot', type: 'number', unit: 'mm' },
          { key: 'shots', label: 'Disparos', type: 'number' },
        ],
      },
      { key: 'cooling', label: 'Resfriamento', type: 'text' },
      { key: 'reaction', label: 'Reação', type: 'select', options: ['Sem reação', 'Eritema perifolicular', 'Edema perifolicular', 'Hiperpigmentação', 'Bolha', 'Queimadura'] },
      { key: 'reactionNotes', label: 'Detalhes da reação', type: 'text' },
      { key: 'guidance', label: 'Orientações passadas', type: 'textarea' },
      { key: 'nextSessionOn', label: 'Próxima sessão', type: 'date' },
      ...professionalFields,
    ]),
  ],
  trichology: [
    form('aesthetics.trichology.anamnesis', 'Anamnese capilar', [
      { key: 'complaint', label: 'Queixa principal', type: 'textarea', required: true },
      { key: 'onset', label: 'Início e evolução da queda', type: 'text' },
      { key: 'familyHistory', label: 'Calvície na família', type: 'boolean' },
      { key: 'washing', label: 'Frequência de lavagem', type: 'text' },
      { key: 'chemicals', label: 'Química e procedimentos', type: 'text', hint: 'Coloração, progressiva, descoloração…' },
      { key: 'conditions', label: 'Doenças (tireoide, anemia, SOP…)', type: 'text' },
      { key: 'medications', label: 'Medicamentos e suplementos', type: 'text' },
      { key: 'stress', label: 'Estresse', type: 'select', options: ['Baixo', 'Moderado', 'Alto'] },
      { key: 'diet', label: 'Alimentação / dieta restritiva', type: 'text' },
      ...professionalFields,
    ]),
    form('aesthetics.trichology.scope', 'Tricoscopia', [
      {
        key: 'regions',
        label: 'Regiões',
        type: 'list',
        required: true,
        itemFields: [
          { key: 'region', label: 'Região', type: 'text', required: true },
          { key: 'density', label: 'Densidade', type: 'number', unit: 'fios/cm²' },
          { key: 'thickness', label: 'Espessura dos fios', type: 'text' },
          { key: 'findings', label: 'Achados', type: 'text' },
        ],
      },
      { key: 'scalp', label: 'Couro cabeludo', type: 'select', options: ['Normal', 'Oleoso', 'Seco', 'Descamativo', 'Sensível', 'Inflamado'] },
      { key: 'pullTest', label: 'Teste de tração', type: 'select', options: ['Negativo', 'Positivo'] },
      ...professionalFields,
    ]),
    form('aesthetics.trichology.diagnosis', 'Diagnóstico capilar', [
      {
        key: 'diagnosis',
        label: 'Diagnóstico',
        type: 'select',
        required: true,
        options: ['Alopecia androgenética', 'Eflúvio telógeno', 'Alopecia areata', 'Dermatite seborreica', 'Alopecia por tração', 'Outro'],
      },
      { key: 'detail', label: 'Detalhes', type: 'textarea' },
      { key: 'protocol', label: 'Protocolo de tratamento', type: 'textarea', required: true },
      { key: 'sessions', label: 'Sessões previstas', type: 'number' },
      { key: 'homeCare', label: 'Cuidados em casa', type: 'textarea' },
      ...professionalFields,
    ]),
    form('aesthetics.trichology.session', 'Sessão capilar', [
      { key: 'session', label: 'Sessão', type: 'number' },
      {
        key: 'procedure',
        label: 'Procedimento',
        type: 'select',
        required: true,
        options: ['Intradermoterapia (MMP)', 'Microagulhamento capilar', 'Laser de baixa potência', 'Ozonioterapia', 'Peeling capilar', 'Outro'],
      },
      ...lotFields('Ativo'),
      { key: 'amount', label: 'Quantidade', type: 'number', unit: 'ml' },
      { key: 'response', label: 'Resposta', type: 'select', options: ['Sem melhora', 'Melhora leve', 'Melhora moderada', 'Melhora importante'] },
      { key: 'guidance', label: 'Orientações', type: 'textarea' },
      ...professionalFields,
    ]),
  ],
};

/** Formulário → especialidade (as fichas comuns valem para todas). */
export function specialtyOfForm(formKey: string): SpecialtyKey | 'common' | null {
  for (const [key, forms] of Object.entries(specialtyForms)) if (forms.some((f) => f.key === formKey)) return key as SpecialtyKey | 'common';
  return null;
}

/** Fichas que contam como sessão de um caso (para "3 de 10 sessões"). */
/** Fichas em que o lote escolhido exige quantidade: sem ela, nada entraria no rastreio nem baixaria o estoque. */
export const lotAmountRequiredForms = ['aesthetics.whitening'];

export const sessionForms = ['aesthetics.whitening', 'aesthetics.laser', 'aesthetics.trichology.session', 'aesthetics.micropigmentation', 'aesthetics.harmonization'];
