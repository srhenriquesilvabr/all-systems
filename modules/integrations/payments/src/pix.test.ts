import { describe, expect, it } from 'vitest';
import { buildPixPayload, crc16, isValidPixKey } from './pix';

/** Lê o TLV do BR Code de volta para conferir a estrutura. */
function parse(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

describe('Pix copia e cola', () => {
  it('CRC16-CCITT-FALSE confere com o valor de referência', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('monta o BR Code com valor, recebedor e txid', () => {
    const payload = buildPixPayload({
      key: 'pix@lavanderia.com.br',
      merchantName: 'Lavanderia Bolha Azul Ltda Comércio',
      merchantCity: 'São José dos Campos',
      amount: 96.6,
      txid: 'OS-123',
    });
    const fields = parse(payload);
    expect(fields['00']).toBe('01');
    expect(parse(fields['26']!)).toEqual({ '00': 'br.gov.bcb.pix', '01': 'pix@lavanderia.com.br' });
    expect(fields['53']).toBe('986');
    expect(fields['54']).toBe('96.60');
    expect(fields['59']).toBe('LAVANDERIA BOLHA AZUL LTD'); // 25 caracteres, sem acento
    expect(fields['60']).toBe('SAO JOSE DOS CA'); // 15 caracteres
    expect(parse(fields['62']!)).toEqual({ '05': 'OS123' });
    // O CRC é calculado sobre tudo antes dele, incluindo "6304".
    expect(fields['63']).toBe(crc16(payload.slice(0, -4)));
  });

  it('sem txid usa "***", como pede o padrão', () => {
    expect(parse(parse(buildPixPayload({ key: '12345678909', merchantName: 'X', merchantCity: 'Y' }))['62']!)['05']).toBe('***');
  });

  it('valida os tipos de chave', () => {
    expect(isValidPixKey('12345678909')).toBe(true);
    expect(isValidPixKey('+5511987654321')).toBe(true);
    expect(isValidPixKey('a@b.co')).toBe(true);
    expect(isValidPixKey('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isValidPixKey('11987654321x')).toBe(false);
  });
});
