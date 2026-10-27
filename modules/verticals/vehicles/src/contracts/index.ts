import { z } from 'zod';

const money = z.coerce.number().min(0).max(100_000_000).multipleOf(0.01);
const year = z.coerce.number().int().min(1950).max(2100);

export const vehicleKinds = ['car', 'motorcycle', 'truck', 'utility'] as const;
export const vehicleKindLabel: Record<(typeof vehicleKinds)[number], string> = { car: 'Carro', motorcycle: 'Moto', truck: 'Caminhão', utility: 'Utilitário' };
export const vehicleStatuses = ['available', 'reserved', 'sold', 'inactive'] as const;
export type VehicleStatus = (typeof vehicleStatuses)[number];
export const vehicleStatusLabel: Record<VehicleStatus, string> = { available: 'Disponível', reserved: 'Reservado', sold: 'Vendido', inactive: 'Fora de venda' };

export const vehicleInput = z
  .object({
    kind: z.enum(vehicleKinds).default('car'),
    brand: z.string().trim().min(2).max(60),
    model: z.string().trim().min(1).max(80),
    version: z.string().trim().max(120).nullish(),
    yearManufacture: year,
    yearModel: year,
    plate: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/, 'Placa inválida (ABC1D23 ou ABC-1234)')
      .transform((p) => p.replace('-', ''))
      .nullish()
      .or(z.literal('').transform(() => null)),
    color: z.string().trim().max(40).nullish(),
    km: z.coerce.number().int().min(0).max(5_000_000).default(0),
    fuel: z.enum(['flex', 'gasoline', 'ethanol', 'diesel', 'electric', 'hybrid']).default('flex'),
    transmission: z.enum(['manual', 'automatic', 'cvt', 'automated']).default('manual'),
    fipeCode: z.string().trim().regex(/^\d{6}-\d$/, 'Código FIPE no formato 000000-0').nullish().or(z.literal('').transform(() => null)),
    fipePrice: money.nullish(),
    /** Quanto a loja pagou. */
    cost: money.nullish(),
    price: money.refine((v) => v > 0, 'Informe o preço de venda'),
    status: z.enum(vehicleStatuses).default('available'),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((v) => v.yearModel >= v.yearManufacture && v.yearModel <= v.yearManufacture + 1, { message: 'Ano modelo deve ser igual ou o seguinte ao de fabricação', path: ['yearModel'] });
export type VehicleInput = z.infer<typeof vehicleInput>;

export interface Vehicle {
  id: string;
  kind: (typeof vehicleKinds)[number];
  brand: string;
  model: string;
  version: string | null;
  yearManufacture: number;
  yearModel: number;
  plate: string | null;
  color: string | null;
  km: number;
  fuel: VehicleInput['fuel'];
  transmission: VehicleInput['transmission'];
  fipeCode: string | null;
  fipePrice: number | null;
  cost: number | null;
  price: number;
  status: VehicleStatus;
  notes: string | null;
  photos: { id: string }[];
  daysInStock: number;
  createdAt: string;
}

export const fuelLabel = { flex: 'Flex', gasoline: 'Gasolina', ethanol: 'Etanol', diesel: 'Diesel', electric: 'Elétrico', hybrid: 'Híbrido' } as const;
export const transmissionLabel = { manual: 'Manual', automatic: 'Automático', cvt: 'CVT', automated: 'Automatizado' } as const;

export const dealInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  vehicleId: z.string().uuid('Escolha o veículo'),
  price: money,
  discount: money.default(0),
  paymentType: z.enum(['cash', 'financing']).default('cash'),
  downPayment: money.default(0),
  tradeIn: z
    .object({
      brand: z.string().trim().min(2).max(60),
      model: z.string().trim().min(1).max(80),
      yearModel: year,
      plate: z.string().trim().toUpperCase().max(8).nullish(),
      km: z.coerce.number().int().min(0).default(0),
      value: money.refine((v) => v > 0, 'Informe o valor da troca'),
    })
    .nullish(),
  notes: z.string().trim().max(1000).nullish(),
  /** Vendedor responsável; sem informar, fica quem abriu a negociação. */
  sellerId: z.string().uuid().nullish(),
});
export type DealInput = z.infer<typeof dealInput>;

export const lostReasonKeys = ['price', 'financing_denied', 'bought_elsewhere', 'gave_up', 'trade_rejected', 'no_contact', 'other'] as const;
export type LostReasonKey = (typeof lostReasonKeys)[number];
export const lostReasonLabel: Record<LostReasonKey, string> = {
  price: 'Preço',
  financing_denied: 'Financiamento negado',
  bought_elsewhere: 'Comprou em outra loja',
  gave_up: 'Desistiu',
  trade_rejected: 'Troca não aceita',
  no_contact: 'Sem contato',
  other: 'Outro',
};

/** Motivo padronizado; o texto é detalhe opcional, obrigatório só em "outro". */
export const loseInput = z
  .object({ reasonKey: z.enum(lostReasonKeys), reason: z.string().trim().max(300).nullish() })
  .refine((v) => v.reasonKey !== 'other' || (v.reason?.length ?? 0) >= 3, { message: 'Descreva o motivo', path: ['reason'] });
export type LoseInput = z.infer<typeof loseInput>;

export const sellerInput = z.object({ sellerId: z.string().uuid('Escolha o vendedor') });

export const dealStatuses = ['negotiating', 'credit_analysis', 'credit_approved', 'credit_rejected', 'closed', 'lost'] as const;
export type DealStatus = (typeof dealStatuses)[number];
export const dealStatusLabel: Record<DealStatus, string> = {
  negotiating: 'Em negociação',
  credit_analysis: 'Crédito em análise',
  credit_approved: 'Crédito aprovado',
  credit_rejected: 'Crédito recusado',
  closed: 'Vendido',
  lost: 'Perdida',
};

export interface Deal {
  id: string;
  number: number;
  customer: { id: string; name: string; phone: string | null; email: string | null; document: string | null };
  vehicle: { id: string; title: string; plate: string | null; price: number };
  price: number;
  discount: number;
  tradeIn: DealInput['tradeIn'] | null;
  downPayment: number;
  paymentType: 'cash' | 'financing';
  /** Preço - desconto - troca - entrada (só no financiamento). */
  financedAmount: number;
  status: DealStatus;
  lostReasonKey: LostReasonKey | null;
  /** Detalhe do motivo (nas perdidas antigas, o texto livre). */
  lostReason: string | null;
  lostAt: string | null;
  sellerId: string | null;
  sellerName: string | null;
  notes: string | null;
  closedAt: string | null;
  createdAt: string;
}

/** Por vendedor: em aberto agora; vendidas (valor líquido) e perdidas dentro do período. */
export interface DealsSummary {
  from: string;
  to: string;
  sellers: { sellerId: string | null; sellerName: string | null; open: number; won: number; wonValue: number; lost: number }[];
  /** reasonKey nulo = perdidas antigas, sem motivo padronizado. */
  lostByReason: { reasonKey: LostReasonKey | null; count: number }[];
}

export const vehicleTitle = (v: { brand: string; model: string; version?: string | null; yearManufacture: number; yearModel: number }) =>
  `${v.brand} ${v.model}${v.version ? ` ${v.version}` : ''} ${v.yearManufacture}/${v.yearModel}`;

/** Resposta da tabela FIPE (BrasilAPI). */
export interface FipePrice {
  codigoFipe: string;
  marca: string;
  modelo: string;
  anoModelo: number;
  combustivel: string;
  valor: number;
  mesReferencia: string;
}
