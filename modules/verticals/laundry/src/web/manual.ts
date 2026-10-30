import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Lavanderia',
  summary: 'Do recebimento das peças à entrega: balcão, etiquetas, produção, coleta e entrega.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/lavanderia/servicos',
      simple: [
        { text: 'Antes da primeira ordem, deixe o básico pronto. Assim o balcão já mostra os serviços e os preços certos.' },
        {
          steps: [
            'Abra Serviços e preços. O sistema já traz quatro serviços de exemplo e uma lista de tipos de peça. Ajuste os preços e os prazos para os da sua lavanderia.',
            'No Financeiro, em Contas e categorias, confira se existe uma conta de caixa. É nela que entram os pagamentos.',
            'Em Configurações, Usuários, convide quem trabalha com você e escolha o papel de cada um: Atendente, Operador ou Motorista.',
            'Se faz coleta e entrega, abra Coletas e entregas e preencha as Taxas padrão.',
            'Separe a impressora: comprovante em cupom de 80 mm ou A4 e etiquetas de 6 × 3,5 cm.',
            'Faça uma ordem de teste no Balcão, usando o seu próprio cadastro como cliente, para ver o caminho completo.',
          ],
        },
        { tip: 'Cadastre o telefone e o e-mail dos clientes. Sem contato, o aviso de peças prontas não chega.' },
      ],
      technical: [
        { text: 'Ao ativar o módulo, se a empresa ainda não tiver cadastro, são criados 17 tipos de peça e 4 serviços: Lavar e passar (R$ 14,90, 48 h), Só passar (R$ 8,90, 24 h), Lavagem a seco (R$ 29,90, 72 h) e Lavagem por quilo (R$ 19,90/kg, 48 h).' },
        {
          list: [
            'Atendente: ordens, status, pagamentos, clientes, coletas e entregas (gerenciar e dirigir).',
            'Operador: ver ordens e mover peças (laundry.orders.read, laundry.orders.status, mais leitura e status das ordens de serviço).',
            'Motorista: só laundry.logistics.drive (Fazer coletas e entregas, só as atribuídas a si).',
            'laundry.catalog.manage (Gerenciar serviços e preços) e laundry.reports.read (Ver relatórios da lavanderia) não fazem parte de nenhum desses papéis: só o dono da conta os tem de início. Para outra pessoa, inclua em um papel próprio.',
            'Taxas padrão exigem core.access.settings (Configurar os módulos contratados).',
          ],
        },
        { text: 'Não há tela para as configurações de modo de cobrança e de foto obrigatória no recebimento. A foto da peça não é exigida ao abrir a ordem.' },
      ],
    },
    {
      id: 'servicos-e-precos',
      title: 'Ajustar serviços, tipos de peça e preços',
      path: '/lavanderia/servicos',
      simple: [
        { text: 'Aqui você define o que a lavanderia oferece, como cobra e em quanto tempo entrega. É o que aparece na hora de abrir a ordem.' },
        {
          steps: [
            'Clique em Novo serviço, ou em Editar em um serviço da lista.',
            'Preencha Nome, Cobrança (por peça, por kg ou por m²), Preço e Prazo de entrega em horas. Exemplo: 48 horas são 2 dias.',
            'Clique em Salvar.',
            'Para cobrar diferente por tipo de roupa, clique em Preço por peça. Exemplo: Lavar e passar custa mais em um vestido de festa do que em uma camisa. Deixe em branco o que segue o preço normal.',
            'Na aba Tipos de peça, digite o nome e clique em Adicionar. Use Desativar para tirar um tipo da lista do balcão.',
          ],
        },
        { tip: 'Tem muitos serviços? Use Baixar modelo, preencha a planilha e clique em Importar planilha.' },
        { warn: 'Desmarcar Serviço ativo tira o serviço do balcão. Não há como apagar um serviço.' },
      ],
      technical: [
        { list: ['Permissão: laundry.catalog.manage.', 'Preço de 0 a R$ 100.000,00, com até 2 casas. Prazo de 1 a 1.440 horas. Nome de 2 a 80 caracteres.', 'Tipo de peça: nome único. Repetido é recusado com “Este tipo de peça já existe”.', 'A tabela Preço por peça só existe para serviços cobrados por peça. Serviços por kg ou m² usam sempre o preço do serviço.'] },
        { text: 'Mudar o preço não altera ordens já abertas: o valor fica gravado em cada item da ordem. As alterações ficam na auditoria.' },
      ],
    },
    {
      id: 'abrir-ordem',
      title: 'Receber roupas e abrir uma ordem',
      path: '/lavanderia/ordens/nova',
      simple: [
        { text: 'A ordem registra o que o cliente deixou, quanto vai custar e quando fica pronto. Cada peça ganha uma etiqueta para não se perder na produção.' },
        {
          steps: [
            'Abra Balcão e busque o cliente por nome, CPF/CNPJ ou telefone. Se não encontrar, clique em Cadastrar cliente.',
            'Em Peças, escolha o Serviço, o Tipo de peça e a quantidade em Peças. Nos serviços por quilo ou metro, informe também o peso ou a área.',
            'Clique em + cor, marca e avarias e anote o que a peça já tem: mancha, rasgo, botão faltando.',
            'Use Adicionar peças para incluir outro serviço ou outro tipo de roupa.',
            'Se houver, preencha o Desconto. Confira o Total.',
            'A Previsão de entrega pode ficar em branco: o sistema calcula. Observações para o cliente saem no comprovante.',
            'Clique em Abrir ordem. Depois, imprima o comprovante e as etiquetas.',
          ],
        },
        { tip: 'Anotar as avarias protege a lavanderia: elas saem no comprovante que o cliente leva.' },
        { warn: 'Confira antes de abrir. Depois de aberta, esta tela não permite trocar peças, preços ou desconto. Para corrigir, cancele e abra outra ordem.' },
      ],
      technical: [
        { list: ['Permissão: laundry.orders.write.', 'Até 100 linhas por ordem e até 200 peças por linha.', 'Por peça: cada unidade vira um item e uma etiqueta, com o preço por tipo de peça ou, sem ele, o preço do serviço.', 'Por kg ou m²: a linha inteira vira um item e uma etiqueta. A quantidade de peças é só informativa. Sem medida, a recusa é “Informe o peso para...” ou “Informe a área para...”.', 'Etiqueta: número da ordem e sequência com dois dígitos, por exemplo 123-01.'] },
        { text: 'Previsão em branco: data de entrada mais o maior prazo entre os serviços da ordem, em horas corridas (não considera expediente). Previsão anterior à entrada é recusada.' },
        { text: 'Financeiro: o total da ordem vira um único valor a receber, com vencimento na previsão de entrega. O status inicial é Recebida e o cliente recebe o aviso Peças recebidas.' },
        { text: 'Registrar ordem antiga: informe Recebida em com data passada, nunca futura. O prazo conta dessa data e o cliente não é avisado. Desconto maior que o valor dos itens é recusado.' },
      ],
    },
    {
      id: 'comprovante-e-etiquetas',
      title: 'Imprimir comprovante e etiquetas',
      simple: [
        { text: 'O comprovante fica com o cliente. As etiquetas vão presas nas peças e permitem achar cada uma na produção.' },
        {
          steps: [
            'Na tela da ordem, clique em Comprovante ou em Etiquetas.',
            'Confira o que apareceu e clique em Imprimir.',
            'Use Voltar para a ordem para continuar.',
          ],
        },
        { tip: 'Você pode reimprimir quando precisar. Basta abrir a ordem em Ordens de serviço.' },
      ],
      technical: [
        { list: ['Permissão: laundry.orders.read.', 'Etiqueta de 6 × 3,5 cm com QR Code do código da etiqueta, primeiro nome do cliente, descrição da peça e previsão.', 'Comprovante em formato de 80 mm: número, itens com etiqueta e valor, desconto, total, pago, a pagar, avarias na entrada e observações.'] },
        { text: 'A frase “Apresente este comprovante na retirada” é só uma orientação: o sistema não exige o comprovante para marcar a ordem como entregue. O comprovante não é documento fiscal.' },
      ],
    },
    {
      id: 'producao',
      title: 'Acompanhar as peças na produção',
      path: '/lavanderia/producao',
      simple: [
        { text: 'O quadro mostra onde cada peça está: Recebida, Lavagem, Secagem, Passadoria e Pronta. As mais urgentes vêm primeiro, e as atrasadas aparecem em destaque.' },
        {
          steps: [
            'Para uma peça, clique no botão com o nome da próxima etapa, como → Secagem.',
            'Para várias, marque as caixinhas, escolha a etapa e clique em Mover. Serve bem para um cesto inteiro.',
            'Com leitor de código, escolha a etapa em Ler etiqueta e mover para e passe as etiquetas. Cada leitura move a peça. Também dá para digitar o código, como 123-01.',
          ],
        },
        { tip: 'Você não precisa mudar a situação da ordem. Quando a primeira peça começa, a ordem fica Em produção. Quando todas ficam prontas, a ordem fica Pronta e o cliente é avisado.' },
        { warn: 'Ao ficar Pronta, a ordem sai do quadro. Se uma peça precisar voltar, use Ler etiqueta e mover para: ela volta à etapa escolhida e a ordem volta para produção.' },
      ],
      technical: [
        { list: ['Permissão da tela: laundry.orders.status. O quadro atualiza sozinho a cada 30 segundos.', 'Mostra só peças de ordens Recebida ou Em produção, por previsão e número da ordem.', 'Até 200 peças por movimento. Em ordem já fora da produção, a recusa é “A ordem nº X já saiu da produção”.', 'Etiqueta inexistente: “Nenhuma peça com a etiqueta X”.'] },
        { text: 'Voltar para uma etapa anterior conta como retrabalho: soma 1 no contador da peça e aparece o selo Retrabalho. Depois de pronta, voltar leva a ordem para Em produção sem novo aviso; quando todas ficarem prontas outra vez, o aviso Peças prontas é enviado de novo.' },
        { text: 'Pronta só acontece com todas as peças prontas. O botão correspondente não aparece na ordem, e a API recusa com “Ainda há X peça(s) em produção”.' },
      ],
    },
    {
      id: 'ocorrencias-e-fotos',
      title: 'Registrar avaria e tirar fotos da peça',
      path: '/ordens',
      simple: [
        { text: 'Use quando algo acontece durante o processo, como mancha que não saiu ou peça danificada. O registro fica na ordem e o cliente é avisado.' },
        {
          steps: [
            'Abra a ordem em Ordens de serviço.',
            'Na peça, clique em Foto para anexar uma imagem. No celular, abre a câmera.',
            'Clique em Registrar ocorrência e descreva em O que aconteceu.',
            'Clique em Registrar e avisar o cliente.',
          ],
        },
        { warn: 'O aviso sai na hora. Escreva pensando que o cliente vai ler o texto como está.' },
      ],
      technical: [
        { list: ['Permissão: laundry.orders.status.', 'Descrição de 5 a 500 caracteres. Mais curta, a recusa é “Descreva o ocorrido”.', 'Foto em JPEG, PNG ou WebP, até 8 MB.', 'Registrar ocorrência só aparece com a ordem Recebida ou Em produção. Foto pode ser anexada também depois.'] },
        { text: 'A tela mostra só a última ocorrência de cada peça, mas todas ficam guardadas nos eventos da peça e na linha do tempo do cliente, e contam no relatório. O aviso usa o modelo Ocorrência com uma peça. O texto da janela cita e-mail, mas com o WhatsApp ativo o aviso também vai por lá.' },
      ],
    },
    {
      id: 'pagamento',
      title: 'Receber o pagamento da ordem',
      path: '/ordens',
      simple: [
        { text: 'Registre aqui tudo o que o cliente pagar, de uma vez ou em partes. Assim a ordem mostra quanto falta e o financeiro fica certo.' },
        {
          steps: [
            'Abra a ordem em Ordens de serviço. Dá para buscar por número ou cliente.',
            'Clique em Registrar pagamento.',
            'Confira o Valor. Ele já vem com o que falta. Para um sinal, digite só o valor recebido.',
            'Escolha a Data, a Forma de pagamento e a Conta.',
            'Clique em Registrar.',
          ],
        },
        { tip: 'Com Pix e o módulo de pagamentos ativo, aparece o botão para gerar o QR Code. Confira o recebimento no aplicativo do banco antes de registrar.' },
      ],
      technical: [
        { list: ['Permissão: shared.service-orders.payments (Registrar pagamentos de ordens).', 'Valor acima do saldo: “O valor passa do saldo em aberto”. Ordem cancelada não recebe pagamento.', 'Situações: A pagar, Pago em parte, Pago.'] },
        { text: 'Cada pagamento vira uma receita paga no financeiro, na conta e na data informadas, categoria de serviços. O saldo que sobra continua como um único valor a receber. Gerar o QR Code não dá baixa: a baixa é feita ao clicar em Registrar.' },
        { text: 'A tela da lavanderia mostra Total, Pago e Em aberto, sem a lista de cada pagamento. A taxa de coleta ou entrega é um lançamento separado e não entra nesse saldo.' },
      ],
    },
    {
      id: 'entregar-no-balcao',
      title: 'Entregar no balcão e cancelar uma ordem',
      path: '/ordens',
      simple: [
        { text: 'Quando as peças ficam prontas, o cliente é avisado e vem buscar. Ao entregar, encerre a ordem.' },
        {
          steps: [
            'Em Ordens de serviço, busque o número ou o nome do cliente.',
            'Confira o valor Em aberto e registre o pagamento, se houver.',
            'Clique em Marcar como “Entregue”.',
          ],
        },
        { text: 'Para cancelar, clique em Cancelar ordem, escreva o Motivo e confirme.' },
        { warn: 'O sistema permite entregar com valor em aberto. A cobrança continua no financeiro, então confira antes.' },
        { warn: 'Se a ordem já estiver Pronta, não aparece Cancelar ordem. Ela só pode ser cancelada enquanto está Recebida ou Em produção.' },
      ],
      technical: [
        { text: 'Situações: Recebida, Em produção, Pronta, Saiu para entrega, Entregue e Cancelada. De Pronta vai para Entregue ou Saiu para entrega. De Saiu para entrega vai para Entregue ou, quando a entrega agendada falha ou é cancelada, volta para Pronta. Entregue e Cancelada são finais.' },
        { list: ['Permissão: shared.service-orders.status.', 'Cancelar exige motivo: “Informe o motivo do cancelamento”.', 'Cancelar zera o valor a receber. Pagamentos já feitos continuam registrados; devolução é lançada à mão no financeiro.', 'Avisos: Peças prontas, Saiu para entrega e Peças entregues, por e-mail e, com o módulo de WhatsApp ativo, também por WhatsApp. Sem contato cadastrado, ou se o cliente pediu para não receber, o aviso é pulado. Textos em Configurações, Notificações.'] },
        { text: 'Cancelar a ordem não cancela uma entrega já agendada para ela. Cancele também em Coletas e entregas.' },
      ],
    },
    {
      id: 'coleta',
      title: 'Agendar uma coleta na casa do cliente',
      path: '/lavanderia/logistica',
      simple: [
        { text: 'A coleta é a busca das roupas no endereço do cliente, antes de existir ordem. O motorista informa quantas peças vieram, e a conferência peça a peça é feita no balcão.' },
        {
          steps: [
            'Abra Coletas e entregas e clique em Agendar coleta.',
            'Escolha o cliente. O endereço vem do cadastro, e você pode mudar só para esta coleta.',
            'Escolha o Dia e o Período: Manhã, Tarde, Noite ou Horário específico.',
            'Confira a Taxa de coleta. Vazio usa a taxa padrão.',
            'Escolha o Motorista, se já souber, e clique em Agendar.',
            'Quando a coleta estiver Concluída, clique em Abrir ordem no balcão e confira as peças.',
          ],
        },
        { tip: 'Se a coleta já aconteceu e não foi lançada, agende com a data passada e depois conclua informando o horário. O cliente não recebe aviso.' },
      ],
      technical: [
        { list: ['Permissão: laundry.logistics.manage. Abrir a ordem pede também laundry.orders.write.', 'Períodos: Manhã das 8h às 12h, Tarde das 12h às 18h, Noite das 18h às 21h.', 'Sem rua nem CEP: “Informe o endereço (rua ou CEP): o cliente não tem endereço cadastrado”.', 'Horário final antes do inicial: “O horário final deve ser depois do inicial”.'] },
        { text: 'A taxa maior que zero vira um valor a receber próprio, separado da ordem, com vencimento no dia da coleta. Taxa padrão começa em R$ 0,00 e é ajustada no cartão Taxas padrão.' },
        { text: 'A ordem aberta pelo botão fica ligada à coleta. Coleta só pode ser ligada a uma ordem do mesmo cliente, e cada uma só uma vez. Avisos: Coleta agendada (também ao reagendar) e Motorista a caminho da coleta. Coleta em dia já passado não gera aviso.' },
      ],
    },
    {
      id: 'entrega',
      title: 'Agendar entregas e distribuir motoristas',
      path: '/lavanderia/logistica',
      simple: [
        { text: 'A entrega nasce na ordem. No quadro de Coletas e entregas, você vê tudo do dia, separado por motorista, e resolve o que ficou pendente.' },
        {
          steps: [
            'Abra a ordem e, no cartão Entrega, clique em Entregar no endereço.',
            'Confira endereço, Dia, Período, taxa e motorista. Clique em Agendar.',
            'No quadro, escolha o dia. As tarefas sem motorista aparecem primeiro.',
            'Em cada cartão, escolha o motorista na lista. Use Editar para mudar dia, endereço ou taxa.',
            'Se não deu certo, a tarefa aparece em Não realizadas, aguardando reagendamento. Clique em Reagendar ou em Cancelar.',
          ],
        },
        { warn: 'Dá para agendar antes de a ordem ficar pronta, mas o motorista só consegue sair quando ela estiver Pronta.' },
      ],
      technical: [
        { list: ['Permissão: laundry.logistics.manage. O quadro atualiza a cada minuto.', 'Só uma entrega em aberto por ordem: “A ordem nº X já tem uma entrega em aberto”.', 'Agendamento só antes de a ordem sair: Recebida, Em produção ou Pronta.', 'Editar só em tarefas Agendada ou Não realizada: “Só dá para alterar coletas/entregas agendadas ou não realizadas”.', 'Taxa já recebida não muda: “A taxa já foi recebida e não pode mais ser alterada”.'] },
        { text: 'A lista de motoristas traz todos os usuários ativos da empresa, não só quem tem o papel Motorista. Não há roteirização: a ordem da rota segue dia e janela de horário.' },
        { text: 'Situações: Agendada, Em rota, Concluída, Não realizada e Cancelada. Reagendar uma Não realizada a devolve para Agendada, mantém o selo da tentativa que falhou e reenvia o aviso de agendamento. Cancelar apaga a taxa ainda não recebida e, se a ordem tinha saído, ela volta para Pronta sem novo aviso. Avisos: Entrega agendada, Saiu para entrega e Peças entregues.' },
      ],
    },
    {
      id: 'minhas-rotas',
      title: 'Fazer a rota do dia (motorista)',
      path: '/lavanderia/minhas-rotas',
      simple: [
        { text: 'No celular, o motorista vê as coletas e entregas dele na ordem dos horários, com botões para ligar, chamar no WhatsApp e abrir o mapa.' },
        {
          steps: [
            'Abra Minhas rotas.',
            'Antes de sair, clique em Sair para a coleta ou Sair para a entrega. O cliente é avisado.',
            'Na chegada, clique em Concluir.',
            'Na entrega, escreva Quem recebeu. Na coleta, informe as Peças coletadas.',
            'Se quiser, use Tirar foto. Se recebeu a taxa, marque a opção e escolha a forma.',
            'Clique em Concluir.',
            'Se não deu, clique em Não realizada, escolha ou escreva o motivo e clique em Registrar.',
          ],
        },
        { warn: 'O cartão mostra A receber com o saldo da ordem e a taxa. Nesta tela só dá para registrar a taxa. O pagamento da ordem precisa ser lançado por alguém do escritório, na ordem.' },
        { tip: 'Esqueceu de registrar na hora? Use Aconteceu em outro horário na janela de conclusão.' },
      ],
      technical: [
        { list: ['Permissão: laundry.logistics.drive. Cada um vê só o que está atribuído a si, mais o que ficou Em rota de outros dias. Atualiza a cada minuto.', 'Saída de entrega com a ordem fora de Pronta: “A ordem nº X ainda não está pronta para entrega”.', 'Sem nome de quem recebeu: “Informe o nome de quem recebeu”. Sem peças: “Informe quantas peças foram coletadas”. Motivo de falha: no mínimo 3 caracteres.', 'Foto em JPEG, PNG ou WebP, até 8 MB.'] },
        { text: 'Concluir entrega marca a ordem como Entregue, mesmo com saldo em aberto. Não realizada devolve a ordem para Pronta, sem avisar o cliente, e a taxa continua a receber.' },
        { text: 'Taxa recebida: dá baixa no financeiro na data da conclusão, na conta de caixa padrão. Sem conta: “Cadastre uma conta (caixa) no financeiro para registrar a taxa recebida”.' },
        { text: 'Registro posterior: o horário não pode ser futuro, nem antes do dia da tarefa, da saída ou da tentativa anterior. Se o evento tiver mais de 30 minutos, o cliente não é avisado.' },
      ],
    },
    {
      id: 'relatorios',
      title: 'Ver prazos, retrabalho e receita',
      path: '/lavanderia/relatorios',
      simple: [
        { text: 'O relatório mostra se a lavanderia está cumprindo os prazos, quantas peças precisaram voltar e quais serviços trazem mais receita.' },
        {
          steps: [
            'Abra Relatórios da lavanderia.',
            'Escolha o período: Hoje ou os últimos 7, 30 ou 90 dias.',
            'Veja primeiro Ordens atrasadas agora e clique no número para abrir a ordem.',
          ],
        },
        { tip: 'Muitos retrabalhos em uma mesma semana podem indicar problema em uma etapa. Veja também Movimentações por pessoa.' },
      ],
      technical: [
        { list: ['Permissão: laundry.reports.read.', 'Entregues no prazo: ordens entregues no período cuja data de entrega não passou da previsão.', 'Ordens atrasadas agora: previsão vencida e ordem não entregue nem cancelada, até 20 ordens. Não depende do período.', 'Peças prontas, Retrabalhos e Ocorrências contam eventos no período.'] },
        { text: 'Receita por serviço é o valor contratado nas ordens recebidas no período, exceto canceladas, e não o valor recebido. A coluna Qtd. soma peças com quilos e metros, conforme o serviço. Para caixa e recebimentos, use o Financeiro.' },
      ],
    },
  ],
};
