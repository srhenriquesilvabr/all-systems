import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Clínica ortodôntica',
  summary: 'Agenda, prontuário, tratamentos e mensalidades, na ordem do dia a dia da clínica.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/agenda/servicos',
      simple: [
        { text: 'Antes de atender o primeiro paciente, deixe a clínica configurada nesta ordem:' },
        {
          steps: [
            'Abra Serviços da agenda. O sistema já traz exemplos, como Avaliação ortodôntica e Manutenção mensal. Ajuste os tempos e os preços.',
            'Abra Profissionais e horários e cadastre cada dentista. Se quiser, cadastre também as cadeiras ou salas.',
            'Em cada dentista, clique em Horários e deixe os dias certos.',
            'No fim da tela Serviços da agenda, escolha quando o paciente recebe o lembrete.',
            'Abra Contas e categorias, no Financeiro, e confira as contas onde o dinheiro entra.',
            'Peça ao responsável pelo sistema para criar o acesso de cada pessoa.',
          ],
        },
        { tip: 'Se a clínica já tem pacientes em tratamento, cadastre-os e inicie o tratamento com a data de início real.' },
      ],
      technical: [
        { text: 'Os 7 serviços de exemplo só são criados na ativação se a agenda não tiver nenhum serviço.' },
        {
          list: [
            'Papel Ortodontista: agenda (ver e situação), prontuário (ver e incluir), orthodontics.treatments.read e manage, core.customers.read. Não marca na agenda.',
            'Papel Recepção: agenda (ver, marcar, situação e pagamentos), orthodontics.treatments.read, clientes. Não inicia nem encerra tratamento, nem vê prontuário.',
            'A Recepção dá baixa nas mensalidades (core.finance.read e core.finance.write). Nenhum dos dois traz shared.scheduling.manage: dê em Configurações › Papéis.',
            'orthodontics.treatments.read é Ver tratamentos e mensalidades. orthodontics.treatments.manage é Iniciar, prorrogar e encerrar tratamentos.',
          ],
        },
      ],
    },
    {
      id: 'dentistas-e-horarios',
      title: 'Cadastrar dentistas, salas e horários',
      path: '/agenda/profissionais',
      simple: [
        { text: 'Cada dentista vira uma coluna na agenda. O horário de trabalho define o que aparece como livre.' },
        {
          steps: [
            'Clique em Novo profissional, preencha o nome e clique em Salvar.',
            'Clique em Horários. Use + intervalo para acrescentar um período. Dia sem horário é folga.',
            'Use Copiar segunda para a semana para repetir os dias úteis e clique em Salvar.',
            'Para férias ou congresso, clique em Bloqueios, informe De e Até, e clique em Bloquear horário.',
            'Para uma cadeira ou sala, clique em Novo profissional e troque o Tipo para Sala / equipamento.',
          ],
        },
        { tip: 'Dentista que saiu não precisa ser apagado. Em Editar, desmarque Ativo.' },
      ],
      technical: [
        {
          list: [
            'Novo cadastro começa com segunda a sexta 9h às 12h e 13h às 18h, e sábado 9h às 13h.',
            'A tela exige shared.scheduling.manage. Bloqueios exigem shared.scheduling.write e são listados nos próximos 120 dias.',
            'Sala só é reservada se for escolhida no horário ou se o serviço tiver Precisa de sala/equipamento livre.',
            'O serviço com alguém marcado em Quem faz só pode ser feito por essas pessoas.',
            'Baixar modelo e Importar planilha cadastram vários de uma vez, sem os horários.',
          ],
        },
      ],
    },
    {
      id: 'marcar-consulta',
      title: 'Marcar uma consulta ou manutenção',
      path: '/agenda',
      simple: [
        { text: 'Reserva o horário do paciente com o dentista. O paciente recebe um aviso de que está marcado.' },
        {
          steps: [
            'Clique em Novo horário, ou no espaço vazio da coluna do dentista.',
            'Busque o paciente. Se não encontrar, use Cadastrar cliente.',
            'Marque o serviço, como Manutenção mensal.',
            'Escolha o Profissional e o Dia, clique num horário livre e em Marcar.',
          ],
        },
        { text: 'Para manutenções fixas, marque Repetir, escolha A cada 2 semanas ou Todo mês (mesmo dia), e diga quando Termina. As datas que não couberem aparecem no final.' },
        { warn: 'O campo Outro horário aceita outra hora, mas o sistema recusa se cair fora do expediente ou numa folga. Para uma exceção real, quem configura a agenda clica em Marcar mesmo assim, e isso fica registrado.' },
      ],
      technical: [
        {
          list: [
            'Permissão: shared.scheduling.write. O banco recusa sobreposição no mesmo profissional ou sala.',
            'Marcação avulsa não confere expediente nem bloqueio. A repetição confere em cada data e aceita até 52 datas.',
            'Avisos automáticos: marcado, remarcado, cancelado e lembrete (padrão 1 dia antes), conforme a configuração de notificações.',
            'A lista de livres usa o Intervalo entre horários (padrão 15 minutos) e soma duração e intervalo dos serviços.',
          ],
        },
      ],
    },
    {
      id: 'manutencao-e-cobranca',
      title: 'Manutenção: o que é cobrado na agenda',
      path: '/agenda',
      simple: [
        { text: 'Quem está em tratamento já paga a manutenção na mensalidade. Por isso, a manutenção sai com valor zero na agenda.' },
        { list: ['Paciente com tratamento em andamento: Manutenção mensal sai por R$ 0, com o texto "no tratamento".', 'Paciente sem tratamento ativo: paga o preço normal do serviço.', 'Outros serviços, como Colagem de bráquete e Contenção: pagam o preço normal, mesmo em tratamento.'] },
        { text: 'Tratamento com Documentação e instalação preenchida: o serviço Instalação de aparelho sai por R$ 0 na agenda, com o texto "na taxa do tratamento". Assim não se cobra duas vezes. Vale para uma instalação; marcar outra volta a cobrar o preço do serviço.' },
      ],
      technical: [
        {
          list: [
            'Regra: serviço da categoria exatamente Manutenção + cliente com tratamento em situação Em tratamento, no momento da marcação.',
            'Mudar a categoria do serviço desliga o valor zero. Serviço novo com a categoria Manutenção entra na regra.',
            'O preço é gravado ao marcar. Encerrar o tratamento não altera manutenções já marcadas, nem iniciar altera as anteriores.',
            'A regra vale também em marcação online e em repetição.',
            'O preço de um horário já marcado não pode ser alterado na tela.',
          ],
        },
      ],
    },
    {
      id: 'atender',
      title: 'Atender, remarcar e cancelar',
      path: '/agenda',
      simple: [
        { text: 'Abra o horário na agenda para registrar cada etapa do atendimento.' },
        {
          steps: [
            'Clique em Confirmar quando o paciente confirmar, e em Chegou quando ele chegar.',
            'Clique em Iniciar atendimento e, no fim, em Concluir.',
            'Se ele não veio, clique em Faltou.',
            'Para mudar a data, clique em Remarcar, escolha o Novo dia e um horário.',
            'Para desmarcar, clique em Cancelar horário e escreva o motivo.',
          ],
        },
        { warn: 'Concluído, Faltou e Cancelado não voltam atrás.' },
        { warn: 'Depois de Concluído, Faltou ou Cancelado, o horário não muda mais. Para trocar dentista, serviço, preço ou desconto de um horário aberto, clique em Alterar.' },
      ],
      technical: [
        {
          list: [
            'Transições: Agendado e Confirmado vão para Chegou, Em atendimento, Concluído, Faltou ou Cancelado (Agendado também para Confirmado). Chegou vai para Em atendimento, Concluído ou Cancelado. Em atendimento só para Concluído.',
            'Alterar vale até concluir e pede shared.scheduling.write; mudar preço ou desconto pede também shared.scheduling.payments. O início não muda, e o fim acompanha a duração. Valem as mesmas conferências da marcação (quem faz, expediente, folga, sala). O total não pode ficar abaixo do que já foi pago, e linha coberta por pacote ou tratamento não muda de valor. Trocar profissional ou serviço avisa o cliente.',
            'Permissões: shared.scheduling.status para a situação e shared.scheduling.write para remarcar e cancelar.',
            'Remarcar só em Agendado e Confirmado. O horário volta para Agendado e o lembrete é reenviado.',
            'Faltou e Cancelado liberam o horário. A aba Agendamentos do paciente guarda o histórico.',
            'Em Mensagens ao cliente, no WhatsApp manual, use Abrir no WhatsApp e Já enviei.',
          ],
        },
      ],
    },
    {
      id: 'prontuario',
      title: 'Registrar anamnese, avaliação e manutenção',
      path: '/clientes',
      simple: [
        { text: 'O prontuário guarda a história do tratamento. O que entra não pode ser apagado nem editado, só corrigido por uma retificação.' },
        {
          steps: [
            'Abra Clientes, entre na ficha do paciente e clique na aba Prontuário.',
            'Clique em + Anamnese, + Avaliação ortodôntica, + Manutenção ou + Anotação.',
            'Confira a Data do atendimento, preencha e clique em Incluir no prontuário.',
            'Para anexar radiografia ou foto, clique em Anexar arquivo no registro.',
            'Para corrigir, clique em Retificar, ajuste e escreva o Motivo da retificação.',
          ],
        },
        { tip: 'Na manutenção, registre os arcos, os elásticos e a Próxima etapa. Assim, quem atender na próxima vez sabe por onde seguir.' },
      ],
      technical: [
        {
          list: [
            'Permissões: shared.medical-records.read para ver e write para incluir, anexar e retificar. Quem acessou exige shared.medical-records.audit, que os papéis padrão não trazem.',
            'Obrigatórios: Queixa principal na Anamnese; Plano de tratamento na Avaliação ortodôntica. Registro totalmente vazio é recusado.',
            'A data do atendimento pode ser passada, nunca futura.',
            'Retificação cria um novo registro e mantém o original, marcado como Retificado. Só a versão mais recente pode ser retificada.',
            'Anexos: JPG, PNG, WebP ou PDF, até 15 MB, sem remoção.',
            'Log de acesso: abrir, incluir, retificar, anexar e abrir anexo.',
            'O prontuário não se liga automaticamente ao horário da agenda, e o sistema não gera plano nem conduta.',
          ],
        },
      ],
    },
    {
      id: 'iniciar-tratamento',
      title: 'Iniciar um tratamento',
      path: '/orto/tratamentos',
      simple: [
        { text: 'Iniciar o tratamento registra o aparelho e cria de uma vez as mensalidades no financeiro.' },
        {
          steps: [
            'Abra Tratamentos e clique em Iniciar tratamento.',
            'Busque o paciente.',
            'Escolha o Aparelho e confira a data de Início.',
            'Preencha Duração prevista (meses), Dia do vencimento e Mensalidade (R$).',
            'Em Documentação e instalação (R$), informe a taxa inicial, se houver. Instalação já marcada e sem pagamento fica sem custo.',
            'Clique em Iniciar. A janela mostra as parcelas criadas.',
          ],
        },
        { tip: 'Exemplo: início em 15/03, vencimento dia 10 e 24 meses. A taxa vence em 15/03 e a primeira mensalidade em 10/04.' },
        { warn: 'Confira os valores antes de iniciar. Não há como editar o valor da mensalidade depois.' },
        { warn: 'Se a instalação já foi cobrada na agenda (concluída ou paga), o sistema avisa e só lança a taxa se você clicar em Lançar a taxa mesmo assim. O vínculo é pela categoria Instalação do serviço: não troque essa categoria.' },
      ],
      technical: [
        {
          list: [
            'Permissão: orthodontics.treatments.manage.',
            'Um paciente só pode ter um tratamento em andamento: "Este paciente já tem um tratamento em andamento".',
            'Duração de 1 a 60 meses. Vencimento do dia 1 ao 28, para existir em todo mês.',
            'A primeira mensalidade vence no mês seguinte ao início. A taxa vence na data de início. Tudo entra como "a receber", na categoria de serviços.',
            'Início no passado gera parcelas já vencidas, que entram na coluna Em atraso.',
            'Aparelhos: Fixo metálico, Fixo estético (safira/porcelana), Autoligado, Alinhadores, Móvel e Outro.',
            'O início entra no histórico do paciente. O sistema não envia aviso automático de vencimento das mensalidades por este módulo.',
          ],
        },
      ],
    },
    {
      id: 'mensalidades',
      title: 'Receber e acompanhar mensalidades',
      path: '/financeiro/lancamentos',
      simple: [
        { text: 'As mensalidades são recebidas no Financeiro. A tela Tratamentos mostra quantas foram pagas e quanto está em atraso.' },
        {
          steps: [
            'Abra Lançamentos, no Financeiro.',
            'Em Buscar descrição, digite Ortodontia. Em Situação, escolha Em aberto ou Vencidos.',
            'Na mensalidade paga, clique em Baixar e confirme.',
          ],
        },
        { text: 'Para ver a situação de um paciente, abra Tratamentos e clique na linha dele. Cada parcela aparece como Em aberto, Paga ou Cancelada.' },
        { tip: 'Em Lançamentos, a coluna Cliente mostra o paciente. Para achar as parcelas de alguém, busque pelo nome. Antes de clicar em Baixar, confira o vencimento e o valor.' },
      ],
      technical: [
        {
          list: [
            'A busca de Lançamentos procura só na descrição. O lançamento guarda o cliente, mas a tela não o exibe nem filtra por ele.',
            'Baixar exige core.finance.write e ver Lançamentos exige core.finance.read. O papel Recepção tem as duas.',
            'Mensalidades e taxa têm o botão Baixar. Atendimentos avulsos, não: são recebidos pela agenda.',
            'Na tela Tratamentos, a coluna Mensalidades conta só as mensalidades não canceladas. Em atraso soma mensalidades e taxa vencidas e em aberto.',
            'O cancelamento de lançamento do tratamento é feito por Concluir ou Cancelar o tratamento, não em Lançamentos.',
          ],
        },
      ],
    },
    {
      id: 'prorrogar-ou-encerrar',
      title: 'Prorrogar, concluir ou cancelar um tratamento',
      path: '/orto/tratamentos',
      simple: [
        { text: 'Abra o tratamento clicando na linha dele, em Tratamentos. Os botões ficam abaixo da lista de parcelas.' },
        {
          list: [
            'Prorrogar: acrescenta mensalidades depois da última. Informe Mais quantos meses?',
            'Concluir tratamento: informe Concluído em. Deixe marcado Cancelar as mensalidades que vencem depois dessa data, para não cobrar parcelas futuras.',
            'Cancelar: informe Cancelado em e o Motivo do cancelamento. Todas as parcelas em aberto são canceladas.',
          ],
        },
        { text: 'Clique em Confirmar.' },
        { warn: 'Tratamento encerrado não reabre. Se o paciente voltar, inicie um novo.' },
        { warn: 'Mensalidade já paga não é devolvida automaticamente. Se houver estorno, ele é feito no financeiro.' },
      ],
      technical: [
        {
          list: [
            'Permissão: orthodontics.treatments.manage. Só em tratamento Em tratamento: "Este tratamento já foi encerrado".',
            'Prorrogar: de 1 a 24 meses. As novas parcelas continuam a numeração, e a descrição mostra o novo total. As antigas mantêm o total anterior.',
            'Concluir cancela só mensalidades com vencimento depois da data informada, e só se a opção estiver marcada. Mensalidades vencidas e a taxa continuam em aberto.',
            'Cancelar cancela mensalidades e taxa em aberto. Motivo com ao menos 3 letras.',
            'Datas entre o início do tratamento e hoje. Fora disso: "A data não pode ser no futuro" ou "A data é anterior ao início do tratamento".',
            'Conclusão e cancelamento entram no histórico do paciente.',
          ],
        },
      ],
    },
    {
      id: 'receber-atendimento',
      title: 'Receber uma consulta ou serviço avulso',
      path: '/agenda',
      simple: [
        { text: 'Avaliação, colagem de bráquete e outros serviços são recebidos dentro do próprio horário.' },
        {
          steps: [
            'Clique no horário na agenda.',
            'Clique em Registrar pagamento.',
            'Confira o Valor (R$). Pode ser só uma parte.',
            'Escolha a Forma e a Conta, e clique em Registrar.',
          ],
        },
        { warn: 'Sem saldo, como numa manutenção por R$ 0, o botão não aparece. O sistema não aplica desconto em atendimento.' },
      ],
      technical: [
        {
          list: [
            'Permissão: shared.scheduling.payments. Formas: Dinheiro, Pix, Cartão de crédito, Cartão de débito, Transferência, Outro.',
            'Vira receita paga, na data informada (padrão hoje; futuro é recusado). Valor acima do saldo é recusado.',
            'Com Caixa escolhido e sessão aberta, o recebimento entra na conferência do fechamento como "Recebimento de atendimento". No financeiro continua um lançamento só. Dinheiro no caixa vai para a conta Caixa. Caixa fechado recusa o pagamento de hoje; com data passada, a tela não oferece caixa.',
            'Ao concluir, o saldo vira "a receber" no dia do atendimento e só se resolve pela agenda. Faltou ou Cancelado zera o saldo. Valor já pago não é devolvido automaticamente.',
            'Com o módulo de Pix ativo, é possível gerar QR Code. A confirmação continua manual.',
          ],
        },
      ],
    },
    {
      id: 'agendamento-online',
      title: 'Receber agendamentos pela internet',
      path: '/agenda/servicos',
      simple: [
        { text: 'O paciente escolhe o serviço, o dentista e o horário por um link. O horário aparece na agenda como Marcado online.' },
        {
          steps: [
            'Abra Serviços da agenda e desça até Lembretes e agendamento online.',
            'Marque Receber agendamentos online e marque, em Serviços liberados no link, o que a paciente pode marcar.',
            'Preencha Antecedência mínima (horas) e Até quantos dias à frente.',
            'Clique em Salvar configurações, depois em Copiar, e divulgue o link.',
          ],
        },
        { warn: 'Serviço novo vem desligado do link. Em Serviços liberados no link, marque só o que a paciente pode marcar sozinha. Instalação de aparelho e Remoção de aparelho costumam ficar de fora.' },
      ],
      technical: [
        {
          list: [
            'Paciente reconhecido pelo celular. Sem cadastro, um novo é criado.',
            'O horário é conferido de novo ao confirmar. O preço segue as mesmas regras, inclusive a manutenção sem custo.',
            'Até 5 serviços por marcação e 5 marcações por IP a cada 10 minutos. A página mostra os dias até o limite de Até quantos dias à frente (até 180), com um campo de data para ir direto.',
            'Salvar exige core.access.settings. Sem pagamento pelo link.',
          ],
        },
      ],
    },
  ],
};
