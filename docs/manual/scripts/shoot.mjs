// Capturas do admin (Edge via playwright-core). Uso: node shoot.mjs <pasta-de-saída> [nomes...]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? 'out';
const ONLY = new Set(process.argv.slice(3));
const BASE = 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

async function shot(name, url, { wait, full = false, before } = {}) {
  if (ONLY.size && !ONLY.has(name)) return;
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  if (wait) await page.waitForSelector(wait, { timeout: 15000 });
  if (before) await before();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log('ok', name);
}

// Login
await shot('01-login', '/entrar', { wait: 'form' });
await page.goto(BASE + '/entrar', { waitUntil: 'networkidle' });
await page.getByLabel('E-mail').fill('dono@demo.com');
await page.getByLabel('Senha').fill('demo123456');
await page.getByRole('button', { name: 'Entrar' }).click();
await page.waitForSelector('nav[aria-label="Menu principal"]');

// IDs das telas de detalhe, consultados por uma sessão própria pela API (não mexe na sessão do navegador).
const apiToken = (await (await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dono@demo.com', password: 'demo123456' }) })).json()).accessToken;
const get = async (p) => (await fetch('http://localhost:3000/api' + p, { headers: { Authorization: 'Bearer ' + apiToken } })).json();
const ids = { orders: (await get('/service-orders?limit=50')).items, customer: (await get('/customers?q=Ana')).items[0]?.id };
const order = (n) => ids.orders.find((o) => o.number === n)?.id;

await shot('02-inicio', '/', { wait: 'h1' });
await shot('03-clientes', '/clientes', { wait: 'table' });
await shot('04-cliente', `/clientes/${ids.customer}`, { wait: 'h1' });
await shot('05-balcao', '/lavanderia/ordens/nova', {
  wait: 'h1',
  full: true,
  before: async () => {
    await page.getByLabel('Buscar cliente').fill('Ana');
    await page.getByRole('button', { name: /Ana Beatriz/ }).click();
    const selects = page.locator('select');
    await selects.nth(0).selectOption({ label: /Lavar e passar/ }).catch(() => {});
    const opts = await selects.nth(0).locator('option').allTextContents();
    const lavar = opts.find((o) => o.startsWith('Lavar e passar'));
    if (lavar) await selects.nth(0).selectOption({ label: lavar });
    await selects.nth(1).selectOption({ label: 'Camisa' });
    await page.getByLabel('Peças').first().fill('3');
  },
});
await shot('06-ordem', `/lavanderia/ordens/${order(3)}`, { wait: 'h1', full: true });
await shot('07-etiquetas', `/lavanderia/ordens/${order(3)}/etiquetas`, { wait: '[aria-label^="Etiqueta"]' });
await shot('08-comprovante', `/lavanderia/ordens/${order(3)}/comprovante`, { wait: '[aria-label^="Ordem"]', full: true });
await shot('09-producao', '/lavanderia/producao', { wait: 'section' });
await shot('10-ordens', '/ordens', { wait: 'table' });
await shot('11-pagamento-pix', `/lavanderia/ordens/${order(4)}`, {
  wait: 'h1',
  before: async () => {
    await page.getByRole('button', { name: 'Registrar pagamento' }).click();
    await page.getByRole('button', { name: /Gerar QR Code Pix/ }).click();
    await page.waitForSelector('dialog [role=img]');
  },
});
await shot('12-financeiro', '/financeiro', { wait: 'svg[aria-label^="Receitas"]', full: true });
await shot('13-lancamentos', '/financeiro/lancamentos', { wait: 'table' });
await shot('14-relatorios', '/lavanderia/relatorios', { wait: 'h1', full: true });
await shot('15-servicos', '/lavanderia/servicos', { wait: 'table' });
await shot('16-usuarios', '/configuracoes/usuarios', { wait: 'table' });
await shot('17-papeis', '/configuracoes/papeis', { wait: 'table' });
await shot('18-notificacoes', '/configuracoes/notificacoes', { wait: 'table' });
await shot('19-pix', '/configuracoes/pix', { wait: 'form' });

// Celular
if (!ONLY.size || ONLY.has('20-celular')) {
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('20-celular', '/lavanderia/producao', { wait: 'section' });
}

await browser.close();
if (errors.length) console.log('ERROS NO NAVEGADOR:\n' + [...new Set(errors)].join('\n'));
