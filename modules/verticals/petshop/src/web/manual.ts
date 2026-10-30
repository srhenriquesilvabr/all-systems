import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Pet shop',
  summary: 'Banho e tosa pela agenda, ficha dos pets, aviso de pet pronto e loja.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/agenda/profissionais',
      simple: [
        { text: 'A agenda só funciona depois de saber quem atende e em que horário. Comece por aí.' },
        {
          steps: [
            'Abra Profissionais e horários e clique em Novo profissional para cada banhista ou tosador.',
            'Clique em Horários e ajuste o expediente de cada um.',
            'Abra Serviços da agenda. O sistema já traz uma tabela de banho e tosa de exemplo. Ajuste preços e duração.',
            'Abra Produtos e estoque. Ajuste os produtos de exemplo e lance o saldo inicial.',
            'No Financeiro, em Contas e categorias, confira se existe uma conta de caixa.',
            'Em Configurações, Usuários, convide a equipe e escolha o papel: Recepção ou Banho e tosa.',
          ],
        },
        { tip: 'Se quiser que os clientes marquem sozinhos, veja o assunto Receber agendamentos online.' },
      ],
      technical: [
        { text: 'Ao ativar o módulo, se não houver cadastro, são criados 10 serviços e 8 produtos de exemplo. Profissional não é criado: sem ele, a agenda mostra “Nenhum profissional cadastrado”. Os produtos de exemplo começam com saldo zero.' },
        {
          list: [
            'Recepção: agenda completa, pagamentos de atendimentos, clientes, pets, vender e abrir ou fechar o caixa.',
            'Banho e tosa: ver a agenda, mudar status, ver clientes e pets.',
            'O papel Gerente soma à Recepção shared.scheduling.manage (profissionais, serviços e horários), shared.sales.products, shared.sales.stock, shared.sales.read e shared.sales.register.history. Existe também o papel Estoquista.',
          ],
        },
        { text: 'Novo profissional começa com expediente de segunda a sexta, das 9h às 12h e das 13h às 18h, e sábado das 9h às 13h. Cada profissional também vira uma pessoa na Equipe.' },
      ],
    },
    {
      id: 'tutores-e-pets',
      title: 'Cadastrar tutores e pets',
      path: '/pets',
      simple: [
        { text: 'Cada pet fica ligado ao tutor, que é o cliente. A ficha guarda temperamento, alergias e cuidados no manejo para quem vai dar o banho.' },
        {
          steps: [
            'Abra Pets e clique em Novo pet.',
            'Busque o tutor. Se não encontrar, clique em Cadastrar cliente.',
            'Preencha Nome e Espécie. Se puder, informe Raça, Porte, Peso e Pelagem.',
            'Em Observações, anote o que a equipe precisa saber. Exemplo: bravo com outros cães.',
            'Clique em Salvar.',
          ],
        },
        { tip: 'Na hora de marcar, o botão Novo, ao lado da lista de pets, cadastra sem sair da agenda.' },
        { warn: 'Não há como apagar um pet nem trocar o tutor. Se o pet faleceu, abra a ficha, clique em Editar e marque Falecido(a). Ele some da lista de marcação.' },
      ],
      technical: [
        { list: ['Permissões: shared.pets.read e shared.pets.write. Tutor exige core.customers.write para ser cadastrado.', 'Espécies: Cachorro, Gato, Ave, Roedor, Réptil, Outro. Porte: Pequeno, Médio, Grande, Gigante.', 'A lista é paginada, 25 por página. A busca é por nome, raça ou tutor.', 'Importar planilha: o tutor precisa já existir e é achado por CPF/CNPJ ou telefone.'] },
        { text: 'O porte não escolhe o serviço nem o preço. Como a tabela tem um serviço para cada porte, quem marca escolhe o serviço certo. O histórico de atendimentos fica na ficha do tutor, aba Agendamentos.' },
      ],
    },
    {
      id: 'marcar-banho',
      title: 'Marcar banho e tosa',
      path: '/agenda',
      simple: [
        { text: 'Marcar reserva o horário do profissional e já avisa o tutor. O tempo do serviço é somado sozinho.' },
        {
          steps: [
            'Abra Agenda e clique em Novo horário, ou clique em um espaço vazio na coluna do profissional.',
            'Busque o Cliente e escolha o Pet.',
            'Marque os Serviços. Exemplo: Banho, porte médio, e Corte de unhas.',
            'Escolha o Profissional e o Dia. Clique em um dos horários livres.',
            'Para cliente fixo, marque Repetir e escolha a frequência.',
            'Clique em Marcar.',
          ],
        },
        { warn: 'Escolha sempre o pet. A tela avisa enquanto ele não estiver escolhido. Sem ele, o quadro mostra só o nome do tutor e o aviso de pet pronto não é enviado. Esqueceu? No quadro, clique em Escolher o pet antes de marcar Pronto.' },
      ],
      technical: [
        { list: ['Permissão: shared.scheduling.write.', 'Duração: soma da duração e do intervalo de cada serviço. Total: soma dos preços.', 'Conflito no mesmo profissional: “Este horário já está ocupado para este profissional”.', 'Outro horário confere expediente e folga. Para uma exceção, quem tem shared.scheduling.manage clica em Marcar mesmo assim, e isso fica na auditoria.', 'Repetir: de 2 a 52 vezes. Datas que não cabem são puladas e listadas no fim, e o cliente recebe uma mensagem só.'] },
        { text: 'Aviso: Horário marcado, por e-mail e, com o módulo de WhatsApp ativo, também por WhatsApp. Marcar não lança nada no financeiro: o valor a receber nasce ao concluir ou no primeiro pagamento.' },
      ],
    },
    {
      id: 'confirmar-remarcar-cancelar',
      title: 'Confirmar, remarcar e cancelar',
      path: '/agenda',
      simple: [
        { text: 'Clique no horário para abrir os detalhes. É ali que você cuida de tudo que muda antes do atendimento.' },
        {
          list: [
            'Confirmar: o tutor disse que vem.',
            'Remarcar: escolha o Novo dia e um horário livre.',
            'Cancelar horário: escreva o motivo. O tutor recebe um aviso.',
            'Faltou: o tutor não veio.',
            'Cancelar esta e as próximas: para horários repetidos.',
          ],
        },
        { tip: 'Em Mensagens ao cliente, você vê o que foi enviado. Se aparecer Abrir no WhatsApp, envie e depois clique em Já enviei.' },
      ],
      technical: [
        { list: ['Remarcar e cancelar: shared.scheduling.write. Confirmar e Faltou: shared.scheduling.status.', 'Só horário Agendado ou Confirmado pode ser remarcado. Remarcar volta para Agendado, zera a confirmação e reenvia o lembrete.', 'Motivo de cancelamento: no mínimo 3 caracteres na tela.', 'Depois de Em atendimento, só resta concluir. O botão Cancelar horário aparece, mas a recusa é “Não é possível ir de Em atendimento para Cancelado”.'] },
        { text: 'Lembrete: por padrão, 1 dia antes. Muda em Serviços da agenda. Com WhatsApp ativo, ele traz os botões Confirmar e Cancelar, que mudam o horário sozinhos. Horário marcado já dentro da janela do lembrete não recebe lembrete.' },
      ],
    },
    {
      id: 'agendamento-online',
      title: 'Receber agendamentos online',
      path: '/agenda/servicos',
      simple: [
        { text: 'O tutor marca sozinho por um link, sem ligar. Dá para colocar no Instagram, no WhatsApp ou no Google.' },
        {
          steps: [
            'Abra Serviços da agenda.',
            'No cartão Lembretes e agendamento online, marque Receber agendamentos online.',
            'Defina a Antecedência mínima e Até quantos dias à frente.',
            'Clique em Salvar configurações e use Copiar para pegar o link.',
            'Em Serviços liberados no link, marque só os que fizerem sentido. Serviço novo vem desligado.',
          ],
        },
        { warn: 'O tutor informa só o nome e a espécie do pet. Se o nome for novo, o sistema cria a ficha com esses dados. Complete depois.' },
      ],
      technical: [
        { list: ['Configuração: core.access.settings (Configurar os módulos contratados). Sem ela, o cartão não aparece.', 'A página mostra os dias até o limite configurado (até 180) e no máximo 5 serviços por marcação.', 'Padrão: 2 horas de antecedência e 30 dias à frente. Sem a opção ligada: “Agendamento online indisponível para esta empresa”.'] },
        { text: 'O cliente é procurado pelo telefone e, sem cadastro, é criado. O pet é procurado entre os do tutor, pelo nome, sem diferenciar acento e maiúscula. O horário entra na agenda com o selo Marcado online. Pagamento online não faz parte desta página.' },
      ],
    },
    {
      id: 'quadro-do-dia',
      title: 'Tocar o dia no quadro de banho e tosa',
      path: '/petshop/hoje',
      simple: [
        { text: 'O quadro mostra cada pet do dia, da chegada até o tutor buscar. Quem está no banho enxerga o próximo sem abrir a agenda.' },
        {
          steps: [
            'Abra Banho e tosa.',
            'Quando o pet chegar, clique em Chegou. Ele vai para Na loja.',
            'Ao começar, clique em Iniciar. Ele vai para No banho / tosa.',
            'Ao terminar, clique em Pronto. Ele vai para Pronto para buscar e o tutor é avisado.',
            'Quando o tutor buscar, clique em Tutor buscou. Ele vai para Já buscado.',
            'Para ver outro dia, use as setas ou escolha a data no alto da tela.',
          ],
        },
        { tip: 'Clique no nome do pet para ver detalhes, marcar falta ou registrar o pagamento.' },
      ],
      technical: [
        { list: ['Permissão da tela: shared.scheduling.read. Botões: shared.scheduling.status. O quadro atualiza a cada 30 segundos.', 'A chegar: Agendado e Confirmado. Na loja: Chegou. No banho / tosa: Em atendimento. Pronto para buscar: Concluído. Já buscado: Concluído com a saída registrada. Cancelados e faltas não aparecem.', 'Tutor buscou: só depois de Concluído (“O pet ainda não está pronto para ser buscado”) e uma vez por horário. Pede shared.scheduling.status. O link desfazer apaga a marca e deixa o registro na auditoria.', 'Escolher o pet: só antes de concluir e com um pet do mesmo tutor. Pede shared.scheduling.write ou shared.scheduling.status.', 'O quadro mostra todos os atendimentos da agenda do dia.'] },
        { text: 'Aviso Pet pronto para buscar: enviado ao concluir, se o horário tiver um pet e a opção “Avisar o tutor (WhatsApp ou e-mail) quando o pet ficar pronto” estiver ligada. A opção fica no fim desta tela, para quem tem core.access.settings. Vale também ao concluir pelos detalhes do horário. Pode levar alguns instantes.' },
      ],
    },
    {
      id: 'receber-pagamento',
      title: 'Receber o pagamento do banho',
      path: '/petshop/hoje',
      simple: [
        { text: 'Registre o que o tutor pagar no próprio horário. Assim fica claro quanto falta e o financeiro acompanha.' },
        {
          steps: [
            'No quadro ou na agenda, clique no atendimento.',
            'Clique em Registrar pagamento.',
            'Confira o Valor, a Forma e a Conta. Clique em Registrar.',
          ],
        },
        { warn: 'Este pagamento não passa pelo Caixa (PDV) e não entra no fechamento da gaveta. Se vendeu um produto junto, ele é lançado à parte, no PDV.' },
      ],
      technical: [
        { list: ['Permissão: shared.scheduling.payments. O papel Banho e tosa não tem.', 'A data é sempre a de hoje: a tela não tem campo de data.', 'Valor acima do saldo: “O valor passa do saldo em aberto”. Cancelado ou falta não recebe pagamento.'] },
        { text: 'Cada pagamento vira uma receita paga no financeiro, categoria de serviços. Ao concluir com saldo, o restante vira um valor a receber, no dia do atendimento. Cancelar ou marcar falta zera o valor a receber. Com Pix e o módulo de pagamentos ativo, dá para gerar o QR Code; a baixa ocorre ao clicar em Registrar.' },
      ],
    },
    {
      id: 'vender-produtos',
      title: 'Vender ração e produtos no caixa',
      path: '/pdv',
      simple: [
        { text: 'O caixa é para a loja: ração, petisco, coleira. Ele calcula o troco e baixa o estoque.' },
        {
          steps: [
            'Abra Caixa (PDV). Se precisar, clique em Abrir caixa e informe o Troco inicial.',
            'Passe o código de barras ou digite o nome do produto.',
            'Se houver, preencha o Desconto. Para vender fiado, clique em + Identificar cliente.',
            'Clique em Receber, escolha a forma de pagamento e clique em Concluir venda.',
            'Clique em Imprimir cupom, se o cliente quiser, ou em Nova venda.',
          ],
        },
        { warn: 'Sem caixa aberto, a venda não entra em nenhum fechamento. A barra no alto do PDV avisa quando isso acontece.' },
      ],
      technical: [
        { list: ['Permissão: shared.sales.sell. Abrir caixa: shared.sales.register.', 'Até 5 formas por venda. Troco só em dinheiro. Fiado exige cliente.', 'Só kg e l aceitam fração. As demais: “X é vendido em quantidade inteira”.', 'O cupom traz “Não é documento fiscal”.'] },
        { text: 'Cada forma vira uma receita paga da categoria de produtos. Fiado vira um valor a receber. Com controle ligado, a venda baixa o estoque. O saldo pode ficar negativo, a não ser com Bloquear a venda de produto sem estoque ligado, em Produtos e estoque (core.access.settings). A conta de Pix e cartões e o rodapé do cupom ficam em Caixas. Lançar venda anterior usa a data informada em relatórios, estoque e financeiro.' },
      ],
    },
    {
      id: 'estoque',
      title: 'Cadastrar produtos e controlar o estoque',
      path: '/produtos',
      simple: [
        { text: 'Mantenha o saldo certo para saber o que comprar e não vender o que não tem na prateleira.' },
        {
          steps: [
            'Abra Produtos e estoque e clique em Novo produto. Preencha Nome, Preço de venda e, se tiver, Código de barras.',
            'Em Estoque mínimo, informe quando deve aparecer como baixo.',
            'Para lançar saldo, clique em Estoque na linha do produto.',
            'Escolha Entrada (compra), Perda / quebra ou Inventário (contagem), digite a quantidade e clique em Lançar.',
          ],
        },
        { tip: 'Marque Só estoque baixo para montar a lista de compras. Use Baixar modelo e Importar planilha para cadastrar muitos produtos de uma vez.' },
      ],
      technical: [
        { list: ['Cadastrar: shared.sales.products. Lançar: shared.sales.stock.', 'Código de barras: de 8 a 14 dígitos, único.', 'Entrada com custo atualiza o Custo do produto. Inventário troca o saldo pela contagem.', 'Lançamentos não geram despesa nem conta a pagar. Compras são lançadas no Financeiro.'] },
        { text: 'Banho e tosa não baixa produtos automaticamente. Para registrar o shampoo usado, por exemplo, lance uma perda à mão. Não há validade nem lote nesta tela.' },
      ],
    },
    {
      id: 'fechar-caixa-e-conferir',
      title: 'Fechar o caixa e conferir as vendas',
      path: '/pdv',
      simple: [
        { text: 'No fim do dia, conte a gaveta e compare com o que o sistema espera. Em Vendas, veja o total e os mais vendidos.' },
        {
          steps: [
            'No PDV, clique em Sangria, suprimento e fechamento.',
            'Use Sangria para retirar dinheiro e Suprimento para reforçar o troco.',
            'Clique em Fechar caixa, digite o dinheiro contado e confirme.',
            'Em Vendas, escolha as datas. Clique em uma venda para ver os itens ou em Cancelar venda.',
          ],
        },
        { warn: 'Depois de fechado, o caixa não pode mais ser alterado.' },
      ],
      technical: [
        { list: ['Fechar: shared.sales.register. Vendas: shared.sales.read. Cancelar: shared.sales.cancel. Histórico em Caixas: shared.sales.register.history.', 'Dinheiro esperado: troco inicial, mais vendas em dinheiro, mais suprimentos, menos sangrias.', 'Sangria acima do esperado é recusada.'] },
        { text: 'A diferença em dinheiro vira lançamento na data do fechamento: quebra como despesa, sobra como receita. Pagamentos de banho e tosa registrados na agenda não entram no caixa nem em Vendas. Cancelar devolve o item ao estoque e estorna o financeiro.' },
      ],
    },
  ],
};
