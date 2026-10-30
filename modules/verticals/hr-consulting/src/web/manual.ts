import type { ManualGuide } from '@all/module-sdk/web';

/** Manual do ramo Consultoria de RH. Fica fora do arquivo principal: só é baixado quando alguém abre o manual. */
export const manual: ManualGuide = {
  title: 'Consultoria de RH',
  summary: 'Departamento pessoal das empresas atendidas: colaboradores, folha, 13º, férias, rescisão e honorários, na ordem do dia a dia.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/consultoria-rh/empresas',
      simple: [
        { text: 'Este ramo serve para a consultoria cuidar da folha de várias empresas no mesmo sistema. Cada empresa atendida tem os próprios colaboradores, folhas e honorários. Configure nesta ordem:' },
        {
          steps: [
            'Em Dados da empresa, preencha o nome, o CNPJ e o logo da consultoria.',
            'Em Usuários, dê acesso a quem vai trabalhar com você e escolha o papel de cada um.',
            'Em Contas e categorias, confira as contas onde o dinheiro da consultoria entra.',
            'Em Empresas atendidas, clique em Cadastrar empresa e cadastre a primeira empresa.',
            'Abra a empresa e configure os honorários dela.',
            'Admita ou importe os colaboradores dessa empresa.',
            'Abra a primeira folha, confira e feche.',
          ],
        },
        { tip: 'Comece com uma empresa só. Confira a primeira folha com o contador antes de fechar e só depois leve as demais.' },
        { warn: 'Folha fechada e rescisão confirmada não podem ser desfeitas pelo sistema. Confira antes de fechar.' },
      ],
      technical: [
        { text: 'O ramo (hr_consulting) depende de hr, core.customers e core.finance, que são ativados junto. O menu do ramo traz Empresas atendidas; Colaboradores e Folha de pagamento vêm do módulo RH. O Head hunter (recruiting) é contratado à parte.' },
        {
          list: [
            'hr.read: Ver colaboradores, salários e folha (dado sensível).',
            'hr.manage: Cadastrar colaboradores e férias.',
            'hr.payroll: Calcular e fechar a folha.',
            'hr_consulting.fees.manage: Configurar os honorários das empresas atendidas.',
          ],
        },
        { text: 'Papéis padrão: Gestor(a) de carteira (hr.read, hr.manage, hr.payroll, hr_consulting.fees.manage, core.team.read, core.customers.read, core.customers.write) e Analista de DP (hr.read, hr.manage, hr.payroll, core.team.read). Nenhum dos dois tem core.finance.read: quem usa só esses papéis não vê o financeiro nem o quadro Honorários lançados.' },
        { text: 'Colaboradores e folhas sem empregador são da própria consultoria: nesse caso, o fechamento lança salários e encargos no financeiro. Folhas de empresa atendida não lançam salários nem guias; só o honorário.' },
        { text: 'Os cálculos seguem as regras em modules/verticals/hr/src/contracts (payroll.ts e termination.ts) e em docs/arquitetura. Os valores devem ser conferidos pelo contador.' },
      ],
    },
    {
      id: 'cadastrar-empresa',
      title: 'Cadastrar uma empresa atendida',
      path: '/consultoria-rh/empresas',
      simple: [
        { text: 'A empresa atendida é um cliente do tipo Empresa. O cadastro serve para separar colaboradores, folhas e honorários de cada uma.' },
        {
          steps: [
            'Abra Empresas atendidas e clique em Cadastrar empresa.',
            'No campo Tipo, troque Pessoa física por Empresa.',
            'Preencha a razão social ou o nome fantasia e o CNPJ.',
            'Preencha telefone, e-mail e endereço. Ao completar o CEP, o endereço é preenchido sozinho.',
            'Clique em Salvar. A empresa passa a aparecer em Empresas atendidas.',
          ],
        },
        { warn: 'O cadastro abre como Pessoa física. Se você não trocar o Tipo, a empresa não aparece na lista de Empresas atendidas.' },
        { tip: 'Clique na linha da empresa para abrir a ficha dela: contato, honorários, colaboradores, folhas e honorários lançados ficam no mesmo lugar. A mesma visão aparece na aba RH (colaboradores e folhas) da ficha do cliente.' },
      ],
      technical: [
        { text: 'A lista vem de GET /hr/employers (hr.read): todos os clientes do tipo company não anonimizados, com colaboradores ativos (situação diferente de Desligado) e a última folha. Todo cliente do tipo Empresa aparece aqui, mesmo sem colaboradores.' },
        { text: 'O botão Cadastrar empresa exige core.customers.write e leva ao cadastro de clientes, onde o CNPJ é validado. CNPJ já cadastrado é recusado com a mensagem Já existe um cliente com este CPF/CNPJ.' },
        { text: 'O topo da lista soma as empresas com colaboradores ativos e estima os honorários do mês pelo quadro ativo. O valor lançado de fato usa os colaboradores que estão na folha fechada.' },
        { text: 'Sem o ramo ativo, GET /hr/employers responde enabled: false e as telas do RH não mostram o filtro de empresa. Cliente anonimizado deixa de poder ser empregador (Empresa empregadora não encontrada no cadastro de clientes).' },
      ],
    },
    {
      id: 'configurar-honorarios',
      title: 'Combinar os honorários da empresa',
      path: '/consultoria-rh/empresas',
      simple: [
        { text: 'Os honorários são o que a empresa atendida paga à consultoria. Configure uma vez e o sistema lança o valor a receber sempre que a folha daquela empresa é fechada.' },
        {
          steps: [
            'Abra a empresa em Empresas atendidas.',
            'No quadro Honorários, clique em Configurar (ou Editar, se já houver).',
            'Em Cobrança, escolha Por colaborador na folha, Valor fixo por folha ou Sem honorário automático.',
            'Informe o valor e o dia de vencimento, de 1 a 28 do mês seguinte.',
            'Se cobrar por rescisão, preencha Por rescisão (R$). Vazio significa que não cobra.',
            'Marque Cobrar também na folha do 13º (2ª parcela), se isso fizer parte do combinado.',
            'Clique em Salvar.',
          ],
        },
        { warn: 'A mudança vale só para as próximas folhas fechadas. O que já foi lançado não muda.' },
        { tip: 'Sem honorário configurado, fechar a folha não lança nada no financeiro.' },
      ],
      technical: [
        { text: 'Permissão: hr_consulting.fees.manage (Configurar os honorários das empresas atendidas). A rota PUT /hr-consulting/clients/:customerId grava a configuração e registra hr_consulting.fee.saved na auditoria.' },
        {
          list: [
            'Por colaborador: valor × colaboradores na folha fechada. Conta todos os que estão na folha, inclusive proporcionais e afastados.',
            'Fixo: o mesmo valor em cada folha.',
            '13º: nunca na 1ª parcela. Na 2ª, só com a opção marcada, pela mesma regra.',
            'Rescisão: valor fixo por rescisão confirmada, independente da forma de cobrança.',
          ],
        },
        { text: 'Validações: valor entre 0 e 1.000.000, com centavos; dia de 1 a 28; forma diferente de Sem honorário automático exige valor maior que zero (Informe o valor do honorário). Só cliente do tipo Empresa aceita honorário (Honorários de folha são para clientes do tipo empresa).' },
      ],
    },
    {
      id: 'admitir-colaborador',
      title: 'Admitir um colaborador',
      path: '/rh/colaboradores',
      simple: [
        { text: 'A admissão registra o contrato da pessoa com a empresa atendida. Sem ela, a pessoa não entra na folha.' },
        {
          steps: [
            'Abra Colaboradores e escolha a empresa no filtro (ou, na ficha da empresa, clique em Admitir / importar).',
            'Clique em Admitir colaborador.',
            'Confira o Empregador: é a empresa que contrata.',
            'Se a pessoa já está na equipe, clique em Escolher pessoa da equipe para aproveitar o cadastro.',
            'Preencha nome completo, CPF, cargo, admissão e salário. Os demais campos completam o cadastro.',
            'Se for contrato de experiência, preencha Fim da experiência.',
            'Para jovem aprendiz, escolha a Categoria certa.',
            'Clique em Salvar.',
          ],
        },
        { warn: 'O Empregador só muda enquanto o colaborador não entrou em nenhuma folha. Depois disso, é preciso registrar o desligamento e admitir na outra empresa.' },
        { warn: 'Colaborador admitido depois de abrir a folha do mês não entra nela sozinho. Admita antes de abrir a folha.' },
        { tip: 'A mesma pessoa pode ter um contrato em cada empresa atendida. Os dados pessoais ficam num cadastro só.' },
      ],
      technical: [
        { text: 'Permissão: hr.manage. Escolher pessoa da equipe exige também core.team.read. O filtro da tela vem do endereço (?empresa=) e preenche o Empregador da admissão; sem filtro, o padrão é Própria empresa.' },
        { text: 'Nome, CPF, nascimento, e-mail e telefone ficam na pessoa da equipe (core.team). Na admissão, se já houver uma pessoa com o mesmo CPF, ela é aproveitada e os dados dela são atualizados. Empresa atendida não mexe em Início na empresa nem em Data de encerramento da pessoa; isso vale só para contrato da própria empresa.' },
        {
          list: [
            'CPF com 11 dígitos; salário maior que zero; jornada de 1 a 44 horas; dependentes de 0 a 20.',
            'Um contrato por pessoa e empregador: Já existe um colaborador com este CPF nesta empresa.',
            'Fim da experiência antes da admissão é recusado.',
            'Troca de empregador com folha registrada: EMPLOYER_LOCKED.',
            'Aprendiz recolhe FGTS de 2%; os demais, 8%, pelas tabelas configuradas.',
          ],
        },
        { warn: 'O campo Situação da edição aceita Desligado com data, mas isso não gera termo de rescisão e tira a pessoa do 13º do ano, e o botão Rescindir some. Para desligar, use Rescindir. A situação Afastado também é manual: registrar um afastamento não a altera.' },
      ],
    },
    {
      id: 'importar-colaboradores',
      title: 'Importar colaboradores por planilha',
      path: '/rh/colaboradores',
      simple: [
        { text: 'Ao receber uma empresa nova, use a planilha para cadastrar todo o quadro de uma vez.' },
        {
          steps: [
            'Em Colaboradores, escolha a empresa no filtro.',
            'Clique em Baixar modelo e preencha uma linha por colaborador.',
            'Clique em Importar planilha e depois em Escolher planilha.',
            'Veja a prévia: as linhas prontas e as que têm problema.',
            'Clique em Importar e não feche a tela até terminar.',
            'Se alguma linha não entrar, clique em Baixar linhas com erro, corrija e importe só essas de novo.',
          ],
        },
        { warn: 'Se a coluna Empresa estiver vazia e o filtro estiver em Todas as empresas, o colaborador entra como da própria consultoria. Sempre escolha a empresa antes ou preencha a coluna.' },
        { tip: 'Jovem aprendiz e Fim da experiência não estão na planilha. Ajuste esses colaboradores depois, em Editar.' },
      ],
      technical: [
        { text: 'Permissão: hr.manage. Cada linha vai para a mesma rota da admissão manual, com as mesmas validações. Aceita .xlsx, .xls e .csv.' },
        { text: 'Colunas: Nome completo, CPF, Empresa (CNPJ ou nome), Nascimento, Cargo, Setor, Admissão, Salário (R$), Jornada semanal (h), Dependentes para IR, E-mail, Telefone, Chave Pix (salário) e Observações. Obrigatórias: Nome completo, CPF, Cargo, Admissão e Salário.' },
        { text: 'A coluna Empresa aceita o CNPJ, com ou sem pontuação, ou o nome exato do cliente, sem diferenciar maiúsculas e acentos. Própria empresa também é aceito. Nome repetido em dois clientes é recusado e pede o CNPJ. Empresa não encontrada: a linha volta com erro.' },
        { text: 'CPF sem os zeros à esquerda, como o Excel costuma guardar, é completado. Importar de novo a mesma linha é recusado pelo CPF no mesmo empregador.' },
      ],
    },
    {
      id: 'registrar-afastamento',
      title: 'Registrar um afastamento',
      path: '/rh/colaboradores',
      simple: [
        { text: 'Registre o afastamento para a folha descontar os dias certos. Há dois tipos: Doença (atestado/auxílio) e Licença-maternidade.' },
        {
          steps: [
            'Abra o colaborador.',
            'No quadro Afastamentos, clique em Registrar afastamento.',
            'Escolha o tipo e informe o início e o fim. Na licença-maternidade, fim vazio significa 120 dias.',
            'Clique em Registrar.',
            'Se a folha do mês já estiver aberta, volte a ela e clique em Recalcular.',
          ],
        },
        { warn: 'Se a folha já foi fechada, o afastamento novo não muda o que foi fechado.' },
      ],
      technical: [
        { text: 'Permissão: hr.manage. Doença: os primeiros 15 dias, conforme a configuração, são pagos como salário; os seguintes saem da folha como dias do INSS e não contam para os avos do 13º. Maternidade: os dias são pagos à parte como salário-maternidade, com aviso informativo na folha sobre a dedução na DCTFWeb.' },
        { list: ['Recusas: colaborador desligado, início antes da admissão, datas sobrepostas (Já há afastamento nestas datas).', 'Doença exige data de fim. Empresa Cidadã (180 dias) deve ser informada no campo de fim.', 'Excluir não confere se o período já está em folha fechada.'] },
        { text: 'Simplificação do cálculo: atestados da mesma doença dentro de 60 dias não são somados. Registrar afastamento não muda a Situação do colaborador, e o filtro Afastados da lista depende desse campo. Os valores devem ser conferidos pelo contador.' },
      ],
    },
    {
      id: 'marcar-ferias',
      title: 'Marcar férias',
      path: '/rh/colaboradores',
      simple: [
        { text: 'Marque as férias para saber o valor, o prazo de pagamento e para a folha do mês considerar os dias. A coluna Férias da lista avisa quem tem saldo e quem está com férias vencidas.' },
        {
          steps: [
            'Abra o colaborador.',
            'No quadro Períodos aquisitivos, clique em Marcar férias na linha do período.',
            'Informe o início, os dias e, se houver, os dias vendidos.',
            'Confira o valor a pagar, mostrado na tela, e clique em Marcar.',
          ],
        },
        { warn: 'Colaborador de empresa atendida: quem paga as férias é a empresa, e nada entra no financeiro da consultoria. Avise a empresa do valor e da data.' },
        { tip: 'Férias marcadas podem ser canceladas em Férias marcadas até a véspera do início.' },
      ],
      technical: [
        { text: 'Permissão: hr.manage. O botão só aparece em período completo com pelo menos 5 dias de saldo.' },
        {
          list: [
            'O sistema confere: mínimo de 5 dias, máximo de 30; até 10 dias vendidos; saldo do período; abono uma vez por período; datas sem sobreposição; colaborador não desligado.',
            'Valor: salário ÷ 30 × dias × 4/3, mais os dias vendidos × 4/3. Usa só o salário do cadastro.',
            'Pagamento até 2 dias antes do início.',
            'Próprio contrato da consultoria: gera despesa em aberto em Salários e encargos. Empresa atendida: não gera lançamento.',
            'Férias já iniciadas não podem ser canceladas.',
          ],
        },
        { text: 'Simplificações: o recibo de férias não retém INSS nem IRRF; na folha do mês, os dias saem do salário e o valor entra na base do INSS e do FGTS e é abatido. Não há outra regra de fracionamento além do mínimo de 5 dias. Os valores devem ser conferidos pelo contador.' },
      ],
    },
    {
      id: 'conferir-folha',
      title: 'Abrir e conferir a folha do mês',
      path: '/rh/folha',
      simple: [
        { text: 'A folha calcula o salário de cada colaborador da empresa no mês. Enquanto está Em aberto, você pode lançar horas extras, faltas e comissões.' },
        {
          steps: [
            'Abra Folha de pagamento e escolha a empresa no filtro.',
            'Escolha o mês no campo ao lado de Abrir folha.',
            'No campo numérico, informe quantos feriados em dias úteis o mês teve.',
            'Clique em Abrir folha.',
            'Em cada colaborador, clique em Lançamentos para informar horas extras, comissões, faltas, outros proventos e outros descontos. Clique em Recalcular para gravar.',
            'Clique em Holerite para conferir o resultado de cada pessoa.',
          ],
        },
        { warn: 'O sistema só permite abrir a folha com uma empresa escolhida. Com Todas as empresas no filtro, o botão fica bloqueado.' },
        { warn: 'Mudou o salário, os dependentes ou admitiu alguém depois de abrir? A folha aberta não pega essas mudanças. Só afastamentos, férias e feriados entram ao clicar em Recalcular.' },
        { tip: 'Na ficha da empresa, o botão Abrir folha / 13º já leva à tela com a empresa escolhida.' },
      ],
      technical: [
        { text: 'Permissões: hr.read para ver, hr.payroll para abrir, lançar e recalcular. Uma folha por mês e empregador (A folha deste mês já existe para esta empresa). Sem colaboradores no mês, abrir é recusado. Não há rota para excluir folha aberta nem para incluir ou remover um colaborador dela.' },
        {
          list: [
            'Entra quem foi admitido até o fim do mês e não tem desligamento antes do início, exceto quem tem termo de rescisão até o fim do mês.',
            'Salário: salário ÷ 30 × dias pagos, com mês cheio igual a 30.',
            'Hora: salário ÷ (jornada semanal × 5). Extras a 50% e 100%.',
            'DSR simplificado: (extras + comissões) ÷ dias úteis × (domingos + feriados). Sábado conta como dia útil.',
            'Faltas: salário ÷ 30 × (faltas + DSR perdidos).',
            'INSS progressivo; IRRF com dependentes ou desconto simplificado, o que for maior, e a redução da Lei 15.270/2025; FGTS sobre o bruto.',
            'Descontos maiores que os proventos são recusados (Os descontos passam do salário).',
          ],
        },
        { text: 'A folha guarda uma cópia das tabelas ao abrir; o rótulo aparece no cabeçalho. Tabelas padrão: INSS 2026 (Portaria Interministerial MPS/MF 13/2026), IRRF maio/2025 e redução da Lei 15.270/2025. Em Configurações › Tabelas da folha (core.access.settings) é possível alterar as tabelas e o dia de pagamento. Na folha mensal aberta, Usar tabelas atuais troca a cópia e recalcula. Confira se a tabela é a vigente.' },
        { text: 'Os valores devem ser conferidos pelo contador. A regra de cada cálculo está em contracts/payroll.ts e em docs/arquitetura. O sistema não gera guias, eSocial nem arquivos oficiais.' },
      ],
    },
    {
      id: 'fechar-folha',
      title: 'Fechar a folha e entregar o resumo',
      path: '/rh/folha',
      simple: [
        { text: 'Fechar trava a folha e lança o seu honorário. Depois, você entrega à empresa o resumo com o que ela precisa pagar.' },
        {
          steps: [
            'Confira os totais e os holerites da folha.',
            'Clique em Fechar folha.',
            'Clique em Resumo para a empresa e em Imprimir. O resumo traz os colaboradores, os totais e os vencimentos.',
            'Em cada colaborador, clique em Holerite e em Imprimir, para a assinatura.',
          ],
        },
        { warn: 'Não há como reabrir folha fechada pelo sistema, e o honorário lançado não pode ser cancelado na tela. Mostre os valores ao contador antes de fechar.' },
        { tip: 'O Resumo para a empresa também pode ser impresso antes do fechamento. Nesse caso, sai como prévia.' },
        { warn: 'O sistema só imprime: não envia o resumo nem os holerites por e-mail ou WhatsApp, e um holerite é impresso de cada vez.' },
      ],
      technical: [
        { text: 'Permissão: hr.payroll. Fechar grava a data, quem fechou e o evento hr.payroll.closed na auditoria. Folha fechada recusa alterações (Folha fechada não pode ser alterada).' },
        { text: 'Empresa atendida: salários, INSS, IRRF e FGTS não entram no financeiro da consultoria. O fechamento registra a linha do tempo do cliente e, se houver honorário, cria uma receita em aberto com vencimento no dia configurado do mês seguinte à competência, categoria Serviços, com baixa pelo financeiro.' },
        {
          list: [
            'Própria empresa, folha mensal: salários no dia de pagamento configurado do mês seguinte (padrão: dia 5, dia do mês e não dia útil); INSS + IRRF e FGTS no dia 20 do mês seguinte.',
            'Própria empresa, 13º 1ª parcela: líquido em 30/11; FGTS em 20/12.',
            'Própria empresa, 13º 2ª parcela: líquido e INSS em 20/12; IRRF e FGTS em 20/01 do ano seguinte.',
          ],
        },
        { text: 'O resumo lista os vencimentos que o sistema calcula: líquido até o 5º dia útil do mês seguinte e INSS, IRRF e FGTS no dia 20. São referência: os valores e prazos devem ser conferidos pelo contador. O Resumo para a empresa existe em folhas de empresa atendida com pelo menos um colaborador.' },
      ],
    },
    {
      id: 'calcular-13',
      title: 'Calcular o 13º salário',
      path: '/rh/folha',
      simple: [
        { text: 'O 13º é uma folha separada, em duas parcelas, para cada empresa.' },
        {
          steps: [
            'Em Folha de pagamento, escolha a empresa no filtro.',
            'Clique em Calcular 13º.',
            'Informe o ano e a parcela: 1ª (adiantamento, até 30/11) ou 2ª (até 20/12).',
            'Clique em Calcular.',
            'Em cada colaborador, clique em Ajustar se precisar corrigir os avos (os meses que contam) ou a média, e depois em Recalcular.',
            'Confira e clique em Fechar folha.',
          ],
        },
        { warn: 'Feche a 1ª parcela antes de calcular a 2ª. Sem a 1ª fechada, a 2ª não desconta adiantamento nenhum.' },
        { tip: 'Quem foi desligado no ano recebe o 13º no termo de rescisão e não entra nesta folha.' },
      ],
      technical: [
        { text: 'Permissão: hr.payroll. Uma folha por parcela, ano e empregador. Com a 1ª parcela ainda em aberto, a 2ª é recusada (Feche a folha da 1ª parcela antes de calcular a 2ª); se a 1ª nem existir, o cálculo segue sem adiantamento.' },
        {
          list: [
            'Avos: mês com 15 dias ou mais de trabalho conta; dias pagos pelo INSS não contam; maternidade conta. Na 1ª parcela, projetados até dezembro.',
            '1ª parcela: metade de (salário + média das variáveis) ÷ 12 × avos, sem INSS nem IRRF; FGTS sobre o valor.',
            '2ª parcela: 13º integral com INSS e IRRF em separado, menos a 1ª parcela; FGTS sobre a diferença.',
            'Médias: horas extras, comissões e DSR das folhas mensais fechadas do ano, até outubro na 1ª e até novembro na 2ª.',
            'Honorário: só na 2ª parcela e com a opção marcada.',
          ],
        },
        { text: 'Simplificações: não desconta o avo de meses com mais de 15 faltas; a diferença das variáveis de dezembro fica para um ajuste manual; desligado pela edição da Situação também fica de fora, sem termo. Folha de 13º não usa Recalcular: o ajuste é por colaborador. Os valores devem ser conferidos pelo contador.' },
      ],
    },
    {
      id: 'fazer-rescisao',
      title: 'Fazer uma rescisão',
      path: '/rh/colaboradores',
      simple: [
        { text: 'A rescisão calcula o que o colaborador recebe ao sair e registra o termo. Primeiro você vê uma prévia; só depois confirma.' },
        {
          steps: [
            'Abra o colaborador e clique em Rescindir.',
            'Escolha o Tipo de rescisão, o Último dia trabalhado e o Aviso prévio.',
            'Confira o Último salário. Se tiver, informe a média das variáveis e os outros valores.',
            'No Saldo do FGTS, informe o valor do extrato da Caixa.',
            'Clique em Calcular prévia e leia os avisos e as verbas.',
            'Mostre a prévia ao contador. Com tudo certo, clique em Confirmar rescisão.',
            'Depois, clique em Termo de rescisão e em Imprimir.',
          ],
        },
        { warn: 'Confirmar não tem volta: o colaborador fica como Desligado e o termo não pode ser refeito pelo sistema.' },
        { warn: 'O termo é um documento de conferência. Ele não substitui o TRCT oficial nem os eventos do eSocial.' },
      ],
      technical: [
        { text: 'Permissões: hr.payroll para calcular e confirmar, hr.read para ver o termo. Tipos: Dispensa sem justa causa, Pedido de demissão, Dispensa por justa causa, Término do contrato de experiência e Acordo entre as partes (art. 484-A). As formas de aviso mudam conforme o tipo.' },
        {
          list: [
            'Ao confirmar: o termo entra na folha Rescisões da competência da saída e o colaborador sai das folhas em aberto a partir daquele mês.',
            'Férias marcadas para depois da saída são canceladas e os dias voltam como férias indenizadas.',
            'Empresa atendida: nada entra no financeiro da consultoria; a linha do tempo do cliente registra a rescisão e o honorário por rescisão, se houver, vira receita em aberto.',
            'Própria empresa: líquido e guia do FGTS em até 10 dias, INSS + IRRF no dia 20 do mês seguinte; a pessoa ganha Data de encerramento na equipe.',
            'Saldo de salário já pago em folha mensal fechada não entra de novo no termo.',
            'Média das variáveis vazia: folhas mensais fechadas dos 12 meses anteriores à saída.',
          ],
        },
        { text: 'Saldo do FGTS vazio é estimado pela soma das folhas registradas, sem juros, correção e depósitos de antes do sistema, e o termo avisa. A multa é de 40% sem justa causa e 20% no acordo, sobre saldo + depósito rescisório. Colaborador com rescisão já registrada é recusado (Este colaborador já tem rescisão registrada).' },
        { text: 'A rescisão usa as tabelas atuais da configuração. Simplificações: INSS do saldo calculado sem somar a folha do mês; contribuições patronais fora; compensação limitada do art. 477 só gera aviso. Os valores devem ser conferidos pelo contador; a regra está em contracts/termination.ts e em docs/arquitetura.' },
      ],
    },
    {
      id: 'receber-honorarios',
      title: 'Receber os honorários',
      path: '/financeiro/lancamentos',
      simple: [
        { text: 'Quando a empresa paga, registre o recebimento. Assim o caixa da consultoria fica certo e o honorário sai do que está a receber.' },
        {
          steps: [
            'Abra Lançamentos, no grupo Financeiro.',
            'Use a busca: digite Honorários ou o nome da empresa.',
            'Na linha do honorário pago, clique em Baixar.',
            'Informe a data e a conta em que o dinheiro entrou.',
            'Clique em Confirmar.',
          ],
        },
        { tip: 'Na ficha da empresa, o quadro Honorários lançados mostra o que está A receber e o que já foi Recebido.' },
        { warn: 'Honorário lançado errado não pode ser cancelado nem editado na tela de Lançamentos. Fale com quem administra o sistema antes de dar baixa.' },
      ],
      technical: [
        { text: 'Dar baixa exige core.finance.write; ver a lista e o quadro Honorários lançados exige core.finance.read. O papel Gestor(a) de carteira tem as duas; o Analista de DP, não.' },
        { text: 'Os lançamentos vêm com a origem hrc_fee, marcados para baixa no financeiro. A origem aparece como esse código na segunda linha da descrição. Cancelar é recusado para lançamento de módulo (Este valor é controlado por outro módulo: cancele por lá), e o ramo não tem rota de cancelamento.' },
        { text: 'A descrição traz a folha e a empresa e, por colaborador, a conta (quantidade × valor). O honorário vinculado ao cliente, ao ser baixado, entra na Segmentação de clientes.' },
      ],
    },
    {
      id: 'abrir-vaga',
      title: 'Abrir uma vaga para a empresa atendida',
      path: '/recrutamento/vagas',
      simple: [
        { text: 'Se a consultoria contratou o módulo Head hunter, ela recruta pelas mesmas telas: a vaga fica ligada à empresa contratante e recebe candidaturas por uma página pública. Sem o módulo, o dono pode contratá-lo na página inicial.' },
        {
          steps: [
            'Em Vagas, clique em Nova vaga.',
            'Em Contratante, escolha a empresa atendida. Para esconder o nome dela, marque Vaga confidencial.',
            'Preencha título, descrição, requisitos, remuneração, etapas e perguntas.',
            'Clique em Salvar. A vaga nasce como rascunho.',
            'Na página da vaga, clique em Abrir vaga.',
            'Copie o link da Página de candidatura e divulgue.',
          ],
        },
        { tip: 'Os requisitos obrigatórios pesam mais na nota de aderência. Escreva um por item.' },
        { warn: 'Não pergunte idade, estado civil, religião ou outros dados sensíveis.' },
      ],
      technical: [
        { text: 'Permissões: recruiting.jobs.read (Ver vagas e o funil de candidatos) e recruiting.jobs.manage (Criar, editar, publicar e encerrar vagas). Configurações em Head hunter, grupo Configurações, com core.access.settings. Contratante precisa ser cliente do tipo Empresa.' },
        { list: ['Situações: Rascunho, Aberta, Pausada, Encerrada. Só a aberta aparece na página pública (/vagas/<endereço da empresa>) e no feed do Indeed.', 'O feed do Indeed precisa ser cadastrado com o Indeed. O endereço aparece nas configurações.', 'LinkedIn: não há integração direta; a vaga chega pela Gupy ou pelo link e pelo texto pronto da página da vaga.', 'Gupy: Sem Gupy, API da Gupy (token e ids) ou Simulado, que só marca como publicada. Erros aparecem na vaga.', 'Etapa com candidatura não pode ser removida (Mova-as antes de remover a etapa).'] },
      ],
    },
    {
      id: 'candidato-admissao',
      title: 'Da candidatura à admissão',
      path: '/recrutamento/candidatos',
      simple: [
        { text: 'As candidaturas da página pública entram sozinhas na primeira etapa da vaga e no Banco de talentos. Você move cada pessoa pelas etapas até a contratação.' },
        {
          steps: [
            'Abra a vaga e veja os candidatos em Quadro ou Lista. Para incluir alguém de fora, clique em Incluir candidato.',
            'Arraste o candidato de etapa ou reprove informando o motivo.',
            'Clique no nome para ver o currículo, a nota, as respostas e fazer anotações.',
            'Ao aprovar, mova para a etapa Contratado.',
            'Abra a candidatura e clique em Cadastrar na equipe e admitir.',
            'Na admissão, escolha o Empregador, informe o CPF e os dados do contrato e clique em Salvar.',
          ],
        },
        { warn: 'A admissão abre com Própria empresa no Empregador, mesmo em vaga de empresa atendida. Troque para a empresa contratante antes de salvar.' },
        { tip: 'A nota ajuda a organizar a triagem, mas a decisão é sua. Confira o currículo antes de decidir.' },
      ],
      technical: [
        { list: ['recruiting.candidates.read: Ver candidatos, currículos e notas (dado pessoal).', 'recruiting.candidates.manage: Cadastrar candidatos, mover no funil, anotar, reprovar e contratar.', 'recruiting.candidates.privacy: Exportar e excluir dados de candidatos (LGPD). Não está nos papéis padrão Recrutador e Visualizador de recrutamento.', 'Para seguir até a admissão, o usuário precisa também de hr.read e hr.manage, e de core.team.read para a pessoa vir escolhida.'] },
        { text: 'Cadastrar na equipe cria a pessoa com nome, contato, LinkedIn e currículo, sem CPF, e segue para /rh/colaboradores. Repetir devolve a mesma pessoa. Candidato já contratado e cadastrado na equipe não pode ser reprovado. Na admissão, CPF já usado por outra pessoa da equipe é recusado (Este CPF já é de ..., da equipe).' },
        { text: 'Nota: IA (Anthropic) quando o servidor tem a chave; sem ela, ou com a opção de estimativa, comparação por palavras-chave, marcada como estimativa. Verde a partir de 75, amarelo a partir de 50. A IA lê o currículo em PDF e as respostas; nome, e-mail e telefone não vão no texto enviado.' },
        { text: 'Página pública: currículo em PDF de até 5 MB, com consentimento registrado; até 5 candidaturas por IP por hora e por e-mail por dia. Guarda: 12 meses depois da última candidatura, por padrão (de 1 a 60); vencido o prazo, quem não está em processo é anonimizado automaticamente. Cada e-mail é um candidato só.' },
      ],
    },
  ],
};
