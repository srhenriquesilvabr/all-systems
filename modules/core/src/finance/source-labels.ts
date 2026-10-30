/**
 * Nome em português de cada origem de lançamento. O core não conhece os ramos (ADR-018): aqui só há
 * o texto que aparece na tela e na planilha; origem nova sem nome cai no texto legível do fallback.
 */
const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  service_order: 'Ordem de serviço',
  appointment: 'Atendimento da agenda',
  sale: 'Venda no caixa',
  sales_register_move: 'Sangria ou suprimento de caixa',
  sales_register_session: 'Quebra ou sobra de caixa',
  store_order: 'Pedido da lojinha',
  hr_payroll: 'Folha de pagamento',
  hr_vacation: 'Férias',
  hr_termination: 'Rescisão',
  hrc_fee: 'Honorários da consultoria de RH',
  acc_fee: 'Honorários contábeis',
  legal_fee: 'Honorários advocatícios',
  laundry_logistics: 'Coleta e entrega',
  aes_package: 'Pacote de estética',
  aes_case: 'Caso de estética',
  ortho_treatment: 'Tratamento ortodôntico',
  ortho_entry_fee: 'Taxa de instalação do aparelho',
  consortium_quota: 'Comissão de cota de consórcio',
  consortium_commission_reversal: 'Estorno de comissão de consórcio',
  consortium_lead: 'Indicação de consórcio',
  real_estate_deal: 'Negociação de imóvel',
  real_estate_lease: 'Aluguel',
  real_estate_lease_extra: 'Cobrança extra da locação',
  vehicle_deal: 'Negociação de veículo',
};

/** "minha_origem_nova" → "Minha origem nova": nunca mostra o código cru, mesmo em origem sem nome. */
export function financeSourceLabel(sourceType: string): string {
  const known = SOURCE_LABELS[sourceType];
  if (known) return known;
  const words = sourceType.replace(/[_.-]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Outra origem';
}
