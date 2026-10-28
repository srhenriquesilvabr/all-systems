import { BadRequestException, Controller, Get, Header, Injectable, NotFoundException, Param, ServiceUnavailableException } from '@nestjs/common';

export interface CepAddress {
  zip: string;
  street: string;
  district: string;
  city: string;
  state: string;
  complement: string;
}

interface ViaCepBody {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

/** Chamada ao ViaCEP (substituída nos testes). */
@Injectable()
export class CepHttp {
  async get(cep: string): Promise<{ status: number; body: ViaCepBody | null }> {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(3000), headers: { Accept: 'application/json' } });
    return { status: res.status, body: res.ok ? ((await res.json()) as ViaCepBody) : null };
  }
}

/**
 * Busca de endereço pelo CEP, feita pelo servidor: o navegador não fala com serviços de fora e
 * a resposta já vem no formato do endereço dos cadastros. Qualquer usuário logado pode consultar.
 */
@Controller('cep')
export class CepController {
  constructor(private readonly http: CepHttp) {}

  @Get(':cep')
  @Header('Cache-Control', 'private, max-age=86400')
  async lookup(@Param('cep') raw: string): Promise<CepAddress> {
    const cep = raw.replace(/\D/g, '');
    if (cep.length !== 8) throw new BadRequestException({ code: 'INVALID_CEP', message: 'O CEP tem 8 dígitos' });
    let result: Awaited<ReturnType<CepHttp['get']>>;
    try {
      result = await this.http.get(cep);
    } catch {
      throw new ServiceUnavailableException({ code: 'CEP_UNAVAILABLE', message: 'A busca de CEP não respondeu. Preencha o endereço à mão.' });
    }
    const body = result.body;
    if (result.status === 400 || (result.status === 200 && (!body || body.erro === true || body.erro === 'true'))) {
      throw new NotFoundException({ code: 'CEP_NOT_FOUND', message: 'CEP não encontrado' });
    }
    if (!body) throw new ServiceUnavailableException({ code: 'CEP_UNAVAILABLE', message: 'A busca de CEP não respondeu. Preencha o endereço à mão.' });
    return {
      zip: `${cep.slice(0, 5)}-${cep.slice(5)}`,
      street: body.logradouro ?? '',
      district: body.bairro ?? '',
      city: body.localidade ?? '',
      state: (body.uf ?? '').toUpperCase(),
      complement: body.complemento ?? '',
    };
  }
}
