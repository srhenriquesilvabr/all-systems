import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Escritório de contabilidade',
  summary: 'Carteira de empresas, calendário de obrigações e honorários mensais do escritório.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      simple: [
        { text: 'O sistema monta o calendário de obrigações de cada empresa a partir de três informações: o regime tributário, se ela tem funcionários e o catálogo de obrigações. Por isso, a ordem abaixo importa.' },
        {
          steps: [
            'Em Configurações, abra Usuários e convide a equipe. Dê a cada pessoa o papel certo: "Analista contábil / fiscal" ou "Sócio(a) / gestor(a)".',
            'Abra Obrigações e clique em "Catálogo". Confira o dia de vencimento de cada obrigação e desligue o que o escritório não acompanha.',
            'Abra Clientes e cadastre as empresas atendidas.',
            'Abra Carteira de empresas e clique em "Adicionar empresa" para cada uma, ou use "Importar planilha".',
            'Volte em Obrigações: o calendário das empresas já aparece.',
          ],
        },
        { warn: 'Os prazos do catálogo são um ponto de partida. Eles mudam com a legislação e alguns são municipais ou estaduais. Confira antes de confiar neles.' },
      ],
      technical: [
        { text: 'Ao ativar o módulo, o catálogo padrão é criado para a empresa. Veja o conteúdo em "Conferir o catálogo de obrigações".' },
        {
          list: [
            'Papel "Analista contábil / fiscal": accounting.read (Ver carteira e obrigações), accounting.work (Dar baixa nas obrigações), core.customers.read.',
            'Papel "Sócio(a) / gestor(a)": os anteriores, accounting.manage (Cadastrar empresas, honorários e o catálogo de obrigações) e core.customers.write.',
            'Nenhum desses papéis traz permissão do financeiro. Para dar baixa em honorários, inclua core.finance.write (Lançar, dar baixa e cancelar lançamentos) no papel da pessoa.',
          ],
        },
        { text: 'Limite do módulo: ele organiza prazos e cobranças internas. Não calcula imposto, não gera guia, não transmite declaração e não fala com a Receita ou prefeituras. Também não cobre a escrituração. O menu Caixa (PDV) e Vendas pertence a outro módulo e não interfere nos honorários.' },
      ],
    },
    {
      id: 'adicionar-empresa',
      title: 'Adicionar uma empresa à carteira',
      path: '/contabil/empresas',
      simple: [
        { text: 'A carteira é a lista de empresas que o escritório atende. Cada empresa colocada aqui passa a ter obrigações e, se você informar um valor, honorário mensal.' },
        {
          steps: [
            'Clique em "Adicionar empresa".',
            'Busque a empresa pelo nome, CPF/CNPJ ou telefone. Se ela não existir, use o link "Cadastrar cliente" e depois volte.',
            'Escolha o Regime tributário.',
            'Informe o CNAE principal, o Honorário mensal e o dia de vencimento do honorário.',
            'Escolha o Responsável: é quem recebe os avisos de prazo dessa empresa.',
            'Marque "Tem funcionários" se a empresa tiver folha.',
            'Clique em "Salvar".',
          ],
        },
        { tip: 'Exemplo: uma padaria do Simples Nacional com dois funcionários recebe, por mês, DAS, DCTFWeb, eSocial e FGTS Digital. Sem marcar "Tem funcionários", o único mensal é o DAS. A DEFIS, anual, vale nos dois casos.' },
        { warn: 'Se a empresa mudar de regime, edite aqui. As obrigações novas passam a ser geradas, mas as que já estavam a fazer continuam na lista. Use "Dispensar" nas que não valem mais.' },
      ],
      technical: [
        { text: 'Permissão: accounting.manage. A empresa precisa existir em Clientes e não pode estar anonimizada. Cada cliente entra uma vez só na carteira; repetir devolve "Esta empresa já está na carteira". O vínculo com o cliente não muda depois de criado.' },
        {
          list: [
            'Vencimento do honorário: dia de 1 a 28.',
            'Honorário igual a zero: sem cobrança recorrente.',
            'Salvar gera na hora as obrigações do período atual dessa empresa. O honorário não: ele sai na rotina diária ou em "Gerar agora".',
            'Desmarcar "Ativa na carteira" interrompe novas obrigações e honorários. O que já foi gerado permanece.',
            'Mudar o regime não apaga obrigações em aberto.',
          ],
        },
      ],
    },
    {
      id: 'importar-carteira',
      title: 'Importar a carteira por planilha',
      path: '/contabil/empresas',
      simple: [
        { text: 'Use a importação quando o escritório já tem muitas empresas e digitar uma a uma levaria tempo.' },
        {
          steps: [
            'Confira se as empresas já estão em Clientes. A importação não cria clientes.',
            'Em Carteira de empresas, clique em "Baixar modelo" e preencha a planilha.',
            'Clique em "Importar planilha" e escolha o arquivo.',
            'Confira a prévia e clique para importar as linhas válidas.',
            'Corrija as linhas recusadas e importe de novo só essas.',
          ],
        },
        { tip: 'Na coluna Empresa, prefira o CNPJ. Ele evita confusão entre nomes parecidos.' },
      ],
      technical: [
        { text: 'Cada linha válida usa a mesma rota do cadastro manual, com as mesmas regras e a permissão accounting.manage. Colunas obrigatórias: Empresa e Regime tributário.' },
        {
          list: [
            'Empresa: CNPJ ou o nome exatamente como em Clientes. Não encontrada: "cadastre antes de importar". Nome repetido: pede o CNPJ.',
            'Responsável: nome igual ao do usuário na equipe. Nome ausente ou repetido recusa a linha.',
            'Vazios: honorário sem cobrança recorrente, vencimento dia 10, sem funcionários, ativa na carteira.',
            'Empresa que já está na carteira é recusada; a importação não atualiza cadastros existentes.',
          ],
        },
      ],
    },
    {
      id: 'catalogo',
      title: 'Conferir o catálogo de obrigações',
      path: '/contabil/obrigacoes',
      simple: [
        { text: 'O catálogo é a lista de obrigações que o sistema sabe gerar. Ajuste aqui o dia de vencimento e desligue o que o escritório não acompanha.' },
        {
          steps: [
            'Em Obrigações, clique em "Catálogo".',
            'Altere o dia ao lado da obrigação e clique fora do campo para salvar.',
            'Desmarque "Ativa" no que não deve mais ser gerado.',
          ],
        },
        { warn: 'A mudança vale só para as próximas gerações. O que já foi gerado continua com o prazo antigo.' },
      ],
      technical: [
        { text: 'Permissão: accounting.manage. A tela edita o dia e a situação ativa. Criar obrigação nova, mudar regimes, periodicidade ou o mês de vencimento das anuais não tem tela hoje. Dia maior que o último do mês cai no último dia.' },
        { text: 'Catálogo padrão. Os prazos são referência do sistema, não orientação fiscal:' },
        {
          list: [
            'DAS: Simples e MEI, mensal, dia 20.',
            'DCTFWeb: Simples, Presumido e Real com funcionários, mensal, dia 15.',
            'eSocial (folha): todos os regimes com funcionários, mensal, dia 15.',
            'FGTS Digital: todos os regimes com funcionários, mensal, dia 20.',
            'EFD-Reinf: Presumido e Real, mensal, dia 15.',
            'PIS/COFINS (DARF): Presumido e Real, mensal, dia 25.',
            'ISS (municipal): Presumido e Real, mensal, dia 10.',
            'IRPJ/CSLL trimestral: Presumido e Real, dia 31 do mês seguinte ao trimestre.',
            'DEFIS: Simples, anual, 31 de março.',
            'DASN-SIMEI: MEI, anual, 31 de maio.',
            'ECD: Presumido e Real, anual, 30 de junho.',
            'ECF: Presumido e Real, anual, 31 de julho.',
          ],
        },
      ],
    },
    {
      id: 'dar-baixa',
      title: 'Trabalhar as obrigações do mês',
      path: '/contabil/obrigacoes',
      simple: [
        { text: 'Esta é a tela de todo dia. Ela mostra o que precisa ser entregue, agrupado pela data de vencimento. Atrasos aparecem em vermelho.' },
        {
          steps: [
            'Abra Obrigações. A tela já começa no mês atual, mostrando "A fazer".',
            'Use as setas para mudar de mês.',
            'Quando entregar a obrigação ao órgão, clique em "Entregue".',
            'Se ela não se aplica naquele mês, clique em "Dispensar".',
            'Errou? Mude o filtro para "Entregues" ou "Dispensadas" e clique em "Reabrir".',
          ],
        },
        { warn: '"Entregue" é só uma anotação interna. O sistema não envia nada ao governo: a entrega é feita por você no sistema do órgão.' },
      ],
      technical: [
        { text: 'Permissão para ver: accounting.read. Para mudar a situação: accounting.work (Dar baixa nas obrigações).' },
        {
          list: [
            'Situações: A fazer, Entregue, Dispensada. Qualquer uma pode voltar para A fazer pelo "Reabrir".',
            'Entregue e Dispensada gravam quem fez e quando. A tela mostra "por" e o nome da pessoa. Cada mudança vai para a auditoria.',
            'O filtro de mês usa a data de vencimento, não a competência.',
            'Competência: "2026-09" (mensal), "2026-T3" (trimestral) e "2026" (anual).',
            'A obrigação não tem campo para anexar comprovante, guia ou recibo. Lista limitada a 2000 linhas.',
          ],
        },
      ],
    },
    {
      id: 'geracao-e-avisos',
      title: 'Entender a geração automática e os avisos',
      path: '/contabil/obrigacoes',
      simple: [
        { text: 'Você não precisa criar obrigações à mão. O sistema gera sozinho, uma vez por dia, e avisa por e-mail quando um prazo está chegando.' },
        { text: 'O aviso chega três dias antes do vencimento, para o responsável pela empresa. Se a empresa não tem responsável, todos do escritório recebem. Cada obrigação é avisada uma vez.' },
        { tip: 'Se cadastrou empresas agora ou mudou o catálogo, clique em "Gerar agora" para ver o resultado sem esperar.' },
        { warn: 'Empresa sem responsável enche a caixa de entrada de toda a equipe. Vale definir um responsável para cada uma.' },
      ],
      technical: [
        { text: 'A rotina accounting.daily roda a cada 24 horas para cada empresa com o módulo ativo: gera obrigações, lança honorários e coleta os avisos. "Gerar agora" exige accounting.manage e faz a geração e os honorários, sem enviar avisos. A geração é idempotente: rodar de novo não duplica.' },
        {
          list: [
            'Mensal: gera a competência anterior (vence neste mês) e a atual (vence no próximo).',
            'Trimestral: gera o trimestre anterior.',
            'Anual: gera o ano anterior.',
            'Considera empresas ativas, obrigações ativas, regime e, quando exigido, se tem funcionários.',
            'Competências mais antigas não são criadas retroativamente: uma empresa nova começa pelo período atual.',
            'Aviso: e-mail único por pessoa, listando todas as obrigações dela. Vale para obrigações A fazer que vencem em até 3 dias, inclusive as já vencidas e ainda não avisadas.',
            'O prazo de 3 dias é fixo. "Reabrir" não dispara novo aviso. Não há aviso ao cliente nem por WhatsApp.',
          ],
        },
      ],
    },
    {
      id: 'honorarios',
      title: 'Cobrar os honorários mensais',
      path: '/contabil/empresas',
      simple: [
        { text: 'Todo mês, o sistema lança o honorário de cada empresa como um valor a receber no financeiro. Assim, o escritório vê quem pagou e quem está devendo.' },
        {
          steps: [
            'Informe o Honorário mensal e o dia de vencimento em cada empresa da carteira.',
            'O lançamento aparece sozinho em Financeiro, Lançamentos.',
            'Quando o cliente pagar, dê baixa lá no Financeiro.',
          ],
        },
        { warn: 'Mudar o valor do honorário só afeta os próximos meses. O lançamento já feito precisa ser ajustado no Financeiro.' },
        { tip: 'O topo da Carteira de empresas mostra quantas empresas estão ativas e o total de honorários por mês.' },
      ],
      technical: [
        { text: 'A rotina diária lança uma receita em aberto, categoria de serviços, descrição "Honorários contábeis MM/AAAA", ligada ao cliente. Há uma por empresa e competência; repetir não duplica. A baixa é feita no financeiro (core.finance.write).' },
        {
          list: [
            'Só para empresa ativa com honorário maior que zero.',
            'A competência é o mês corrente e o vencimento é o dia informado nesse mês. Empresa adicionada depois do dia de vencimento recebe um lançamento já vencido no primeiro mês.',
            'Desativar a empresa não cancela lançamentos já feitos.',
            'Não há reajuste automático de honorário, emissão de boleto ou de nota fiscal por este módulo, nem aviso de cobrança ao cliente.',
          ],
        },
      ],
    },
    {
      id: 'acompanhar-empresa',
      title: 'Acompanhar uma empresa',
      path: '/contabil/empresas',
      simple: [
        { text: 'Use a carteira para ver rapidamente quais empresas precisam de atenção, e a ficha do cliente para ver o histórico de uma delas.' },
        {
          list: [
            'Selo vermelho "atrasada(s)": há obrigação vencida sem baixa.',
            'Selo amarelo "a fazer": há obrigação em aberto, ainda no prazo.',
            'Selo verde "Em dia": nada pendente.',
          ],
        },
        {
          steps: [
            'Para o histórico, abra Clientes e entre na empresa.',
            'Clique na aba "Contabilidade".',
            'Veja vencimento, obrigação, competência e situação.',
          ],
        },
      ],
      technical: [
        { text: 'Carteira e aba exigem accounting.read; a aba só aparece com essa permissão. Empresa fora da carteira mostra "Esta empresa não está na carteira contábil". A aba é só de leitura: a baixa é feita em Obrigações.' },
        { text: 'A contagem de atrasadas considera obrigações A fazer com vencimento anterior a hoje, no fuso de São Paulo. A carteira não tem busca nem filtro por responsável, regime ou situação.' },
      ],
    },
  ],
};
