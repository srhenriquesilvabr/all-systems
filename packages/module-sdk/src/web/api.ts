export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

interface ApiConfig {
  baseUrl: string;
  getToken: () => string | null;
  /** Tenta renovar o access token. Retorna false se a sessão acabou. */
  refresh: () => Promise<boolean>;
  onUnauthorized: () => void;
}

const config: ApiConfig = {
  baseUrl: '/api',
  getToken: () => null,
  refresh: async () => false,
  onUnauthorized: () => {},
};

export function configureApi(partial: Partial<ApiConfig>) {
  Object.assign(config, partial);
}

let refreshing: Promise<boolean> | null = null;

/** Várias requisições recebendo 401 ao mesmo tempo disparam uma única renovação. */
function refreshOnce(): Promise<boolean> {
  refreshing ??= config.refresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

async function request(path: string, opts: ApiOptions, retried: boolean): Promise<Response> {
  const url = new URL(config.baseUrl + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = {};
  const token = config.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'same-origin',
  });

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshOnce()) return request(path, opts, true);
    config.onUnauthorized();
  }
  return res;
}

/**
 * Baixa um arquivo de uma rota autenticada (CSV, exportação de dados). Um link <a href>
 * comum não levaria o token, por isso o download passa pelo fetch.
 */
export async function apiDownload(path: string, filename: string, opts: ApiOptions = {}): Promise<void> {
  const res = await request(path, opts, false);
  if (!res.ok) throw new ApiError(res.status, undefined, res.statusText, undefined);
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await request(path, opts, false);
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? res.statusText);
    throw new ApiError(res.status, data?.code, message, data);
  }
  return data as T;
}
