// Lojinha (módulo store) na padaria e no pet shop de demonstração: configura a loja, publica ~12
// produtos do PDV com fotos ilustrativas desenhadas aqui mesmo (PNG gerado em código, sem fotos
// reais nem direitos de terceiros) e cria ~8 pedidos em estados variados — alguns concluídos, que
// viram vendas no PDV. Só completa o que falta: anúncio existente não é alterado, foto só para quem
// não tem, e os pedidos param ao chegar a 8 na empresa.
//
// O módulo precisa estar ativo na empresa. Não há rota de API para ativar módulos; ative pelo CLI:
//   pnpm --filter @all/api cli module:enable --tenant <id da fake-padaria / fake-petshop> --module store
import { deflateSync } from 'node:zlib';
import { day, DISTRICTS, STREETS, step } from '../lib.mjs';

const TARGET_ORDERS = 8;
const TARGET_LISTINGS = 12;

/** Configuração e textos de cada loja. */
const STORES = {
  'fake-padaria': {
    banner: 'FORNADA DO DIA',
    colors: [
      [196, 120, 52],
      [240, 200, 140],
    ],
    welcome: 'Pães, bolos e salgados feitos todos os dias. Peça até as 10h para retirar à tarde ou receber em casa.',
    pickup: { enabled: true, address: 'Rua Augusta, 1500 — Consolação, São Paulo', hours: 'Seg. a sáb., 6h às 20h; dom., 7h às 13h' },
    delivery: { enabled: true, feeMode: 'district', minOrder: 25, eta: 'Até 60 minutos', fees: [6, 8, 8, 10, 12] },
    exchangePolicy: 'Produtos frescos não têm troca depois de entregues. Se algo vier errado, fale com a gente pelo WhatsApp no mesmo dia que resolvemos.',
    words: { Pães: 'Assado na hora, casca crocante e miolo macio.', Doces: 'Receita da casa, feito em pequenas fornadas.', Salgados: 'Massa leve e recheio generoso. Ótimo para o lanche.' },
  },
  'fake-petshop': {
    banner: 'TUDO PARA SEU PET',
    colors: [
      [46, 125, 160],
      [170, 220, 210],
    ],
    welcome: 'Rações, petiscos, higiene e acessórios com entrega no bairro. Agende também o banho e tosa com a gente!',
    pickup: { enabled: true, address: 'Av. Paulista, 900 — Bela Vista, São Paulo', hours: 'Seg. a sex., 9h às 19h; sáb., 9h às 15h' },
    delivery: { enabled: true, feeMode: 'fixed', fixedFee: 9.9, minOrder: 50, eta: 'No mesmo dia para pedidos até as 15h' },
    exchangePolicy: 'Troca de produtos lacrados em até 7 dias, com o comprovante. Rações abertas não têm troca.',
    words: { Rações: 'Nutrição completa e balanceada para o dia a dia.', Petiscos: 'Petisco saboroso para treinos e recompensas.', Higiene: 'Praticidade e limpeza para a casa e o pet.', Acessórios: 'Resistente, confortável e fácil de ajustar.', Farmácia: 'Siga a orientação do médico-veterinário.' },
  },
};

/** Estado final de cada pedido criado (o índice do pedido escolhe o caminho). */
const PATHS = [
  { to: 'completed', pay: 'pix' },
  { to: 'completed', pay: 'cash' },
  { to: 'completed', pay: 'credit_card' },
  { to: 'cancelled', reason: 'Cliente desistiu da compra' },
  { to: 'ready' },
  { to: 'preparing' },
  { to: 'confirmed' },
  { to: 'new' },
];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: unknown[] }} ctx */
export default async function seedStore(ctx) {
  const cfg = STORES[ctx.tenant.name];
  if (!cfg) return;
  const { api, log } = ctx;
  let status;
  try {
    status = await api.get('/store/status');
  } catch (err) {
    if (err.status === 403) {
      log(`  ✗ lojinha: módulo store inativo. Ative pelo CLI: pnpm --filter @all/api cli module:enable --tenant ${ctx.tenant.id} --module store`);
      return;
    }
    throw err;
  }
  await step(log, 'lojinha: configurações', () => seedSettings(ctx, cfg));
  if (!status.bannerFileId) {
    await step(log, 'lojinha: banner', () => api.upload('/store/banner', 'banner', bannerPng(cfg), 'banner.png', 'image/png'));
  }
  const listed = await step(log, 'lojinha: anúncios e fotos', () => seedListings(ctx, cfg));
  if (listed?.length) await step(log, 'lojinha: pedidos', () => seedOrders(ctx, cfg, listed));
}

