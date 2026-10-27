// Pix "copia e cola" estático (BR Code / EMV-QRCPS), conforme o Manual de Padrões para
// Iniciação do Pix do Banco Central. Gerado localmente a partir da chave: não depende de gateway.
// A confirmação do pagamento é manual (quem recebe confere no banco); a confirmação automática
// virá com um provedor (gateway/PSP) — ver ADR-P5.

export interface PixPayloadInput {
  key: string;
  merchantName: string;
  merchantCity: string;
  /** Em reais. Sem valor, o pagador digita. */
  amount?: number;
  /** Identificador da cobrança (até 25 caracteres alfanuméricos). */
  txid?: string;
  description?: string;
}

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** Sem acentos e só com caracteres aceitos pelo padrão. */
function sanitize(value: string, max: number) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,\-/]/g, '')
    .trim()
    .slice(0, max);
}

export function buildPixPayload(input: PixPayloadInput): string {
  const account = field('00', 'br.gov.bcb.pix') + field('01', input.key) + (input.description ? field('02', sanitize(input.description, 40)) : '');
  const txid = (input.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';

  const payload =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (input.amount !== undefined ? field('54', input.amount.toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', sanitize(input.merchantName, 25).toUpperCase()) +
    field('60', sanitize(input.merchantCity, 15).toUpperCase()) +
    field('62', field('05', txid)) +
    '6304';
  return payload + crc16(payload);
}

/** CRC16-CCITT-FALSE (polinômio 0x1021, inicial 0xFFFF), em 4 dígitos hexadecimais maiúsculos. */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(data, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Aceita os quatro tipos de chave Pix: CPF/CNPJ, e-mail, telefone (+55…) e chave aleatória. */
export function isValidPixKey(key: string): boolean {
  return (
    /^\d{11}$/.test(key) ||
    /^\d{14}$/.test(key) ||
    /^\+55\d{10,11}$/.test(key) ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  );
}
