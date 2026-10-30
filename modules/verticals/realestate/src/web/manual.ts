import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Imobiliária',
  summary: 'Captação de imóveis, visitas, propostas de compra com financiamento e administração de aluguéis.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      simple: [
        { text: 'Deixe a imobiliária pronta nesta ordem. Os proprietários precisam estar em Clientes antes da captação dos imóveis.' },
        {
          steps: [
            'Em Configurações, abra Dados da empresa e preencha nome e logo.',
            'Abra Usuários e convide a equipe, com o papel "Corretor(a)" ou "Gerente / captação".',
            'Abra Bancos e financeiras e confira as instituições do financiamento.',
            'Abra Clientes e cadastre os proprietários.',
            'Abra Imóveis e capte a carteira.',
            'Se a imobiliária faz visitas com horário, confira os corretores em Profissionais e horários.',
            'Em Locações, ajuste os prazos em "Configurações da locação".',
          ],
        },
        { warn: 'Os bancos que vêm prontos são de demonstração. Enquanto não trocar por uma instituição real, nenhuma proposta chega a um banco de verdade.' },
      ],
      technical: [
        {
          list: [
            'Papel "Corretor(a)": real_estate.properties.read, real_estate.deals.read, real_estate.deals.write, real_estate.leases.read, simulação e propostas de crédito, agenda (read, write e status) e clientes. Não capta imóvel nem cria contrato de locação.',
            'Papel "Gerente / captação": os anteriores, real_estate.properties.write (Cadastrar imóveis, preços e fotos) e real_estate.leases.write (Criar, reajustar, prorrogar e encerrar contratos de locação).',
            'Baixa no financeiro exige core.finance.write, fora desses papéis.',
            'Configurações da locação e Bancos e financeiras exigem core.access.settings.',
          ],
        },
        { text: 'Ao ativar o módulo, se a agenda ainda não tiver serviços, são criados "Visita ao imóvel" (60 min), "Avaliação de imóvel" (90 min) e "Assinatura de contrato" (60 min), todos sem preço.' },
        { text: 'Instituições simuladas para imóvel: "Banco Parceiro A (simulação)", 10,99% a.a., e "Banco Parceiro C (simulação)", 11,49% a.a. O módulo Vendas e estoque acompanha o ramo, mas propostas e aluguéis não passam pelo caixa.' },
      ],
    },
    {
      id: 'conectar-bancos',
      title: 'Conectar bancos para o financiamento',
      path: '/configuracoes/bancos',
      simple: [
        { text: 'Aqui você define quais bancos aparecem na simulação do financiamento habitacional e como a proposta chega até eles.' },
        {
          steps: [
            'Em Bancos e financeiras, clique em "Nova conexão".',
            'Escolha o banco no catálogo ou clique em "Outra instituição".',
            'Marque o produto "Financiamento imobiliário".',
            'Escolha o Modo. Sem acesso direto ao banco, use "Manual (sem API)".',
            'Informe a taxa em "Imóvel (% a.a.)" e a tarifa, se houver.',
            'Clique em "Salvar".',
          ],
        },
        { warn: 'Ao escolher um banco do catálogo, só "Consórcio" vem marcado. Marque "Financiamento imobiliário", ou ele não aparece na simulação.' },
      ],
      technical: [
        { text: 'Permissão: core.access.settings. Toda integração real depende de contrato com a instituição. O catálogo é referência, marcado "A confirmar".' },
        {
          list: [
            'Simulação: decide sozinha pela regra de 30% da renda; não fala com ninguém.',
            'Manual (sem API): a taxa é só referência; a equipe registra a resposta.',
            'API com REST genérico: OAuth2 e webhook assinado; segredos ficam cifrados.',
            'API com adaptador da administradora: esqueleto que falha com "a confirmar com a administradora".',
          ],
        },
      ],
    },
    {
      id: 'captar-imovel',
      title: 'Captar um imóvel',
      path: '/imoveis',
      simple: [
        { text: 'Captar é colocar o imóvel na carteira, com fotos, preço e proprietário. É da página dele que saem as propostas e os contratos de aluguel.' },
        {
          steps: [
            'Em Imóveis, clique em "Captar imóvel".',
            'Busque o proprietário. Se não existir, use o link "Cadastrar cliente".',
            'Escreva o Título do anúncio.',
            'Escolha Tipo e Finalidade: Venda, Locação ou Venda e locação.',
            'Preencha endereço, área, quartos, banheiros e vagas.',
            'Informe o Preço de venda, o Aluguel ou os dois.',
            'Marque se aceita financiamento bancário.',
            'Clique em "Salvar" e depois em "Adicionar foto".',
          ],
        },
        { tip: 'Muitos imóveis? Use "Baixar modelo" e "Importar planilha". Os proprietários precisam já estar em Clientes.' },
        { warn: 'A lista começa só com os disponíveis. Alugados e vendidos aparecem ao trocar o filtro de situação. Uma foto enviada por engano não tem botão para remover nesta tela.' },
      ],
      technical: [
        { text: 'Permissão: real_estate.properties.write. O código do imóvel é sequencial. O preço por m² é calculado com Preço de venda e Área. A captação entra na linha do tempo do proprietário.' },
        {
          list: [
            'Finalidade Venda exige Preço de venda; Locação exige Aluguel; Venda e locação exige os dois.',
            'Situações: Disponível, Reservado, Vendido, Alugado e Fora do mercado.',
            'Com contrato de locação ativo, a situação fica sempre Alugado, mesmo que se escolha outra.',
            'A situação pode ser mudada à mão nos demais casos. Tirar de Reservado com proposta aberta permite uma segunda proposta.',
            'Fotos: JPEG, PNG ou WebP, até 8 MB.',
            'Busca: código, título, bairro, cidade ou rua. Até 300 imóveis.',
            'A tela não pede CEP e complemento, que só entram pela planilha, junto com Área do terreno.',
            'Importação: obrigatórios Proprietário (CPF/CNPJ ou nome exato), Título, Tipo, Rua, Bairro, Cidade e UF.',
          ],
        },
      ],
    },
    {
      id: 'marcar-visita',
      title: 'Marcar uma visita',
      path: '/agenda',
      simple: [
        { text: 'A visita é marcada na Agenda, ligada ao imóvel. Assim, o corretor vê os compromissos do dia e o horário não fica duplicado.' },
        {
          steps: [
            'Em Agenda, clique em "Novo horário".',
            'Busque o cliente.',
            'Em Imóvel, escolha o imóvel da visita.',
            'Marque o serviço "Visita ao imóvel".',
            'Escolha o Profissional, o Dia e um horário livre.',
            'Salve.',
          ],
        },
        { warn: 'Só imóveis disponíveis aparecem na lista. Um imóvel reservado por outra proposta precisa voltar a Disponível antes.' },
      ],
      technical: [
        { text: 'Permissões: shared.scheduling.read, shared.scheduling.write e shared.scheduling.status, incluídas nos papéis da imobiliária. Os serviços e profissionais são configurados em Serviços da agenda e Profissionais e horários (shared.scheduling.manage).' },
        { text: 'A visita é um horário comum da agenda, com o imóvel como referência. Avisos e lembretes seguem as regras da agenda. Não há registro próprio de resultado da visita nem funil de interessados: o que o cliente achou fica nas observações ou na ficha dele.' },
      ],
    },
    {
      id: 'registrar-proposta',
      title: 'Registrar uma proposta de compra',
      path: '/imoveis/propostas',
      simple: [
        { text: 'A proposta registra quanto o comprador oferece e como vai pagar. Ao registrar, o imóvel fica reservado.' },
        {
          steps: [
            'Em Imóveis, abra o imóvel e clique em "Nova proposta".',
            'Busque o comprador.',
            'Informe o Valor da proposta.',
            'Em Pagamento, escolha "Financiamento habitacional" ou "À vista".',
            'Informe Entrada e, no financiamento, FGTS.',
            'Confira a Comissão (%) e o Corretor(a).',
            'Clique em "Registrar proposta".',
          ],
        },
        { tip: 'Exemplo: imóvel de R$ 500.000. Entrada mais FGTS precisam somar pelo menos R$ 100.000. A tela mostra o mínimo em vermelho enquanto faltar.' },
        { warn: 'Depois de registrada, a proposta não pode ser editada. Se o valor mudar, marque como perdida e registre outra.' },
      ],
      technical: [
        { text: 'Permissão: real_estate.deals.write. O botão aparece com imóvel Disponível e finalidade diferente de Locação. O imóvel vira Reservado e a proposta entra na linha do tempo e na aba "Imóveis" do comprador.' },
        {
          list: [
            'Financiamento: até 80% do valor. Abaixo disso: "Os bancos financiam até 80% do valor". É regra fixa do sistema, não do banco escolhido.',
            'A financiar = Valor da proposta menos Entrada menos FGTS.',
            '"Entrada e FGTS passam do valor da proposta".',
            'FGTS em compra à vista é recusado: "FGTS só entra junto com o financiamento habitacional".',
            'Imóvel que não aceita financiamento só oferece À vista.',
            '"O comprador é o próprio proprietário": bloqueado.',
            'Comissão: padrão de 6% na tela, máximo de 20%.',
            'Situações: Proposta em negociação, Crédito em análise, Crédito aprovado, Crédito recusado, Vendido, Perdida.',
          ],
        },
      ],
    },
    {
      id: 'financiamento',
      title: 'Simular o financiamento e acompanhar a proposta',
      path: '/imoveis/propostas',
      simple: [
        { text: 'Dentro da proposta, o sistema compara os bancos ativos. Depois de escolher, você envia a proposta e acompanha a resposta ali mesmo.' },
        {
          steps: [
            'Abra a proposta.',
            'Escolha o prazo, de 120 a 420 meses, e o sistema: SAC ou Price.',
            'Compare Parcela, Taxa, CET e Total.',
            'Clique em "Enviar proposta" no banco escolhido.',
            'Confira os dados, informe a Renda mensal e clique em "Enviar".',
            'Acompanhe em "Propostas enviadas".',
          ],
        },
        { text: 'Sem integração direta, envie pelo portal do banco e depois clique em "Registrar resposta". Com integração, use "Consultar status". Assinou? Clique em "Contrato assinado".' },
        { warn: 'Só envie com o consentimento do cliente: os dados vão para o banco fazer a análise de crédito.' },
      ],
      technical: [
        { text: 'Permissões: integration.banking.simulate e integration.banking.propose. O padrão é 360 meses em SAC. A simulação de imóvel não inclui IOF; inclui a tarifa da conexão. A taxa anual é convertida em mensal. Nos modos Simulação e Manual, os números são estimativas locais.' },
        {
          list: [
            'Simulação: aprova parcela (a primeira, no SAC) de até 30% da renda declarada. A decisão sai na consulta.',
            'Consulta automática a cada 10 minutos, fora do modo manual.',
            'Crédito em análise ou aprovado esconde "Enviar proposta". Cancele a atual para tentar outro banco.',
            'Uma proposta em andamento por instituição.',
            'Aprovada ou Contratada: Crédito aprovado. Recusada: Crédito recusado. Cancelada: Proposta em negociação.',
            'Aviso ao cliente: modelo "Financiamento imobiliário aprovado", por e-mail e WhatsApp, conforme os canais ativos.',
            'O sistema não trata cartório, escritura, ITBI nem liberação do FGTS.',
          ],
        },
      ],
    },
    {
      id: 'fechar-venda',
      title: 'Fechar a venda, perder a proposta e ver resultados',
      path: '/imoveis/propostas',
      simple: [
        { text: 'Ao fechar, o imóvel vira Vendido e a comissão da imobiliária entra no financeiro como valor a receber. O preço do imóvel não entra, porque esse dinheiro é do proprietário.' },
        {
          steps: [
            'Abra a proposta e clique em "Fechar venda".',
            'No Financeiro, dê baixa na comissão quando receber.',
          ],
        },
        { text: 'O cliente desistiu? Cancele a proposta no banco, se houver, clique em "Perdida", escolha o motivo e confirme. O imóvel volta a ficar disponível.' },
        { text: 'No alto de Propostas, o gerente vê o "Resultado por corretor" do mês e as "Perdas por motivo". Para mudar o responsável, clique em "trocar".' },
        { warn: 'Venda fechada ou proposta perdida não pode ser desfeita pela tela.' },
      ],
      technical: [
        { text: 'Permissão: real_estate.deals.write. Financiamento exige proposta Aprovada ou Contratada; senão, "Financiamento ainda não aprovado". A tela libera o botão com À vista ou Crédito aprovado.' },
        {
          list: [
            'Comissão = Valor da proposta vezes Comissão (%). Lançada em aberto, vencimento hoje, categoria de serviços, com o proprietário como cliente.',
            'Comissão zero não gera lançamento.',
            'A divisão da comissão com o corretor não é calculada; o resumo mostra o total.',
            'Perda bloqueada com proposta Enviada, Em análise ou Aprovada. Contratada não bloqueia.',
            'Motivos: Preço, Financiamento negado, Comprou outro imóvel, Desistiu, Documentação, Sem contato e Outro (detalhe de ao menos 3 caracteres).',
            'Resumo: Em aberto é o total atual; Vendidas, Valor vendido, Comissão e Perdidas são do mês escolhido.',
            'A troca de corretor exige pessoa ativa na equipe e fica na auditoria.',
          ],
        },
      ],
    },
    {
      id: 'contrato-locacao',
      title: 'Criar um contrato de locação',
      path: '/imoveis/locacoes',
      simple: [
        { text: 'O contrato registra o aluguel no sistema. Ao salvar, ele já lança as cobranças do inquilino e os repasses ao proprietário.' },
        {
          steps: [
            'Na página do imóvel, clique em "Alugar". Ou, em Locações, clique em "Novo contrato".',
            'Busque o inquilino.',
            'Se veio de Locações, escolha o Imóvel.',
            'Preencha Início, Prazo (meses) e Dia do vencimento.',
            'Informe Aluguel, Condomínio e IPTU mensais.',
            'Informe a Taxa de administração.',
            'Escolha o Índice de reajuste e o Mês do aniversário.',
            'Escolha a Garantia e preencha os dados pedidos.',
            'Clique em "Assinar contrato".',
          ],
        },
        { tip: 'O aluguel vence depois do mês de uso. Contrato iniciado em 15/10, com vencimento no dia 10: a primeira cobrança vence em 10/11.' },
        { warn: 'O botão "Assinar contrato" só registra no sistema. Ele não gera nem assina o documento. Depois de salvo, o contrato não tem tela de edição: confira tudo antes.' },
      ],
      technical: [
        { text: 'Permissão: real_estate.leases.write. Exige imóvel Disponível e finalidade diferente de Venda; o imóvel vira Alugado. Padrões da tela: 30 meses, dia 10, IGP-M e taxa de 10%.' },
        {
          list: [
            'São lançadas as 12 primeiras mensalidades (ou o prazo, se menor). A rotina de hora em hora mantém 12 meses à frente.',
            'Dia maior que o último do mês vence no último dia.',
            'Caução: até 3 aluguéis (Lei 8.245/91, art. 38, conforme a regra do sistema). O valor é só registrado, sem lançamento no financeiro nem devolução automática.',
            'Fiador: nome e CPF válido. Seguro-fiança: seguradora e apólice. Título de capitalização: número obrigatório.',
            'Índice "Percentual fixo" exige o percentual, de até 30%.',
            'Início no passado: aniversários vencidos entram como "Não aplicado", e as mensalidades são lançadas desde o início.',
            '"O inquilino é o próprio proprietário": bloqueado.',
            'Pela página do imóvel, o condomínio não vem preenchido; pela lista, vem. Confira.',
          ],
        },
      ],
    },
    {
      id: 'receber-repassar',
      title: 'Receber o aluguel, repassar e lançar cobranças extras',
      path: '/imoveis/locacoes',
      simple: [
        { text: 'O sistema lança sozinho o que o inquilino deve e o que a imobiliária deve ao proprietário. Você só dá baixa conforme o dinheiro entra e sai.' },
        {
          steps: [
            'Em Financeiro, Lançamentos, dê baixa no aluguel quando o inquilino pagar.',
            'Dê baixa no repasse quando transferir ao proprietário.',
            'No contrato, a tabela "Mensalidades" mostra o andamento.',
          ],
        },
        { text: 'Para cobrar algo fora do aluguel, como multa ou reparo, abra o contrato e clique em "Cobrança extra". Escolha o Tipo, o Valor e o Vencimento. Marque "Repassar o valor ao proprietário" se o dinheiro for dele. Clique em "Lançar".' },
        { warn: 'O sistema não impede pagar o repasse antes de receber o aluguel. Confira a coluna "Recebimento" antes de transferir.' },
      ],
      technical: [
        { text: 'As baixas são feitas no financeiro (core.finance.write). Cada mensalidade cria uma receita e uma despesa de repasse, nas categorias outras receitas e outras despesas.' },
        {
          list: [
            'Inquilino paga = Aluguel + Condomínio + IPTU.',
            'Taxa adm. = Aluguel vezes o percentual. Não incide sobre condomínio e IPTU.',
            'Repasse = Aluguel menos Taxa adm. mais Condomínio mais IPTU.',
            'Data do repasse = vencimento mais os dias da configuração (padrão 5). A mudança vale para os próximos lançamentos.',
            'Lembrete: modelo "Lembrete de vencimento do aluguel", dias antes do vencimento (padrão 3, zero desliga), uma vez por mensalidade.',
            'Cobrança extra: sem taxa de administração. Repassada, gera despesa de valor integral. Condomínio e IPTU já vêm com o repasse marcado.',
            'Cobrança recebida ou repassada não cancela: "Esta cobrança já foi recebida ou repassada".',
            'O botão "Cobrança extra" também aparece em contrato encerrado.',
            'Valores de condomínio e IPTU do contrato não têm tela de alteração. Diferenças podem ser lançadas como cobrança extra.',
            'Não há boleto, multa e juros por atraso, nem cobrança automática neste módulo.',
          ],
        },
      ],
    },
    {
      id: 'reajuste',
      title: 'Aplicar o reajuste do aluguel',
      path: '/imoveis/locacoes',
      simple: [
        { text: 'Perto do aniversário do contrato, o reajuste aparece em "Reajustes pendentes", no alto de Locações. Você informa a variação do índice e o sistema faz o resto.' },
        {
          steps: [
            'Consulte o índice acumulado de 12 meses na sua fonte de confiança.',
            'Em "Reajustes pendentes", clique em "Informar reajuste".',
            'Digite a variação. A tela mostra o aluguel novo.',
            'Clique em "Aplicar reajuste".',
          ],
        },
        { text: 'Combinou de não reajustar? Clique em "Não reajustar este ano", escreva o motivo e confirme. O aluguel continua igual.' },
        { warn: 'O sistema não busca o IGP-M nem o IPCA: quem informa é você. A variação também pode ser negativa, por isso confira o sinal.' },
      ],
      technical: [
        { text: 'Permissão: real_estate.leases.write. O reajuste é aberto pela rotina de hora em hora, nos dias de antecedência configurados (padrão 30). O primeiro aniversário tem ao menos 12 meses de contrato. Só abre se a data estiver dentro da vigência.' },
        {
          list: [
            'Novo aluguel = aluguel vigente vezes (1 + percentual). Aceita de -30% a 50%.',
            'Percentual fixo: aplicado sozinho quando o reajuste é aberto, com aviso ao inquilino.',
            'Mensalidades com início no aniversário ou depois, sem nada pago, são canceladas e lançadas de novo com o valor novo. O que já tem baixa fica como está.',
            'Aviso: modelo "Aviso de reajuste do aluguel" ao inquilino.',
            'Enquanto houver um reajuste pendente, o seguinte não é aberto.',
            'Encerrar o contrato marca os pendentes como "Não aplicado".',
          ],
        },
      ],
    },
    {
      id: 'encerrar-contrato',
      title: 'Prorrogar, encerrar ou rescindir um contrato',
      path: '/imoveis/locacoes',
      simple: [
        { text: 'Para continuar depois do prazo, prorrogue. Na entrega das chaves, encerre. O imóvel volta a ficar disponível.' },
        { text: 'Prorrogar: abra o contrato, clique em "Prorrogar", informe os meses a mais e confirme.' },
        {
          steps: [
            'Para terminar, clique em "Encerrar / rescindir".',
            'Informe a data da Entrega das chaves.',
            'Antes do fim do prazo, informe o Motivo da rescisão. Se houver, informe a multa.',
            'Clique em "Confirmar".',
          ],
        },
        { warn: 'O mês da entrega é cobrado pelos dias de uso e os meses seguintes em aberto são cancelados. Valores já recebidos não mudam: acerte diferenças à parte. O encerramento não pode ser desfeito.' },
      ],
      technical: [
        { text: 'Permissão: real_estate.leases.write. Entrega no fim do prazo ou depois: Encerrado. Antes: Rescindido, com motivo de ao menos 3 caracteres. Data anterior ao início é recusada.' },
        {
          list: [
            'Mensalidades com início na data da entrega ou depois: canceladas, se nada foi pago.',
            'Mês em curso: valores proporcionais aos dias de uso e relançados, se nada foi pago.',
            'Mensalidade com baixa fica como está. A contagem vai para a auditoria.',
            'Cobranças extras com vencimento depois da entrega são canceladas, se abertas.',
            'Multa só na rescisão, com vencimento na data da entrega. "Repassar a multa ao proprietário" vem marcado.',
            'A multa não é calculada: o valor é informado pela equipe.',
            'A caução não é devolvida nem abatida pelo sistema, e não há vistoria.',
            'Prorrogar: de 1 a 120 meses. Lança o que faltar até 12 meses à frente.',
          ],
        },
      ],
    },
    {
      id: 'extrato-proprietario',
      title: 'Enviar o extrato ao proprietário',
      path: '/imoveis/locacoes',
      simple: [
        { text: 'O extrato mostra ao proprietário o que foi cobrado, recebido e repassado no mês.' },
        {
          steps: [
            'Em Locações, clique em "Extrato do proprietário".',
            'Escolha o proprietário e o mês.',
            'Confira as linhas e os totais.',
            'Clique em "Imprimir". Para enviar em PDF, salve o arquivo na janela de impressão.',
          ],
        },
        { tip: 'O mês considerado é o do vencimento. O aluguel de outubro, que vence em novembro, aparece no extrato de novembro.' },
      ],
      technical: [
        { text: 'Permissão: real_estate.leases.read. Entram mensalidades ativas e cobranças extras repassadas com vencimento no mês. A lista de proprietários vem dos contratos de locação.' },
        {
          list: [
            'Total cobrado dos inquilinos, Recebido, Taxa de administração, Repasse do mês e Já repassado.',
            'Recebido e Já repassado seguem a baixa no financeiro.',
            'Repasse do mês soma o previsto, recebido ou não.',
            'Cobrança extra sem repasse não aparece.',
            'Não há envio automático por e-mail nem informe de rendimentos. O extrato é um resumo operacional, não documento fiscal.',
          ],
        },
      ],
    },
  ],
};