async function seedSettings({ api, log }, cfg) {
  const current = await api.get('/store/settings');
  if (current.open && current.welcome) return log('    loja já configurada');
  const delivery =
    cfg.delivery.feeMode === 'district'
      ? { ...cfg.delivery, districts: DISTRICTS.slice(0, cfg.delivery.fees.length).map((name, i) => ({ name, fee: cfg.delivery.fees[i] })) }
      : { ...cfg.delivery, districts: [] };
  delete delivery.fees;
  await api.put('/store/settings', {
    ...current,
    open: true,
    welcome: cfg.welcome,
    outOfStock: 'sold_out',
    paymentModes: ['whatsapp', 'on_delivery'],
    pickup: cfg.pickup,
    delivery,
    exchangePolicy: cfg.exchangePolicy,
  });
}

/** Publica até 12 produtos ativos do PDV (variando as categorias) com 1 ou 2 fotos e algumas promoções. */
async function seedListings({ api, rng, log }, cfg) {
  const products = (await api.get('/store/products')).filter((p) => p.active && p.price > 0);
  const already = products.filter((p) => p.listing?.visible);
  const byCategory = new Map();
  for (const p of products) byCategory.set(p.category ?? '', [...(byCategory.get(p.category ?? '') ?? []), p]);
  // Uma de cada categoria por rodada, até completar.
  const picked = [...already];
  for (let round = 0; picked.length < TARGET_LISTINGS && round < 20; round++) {
    for (const list of byCategory.values()) {
      const p = list[round];
      if (p && !picked.includes(p) && picked.length < TARGET_LISTINGS) picked.push(p);
    }
  }

  let created = 0;
  let photos = 0;
  let stocked = 0;
  for (const [i, p] of picked.entries()) {
    if (!p.listing) {
      const promo = i % 4 === 1 && p.price >= 5 ? Math.round(p.price * 85) / 100 : null;
      await api.put(`/store/listings/${p.productId}`, {
        visible: true,
        title: null,
        description: cfg.words[p.category] ?? 'Produto selecionado pela loja.',
        category: null,
        featured: i < 3,
        promoPrice: promo,
        promoUntil: promo ? day(10 + i) : null,
      });
      created++;
    }
    if (!p.listing?.photos.length) {
      const count = i % 3 === 0 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        await api.upload(`/store/listings/${p.productId}/photos`, 'photo', productPng(p.name, cfg, k, rng), `${slug(p.name)}-${k + 1}.png`, 'image/png');
        photos++;
      }
    }
    // Para a vitrine não abrir com tudo "esgotado": entrada de estoque nos que estão zerados.
    if (p.trackStock && (p.available ?? 0) < 5) {
      await api.post('/sales/stock-moves', { productId: p.productId, kind: 'purchase', quantity: p.unit === 'kg' || p.unit === 'l' ? 10 : 30, reason: 'Estoque para a loja online (demonstração)' });
      stocked++;
    }
  }
  log(`    ${picked.length} anunciados (${created} novos), ${photos} foto(s), ${stocked} com entrada de estoque`);
  return picked;
}

