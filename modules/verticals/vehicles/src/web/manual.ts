import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Revenda de veículos',
  summary: 'Estoque com fotos e FIPE, negociações com troca, financiamento pelos bancos parceiros e fechamento da venda.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      simple: [
        { text: 'Antes da primeira venda, deixe a loja pronta nesta ordem. Assim, o vendedor já encontra carros, clientes e bancos no sistema.' },
        {
          steps: [
            'Em Configurações, abra Dados da empresa e preencha nome e logo.',
            'Abra Usuários e convide a equipe, com o papel "Vendedor(a)" ou "Gerente de loja".',
            'Abra Bancos e financeiras e confira quais instituições vão aparecer na simulação.',
            'Abra Estoque e cadastre os veículos, um a um ou por planilha.',
            'Abra Clientes e cadastre quem já está em atendimento.',
          ],
        },
        { warn: 'Os bancos que vêm prontos são de demonstração. Enquanto não trocar por uma instituição real, nenhuma proposta chega a um banco de verdade.' },
      ],
      technical: [
        {
          list: [
            'Papel "Vendedor(a)": vehicles.stock.read, vehicles.deals.read, vehicles.deals.write, integration.banking.simulate, integration.banking.propose, core.customers.read e core.customers.write. Não cadastra veículo nem vê custo.',
            'Papel "Gerente de loja": os anteriores, vehicles.stock.write (Cadastrar veículos, preços e fotos) e vehicles.costs.read (Ver custo e margem dos veículos).',
            'Bancos e financeiras exige core.access.settings (Configurar os módulos contratados).',
            'Baixa no financeiro exige core.finance.write, que não vem nesses papéis.',
          ],
        },
        { text: 'Ao contratar a integração bancária, são criadas instituições simuladas. Para veículos valem "Banco Parceiro A (simulação)", 1,89% a.m., tarifa de R$ 600, e "Financeira Parceira B (simulação)", 2,19% a.m., sem tarifa.' },
        { text: 'O módulo Vendas e estoque (Caixa, Vendas, Produtos e estoque) acompanha a revenda, mas a negociação de veículo não passa por ele. O estoque de veículos é separado do estoque de produtos.' },
      ],
    },
    {
      id: 'conectar-bancos',
      title: 'Conectar bancos e financeiras',
      path: '/configuracoes/bancos',
      simple: [
        { text: 'Aqui você define quais instituições aparecem na simulação de financiamento e como a proposta chega até elas.' },
        {
          steps: [
            'Em Bancos e financeiras, clique em "Nova conexão".',
            'Escolha a instituição no catálogo ou clique em "Outra instituição".',
            'Confira o "Nome na tela" e marque o produto "Financiamento de veículo".',
            'Escolha o Modo. Sem acesso direto ao banco, use "Manual (sem API)".',
            'Informe a taxa de referência em "Veículo (% a.m.)" e a "Tarifa de cadastro (R$)".',
            'Clique em "Salvar".',
            'Para tirar uma instituição da simulação, edite e desmarque "Ativa".',
          ],
        },
        { tip: 'No modo manual, a equipe envia a proposta pelo portal do banco e depois anota a resposta no sistema. O acompanhamento funciona igual.' },
        { warn: 'Ao escolher um banco do catálogo, só "Consórcio" vem marcado. Lembre de marcar "Financiamento de veículo", ou ele não aparece na simulação.' },
      ],
      technical: [
        { text: 'Permissão: core.access.settings. Toda integração real depende de contrato com a instituição. O catálogo é material de referência, marcado "A confirmar", e não foi validado com as administradoras.' },
        {
          list: [
            'Simulação: usa as taxas da conexão e decide sozinha pela regra de 30% da renda. Não fala com ninguém.',
            'Manual (sem API): usa as taxas como referência; a taxa que vale é a da resposta da instituição. A resposta é registrada pela equipe.',
            'API, adaptador REST genérico: OAuth2 com Client ID e Client secret, mais webhook assinado. O segredo fica cifrado e não volta para a tela.',
            'API, adaptador da administradora: hoje é um esqueleto. As chamadas falham com a mensagem "a confirmar com a administradora".',
          ],
        },
        { text: 'A conexão não é excluída pela tela, só desativada. Taxa de veículo aceita de 0 a 20% a.m.; tarifa até R$ 10.000.' },
      ],
    },
    {
      id: 'cadastrar-veiculo',
      title: 'Cadastrar um veículo',
      path: '/veiculos/estoque',
      simple: [
        { text: 'Cada carro da loja vira uma ficha com fotos, preço e dados técnicos. É dela que o vendedor abre a negociação.' },
        {
          steps: [
            'Em Estoque, clique em "Novo veículo".',
            'Preencha Tipo, Marca, Modelo e, se quiser, Versão.',
            'Informe Ano fabricação, Ano modelo, Placa, Cor e Quilometragem.',
            'Escolha Combustível e Câmbio.',
            'Informe o Custo (quanto a loja pagou) e o Preço de venda.',
            'Clique em "Salvar". A ficha do veículo abre.',
            'Clique em "Adicionar foto" para cada foto.',
          ],
        },
        { tip: 'A primeira foto é a que aparece no card do estoque. Use a busca por marca, modelo ou placa para achar um carro rápido.' },
        { warn: 'A lista começa mostrando só os disponíveis. Se um carro sumiu, troque o filtro para "Todos": ele pode estar Reservado, Vendido ou Fora de venda.' },
      ],
      technical: [
        { text: 'Para cadastrar: vehicles.stock.write. Para ver: vehicles.stock.read. O custo e a margem só aparecem com vehicles.costs.read. Custo não é obrigatório.' },
        {
          list: [
            'Situações: Disponível, Reservado, Vendido e Fora de venda.',
            'Ano modelo igual ou um a mais que o de fabricação. Anos de 1950 a 2100.',
            'Placa nos formatos ABC1D23 ou ABC-1234, única na empresa: "Já existe um veículo com esta placa".',
            'Fotos: JPEG, PNG ou WebP, até 8 MB, uma por vez. "Remover" aparece ao passar o mouse.',
            'Dias em estoque contam a partir do cadastro. A lista mostra até 300 veículos.',
            'Veículo vendido não volta: "Veículo vendido não volta ao estoque por aqui".',
          ],
        },
        { warn: 'A Situação pode ser trocada à mão no formulário. Tirar um carro de Reservado com negociação aberta permite abrir uma segunda negociação para ele. Marcar Vendido à mão não lança nada no financeiro.' },
        { warn: 'Quem pode editar o veículo mas não tem vehicles.costs.read vê o Custo vazio e, ao salvar, apaga o custo gravado. Os papéis padrão não têm essa combinação; cuidado ao criar papéis próprios.' },
      ],
    },
    {
      id: 'fipe',
      title: 'Consultar a FIPE e definir o preço',
      path: '/veiculos/estoque',
      simple: [
        { text: 'A FIPE ajuda a comparar o seu preço com a referência do mercado. Ela não muda o preço de venda: quem decide é a loja.' },
        {
          steps: [
            'No cadastro do veículo, preencha primeiro o Ano modelo.',
            'Digite o Código FIPE, no formato 000000-0.',
            'Clique em "Consultar". O Valor FIPE é preenchido.',
            'Defina o Preço de venda e clique em "Salvar".',
          ],
        },
        { tip: 'Na ficha do veículo, você vê a diferença do seu preço para a FIPE em porcentagem e, se tiver acesso, o custo e a margem.' },
        { warn: 'Se aparecer "Código não encontrado na tabela FIPE", confira o código ou digite o valor à mão.' },
      ],
      technical: [
        { text: 'A consulta usa a BrasilAPI, serviço público sem chave, com limite de 10 segundos. Fora do ar: "Consulta à tabela FIPE indisponível agora", e o valor pode ser digitado.' },
        {
          list: [
            'Procura o resultado com o mesmo Ano modelo. Sem ele, usa o primeiro da lista, que pode ser de outro ano: confira.',
            'Marca e Modelo só são preenchidos se estiverem vazios.',
            'O valor é gravado na hora da consulta e não é atualizado depois. Para atualizar, consulte de novo e salve.',
            'Margem exibida: Preço de venda menos Custo. Não inclui despesas de preparo, comissão ou impostos.',
          ],
        },
      ],
    },
    {
      id: 'importar-estoque',
      title: 'Importar o estoque por planilha',
      path: '/veiculos/estoque',
      simple: [
        { text: 'Tem o estoque em uma planilha? Importe tudo de uma vez em vez de digitar carro por carro.' },
        {
          steps: [
            'Em Estoque, clique em "Baixar modelo".',
            'Preencha a planilha, uma linha por veículo.',
            'Clique em "Importar planilha" e escolha o arquivo.',
            'Confira a prévia e importe as linhas válidas.',
            'Corrija as linhas recusadas e importe de novo.',
            'Abra cada veículo para adicionar as fotos.',
          ],
        },
        { tip: 'Formate a coluna do Código FIPE como texto, para o Excel não alterar o número.' },
      ],
      technical: [
        { text: 'Permissão: vehicles.stock.write. Cada linha segue as regras do cadastro manual. Obrigatórias: Marca, Modelo, Ano fabricação, Ano modelo e Preço de venda.' },
        { text: 'Vazios assumem Carro, Flex, Manual, quilometragem 0 e situação Disponível. Fotos não entram pela planilha. Placa repetida recusa a linha; a importação não atualiza veículos existentes.' },
      ],
    },
    {
      id: 'abrir-negociacao',
      title: 'Abrir uma negociação',
      path: '/veiculos/estoque',
      simple: [
        { text: 'A negociação registra quem quer comprar qual carro e em que condições. Ao abrir, o carro fica reservado para esse cliente e ninguém mais consegue negociá-lo.' },
        {
          steps: [
            'No Estoque, abra o veículo e clique em "Nova negociação".',
            'Busque o cliente. Se não existir, use o link "Cadastrar cliente".',
            'Confira o Preço e informe o Desconto, se houver.',
            'Em Pagamento, escolha "Financiamento" ou "À vista".',
            'No financiamento, informe a Entrada.',
            'Confira o Vendedor e clique em "Salvar".',
          ],
        },
        { tip: 'Exemplo: carro de R$ 80.000, desconto de R$ 2.000, entrada de R$ 18.000 e troca de R$ 20.000. O valor a financiar fica em R$ 40.000.' },
        { text: 'Para mudar algo depois, clique em "Alterar valores". Isso é possível em "Em negociação" e "Crédito recusado".' },
        { warn: 'Com o crédito em análise ou aprovado, os valores ficam travados. Cancele a proposta primeiro.' },
      ],
      technical: [
        { text: 'Permissão: vehicles.deals.write. O botão só aparece com o veículo Disponível. A abertura trava o veículo, cria o número sequencial, muda o veículo para Reservado e registra na linha do tempo do cliente.' },
        {
          list: [
            'Valor da venda = Preço menos Desconto.',
            'A financiar = Valor da venda menos Troca menos Entrada.',
            '"Desconto maior que o preço": valor líquido zero ou negativo.',
            '"Entrada e troca passam do valor da venda".',
            '"Não sobra valor para financiar": financiamento com valor a financiar zerado.',
            '"Veículo reservado, vendido ou fora de venda": outro já abriu ou o carro saiu de venda.',
            'Situações: Em negociação, Crédito em análise, Crédito aprovado, Crédito recusado, Vendido, Perdida.',
            'A negociação fica também na aba "Veículos" da ficha do cliente.',
          ],
        },
      ],
    },
    {
      id: 'troca',
      title: 'Receber um carro na troca',
      path: '/veiculos/negociacoes',
      simple: [
        { text: 'Quando o cliente dá o carro dele como parte do pagamento, registre a troca na negociação. O valor é abatido do que falta pagar.' },
        {
          steps: [
            'Na negociação, marque "Tem carro na troca".',
            'Preencha Marca, Modelo, Ano modelo e Placa.',
            'Informe o "Valor da troca (R$)" combinado.',
            'Clique em "Salvar".',
          ],
        },
        { warn: 'O carro da troca só entra no estoque quando a venda é fechada, e entra como "Fora de venda". Revise os dados, cadastre as fotos e defina o preço antes de anunciar.' },
      ],
      technical: [
        { text: 'No fechamento, o sistema cria um veículo novo: tipo Carro, Flex, Manual, quilometragem 0 e ano de fabricação igual ao ano modelo. Custo e Preço recebem o valor da troca, e as Observações citam o número da negociação. Corrija esses dados na ficha.' },
        {
          list: [
            'A troca não gera lançamento no financeiro: ela só reduz o valor a receber.',
            'O formulário da negociação não pede quilometragem do carro de troca.',
            'A placa da troca não tem a validação de formato do cadastro normal.',
            'Se a placa já existir no estoque, o fechamento falha, possivelmente com uma mensagem genérica. Confira a placa antes.',
            'Não há avaliação, vistoria ou controle de documentos do carro recebido.',
          ],
        },
      ],
    },
    {
      id: 'financiamento',
      title: 'Simular o financiamento e enviar a proposta',
      path: '/veiculos/negociacoes',
      simple: [
        { text: 'Dentro da negociação, o sistema compara as instituições ativas e mostra qual tem a menor parcela. Com o cliente de acordo, você envia a proposta.' },
        {
          steps: [
            'Abra a negociação com pagamento "Financiamento".',
            'Escolha o Prazo: de 12 a 60 meses.',
            'Escolha o sistema: "Price (parcela fixa)" ou "SAC (parcela decrescente)".',
            'Compare Parcela, Taxa, CET e Total.',
            'Clique em "Enviar proposta" na instituição escolhida.',
            'Confira o Nome completo e o CPF ou CNPJ. Informe a Renda mensal.',
            'Clique em "Enviar".',
          ],
        },
        { warn: 'Só envie com o consentimento do cliente: os dados vão para a instituição fazer a análise de crédito.' },
        { tip: 'CET é o custo efetivo total, com tarifas e impostos. Duas parcelas parecidas podem ter custos bem diferentes.' },
      ],
      technical: [
        { text: 'Permissões: integration.banking.simulate e integration.banking.propose (Enviar e acompanhar propostas de crédito). A simulação roda em toda instituição ativa com o produto. A que falhar aparece em vermelho, sem derrubar as outras. Os resultados vêm da menor para a maior parcela.' },
        {
          list: [
            'Nos modos Simulação e Manual, os números são estimativas locais: parcela com tarifa e IOF financiados.',
            'IOF estimado: 0,38% mais 0,0082% ao dia, limitado a 365 dias, sobre o valor total. É aproximação; o cálculo oficial é por parcela.',
            'CET: taxa interna de retorno das parcelas, anualizada.',
            'Na proposta, a simulação é refeita na instituição escolhida. Renda mensal é obrigatória na tela.',
            'Há uma proposta em andamento por instituição: "Já existe proposta em andamento em" e o nome dela.',
            'Em análise ou aprovado, o botão "Enviar proposta" some. Para tentar outro banco, cancele a atual ou aguarde a recusa.',
            'Sem instituição: "Nenhuma instituição ativa oferece este produto".',
          ],
        },
      ],
    },
    {
      id: 'resposta-banco',
      title: 'Acompanhar a resposta do banco',
      path: '/veiculos/negociacoes',
      simple: [
        { text: 'As propostas aparecem na negociação, em "Propostas enviadas". A situação da negociação acompanha a resposta.' },
        { text: 'Sem integração direta (selo "Manual"), a equipe trabalha assim:' },
        {
          steps: [
            'Envie a proposta pelo portal do banco.',
            'Quando o banco responder, clique em "Registrar resposta".',
            'Escolha a resposta, informe o protocolo e, se aprovado, o valor.',
            'Clique em "Registrar".',
          ],
        },
        { text: 'Com integração, clique em "Consultar status" para ver a resposta na hora.' },
        { text: 'Depois da aprovação e da assinatura, clique em "Contrato assinado". Use "Cancelar" se o cliente desistir da proposta.' },
        { tip: 'Quando o crédito é aprovado, o cliente recebe uma mensagem avisando. Combine logo a assinatura e a entrega.' },
      ],
      technical: [
        { text: 'Propostas: Enviada, Em análise, Aprovada, Recusada, Cancelada, Contratada. A negociação muda para Crédito em análise, Crédito aprovado (Aprovada ou Contratada), Crédito recusado ou Em negociação (Cancelada). Cada mudança vai para a linha do tempo do cliente.' },
        {
          list: [
            'Simulação: entra em análise e decide na consulta. Aprova parcela de até 30% da renda declarada; senão, "Parcela acima de 30% da renda declarada (simulação)".',
            'Consulta automática: a cada 10 minutos para propostas Enviada ou Em análise, fora do modo manual.',
            'API: também aceita webhook com assinatura. O endereço aparece na edição da conexão, depois de salvar.',
            'Manual: o sistema dá um protocolo próprio até a equipe informar o da instituição.',
            'Aviso ao cliente: modelo "Financiamento aprovado", por e-mail e WhatsApp, conforme os canais ativos. Sai quando a proposta passa a Aprovada.',
            'O "Valor aprovado" é só registro: não altera os valores da negociação.',
          ],
        },
      ],
    },
    {
      id: 'fechar-venda',
      title: 'Fechar a venda',
      path: '/veiculos/negociacoes',
      simple: [
        { text: 'Fechar a venda tira o carro do estoque e lança no financeiro o dinheiro a receber. Faça isso quando o negócio estiver mesmo concluído.' },
        {
          steps: [
            'Abra a negociação.',
            'Confira valores, troca e entrada.',
            'Clique em "Fechar venda".',
            'Em Financeiro, Lançamentos, dê baixa em cada valor quando o dinheiro entrar.',
          ],
        },
        { warn: 'No financiamento, o botão só libera com "Crédito aprovado". Depois de fechada, a venda não pode ser desfeita pela tela.' },
      ],
      technical: [
        { text: 'Permissão: vehicles.deals.write. Exige venda à vista ou proposta Aprovada ou Contratada; senão, "Financiamento ainda não aprovado". O veículo vira Vendido e a negociação, Vendido, com a data gravada.' },
        { text: 'Lançamentos no financeiro, em aberto, categoria de produtos, ligados ao cliente:' },
        {
          list: [
            'À vista: Valor da venda menos Troca, com vencimento hoje.',
            'Financiado, entrada: valor da Entrada, com vencimento hoje, se maior que zero.',
            'Financiado, repasse: valor financiado, vencimento em 7 dias, com o nome da instituição. O prazo é fixo, não vem do banco.',
          ],
        },
        { text: 'Limites: não há comissão de vendedor, contrato, nota fiscal ou transferência do veículo neste fluxo, nem caminho pela tela para desfazer o fechamento. Para corrigir valores, ajuste no financeiro e nos cadastros.' },
      ],
    },
    {
      id: 'perder-negociacao',
      title: 'Marcar uma negociação como perdida',
      path: '/veiculos/negociacoes',
      simple: [
        { text: 'Se o cliente desistiu, marque como perdida. O carro volta a ficar disponível e o motivo ajuda a entender por que a loja perde vendas.' },
        {
          steps: [
            'Se houver proposta em andamento, clique em "Cancelar" nela.',
            'Clique em "Perdida".',
            'Escolha o Motivo.',
            'Se escolher "Outro", descreva em Detalhes.',
            'Clique em "Confirmar".',
          ],
        },
        { warn: 'Uma negociação perdida não pode ser reaberta. Se o cliente voltar, abra uma nova.' },
      ],
      technical: [
        { text: 'Permissão: vehicles.deals.write. Motivos: Preço, Financiamento negado, Comprou em outra loja, Desistiu, Troca não aceita, Sem contato e Outro. Em "Outro", o detalhe precisa de pelo menos 3 caracteres.' },
        { text: 'Proposta Enviada, Em análise ou Aprovada bloqueia: "Cancele a proposta de financiamento em andamento antes". Proposta Contratada não bloqueia nem pode ser cancelada pela tela; confirme com o banco antes de perder. O veículo só volta a Disponível se ainda estiver Reservado. A mudança vai para a auditoria.' },
      ],
    },
    {
      id: 'resultado-vendedor',
      title: 'Ver o resultado por vendedor',
      path: '/veiculos/negociacoes',
      simple: [
        { text: 'No alto de Negociações, o gerente vê quanto cada vendedor vendeu no mês e por que a loja está perdendo negócios.' },
        {
          steps: [
            'Abra Negociações e escolha o mês.',
            'Leia "Resultado por vendedor" e "Perdas por motivo".',
            'Use os filtros para ver as negociações de uma situação ou de um vendedor.',
            'Para passar um cliente a outro vendedor, abra a negociação e clique em "trocar".',
          ],
        },
        { tip: 'Se um vendedor sair da equipe, passe as negociações abertas dele para outra pessoa pelo "trocar".' },
      ],
      technical: [
        { text: 'Permissão para ver: vehicles.deals.read. Para trocar: vehicles.deals.write, em qualquer etapa antes do encerramento. O novo vendedor precisa estar ativo na equipe. A troca vai para a auditoria.' },
        {
          list: [
            'Em aberto: negociações abertas agora, independentemente do mês escolhido.',
            'Vendidas e Valor vendido: fechadas no mês, pelo valor líquido de desconto.',
            'Perdidas: pela data da perda.',
            'Vendedor padrão: quem abriu a negociação.',
            'A lista mostra até 300 negociações. O resumo não calcula comissão.',
          ],
        },
      ],
    },
  ],
};
