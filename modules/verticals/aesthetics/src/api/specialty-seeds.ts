import type { SpecialtyKey } from '../contracts';

// Dados que cada especialidade traz ao ser ligada: serviços de exemplo na agenda e modelos de
// termo de consentimento. Criados uma vez só (por nome / por chave); a clínica edita à vontade.

export interface SeedService {
  name: string;
  category: string;
  durationMin: number;
  bufferMin?: number;
  price: string;
  online?: boolean;
  description?: string;
  requiresRoom?: boolean;
}

export const SPECIALTY_SERVICES: Record<SpecialtyKey, SeedService[]> = {
  harmonization: [
    { name: 'Avaliação de harmonização facial', category: 'Injetáveis', durationMin: 30, price: '150.00' },
    { name: 'Toxina botulínica', category: 'Injetáveis', durationMin: 45, bufferMin: 15, price: '1200.00', online: false, description: 'Terço superior. Retorno em 15 dias incluso.' },
    { name: 'Preenchimento com ácido hialurônico', category: 'Injetáveis', durationMin: 60, bufferMin: 15, price: '1500.00', online: false, description: 'Por seringa de 1 ml.' },
    { name: 'Bioestimulador de colágeno', category: 'Injetáveis', durationMin: 60, bufferMin: 15, price: '1800.00', online: false },
    { name: 'Fios de sustentação (PDO)', category: 'Injetáveis', durationMin: 90, bufferMin: 15, price: '2500.00', online: false },
    { name: 'Retorno de injetáveis (retoque)', category: 'Injetáveis', durationMin: 30, price: '0.00', online: false, description: 'Revisão em 15 dias e retoque, se preciso.' },
  ],
  whitening: [
    { name: 'Avaliação odontológica para clareamento', category: 'Clareamento', durationMin: 30, price: '120.00' },
    { name: 'Clareamento em consultório (sessão)', category: 'Clareamento', durationMin: 60, bufferMin: 15, price: '600.00', online: false },
    { name: 'Clareamento caseiro (moldeiras e gel)', category: 'Clareamento', durationMin: 40, price: '900.00', online: false, description: 'Moldagem, moldeiras e kit de gel para 3 semanas.' },
    { name: 'Retorno de clareamento', category: 'Clareamento', durationMin: 20, price: '0.00', online: false },
  ],
  plastic_surgery: [
    { name: 'Consulta de cirurgia plástica', category: 'Cirurgia plástica', durationMin: 45, price: '450.00', online: false },
    { name: 'Avaliação pré-operatória', category: 'Cirurgia plástica', durationMin: 40, price: '0.00', online: false },
    { name: 'Cirurgia plástica (centro cirúrgico)', category: 'Cirurgia plástica', durationMin: 240, bufferMin: 60, price: '0.00', online: false, description: 'Valor pelo orçamento da cirurgia.' },
    { name: 'Retorno pós-operatório', category: 'Cirurgia plástica', durationMin: 30, price: '0.00', online: false },
  ],
  micropigmentation: [
    { name: 'Micropigmentação de sobrancelhas', category: 'Micropigmentação', durationMin: 120, bufferMin: 15, price: '850.00' },
    { name: 'Micropigmentação labial', category: 'Micropigmentação', durationMin: 150, bufferMin: 15, price: '950.00' },
    { name: 'Delineado de olhos', category: 'Micropigmentação', durationMin: 90, bufferMin: 15, price: '700.00' },
    { name: 'Micropigmentação capilar', category: 'Micropigmentação', durationMin: 180, bufferMin: 15, price: '1800.00', online: false },
    { name: 'Retoque de micropigmentação', category: 'Micropigmentação', durationMin: 60, price: '200.00' },
  ],
  laser: [
    { name: 'Depilação a laser (área pequena)', category: 'Depilação', durationMin: 30, price: '150.00', requiresRoom: true },
    { name: 'Depilação a laser (área média)', category: 'Depilação', durationMin: 45, price: '250.00', requiresRoom: true },
    { name: 'Depilação a laser (área grande)', category: 'Depilação', durationMin: 60, bufferMin: 15, price: '400.00', requiresRoom: true },
    { name: 'Laser corporal (rejuvenescimento / manchas)', category: 'Laser', durationMin: 45, price: '350.00', requiresRoom: true, online: false },
  ],
  trichology: [
    { name: 'Avaliação tricológica (tricoscopia)', category: 'Tricologia', durationMin: 60, price: '300.00' },
    { name: 'Intradermoterapia capilar', category: 'Tricologia', durationMin: 45, price: '350.00', online: false },
    { name: 'Microagulhamento capilar', category: 'Tricologia', durationMin: 60, price: '400.00', online: false },
    { name: 'Laser capilar de baixa potência', category: 'Tricologia', durationMin: 30, price: '150.00' },
  ],
};

/** Equipamento que a depilação a laser reserva na agenda (criado se não houver um com o nome). */
export const LASER_ROOM = { name: 'Laser de diodo (equipamento)', color: '#ea580c' };

