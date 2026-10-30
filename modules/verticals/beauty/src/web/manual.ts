import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Salão de beleza',
  summary: 'Agenda do salão, atendimento, pagamento, comissões e venda de produtos, na ordem do dia a dia.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/agenda/servicos',
      simple: [
        { text: 'Antes de marcar o primeiro horário, o sistema precisa saber o que o salão faz, quem atende e em que horário. Faça nesta ordem:' },
        {
          steps: [
            'Abra Serviços da agenda. O sistema já traz exemplos, como Corte feminino, Escova e Manicure. Ajuste os preços e os tempos, e cadastre o que faltar.',
            'Abra Profissionais e horários e clique em Novo profissional para cada pessoa que atende.',
            'Em cada profissional, clique em Horários e deixe os dias e horários certos. Dia sem horário é folga.',
            'Se o salão tem salas ou aparelhos que não podem ser usados por duas pessoas ao mesmo tempo, cadastre também. É opcional.',
            'Abra Comissões e clique em Percentuais em cada profissional.',
            'No fim da tela Serviços da agenda, escolha quando o cliente recebe o lembrete e se o salão aceita agendamento online.',
            'Peça ao responsável pelo sistema para criar o acesso de cada pessoa da equipe.',
          ],
        },
        { tip: 'Os exemplos de serviço servem para ganhar tempo. Tudo pode ser mudado. O que o salão não faz pode ser desativado.' },
      ],
      technical: [
        { text: 'Ao ativar o módulo, os 9 serviços de exemplo só são criados se a agenda ainda não tiver nenhum serviço.' },
        {
          list: [
            'Papel Recepção: shared.scheduling.read, write, status e payments, core.customers.read e write.',
            'Papel Profissional: shared.scheduling.read e status, core.customers.read.',
            'O papel Gerente soma à Recepção as comissões (beauty.commissions.read, Ver comissões de todos os profissionais; beauty.commissions.manage, Definir percentuais de comissão) e a configuração da agenda (shared.scheduling.manage).',
            'O cartão Lembretes e agendamento online exige também core.access.settings. Sem ela, o cartão não aparece.',
            'Vender no caixa usa as permissões shared.sales.*, que os papéis do salão não trazem.',
          ],
        },
      ],
    },
    {
      id: 'profissionais-e-horarios',
      title: 'Cadastrar profissionais e horários',
      path: '/agenda/profissionais',
      simple: [
        { text: 'Cada profissional vira uma coluna na agenda. O horário de trabalho define quais horários aparecem como livres.' },
        {
          steps: [
            'Clique em Novo profissional.',
            'Preencha o nome, escolha a cor na agenda e marque os serviços que a pessoa faz.',
            'Clique em Salvar.',
            'Clique em Horários. Use + intervalo para acrescentar um período e o X para tirar.',
            'Para repetir a segunda nos outros dias úteis, clique em Copiar segunda para a semana.',
            'Clique em Salvar.',
          ],
        },
        { text: 'Para folga, consulta médica ou curso, clique em Bloqueios, informe De e Até, e clique em Bloquear horário. O período aparece listrado na agenda.' },
        { text: 'Para uma sala ou aparelho, use o mesmo botão Novo profissional e troque o Tipo para Sala / equipamento.' },
        { tip: 'Quem saiu do salão não precisa ser apagado. Em Editar, desmarque Ativo. A pessoa some da agenda e o histórico continua guardado.' },
      ],
      technical: [
        {
          list: [
            'Todo cadastro novo começa com segunda a sexta das 9h às 12h e das 13h às 18h, e sábado das 9h às 13h.',
            'O profissional é ligado a uma pessoa da equipe. Com core.team.read aparecem os Dados da pessoa; editar exige core.team.manage. Uma pessoa só pode ser um profissional: "Esta pessoa já é outro profissional da agenda".',
            'Se a pessoa da equipe tem data de encerramento já passada, o profissional fica inativo automaticamente.',
            'A tela exige shared.scheduling.manage. Criar e remover bloqueios exige shared.scheduling.write. A lista mostra os bloqueios dos próximos 120 dias.',
            'Baixar modelo e Importar planilha cadastram vários de uma vez. O horário não vem da planilha.',
          ],
        },
        { text: 'Vale o que está em Quem faz, em cada serviço: serviço com alguém marcado só pode ser feito por essas pessoas. Quem não marcou nenhum serviço aqui faz só os serviços que não têm ninguém em Quem faz.' },
        { text: 'Sala não tem expediente na prática: o horário de uma sala só pinta o fundo da coluna. O que a ocupa são as reservas e os bloqueios dela.' },
      ],
    },
    {
      id: 'servicos-e-precos',
      title: 'Ajustar serviços, tempos e preços',
      path: '/agenda/servicos',
      simple: [
        { text: 'Aqui fica tudo o que pode ser marcado. O tempo que você informa decide quanto da agenda o serviço ocupa.' },
        {
          steps: [
            'Clique em Novo serviço, ou em Editar num serviço da lista.',
            'Preencha Nome, Categoria, Duração (min) e Preço (R$).',
            'Em Intervalo depois (min), coloque o tempo de limpeza ou preparo, se houver.',
            'Em Quem faz, marque os profissionais. Sem marcar ninguém, qualquer profissional faz.',
            'Clique em Salvar.',
          ],
        },
        { tip: 'Exemplo: Coloração de 120 minutos com intervalo de 15 ocupa 2h15 da agenda da profissional.' },
        { warn: 'Mudar o preço não muda os horários já marcados. Eles continuam com o preço do dia em que foram marcados.' },
      ],
      technical: [
        {
          list: [
            'Duração de 5 a 720 minutos, intervalo de 0 a 240, preço de 0 a R$ 1.000.000.',
            'Ocupação do horário: soma de duração + intervalo de todos os serviços escolhidos. Total: soma dos preços.',
            'Precisa de sala/equipamento livre: a agenda só oferece horários com uma sala que sirva livre e reserva a primeira livre se nenhuma for escolhida.',
            'Salas/equipamentos que servem: nenhuma marcada vale qualquer sala.',
            'Não há como excluir um serviço. Desmarque Ativo: ele sai da marcação e dos percentuais de comissão.',
            'Permissão: shared.scheduling.manage.',
          ],
        },
      ],
    },
    {
      id: 'marcar-horario',
      title: 'Marcar um horário',
      path: '/agenda',
      simple: [
        { text: 'Use a agenda para reservar o horário do cliente com um profissional. O cliente recebe um aviso de que está marcado.' },
        {
          steps: [
            'Clique em Novo horário, ou clique direto no espaço vazio da coluna do profissional.',
            'Busque o cliente pelo nome ou telefone. Se não encontrar, use Cadastrar cliente.',
            'Marque um ou mais serviços.',
            'Escolha o Profissional e o Dia.',
            'Clique num dos horários livres.',
            'Se quiser, escreva em Observações. Exemplo: "Trazer foto da cor desejada".',
            'Clique em Marcar.',
          ],
        },
        { text: 'No rodapé da janela aparecem o tempo total, o valor e a hora em que termina.' },
        { warn: 'O campo Outro horário aceita outra hora, mas o sistema recusa se cair fora do expediente ou numa folga. Para uma exceção real, quem configura a agenda clica em Marcar mesmo assim, e isso fica registrado.' },
      ],
      technical: [
        {
          list: [
            'Situação inicial: Agendado. Permissão: shared.scheduling.write.',
            'O banco recusa dois horários sobrepostos no mesmo profissional ("Este horário já está ocupado para este profissional") ou na mesma sala.',
            'Marcação avulsa confere expediente e bloqueio: "Fora do expediente neste horário" ou "Profissional de folga ou com horário bloqueado neste horário". Marcar mesmo assim exige shared.scheduling.manage e fica na auditoria.',
            'Cliente anonimizado, profissional inativo ou profissional que não faz todos os serviços são recusados. Limite de 10 serviços por horário.',
            'A lista de livres avança conforme o Intervalo entre horários configurado (padrão de 15 minutos) e esconde o que já passou.',
            'Aviso automático: modelo Horário marcado (shared.scheduling.booked), por e-mail ou WhatsApp, conforme a configuração de notificações. O registro também entra no histórico do cliente.',
          ],
        },
      ],
    },
    {
      id: 'horario-que-se-repete',
      title: 'Marcar um horário que se repete',
      path: '/agenda',
      simple: [
        { text: 'Serve para a cliente fixa. Exemplo: escova toda sexta às 17h. Você marca todas as datas de uma vez.' },
        {
          steps: [
            'Comece como num horário normal, em Novo horário.',
            'Marque Repetir.',
            'Em Frequência, escolha Toda semana, A cada 2 semanas ou Todo mês (mesmo dia).',
            'Em Termina, escolha Depois de (quantas vezes) ou Em (até qual data).',
            'Clique em Marcar.',
          ],
        },
        { text: 'As datas que estiverem ocupadas, de folga ou fora do expediente são puladas. No final, o sistema mostra quais não couberam e o motivo. Marque essas datas à parte, em outro horário.' },
        { tip: 'Para encerrar a série, abra um dos horários e clique em Cancelar esta e as próximas.' },
      ],
      technical: [
        {
          list: [
            'Máximo de 52 datas. Em Depois de, o total conta também as que não couberam.',
            'No mensal, mês sem aquele dia fica de fora ("O mês não tem dia 31").',
            'Motivos possíveis: Fora do expediente; Profissional de folga ou com horário bloqueado; Profissional já tem horário marcado; Sala/equipamento ocupado.',
            'Como no horário avulso, a série confere expediente e bloqueio em todas as datas. Nela não há Marcar mesmo assim: a data que não couber fica de fora.',
            'Se nada couber, nada é gravado: "Nenhuma das datas coube na agenda".',
            'O cliente recebe uma mensagem só, com as datas, e um lembrete antes de cada horário.',
            'Cancelar esta e as próximas alcança Agendado, Confirmado e Chegou a partir deste horário, com motivo obrigatório e um aviso só.',
          ],
        },
      ],
    },
    {
      id: 'dia-do-atendimento',
      title: 'Atender: da confirmação à conclusão',
      path: '/agenda',
      simple: [
        { text: 'A situação de cada horário mostra em que pé está o atendimento. Só o que for concluído conta para a comissão.' },
        {
          steps: [
            'Clique no horário na agenda.',
            'Se o cliente confirmou, clique em Confirmar.',
            'Quando ele chegar, clique em Chegou.',
            'Ao começar, clique em Iniciar atendimento. Pode pular direto para Concluir.',
            'Ao terminar, clique em Concluir.',
            'Se ele não veio, clique em Faltou.',
          ],
        },
        { warn: 'Concluído, Faltou e Cancelado não voltam atrás. Confira antes de clicar.' },
        { tip: 'Se o WhatsApp estiver no modo manual, a mensagem aparece dentro do horário, em Mensagens ao cliente. Clique em Abrir no WhatsApp, envie e depois clique em Já enviei.' },
      ],
      technical: [
        {
          list: [
            'Transições: Agendado vai para Confirmado, Chegou, Em atendimento, Concluído, Faltou ou Cancelado. Confirmado vai para os mesmos, menos Confirmado. Chegou vai para Em atendimento, Concluído ou Cancelado. Em atendimento só vai para Concluído.',
            'Permissão: shared.scheduling.status.',
            'Faltou e Cancelado liberam o horário na agenda. Horário cancelado some da tela do dia, mas fica na aba Agendamentos do cliente.',
            'Lembrete: rotina a cada 5 minutos, conforme Lembrete ao cliente (padrão de 1 dia antes). Só para Agendado e Confirmado, e não sai se o horário foi marcado já dentro desse prazo.',
            'No WhatsApp com botões, Confirmar passa o horário para Confirmado e Cancelar o cancela com o motivo "Cancelado pelo cliente pelo WhatsApp".',
          ],
        },
      ],
    },
    {
      id: 'remarcar-ou-cancelar',
      title: 'Remarcar ou cancelar',
      path: '/agenda',
      simple: [
        { text: 'Remarcar muda o dia ou a hora e avisa o cliente. Cancelar libera o horário e também avisa.' },
        { steps: ['Clique no horário na agenda.', 'Para mudar o dia ou a hora, clique em Remarcar, escolha o Novo dia e um horário livre, e clique em Remarcar para.', 'Para trocar profissional, serviço, preço ou desconto, clique em Alterar, ajuste e clique em Salvar alteração.', 'Para desmarcar, clique em Cancelar horário, escreva o motivo e confirme.'] },
        { warn: 'Depois de Concluído, Faltou ou Cancelado, o horário não muda mais.' },
      ],
      technical: [
        {
          list: [
            'Remarcar só vale em Agendado e Confirmado: "Só horários ainda não iniciados podem ser remarcados". O horário volta para Agendado, perde a confirmação e o lembrete é enviado de novo no novo prazo.',
            'Na tela, a remarcação mostra os horários livres do mesmo profissional. Outro horário passa pela mesma conferência de expediente e folga.',
            'Alterar vale até concluir e pede shared.scheduling.write; mudar preço ou desconto pede também shared.scheduling.payments. O início não muda, e o fim acompanha a duração. Valem as mesmas conferências da marcação (quem faz, expediente, folga, sala). O total não pode ficar abaixo do que já foi pago, e linha coberta por pacote ou tratamento não muda de valor. Trocar profissional ou serviço avisa o cliente.',
            'Cancelar exige motivo (a tela pede ao menos 3 letras). Permissão: shared.scheduling.write.',
            'Cancelar horário aparece em Agendado, Confirmado e Chegou. Em Em atendimento o botão não aparece: o caminho é Concluir.',
            'Valor já recebido não é devolvido automaticamente ao cancelar: o lançamento pago continua no financeiro. Só o saldo em aberto é cancelado.',
          ],
        },
      ],
    },
    {
      id: 'receber-pagamento',
      title: 'Receber o pagamento',
      path: '/agenda',
      simple: [
        { text: 'Registre o pagamento dentro do próprio horário. Assim o valor entra no financeiro certo e o saldo fica claro.' },
        {
          steps: [
            'Clique no horário na agenda.',
            'Clique em Registrar pagamento.',
            'Confira o Valor (R$). Pode ser só uma parte.',
            'Confira a Data (padrão hoje).',
            'Escolha a Forma e a Conta. Se houver caixa aberto, escolha o Caixa.',
            'Clique em Registrar.',
          ],
        },
        { tip: 'Pagou metade em dinheiro e metade no cartão? Registre duas vezes, uma para cada forma.' },
        { warn: 'Combinou desconto? Use Alterar e informe o Desconto antes de registrar. Sem isso, o saldo continua em aberto.' },
      ],
      technical: [
        {
          list: [
            'Permissão: shared.scheduling.payments. Formas: Dinheiro, Pix, Cartão de crédito, Cartão de débito, Transferência, Outro.',
            'Cada pagamento vira uma receita paga em Lançamentos, na categoria de serviços, na data informada. Futuro é recusado: "A data do pagamento não pode ser no futuro".',
            'Com Caixa escolhido e sessão aberta, o recebimento entra na conferência do fechamento como "Recebimento de atendimento". No financeiro continua um lançamento só. Dinheiro no caixa vai para a conta Caixa. Caixa fechado recusa o pagamento de hoje; com data passada, a tela não oferece caixa.',
            'Valor maior que o saldo é recusado: "O valor passa do saldo em aberto". Faltou ou Cancelado também: "Atendimento cancelado não recebe pagamento".',
            'Ao concluir, o saldo vira um "a receber" com vencimento no dia do atendimento. Com pagamento parcial, o saldo já entra antes de concluir. Faltou ou Cancelado zera esse saldo.',
            'Esse "a receber" se resolve pela agenda: o botão Baixar não aparece em Lançamentos para atendimentos.',
            'Com o módulo de Pix ativo (integration.payments), aparece a opção de gerar QR Code. A confirmação continua manual: alguém precisa clicar em Registrar.',
          ],
        },
      ],
    },
    {
      id: 'agendamento-online',
      title: 'Receber agendamentos pela internet',
      path: '/agenda/servicos',
      simple: [
        { text: 'O cliente escolhe serviço, profissional e horário por um link, sem ligar. O horário aparece na agenda como Marcado online.' },
        {
          steps: [
            'Abra Serviços da agenda e desça até Lembretes e agendamento online.',
            'Marque Receber agendamentos online.',
            'Em Serviços liberados no link, marque o que o visitante pode marcar sozinho. Serviço novo vem desligado.',
            'Preencha Antecedência mínima (horas) e Até quantos dias à frente.',
            'Clique em Salvar configurações.',
            'Clique em Copiar e divulgue o link no Instagram, no WhatsApp ou no Google.',
          ],
        },
        { text: 'Para tirar um serviço do link, desmarque em Serviços liberados no link, ou edite o serviço e desmarque Pode ser marcado online pelo cliente.' },
        { warn: 'O cliente não paga pelo link. O pagamento continua sendo registrado no salão.' },
      ],
      technical: [
        {
          list: [
            'Endereço público: /agendar/ mais o identificador da empresa. Sem login. O link só aparece se a empresa tiver identificador.',
            'O cliente é reconhecido pelo celular. Sem cadastro, um novo é criado com nome, celular e e-mail.',
            'Na hora de confirmar, o sistema confere de novo se o horário está livre: "Este horário acabou de ser ocupado. Escolha outro."',
            'Sem preferência usa o primeiro profissional com aquele horário livre.',
            'Limites: Até 5 serviços por marcação e 5 marcações por IP a cada 10 minutos. A página mostra os dias até o limite de Até quantos dias à frente (até 180), com um campo de data para ir direto.',
            'Serviço novo, inclusive os de exemplo e os da planilha, vem com a opção online desligada. Os que já estavam ligados continuam como estão.',
            'Salvar exige core.access.settings.',
          ],
        },
      ],
    },
    {
      id: 'comissoes',
      title: 'Definir e conferir comissões',
      path: '/salao/comissoes',
      simple: [
        { text: 'A tela calcula quanto cada profissional tem a receber pelos atendimentos concluídos no período.' },
        {
          steps: [
            'Abra Comissões.',
            'Clique em Percentuais no profissional.',
            'Preencha a Comissão padrão (%).',
            'Se algum serviço paga diferente, preencha o % próprio dele. Exemplo: 30% no padrão e 40% em Coloração.',
            'Clique em Salvar.',
            'No alto da tela, escolha Este mês, Mês passado ou Últimos 15 dias.',
            'Clique em Detalhar para ver dia, cliente, serviço, percentual e comissão.',
            'Para pagar, clique em Lançar no financeiro, escolha o Vencimento e confirme.',
          ],
        },
        { warn: 'O lançamento cria a despesa a pagar em Lançamentos. A baixa, quando pagar a profissional, é feita lá.' },
        { tip: 'Quem tem o papel Profissional vê o próprio valor em Minha comissão. O usuário precisa estar ligado ao cadastro do profissional.' },
      ],
      technical: [
        {
          list: [
            'Base: serviços de horários em Concluído, com início no período, pelo preço gravado no horário. Não depende de o cliente ter pago.',
            'Percentual: o % próprio do serviço; sem ele, a Comissão padrão; sem nenhum, 0%. Cálculo arredondado ao centavo, linha a linha.',
            'Faltou e Cancelado não contam. Serviço com preço R$ 0 gera comissão R$ 0.',
            'O percentual e o valor ficam gravados quando o atendimento é concluído. Mudar o percentual depois vale só para o que for concluído daí em diante.',
            'Lançar no financeiro cria uma despesa por profissional, com o que ainda não foi lançado no período. Repetir o período, ou lançar um período que cruza outro, não duplica: "Não há comissão a lançar neste período". Enquanto não foi paga, a despesa pode ser cancelada com motivo, e as linhas voltam a ficar a lançar. Paga, é recusado.',
            'Vendas no caixa (PDV) não geram comissão.',
            'Permissões: beauty.commissions.read para ver todos; beauty.commissions.manage para Percentuais e para lançar; beauty.commissions.own para Minha comissão, que mostra só as linhas de quem está logado.',
            'Período só pelas três opções da tela. Percentual de 0 a 100, com até duas casas. A comissão incide sobre o valor cobrado, já com desconto.',
          ],
        },
      ],
    },
    {
      id: 'vender-produtos',
      title: 'Vender produtos no balcão',
      path: '/pdv',
      simple: [
        { text: 'Use o Caixa (PDV) para vender shampoo, esmalte e outros produtos. É separado do pagamento do atendimento, que fica na agenda.' },
        {
          steps: [
            'Abra Caixa (PDV). Se aparecer Abra o caixa para vender, escolha o caixa e informe o troco inicial.',
            'Passe o código de barras ou busque o produto pelo nome.',
            'Ajuste a quantidade, se precisar.',
            'Se quiser, clique em + Identificar cliente e preencha o Desconto.',
            'Clique em Receber, escolha a forma de pagamento e clique em Concluir venda.',
            'Clique em Imprimir cupom, se o cliente pedir, e em Nova venda.',
          ],
        },
        { warn: 'O cupom impresso não é documento fiscal.' },
      ],
      technical: [
        {
          list: [
            'Permissão: shared.sales.sell. Abrir e fechar caixa: shared.sales.register. Cancelar venda, pela tela Vendas: shared.sales.cancel.',
            'Formas: Dinheiro, Pix, Débito, Crédito, Fiado (a receber) e Outro, até 5 por venda. Só dinheiro pode ter troco. Fiado exige cliente identificado.',
            'Formas pagas entram como receita paga no financeiro. Fiado entra como "a receber".',
            'A venda dá baixa no estoque dos produtos que controlam estoque.',
            'Lançar venda anterior registra uma venda em outra data, sem data futura.',
          ],
        },
      ],
    },
    {
      id: 'estoque-de-produtos',
      title: 'Cadastrar produtos e controlar o estoque',
      path: '/produtos',
      simple: [
        { text: 'Aqui ficam os produtos que o salão vende, com preço e saldo.' },
        {
          steps: [
            'Clique em Novo produto. Preencha Nome, Preço de venda (R$) e, se tiver, Código de barras (EAN).',
            'Em Estoque mínimo, informe o saldo em que quer ser alertado.',
            'Clique em Salvar.',
            'Para lançar uma compra, clique em Estoque no produto, escolha Entrada (compra), informe a Quantidade e clique em Lançar.',
            'Para ver o que está acabando, marque Só estoque baixo.',
          ],
        },
        { tip: 'Fez uma contagem física? Escolha Inventário (contagem) e informe a quantidade contada. O saldo passa a ser esse número.' },
      ],
      technical: [
        {
          list: [
            'Movimentos manuais: Entrada (compra), Produção, Perda / quebra e Inventário (contagem). Venda e Venda cancelada entram sozinhas.',
            'Permissões: shared.sales.products para cadastrar e shared.sales.stock para movimentar.',
            'Código de barras tem de 8 a 14 dígitos. Produto com Controlar estoque desmarcado não tem saldo.',
            'O consumo de produtos nos serviços do salão não é baixado automaticamente: lance como Perda / quebra ou faça o inventário.',
          ],
        },
      ],
    },
  ],
};
