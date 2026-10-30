import { parseWinningBids } from '@all/consortium';
import { describe, expect, it } from 'vitest';

describe('lances vencedores digitados na assembleia', () => {
  it('a vírgula decimal faz parte do percentual, não separa cotas', () => {
    expect(parseWinningBids('045:32,5')).toEqual({ bids: [{ quotaNumber: '045', percent: 32.5 }], invalid: [] });
    expect(parseWinningBids('045:32,5, 210:28')).toEqual({
      bids: [
        { quotaNumber: '045', percent: 32.5 },
        { quotaNumber: '210', percent: 28 },
      ],
      invalid: [],
    });
  });

  it('aceita ponto, ponto e vírgula, quebra de linha e espaço em volta dos dois-pontos', () => {
    expect(parseWinningBids('045:32.5; 210 : 28\n300:40').bids).toEqual([
      { quotaNumber: '045', percent: 32.5 },
      { quotaNumber: '210', percent: 28 },
      { quotaNumber: '300', percent: 40 },
    ]);
  });

  it('o que não for cota:percentual é apontado, nunca vira lance de 0%', () => {
    expect(parseWinningBids('045:32,5 210')).toEqual({ bids: [{ quotaNumber: '045', percent: 32.5 }], invalid: ['210'] });
    expect(parseWinningBids('045:').invalid).toEqual(['045:']);
    // Sem espaço depois da vírgula, "32,210" é lido como número; o resto ":28" fica de fora e é apontado.
    expect(parseWinningBids('045:32,210:28').invalid).toEqual([':28']);
  });

  it('vazio não tem lance nem erro', () => {
    expect(parseWinningBids('  ')).toEqual({ bids: [], invalid: [] });
  });
});