/** Pedidos em estados variados, metade pela vitrine (como um cliente faria) e metade lançada pela equipe. */
async function seedOrders({ api, rng, log, tenant, customers }, cfg, listed) {
  const existing = await api.get('/store/orders', { limit: 200 });
  if (existing.length >= TARGET_ORDERS) return log(`    já tem ${existing.length} pedidos`);
  const people = customers.filter((c) => c.type !== 'company' && c.phone);
  if (!people.length) return log('    sem clientes com celular para os pedidos');
  const status = await api.get('/store/status');
  const settings = await api.get('/store/settings');
  const districts = settings.delivery.feeMode === 'district' ? settings.delivery.districts.map((d) => d.name) : DISTRICTS;

  const results = [];
  for (let i = existing.length; i < TARGET_ORDERS; i++) {
    const path = PATHS[i];
    const who = people[i % people.length];
    const delivery = i % 2 === 1;
    const items = rng
      .shuffle(listed)
      .slice(0, rng.int(1, 3))
      .map((p) => ({ productId: p.productId, quantity: p.unit === 'kg' || p.unit === 'l' ? 0.5 : rng.int(1, 3) }));
    const body = {
      name: who.name,
      phone: who.phone,
      email: who.email ?? null,
      fulfillment: delivery ? 'delivery' : 'pickup',
      address: delivery ? { zip: null, street: rng.pick(STREETS), number: String(rng.int(10, 1999)), complement: null, district: rng.pick(districts), city: 'São Paulo', state: 'SP' } : null,
      notes: i % 3 === 0 ? 'Por favor, tocar o interfone.' : null,
      items,
      paymentMode: i % 2 === 0 ? 'whatsapp' : 'on_delivery',
    };
    // Entrega abaixo do mínimo: completa com mais unidades do primeiro item.
    const subtotal = items.reduce((s, it) => s + it.quantity * (listed.find((p) => p.productId === it.productId)?.price ?? 0), 0);
    if (delivery && subtotal < settings.delivery.minOrder) items[0].quantity = fitMinimum(items[0], listed, settings.delivery.minOrder, subtotal);

    let id = null;
    if (i % 2 === 0 && status.slug) {
      // Pela vitrine: mesmas regras de um cliente (consentimento, limites). Se recusar, lança pela equipe.
      try {
        const store = await api.get(`/public/store/${status.slug}`);
        const placed = await api.post(`/public/store/${status.slug}/orders`, { ...body, consent: true, consentVersion: store.consent.version, startedAt: Date.now() - 90_000 });
        id = placed.order?.id ?? null;
      } catch (err) {
        log(`    vitrine recusou (${err.status}); pedido lançado pela equipe`);
      }
    }
    if (!id) id = (await api.post('/store/orders', { ...body, paymentMode: body.paymentMode })).id;
    results.push(await advance(api, id, path));
  }
  const done = results.filter((r) => r === 'completed').length;
  log(`    ${results.length} pedido(s) novo(s) em ${tenant.name}: ${results.join(', ')} (${done} viraram venda)`);
}

function fitMinimum(item, listed, minimum, subtotal) {
  const p = listed.find((x) => x.productId === item.productId);
  if (!p?.price) return item.quantity;
  const fractional = p.unit === 'kg' || p.unit === 'l';
  const extra = (minimum - subtotal) / p.price;
  return fractional ? Math.round((item.quantity + extra + 0.1) * 10) / 10 : item.quantity + Math.ceil(extra);
}

/** Leva o pedido pelo fluxo até o estado desejado. Devolve o estado em que parou. */
async function advance(api, id, path) {
  if (path.to === 'new') return 'new';
  if (path.to === 'cancelled') {
    await api.post(`/store/orders/${id}/cancel`, { reason: path.reason });
    return 'cancelled';
  }
  const order = await api.post(`/store/orders/${id}/status`, { status: 'confirmed' });
  if (path.to === 'confirmed') return 'confirmed';
  await api.post(`/store/orders/${id}/status`, { status: 'preparing' });
  if (path.to === 'preparing') return 'preparing';
  await api.post(`/store/orders/${id}/status`, { status: order.fulfillment === 'delivery' ? 'dispatched' : 'ready' });
  if (path.to === 'ready') return order.fulfillment === 'delivery' ? 'dispatched' : 'ready';
  try {
    await api.post(`/store/orders/${id}/complete`, { paymentMethod: path.pay });
  } catch (err) {
    // Empresa que exige caixa aberto: conclui no primeiro caixa com sessão aberta.
    if (!String(err.body ?? '').includes('REGISTER')) throw err;
    const { registers } = await api.get('/sales/registers');
    const open = registers.find((r) => r.active && r.openSession);
    if (!open) throw err;
    await api.post(`/store/orders/${id}/complete`, { paymentMethod: path.pay, registerId: open.id });
  }
  return 'completed';
}

