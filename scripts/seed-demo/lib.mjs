// Base do seed de demonstração: cliente da API do admin e geradores de dados brasileiros.
// Tudo passa pela API (mesmas validações e regras da tela), nunca direto no banco.

/** Cliente HTTP autenticado como o dono das empresas de demonstração. */
export function createClient(base) {
  let token = null;
  let selection = null;
  // Para renovar a sessão: o token de acesso dura poucos minutos e um seed grande passa disso.
  let credentials = null;
  let currentTenant = null;

  async function request(method, path, { body, query } = {}) {
    const url = new URL(`${base}/api${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        // Queda de rede deste lado ("fetch failed"): tenta de novo.
        if (attempt < 6) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        throw err;
      }
      // Limite de requisições (300/min) ou instabilidade passageira: espera e tenta de novo.
      // Um 500 desfaz a transação no servidor, então repetir não duplica nada.
      if ((res.status === 429 || res.status === 503 || (res.status === 500 && attempt < 2)) && attempt < 6) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401 && credentials && currentTenant && !path.startsWith('/auth/') && attempt < 6) {
        await renew();
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new ApiError(method, path, res.status, text);
      return text ? JSON.parse(text) : null;
    }
  }

  async function renew() {
    token = null;
    const r = await request('POST', '/auth/login', { body: credentials });
    const s = r.selectTenant
      ? await request('POST', '/auth/select-tenant', { body: { selectionToken: r.selectionToken, tenantId: currentTenant } })
      : await request('POST', '/auth/switch-tenant', { body: { tenantId: currentTenant } });
    token = s.accessToken ?? r.accessToken;
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body, query) => request('POST', path, { body: body ?? {}, query }),
    put: (path, body) => request('PUT', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    del: (path) => request('DELETE', path),

    /** Envia um arquivo (multipart), como o upload da tela. */
    async upload(path, field, bytes, fileName, mime) {
      const form = new FormData();
      form.append(field, new Blob([bytes], { type: mime }), fileName);
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${base}/api${path}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
        if ((res.status === 429 || res.status === 503 || res.status === 500) && attempt < 3) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        if (res.status === 401 && credentials && currentTenant && attempt < 3) {
          await renew();
          continue;
        }
        const text = await res.text();
        if (!res.ok) throw new ApiError('POST', path, res.status, text);
        return text ? JSON.parse(text) : null;
      }
    },

    /** Faz login e devolve as empresas do usuário. */
    async login(email, password) {
      credentials = { email, password };
      const r = await request('POST', '/auth/login', { body: { email, password } });
      if (r.selectTenant) {
        selection = r.selectionToken;
        return r.tenants;
      }
      token = r.accessToken;
      return [r.tenant];
    },

    /** Entra (ou troca para) a empresa; com a sessão vencida, entra de novo. */
    async enter(tenantId) {
      currentTenant = tenantId;
      if (selection) {
        const r = await request('POST', '/auth/select-tenant', { body: { selectionToken: selection, tenantId } });
        selection = null;
        token = r.accessToken;
        return r.tenant;
      }
      try {
        const r = await request('POST', '/auth/switch-tenant', { body: { tenantId } });
        token = r.accessToken;
        return r.tenant;
      } catch (err) {
        if (err.status !== 401) throw err;
        await renew();
        return { id: tenantId };
      }
    },
  };
}

export class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} → ${status}: ${body.slice(0, 400)}`);
    this.status = status;
    this.body = body;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Gerador pseudoaleatório com semente: rodar de novo gera os mesmos dados (e o sistema barra duplicados). */
export function createRng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = (list) => list[Math.floor(next() * list.length)];
  return {
    next,
    int,
    pick,
    /** Valor em reais com centavos, entre min e max. */
    money: (min, max) => Math.round((min + next() * (max - min)) * 100) / 100,
    chance: (p) => next() < p,
    shuffle: (list) => [...list].sort(() => next() - 0.5),
    cpf() {
      const d = Array.from({ length: 9 }, () => int(0, 9));
      for (const len of [9, 10]) {
        const sum = d.reduce((s, n, i) => s + n * (len + 1 - i), 0);
        const r = (sum * 10) % 11;
        d.push(r === 10 ? 0 : r);
      }
      return d.join('');
    },
    cnpj() {
      const d = [...Array.from({ length: 8 }, () => int(0, 9)), 0, 0, 0, 1];
      for (const weights of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
        const r = d.reduce((s, n, i) => s + n * weights[i], 0) % 11;
        d.push(r < 2 ? 0 : 11 - r);
      }
      return d.join('');
    },
    /** Celular de São Paulo, só dígitos com DDD. */
    phone: () => `119${int(6000, 9999)}${int(1000, 9999)}`,
  };
}

const TODAY = new Date();

/** Data (YYYY-MM-DD) a n dias de hoje (negativo = passado), no fuso de Brasília. */
export function day(n = 0) {
  const d = new Date(TODAY.getTime() + n * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

/** Data e hora ISO a n dias de hoje, às hh:mm de Brasília (UTC−3). */
export function at(n, hh, mm = 0) {
  return `${day(n)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`;
}

/** Próximo dia útil a partir de n dias (pula sábado e domingo). */
export function workday(n) {
  for (let i = n; ; i++) {
    const wd = new Date(`${day(i)}T12:00:00-03:00`).getUTCDay();
    if (wd !== 0 && wd !== 6) return i;
  }
}

export const FIRST_NAMES = [
  'Ana', 'Bruno', 'Camila', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João',
  'Juliana', 'Lucas', 'Mariana', 'Matheus', 'Natália', 'Otávio', 'Patrícia', 'Rafael', 'Renata', 'Thiago',
  'Vanessa', 'Vinícius', 'Larissa', 'Gustavo', 'Beatriz', 'Leonardo', 'Carolina', 'Rodrigo', 'Fernanda', 'Pedro',
];
export const LAST_NAMES = [
  'Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento',
  'Carvalho', 'Ribeiro', 'Gomes', 'Martins', 'Araújo', 'Barbosa', 'Rocha', 'Dias', 'Moreira', 'Teixeira',
];
export const STREETS = ['Rua Augusta', 'Av. Paulista', 'Rua Oscar Freire', 'Rua Haddock Lobo', 'Rua Teodoro Sampaio', 'Av. Brigadeiro Faria Lima', 'Rua dos Pinheiros', 'Rua Vergueiro', 'Av. Rebouças', 'Rua Domingos de Morais'];
export const DISTRICTS = ['Consolação', 'Bela Vista', 'Jardins', 'Pinheiros', 'Vila Mariana', 'Itaim Bibi', 'Moema', 'Perdizes', 'Vila Madalena', 'Brooklin'];
export const COMPANIES = ['Mercado Bom Preço', 'Construtora Horizonte', 'Clínica Vida Plena', 'Tech Soluções', 'Restaurante Sabor da Terra', 'Academia Corpo em Forma', 'Papelaria Central', 'Transportadora Rápida'];

/** Nome completo distinto a cada chamada (dentro da mesma semente). */
export function personName(rng, used = new Set()) {
  for (;;) {
    const n = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    if (!used.has(n)) return used.add(n), n;
  }
}

export const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');

/** Executa e registra; um erro não derruba o resto do seed da empresa. */
export async function step(log, label, fn) {
  try {
    const r = await fn();
    log(`  ✓ ${label}`);
    return r;
  } catch (err) {
    log(`  ✗ ${label}: ${err.message}`);
    return undefined;
  }
}
