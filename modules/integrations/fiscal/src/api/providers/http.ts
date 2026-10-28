import { Injectable } from '@nestjs/common';

export interface HttpResult {
  ok: boolean;
  status: number;
  body: any;
}

/** Chamadas HTTP aos provedores. Isolada para ser trocada nos testes (nenhum teste fala com a rede). */
@Injectable()
export class FiscalHttp {
  async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { headers?: Record<string, string>; json?: unknown } = {}): Promise<HttpResult> {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    let body: string | undefined;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { mensagem: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, body: parsed };
  }

  /** Conteúdo binário (XML, PDF) de um endereço do provedor. */
  async bytes(url: string, headers: Record<string, string> = {}): Promise<{ ok: boolean; status: number; content: Buffer; mime: string }> {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    return { ok: res.ok, status: res.status, content: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'application/octet-stream' };
  }
}

export const basicAuth = (user: string, password = '') => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