// ---- Imagens ilustrativas (PNG desenhado em código) ----------------------------------------------

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Fonte 5×7 (linhas em bits) só com o que os desenhos usam. */
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31], 0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
};

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Tela RGB simples com `fill(x, y) => [r,g,b]` e texto em pixel; devolve o PNG. */
function canvas(width, height) {
  const px = Buffer.alloc(width * height * 3);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };
  return {
    fill(fn) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, fn(x, y));
    },
    circle(cx, cy, radius, color) {
      for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) set(x, y, color);
    },
    text(str, cx, cy, scale, color) {
      const chars = [...str].filter((c) => c === ' ' || FONT[c]);
      const w = chars.length * 6 * scale - scale;
      let x0 = Math.round(cx - w / 2);
      const y0 = Math.round(cy - (7 * scale) / 2);
      for (const c of chars) {
        const rows = FONT[c] ?? [0, 0, 0, 0, 0, 0, 0];
        rows.forEach((bits, row) => {
          for (let col = 0; col < 5; col++) {
            if (!((bits >> (4 - col)) & 1)) continue;
            for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) set(x0 + col * scale + dx, y0 + row * scale + dy, color);
          }
        });
        x0 += 6 * scale;
      }
    },
    png() {
      const raw = Buffer.alloc((width * 3 + 1) * height);
      for (let y = 0; y < height; y++) px.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(width, 0);
      ihdr.writeUInt32BE(height, 4);
      ihdr[8] = 8; // 8 bits por canal
      ihdr[9] = 2; // RGB
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
    },
  };
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const ascii = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

/** Foto ilustrativa do produto: fundo em degradê na cor da loja, "prato" claro e as iniciais do nome. */
function productPng(name, cfg, variant, rng) {
  const size = 480;
  const c = canvas(size, size);
  const [a, b] = cfg.colors;
  const tilt = variant ? 0.35 : 0;
  c.fill((x, y) => mix(a, b, Math.min(1, (x * tilt + y) / (size * (1 + tilt)))));
  // Confeitos/bolinhas de fundo (posições fixas pela semente do seed).
  for (let k = 0; k < 14; k++) c.circle(rng.int(0, size), rng.int(0, size), rng.int(6, 18), mix(b, [255, 255, 255], 0.55));
  c.circle(size / 2, size / 2, 150, [252, 249, 243]);
  c.circle(size / 2, size / 2, 132, mix(b, [255, 255, 255], 0.35));
  const words = ascii(name)
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length > 2 || /\d/.test(w));
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? 'P').slice(0, 2)).replace(/[^A-Z0-9]/g, '');
  c.text(initials, size / 2, size / 2, 18, a);
  return c.png();
}

/** Banner largo com o mote da loja. */
function bannerPng(cfg) {
  const w = 1200;
  const h = 400;
  const c = canvas(w, h);
  const [a, b] = cfg.colors;
  c.fill((x, y) => mix(a, b, (x / w) * 0.8 + (y / h) * 0.2));
  for (let k = 0; k < 9; k++) c.circle(80 + k * 130, k % 2 ? 60 : 340, 40, mix(b, [255, 255, 255], 0.5));
  c.text(ascii(cfg.banner), w / 2, h / 2, 12, [255, 255, 255]);
  return c.png();
}
