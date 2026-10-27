import { describe, expect, it } from 'vitest';
import { parseRows, toBoolean, toIsoDate, toNumber, type ImportColumn } from './spreadsheet';

describe('planilhas de cadastro', () => {
  it('datas: dd/mm/aaaa, ISO, Date do Excel e número serial; recusa data inexistente', () => {
    expect(toIsoDate('05/03/1990')).toBe('1990-03-05');
    expect(toIsoDate('2024-12-31')).toBe('2024-12-31');
    expect(toIsoDate(new Date(2025, 0, 9))).toBe('2025-01-09');
    expect(toIsoDate(45658)).toBe('2025-01-01');
    expect(toIsoDate('31/02/2024')).toBeNull();
    expect(toIsoDate('amanhã')).toBeNull();
  });

  it('números no formato brasileiro e do Excel', () => {
    expect(toNumber('R$ 1.234,56')).toBe(1234.56);
    expect(toNumber('1234,5')).toBe(1234.5);
    expect(toNumber('1234.5')).toBe(1234.5);
    expect(toNumber(99)).toBe(99);
    expect(toNumber('abc')).toBeNull();
  });

  it('sim/não em várias formas', () => {
    expect(toBoolean('Sim')).toBe(true);
    expect(toBoolean('NÃO')).toBe(false);
    expect(toBoolean('x')).toBe(true);
    expect(toBoolean('talvez')).toBeNull();
  });

  it('acha as colunas pelo cabeçalho (com * e sem acento), converte e aponta os erros por linha', () => {
    const columns: ImportColumn[] = [
      { key: 'name', label: 'Nome', required: true },
      { key: 'type', label: 'Tipo', type: 'enum', options: [{ value: 'person', label: 'Pessoa física' }, { value: 'company', label: 'Empresa' }] },
      { key: 'price', label: 'Preço (R$)', type: 'money' },
      { key: 'birth', label: 'Nascimento', type: 'date' },
    ];
    const { rows, missingColumns } = parseRows(
      columns,
      ['NOME *', 'tipo', 'Preco R$', 'Nascimento'],
      [
        ['Ana', 'pessoa fisica', '10,5', '01/02/2000'],
        ['', 'Empresa', 'caro', ''],
        ['', '', '', ''],
      ],
    );
    expect(missingColumns).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, errors: [], values: { name: 'Ana', type: 'person', price: 10.5, birth: '2000-02-01' } });
    expect(rows[1]!.line).toBe(3);
    expect(rows[1]!.errors).toEqual(['Nome: obrigatório', 'Preço (R$): número inválido']);
  });

  it('avisa quando falta coluna obrigatória', () => {
    const { missingColumns } = parseRows([{ key: 'name', label: 'Nome', required: true }], ['Telefone'], [['1199']]);
    expect(missingColumns).toEqual(['Nome']);
  });
});
