/** Módulo do runtime do Cloudflare Workers (com nodejs_compat): ponte entre fetch e o http do Node. */
declare module 'cloudflare:node' {
  export function handleAsNodeRequest(port: number, request: Request): Promise<Response>;
}