const BASE = (risks: string) =>
  `Eu, {{paciente}}, declaro que fui informado(a) por {{profissional}}, de forma clara e em linguagem acessível, sobre o procedimento {{procedimento}}: como é feito, os resultados esperados, as alternativas e os cuidados antes e depois.

Fui informado(a) de que os resultados variam de pessoa para pessoa e não podem ser garantidos, e de que podem acontecer reações e complicações, entre elas: ${risks}

Declaro que informei com verdade o meu histórico de saúde, alergias, medicamentos em uso, gestação ou amamentação, e que vou seguir as orientações recebidas. Pude fazer perguntas e todas foram respondidas.

Autorizo a realização do procedimento e o registro de fotografias clínicas para acompanhamento no meu prontuário, que são sigilosas e não serão divulgadas sem a minha autorização por escrito.

Posso revogar este consentimento a qualquer momento antes do procedimento.

{{data}}`;

export const SPECIALTY_TEMPLATES: Record<SpecialtyKey | 'common', { key: string; title: string; body: string }[]> = {
  common: [
    {
      key: 'common.image-use',
      title: 'Autorização de uso de imagem',
      body: `Eu, {{paciente}}, autorizo a clínica a registrar fotografias e vídeos do meu tratamento ({{procedimento}}) para fins de acompanhamento clínico no meu prontuário.

As imagens são dado de saúde, protegidas por sigilo, e só podem ser vistas por profissionais autorizados. Qualquer uso fora do prontuário (aulas, congressos, redes sociais) depende de nova autorização minha, por escrito, e sempre sem identificar o meu rosto, salvo se eu autorizar expressamente.

Posso revogar esta autorização a qualquer momento.

{{data}}`,
    },
  ],
  harmonization: [
    {
      key: 'harmonization.toxin',
      title: 'Consentimento: toxina botulínica',
      body: BASE(
        'dor e ardor no local, hematomas, edema, dor de cabeça, assimetria, queda temporária da pálpebra ou da sobrancelha (ptose) e, raramente, reação alérgica. O efeito começa entre 3 e 15 dias e dura em média de 4 a 6 meses. O retorno para avaliação e eventual retoque é em 15 dias.',
      ),
    },
    {
      key: 'harmonization.filler',
      title: 'Consentimento: preenchimento com ácido hialurônico',
      body: BASE(
        'edema, hematomas, dor, nódulos, assimetria, infecção, reação inflamatória tardia e, raramente, oclusão vascular, que exige atendimento imediato e pode causar necrose de pele ou alteração visual. O ácido hialurônico pode ser dissolvido com hialuronidase, se indicado.',
      ),
    },
    {
      key: 'harmonization.biostimulator',
      title: 'Consentimento: bioestimulador de colágeno e fios',
      body: BASE('edema, hematomas, dor, nódulos e granulomas, assimetria, visibilidade ou extrusão dos fios, infecção. O resultado aparece de forma gradual, em semanas a meses, e pode exigir mais de uma sessão.'),
    },
  ],
  whitening: [
    {
      key: 'whitening.default',
      title: 'Consentimento: clareamento dental',
      body: BASE(
        'sensibilidade dentária durante e após o tratamento, irritação na gengiva, resultado diferente entre os dentes e não alteração da cor de restaurações, coroas e facetas, que podem precisar ser trocadas depois. A cor alcançada pode regredir com o tempo e com o consumo de alimentos e bebidas com pigmento.',
      ),
    },
  ],
  plastic_surgery: [
    {
      key: 'plastic_surgery.default',
      title: 'Consentimento: cirurgia plástica',
      body: BASE(
        'dor, edema e hematomas, seroma, infecção, deiscência (abertura dos pontos), cicatrizes alargadas ou hipertróficas, assimetria, alteração de sensibilidade, trombose e embolia, complicações da anestesia e necessidade de nova cirurgia. Fui orientado(a) sobre os exames pré-operatórios, a avaliação anestésica, o jejum, a suspensão de medicamentos e o uso de malha compressiva, e sobre os retornos e a drenagem linfática no pós-operatório.',
      ),
    },
  ],
  micropigmentation: [
    {
      key: 'micropigmentation.default',
      title: 'Consentimento: micropigmentação',
      body: BASE(
        'vermelhidão, inchaço e crostas nos primeiros dias, falhas que exigem retoque, cor diferente da esperada com o tempo, reação alérgica ao pigmento e, raramente, infecção ou herpes (nos lábios). O desenho foi aprovado por mim antes do procedimento. O retoque é feito entre 30 e 40 dias.',
      ),
    },
  ],
  laser: [
    {
      key: 'laser.default',
      title: 'Consentimento: depilação a laser e laser corporal',
      body: BASE(
        'vermelhidão e inchaço ao redor dos folículos, sensação de queimação, bolhas, queimaduras, manchas claras ou escuras e, raramente, aumento paradoxal de pelos. São necessárias várias sessões, e o resultado depende do fototipo, da cor do pelo e de fatores hormonais. Fui orientado(a) a não me expor ao sol e a usar filtro solar.',
      ),
    },
  ],
  trichology: [
    {
      key: 'trichology.default',
      title: 'Consentimento: tratamento capilar',
      body: BASE(
        'dor e ardor nas aplicações, vermelhidão, descamação, pequenos sangramentos, coceira, queda transitória de fios no início do tratamento (shedding) e reação alérgica aos ativos. O resultado depende da causa da queda e pode exigir tratamento contínuo e acompanhamento médico.',
      ),
    },
  ],
};
