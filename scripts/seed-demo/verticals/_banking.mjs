// Crédito pela integração bancária (instituições simuladas), comum à revenda, à imobiliária e ao consórcio.
// A instituição simulada responde na hora: o envio deixa a proposta "em análise" e a consulta
// (refresh) decide, aprovando se a parcela cabe em 30% da renda declarada.

/** Garante as instituições simuladas pelo nome; com `min`, para quando houver `min` ativas oferecendo `product`. */
export async function ensureConnections(api, log, wanted, { product, min } = {}) {
  const list = await api.get('/banking/connections');
  const offering = () => list.filter((c) => c.active && (!product || c.products.includes(product))).length;
  let created = 0;
  for (const w of wanted) {
    if (list.some((c) => c.name === w.name)) continue;
    if (min && offering() >= min) break;
    list.push(await api.post('/banking/connections', { mode: 'simulated', active: true, realEstateYearlyRate: 11.5, vehicleMonthlyRate: 1.99, tacFee: 0, ...w }));
    created++;
  }
  log(`    ${created ? `${created} instituições criadas` : 'instituições já cadastradas'} (${list.filter((c) => c.active).map((c) => c.name).join(', ')})`);
  return list;
}

/** A instituição pelo nome; se não houver, a primeira ativa que oferece o produto. */
export function connectionFor(list, product, name) {
  const usable = list.filter((c) => c.active && c.products.includes(product));
  const c = usable.find((x) => x.name === name) ?? usable[0];
  if (!c) throw new Error(`nenhuma instituição ativa oferece ${product}`);
  return c;
}

/** Dados do proponente a partir do cadastro do cliente (documento e nascimento vêm do cadastro). */
export async function applicantFor(api, rng, customer, monthlyIncome) {
  const c = await api.get(`/customers/${customer.id}`).catch(() => customer);
  const birth = typeof c.birthDate === 'string' ? c.birthDate.slice(0, 10) : null;
  return {
    name: c.name,
    document: String(c.document ?? '').replace(/\D/g, '') || (c.type === 'company' ? rng.cnpj() : rng.cpf()),
    birthDate: birth && /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : null,
    monthlyIncome,
    email: c.email || null,
    phone: c.phone || null,
  };
}

const PENDING = ['submitted', 'under_review'];

/**
 * Leva a proposta de financiamento de uma negociação até o desfecho desejado, retomando de onde parou:
 * pending (fica em análise), approved, contracted (aprovada e contrato assinado) ou rejected.
 * A renda declarada é calculada sobre a parcela da instituição para dar o resultado pedido.
 */
export async function ensureCredit(api, rng, o) {
  let [p] = await api.get('/banking/proposals', { sourceType: o.sourceType, sourceId: o.sourceId });
  if (!p) {
    const sim = await api.post('/banking/simulate', { product: o.product, amount: o.amount, termMonths: o.termMonths, system: o.system });
    const offer = sim.offers.find((x) => x.connectionId === o.connection.id);
    if (!offer) throw new Error(`${o.connection.name} não devolveu oferta na simulação`);
    // Aprovação: parcela em ~22% da renda. Recusa: parcela em ~42% da renda.
    const ratio = o.outcome === 'rejected' ? 0.42 : 0.22;
    const income = Math.round(offer.firstInstallment / ratio / 100) * 100;
    p = await api.post('/banking/proposals', {
      connectionId: o.connection.id,
      product: o.product,
      sourceType: o.sourceType,
      sourceId: o.sourceId,
      customerId: o.customer.id,
      amount: o.amount,
      termMonths: o.termMonths,
      system: o.system,
      applicant: await applicantFor(api, rng, o.customer, income),
      details: o.details ?? {},
    });
  }
  if (o.outcome !== 'pending' && PENDING.includes(p.status)) p = await api.post(`/banking/proposals/${p.id}/refresh`);
  if (o.outcome === 'contracted' && p.status === 'approved') {
    p = await api.post(`/banking/proposals/${p.id}/status`, { status: 'contracted', message: 'Contrato assinado pelo cliente' });
  }
  return p;
}

/** Cliente da carteira por chave: 'p3' = 4ª pessoa, 'c0' = 1ª empresa (volta ao início se a carteira for menor). */
export function pickers(customers) {
  const people = customers.filter((c) => c.type !== 'company');
  const companies = customers.filter((c) => c.type === 'company');
  return (key) => {
    const list = key[0] === 'c' && companies.length ? companies : people.length ? people : customers;
    return list[Number(key.slice(1)) % list.length];
  };
}
