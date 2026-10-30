import { describe, expect, it } from 'vitest';
import { defaultVaccines, matchVaccine, vaccineKey } from '@all/vet';

describe('nomes de vacina', () => {
  it('nomes da mesma vacina têm a mesma chave', () => {
    for (const name of ['V10', 'v-10', 'V 10', 'V10 polivalente', 'V10 (polivalente canina)', 'Vacina V10', 'Polivalente V10']) expect(vaccineKey(name)).toBe('v10');
    expect(vaccineKey('Antirrábica')).toBe(vaccineKey('ANTIRRABICA'));
  });
  it('códigos diferentes continuam diferentes', () => {
    expect(vaccineKey('V8')).not.toBe(vaccineKey('V10'));
    expect(vaccineKey('V10 reforçada especial')).not.toBe('v10');
  });
  it('acha pelo nome e pelo apelido, e não inventa', () => {
    const catalog = defaultVaccines.map((v, i) => ({ ...v, id: String(i) }));
    expect(matchVaccine('V10 polivalente', catalog)?.name).toBe('V10 (polivalente canina)');
    expect(matchVaccine('raiva', catalog)?.name).toBe('Antirrábica');
    expect(matchVaccine('anti-rábica', catalog)?.name).toBe('Antirrábica');
    expect(matchVaccine('tosse dos canis', catalog)?.name).toBe('Gripe canina (tosse dos canis)');
    expect(matchVaccine('Vacina nova', catalog)).toBeUndefined();
    expect(matchVaccine('   ', catalog)).toBeUndefined();
  });
});
