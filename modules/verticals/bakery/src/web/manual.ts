import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Padaria',
  summary: 'Caixa do dia a dia, encomendas, produção e estoque.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/produtos',
      simple: [
        { text: 'Antes da primeira venda, ajuste o catálogo e deixe o caixa pronto. É coisa de pouco tempo.' },
        {
          steps: [
            'Abra Produtos e estoque. O sistema já traz produtos de exemplo, como pão francês e coxinha. Ajuste os preços, desmarque Ativo no que você não vende e cadastre o restante.',
            'No Financeiro, em Contas e categorias, confira se existe uma conta de caixa. É nela que entra o dinheiro.',
            'Em Configurações, Usuários, convide a equipe e escolha o papel: Balcão ou Produção.',
            'Abra Caixa (PDV), cadastre o caixa deste computador e abra com o troco inicial.',
            'Faça uma venda e uma encomenda de teste, usando o seu próprio cadastro como cliente. Depois, cancele as duas.',
          ],
        },
        { tip: 'Controle o estoque só do que vale a pena. Pão feito na casa pode ficar sem esse controle.' },
      ],
      technical: [
        { text: 'Ao ativar o módulo, se a empresa ainda não tiver produtos, são criados 12 itens de exemplo. Pães, doces, salgados e cafeteria vêm com controle de estoque desligado. Frios, leite e refrigerante vêm com controle ligado e saldo zero.' },
        {
          list: [
            'Balcão: vender, abrir e fechar caixa, ver vendas, ordens de serviço completas e clientes.',
            'Produção: ver encomendas, mudar status, lançar estoque e cadastrar produtos.',
            'O papel Gerente soma ao Balcão cancelar venda (shared.sales.cancel), histórico de caixas (shared.sales.register.history), produtos e estoque.',
          ],
        },
        { text: 'Sem configuração própria na tela: o estoque pode ficar negativo, e Pix e cartão entram na conta padrão. O rodapé do cupom usa o texto padrão.' },
      ],
    },
    {
      id: 'produtos',
      title: 'Cadastrar produtos e preços',
      path: '/produtos',
      simple: [
        { text: 'O produto cadastrado aparece no caixa e na encomenda. O preço daqui é o que o caixa cobra.' },
        {
          steps: [
            'Abra Produtos e estoque e clique em Novo produto.',
            'Preencha Nome, Categoria e Preço de venda.',
            'Escolha a Unidade. Use Quilo para o que vai na balança, como pão francês, e Unidade para o que se vende inteiro, como sonho.',
            'Se o produto tem código de barras, passe o leitor no campo Código de barras.',
            'Deixe Controlar estoque marcado só se for lançar entradas e contagens.',
            'Clique em Salvar.',
          ],
        },
        { tip: 'Tem muitos produtos? Use Baixar modelo, preencha a planilha e clique em Importar planilha.' },
        { warn: 'Não há como apagar um produto. Para tirar do caixa, desmarque Ativo.' },
      ],
      technical: [
        { list: ['Permissão: shared.sales.products. A coluna Estoque inicial da planilha aparece só para quem tem shared.sales.stock.', 'Código de barras: de 8 a 14 dígitos e único. Repetido: “Já existe um produto com este código de barras”.', 'Unidades: un, kg, g, l, ml e pct. Só kg e l aceitam fração no caixa. As demais: “X é vendido em quantidade inteira”.', 'Estoque baixo: saldo igual ou menor que o Estoque mínimo.'] },
        { text: 'A venda guarda o nome e o preço do momento. Mudar o preço não altera vendas antigas. A mudança de preço fica na auditoria.' },
      ],
    },
    {
      id: 'abrir-caixa',
      title: 'Abrir o caixa',
      path: '/pdv',
      simple: [
        { text: 'Abrir o caixa registra quanto dinheiro está na gaveta no começo do turno. No fim, o sistema diz quanto deveria ter.' },
        {
          steps: [
            'Abra Caixa (PDV) e clique em Abrir caixa.',
            'Em Caixa deste computador, escolha o caixa. Se for o primeiro, informe o Nome do caixa, como Caixa 1, e clique em Cadastrar caixa.',
            'Em Troco inicial, informe o dinheiro que está na gaveta.',
            'Clique em Abrir caixa.',
          ],
        },
        { warn: 'Sem caixa aberto, a venda pode até ser feita, mas não entra em nenhum fechamento. A barra no alto do PDV avisa quando isso acontece.' },
      ],
      technical: [
        { list: ['Permissão: shared.sales.register.', 'O caixa escolhido fica guardado neste navegador e computador.', 'Nome de caixa repetido: “Já existe um caixa com este nome”. Caixa já aberto: “X já está aberto”.', 'Quem não tem a permissão só escolhe o caixa e pede a um responsável para abrir.'] },
        { text: 'Para o PDV só vender com caixa aberto, ligue Exigir caixa aberto para vender em Caixas, Gerenciar caixas. A opção pede core.access.settings. Abrir em horário passado não pode cruzar outra sessão do mesmo caixa.' },
      ],
    },
    {
      id: 'vender',
      title: 'Vender no balcão',
      path: '/pdv',
      simple: [
        { text: 'É a venda do dia a dia: pão, café, frios. O caixa soma, calcula o troco e baixa o estoque do que é controlado.' },
        {
          steps: [
            'Em Caixa (PDV), passe o código de barras ou digite o nome do produto. Para produto de quilo, digite o peso que a balança mostrou e clique em Adicionar.',
            'Ajuste a quantidade na linha, se precisar. Se houver, preencha o Desconto.',
            'Clique em Receber.',
            'Escolha a forma de pagamento. Em dinheiro, digite o valor recebido e o troco aparece.',
            'Para dividir, ajuste o valor e clique em + Outra forma de pagamento.',
            'Clique em Concluir venda. Depois, Imprimir cupom ou Nova venda.',
          ],
        },
        { tip: 'Para vender fiado, clique antes em + Identificar cliente. A opção Fiado (a receber) só aparece com cliente identificado.' },
        { warn: 'A balança não é ligada ao sistema: o peso é digitado. Confira antes de adicionar.' },
      ],
      technical: [
        { list: ['Permissão: shared.sales.sell.', 'Até 5 formas de pagamento por venda. Pagamento abaixo do total: “O pagamento não cobre o total”. Troco só em dinheiro: “Só pagamento em dinheiro pode ter troco”.', 'Desconto acima do total: “O desconto é maior que o total”.', 'O cupom impresso traz “Não é documento fiscal”.'] },
        { text: 'Financeiro: cada forma vira uma receita paga da categoria de produtos, já descontado o troco. Fiado vira um valor a receber, com vencimento no dia da venda. Com controle ligado, cada item gera uma baixa no estoque. O saldo pode ficar negativo.' },
        { text: 'Lançar venda anterior: informa data e, se quiser, hora. Relatórios, estoque e financeiro usam essa data. Com o caixa escolhido, a venda entra na sessão daquele horário, se existir.' },
      ],
    },
    {
      id: 'encomenda',
      title: 'Registrar uma encomenda',
      path: '/padaria/encomendas',
      simple: [
        { text: 'Use para bolos, tortas e salgados pedidos com antecedência. A encomenda guarda o que foi pedido e quando o cliente vem buscar, e entra na produção daquele dia.' },
        {
          steps: [
            'Abra Encomendas e clique em Nova encomenda.',
            'Busque o cliente. Se não encontrar, clique em Cadastrar cliente.',
            'Em Itens, busque um produto do catálogo ou clique em + Item sob medida. Exemplo: Bolo de aniversário 2 kg, recheio de brigadeiro.',
            'Confira Qtd. e Preço. Você pode mudar o preço só nesta encomenda.',
            'Informe a Retirada e o Horário.',
            'Escreva as observações. Clique em Registrar encomenda.',
          ],
        },
        { warn: 'Observações para o cliente não aparecem na Produção do dia. Escreva o que a cozinha precisa, como a frase do bolo, em Observações internas (produção).' },
        { warn: 'Confira antes de registrar. Depois de salva, a tela não permite mudar itens, valores ou a data de retirada. Para corrigir, cancele e registre outra.' },
      ],
      technical: [
        { list: ['Permissão: shared.service-orders.write.', 'Retirada obrigatória e não pode estar no passado (tolerância de 1 hora): “A retirada não pode ser no passado”.', 'De 1 a 100 itens. Desconto maior que os itens: “O desconto é maior que o valor dos itens”.', 'Registrar encomenda antiga: Pedido em com data passada, sem aviso ao cliente. A retirada não pode ser antes do pedido.'] },
        { text: 'A encomenda não baixa estoque, nem do produto do catálogo. Para acertar o saldo, faça um lançamento em Produtos e estoque.' },
        { text: 'Financeiro: o total vira um único valor a receber, com vencimento na retirada. Aviso: Encomenda registrada, por e-mail e, com o módulo de WhatsApp ativo, também por WhatsApp. Sem contato cadastrado, o aviso é pulado.' },
      ],
    },
    {
      id: 'sinal-e-pagamento',
      title: 'Receber sinal e pagamento da encomenda',
      path: '/padaria/encomendas',
      simple: [
        { text: 'O sinal e o restante são lançados na própria encomenda. Assim, na retirada, você sabe quanto falta.' },
        {
          steps: [
            'Abra a encomenda em Encomendas, clicando no número.',
            'Clique em Registrar pagamento.',
            'Digite o Valor. Ele já vem com o total em aberto: para um sinal, troque pelo valor recebido.',
            'Escolha a Data, a Forma de pagamento e a Conta. Clique em Registrar.',
          ],
        },
        { warn: 'Este pagamento não passa pelo Caixa (PDV) e não entra no fechamento da gaveta. Se recebeu em dinheiro no balcão, combine com a equipe como separar esse valor.' },
      ],
      technical: [
        { list: ['Permissão: shared.service-orders.payments.', 'Situações: A pagar, Pago em parte, Pago.', 'Valor acima do saldo: “O valor passa do saldo em aberto”. Cancelada: “Ordem cancelada não recebe pagamento”.'] },
        { text: 'Cada pagamento vira uma receita paga no financeiro, na conta e na data informadas, categoria de serviços, e reduz o valor a receber. Com Pix e o módulo de pagamentos ativo, dá para gerar o QR Code, mas a baixa só ocorre ao clicar em Registrar.' },
      ],
    },
    {
      id: 'producao',
      title: 'Organizar a produção do dia',
      path: '/padaria/producao',
      simple: [
        { text: 'A tela junta as encomendas com retirada na data e soma quanto fazer de cada item. Exemplo: três encomendas de coxinha viram uma linha só.' },
        {
          steps: [
            'Abra Produção do dia e escolha a data. Olhe a véspera para se programar.',
            'Veja Total a produzir e, ao lado, cada encomenda com o horário.',
            'Clique em Imprimir para levar para a cozinha.',
            'Clique em Iniciar produção quando começar.',
            'Clique em Pronta quando terminar. O cliente recebe o aviso.',
          ],
        },
        { warn: 'A soma usa o texto exato do item. “Bolo de chocolate” e “Bolo chocolate” aparecem em linhas separadas. Prefira itens do catálogo.' },
        { warn: 'A soma inclui encomendas já prontas e ainda não retiradas. Confira a lista ao lado antes de produzir.' },
      ],
      technical: [
        { list: ['Permissão da tela: shared.service-orders.read. Mudar status: shared.service-orders.status.', 'Entram encomendas com retirada na data, exceto Retirada e Cancelada.', 'Só as observações internas aparecem na tela e na impressão.', 'Não considera produtos do PDV nem estoque: só encomendas.'] },
        { text: 'Situações: Encomendada, Em produção, Pronta para retirar, Retirada e Cancelada. Pronta dispara o aviso Encomenda pronta. Voltar de Pronta para Em produção e marcar pronta de novo envia o aviso outra vez.' },
      ],
    },
    {
      id: 'retirada-e-cancelamento',
      title: 'Entregar a encomenda ou cancelar',
      path: '/padaria/encomendas',
      simple: [
        { text: 'Quando o cliente vem buscar, encerre a encomenda. Assim ela sai da produção e da lista de pendências.' },
        {
          steps: [
            'Em Encomendas, busque por número ou cliente e abra a encomenda.',
            'Confira o valor Em aberto e registre o pagamento, se houver.',
            'Clique em Marcar como “Retirada”.',
          ],
        },
        { text: 'Para cancelar, clique em Cancelar ordem, escreva o Motivo e confirme.' },
        { warn: 'Depois de Pronta para retirar, não aparece Cancelar ordem. Volte antes para Em produção, com Marcar como “Em produção”, e então cancele.' },
      ],
      technical: [
        { list: ['Permissão: shared.service-orders.status.', 'Encomendada vai para Em produção, Pronta para retirar ou Cancelada. Em produção vai para Pronta para retirar ou Cancelada. Pronta para retirar vai para Retirada ou Em produção.', 'Marcar como Retirada não exige pagamento completo e não gera aviso ao cliente.'] },
        { text: 'Cancelar exige motivo e zera o valor a receber. Pagamentos já feitos, como o sinal, continuam registrados. Se houver devolução, lance à mão no financeiro. A lista de Encomendas mostra até 100 registros: use a busca e o filtro de status para achar as mais antigas.' },
      ],
    },
    {
      id: 'estoque',
      title: 'Lançar entradas, produção e perdas',
      path: '/produtos',
      simple: [
        { text: 'Use para manter certo o saldo dos produtos que têm controle de estoque, como frios, leite e refrigerante.' },
        {
          steps: [
            'Em Produtos e estoque, clique em Estoque na linha do produto.',
            'Em Movimento, escolha: Entrada (compra), Produção, Perda / quebra ou Inventário (contagem).',
            'Digite a quantidade. No inventário, digite quanto você contou.',
            'Na compra, preencha o Custo unitário. Em Observação, pode citar a nota ou o motivo.',
            'Confira a Data e clique em Lançar.',
          ],
        },
        { tip: 'Marque Só estoque baixo para ver o que está acabando.' },
        { warn: 'O botão Estoque só aparece com Controlar estoque ligado. Pão, sonho e outros vêm desligados. Ligue em Editar se quiser lançar produção ou perdas deles.' },
      ],
      technical: [
        { list: ['Permissão: shared.sales.stock.', 'Entrada e Produção somam. Perda subtrai. Inventário troca o saldo pela quantidade contada e registra a diferença.', 'Entrada com custo atualiza o Custo do produto.', 'A data não pode ser futura. Lançar em data passada não reordena o saldo gravado em cada movimento.', 'A lista mostra os últimos 200 movimentos, com o saldo depois de cada um.'] },
        { text: 'Estes lançamentos não geram conta a pagar nem despesa. Compras a pagar são lançadas no Financeiro. Não há ficha técnica: produzir um item não baixa os ingredientes.' },
      ],
    },
    {
      id: 'fechar-caixa',
      title: 'Fazer sangria e fechar o caixa',
      path: '/pdv',
      simple: [
        { text: 'A sangria registra o dinheiro que sai da gaveta. O suprimento, o que entra para reforçar o troco. O fechamento compara o que deveria ter com o que você contou.' },
        {
          steps: [
            'No PDV, clique em Sangria, suprimento e fechamento.',
            'Para retirar ou colocar dinheiro, clique em Sangria ou Suprimento. Digite Valor e Motivo, diga para onde foi ou de onde veio e confirme.',
            'No fim do turno, clique em Fechar caixa.',
            'Conte a gaveta e digite em Dinheiro. Cartão e Pix são opcionais.',
            'Clique em Fechar caixa e, se quiser, em Imprimir fechamento.',
          ],
        },
        { warn: 'Depois de fechado, o caixa não pode mais ser alterado. Confira a contagem antes.' },
      ],
      technical: [
        { list: ['Permissão: shared.sales.register.', 'Dinheiro esperado: troco inicial, mais vendas em dinheiro, mais suprimentos, menos sangrias.', 'Sangria acima do esperado: “A sangria passa do dinheiro esperado na gaveta”.', 'Sem conta escolhida, a sangria é despesa e o suprimento é receita. Com conta, é transferência.', 'Fiado não entra na conferência.'] },
        { text: 'A diferença em dinheiro vira lançamento no financeiro na data do fechamento: quebra como despesa, sobra como receita. Diferença em cartão ou Pix fica só no relatório. O fechamento não pode ser antes da última venda ou movimento da sessão.' },
      ],
    },
    {
      id: 'vendas-e-caixas',
      title: 'Conferir vendas, cancelar e ver caixas antigos',
      path: '/vendas',
      simple: [
        { text: 'Em Vendas, você vê o total do período, as formas de pagamento e os mais vendidos. Em Caixas, cada abertura e fechamento, com quebras e sobras.' },
        {
          steps: [
            'Abra Vendas e escolha as datas.',
            'Clique em uma venda para ver os itens.',
            'Para cancelar, clique em Cancelar venda, escreva o Motivo e clique em Confirmar cancelamento.',
            'Abra Caixas para ver o histórico. Marque Só com quebra ou sobra para olhar as diferenças.',
            'Se o sistema ficou fora do ar, use Lançar caixa de outro dia.',
          ],
        },
        { tip: 'Depois de lançar um caixa antigo, lance as vendas dele no PDV com Lançar venda anterior, no mesmo computador.' },
      ],
      technical: [
        { list: ['Vendas: shared.sales.read. Cancelar: shared.sales.cancel, com motivo de no mínimo 3 caracteres.', 'Caixas: shared.sales.register.history. Lançar caixa de outro dia pede também shared.sales.register.', 'A lista de vendas mostra até 200 por período.'] },
        { text: 'Cancelar devolve os itens ao estoque com o movimento Venda cancelada e estorna os lançamentos no financeiro. A venda continua na lista, riscada. O relatório de um caixa já fechado não muda.' },
      ],
    },
  ],
};
