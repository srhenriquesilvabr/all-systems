import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Escritório de advocacia',
  summary: 'Processos, andamentos, prazos, audiências e honorários, na ordem do dia a dia do escritório.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/juridico/processos',
      simple: [
        { text: 'Antes de lançar o primeiro processo, deixe o escritório configurado nesta ordem:' },
        {
          steps: [
            'Peça ao responsável pelo sistema para criar o acesso de cada pessoa. Só quem tem acesso pode ser Responsável por um processo ou receber aviso de prazo.',
            'Abra Clientes e cadastre os clientes, ou importe por planilha.',
            'Abra Processos e cadastre os casos em andamento.',
            'Em cada processo, lance os prazos abertos.',
            'Se for usar a agenda, abra Profissionais e horários e cadastre quem atende. Em Serviços da agenda, ajuste Consulta inicial, Reunião com cliente, Audiência e Diligência.',
          ],
        },
        { warn: 'Os prazos não são calculados nem lidos do tribunal. Quem cadastra informa a data, e o escritório continua responsável por conferir cada prazo.' },
      ],
      technical: [
        { text: 'Os 4 serviços de exemplo só são criados na ativação se a agenda não tiver nenhum serviço.' },
        {
          list: [
            'Papel Advogado(a): legal.cases.read e write, legal.fees.read, agenda (ver, marcar, situação), clientes (ver e editar).',
            'Papel Secretaria / estagiário(a): o mesmo, sem honorários.',
            'Nenhum dos dois traz legal.fees.manage (Lançar e cancelar honorários), shared.scheduling.payments, shared.scheduling.manage nem core.finance.write. Dê em Configurações › Papéis.',
            'Usuário do sistema e profissional da agenda são cadastros diferentes: o advogado precisa existir nos dois para ser responsável por processo e aparecer como coluna na agenda.',
          ],
        },
      ],
    },
    {
      id: 'cadastrar-processo',
      title: 'Cadastrar um processo',
      path: '/juridico/processos',
      simple: [
        { text: 'O processo reúne andamentos, prazos, audiências e honorários. Serve também para caso consultivo, sem número.' },
        {
          steps: [
            'Abra Processos e clique em Novo processo.',
            'Busque o cliente.',
            'Preencha o Título. Exemplo: Reclamação trabalhista, horas extras.',
            'Preencha o Número CNJ, se já houver.',
            'Escolha a Área e O cliente é (Autor, Réu, Terceiro interessado ou Consultivo).',
            'Preencha Vara / tribunal, Parte contrária, Valor da causa (R$) e Responsável.',
            'Clique em Salvar.',
          ],
        },
        { tip: 'Para achar um processo depois, busque por título, número, cliente ou parte contrária. A lista começa em Em andamento: mude a situação para ver os demais.' },
        { text: 'Para muitos processos de uma vez, use Baixar modelo e Importar planilha. O cliente precisa já estar cadastrado.' },
      ],
      technical: [
        {
          list: [
            'Permissão: legal.cases.write. Ver: legal.cases.read.',
            'O número CNJ é conferido pelo dígito verificador e gravado formatado: "Número CNJ inválido (confira os dígitos)". Número repetido é recusado: "Já existe um processo com este número".',
            'O segmento da Justiça aparece a partir do número.',
            'O cliente não pode ser trocado depois do cadastro.',
            'Na planilha, cliente pelo CPF/CNPJ ou pelo nome exato. Responsável pelo nome do usuário. Formate o número como texto.',
            'A lista traz até 200 processos, dos atualizados mais recentemente aos mais antigos.',
            'Processos e honorários não são anonimizados junto com o cadastro do cliente.',
          ],
        },
      ],
    },
    {
      id: 'registrar-andamento',
      title: 'Registrar um andamento',
      path: '/juridico/processos',
      simple: [
        { text: 'Andamento é o histórico do caso. Quem entra no processo depois entende o que aconteceu.' },
        {
          steps: [
            'Abra o processo.',
            'Na aba Andamentos, confira a Data.',
            'Escreva o Andamento. Exemplo: Juntada de contestação pela parte ré.',
            'Clique em Registrar andamento.',
          ],
        },
        { warn: 'O andamento não pode ser editado nem apagado depois. Se errar, registre um novo explicando a correção.' },
        { warn: 'Os andamentos são lançados à mão. O sistema não consulta o tribunal nem importa publicações.' },
      ],
      technical: [
        {
          list: [
            'Permissão: legal.cases.write. Texto de 3 a 5.000 caracteres.',
            'A data aceita passado e futuro. A lista é ordenada por essa data, e mostra o autor.',
            'Entram sozinhos: "Situação alterada para: ...", "Prazo cumprido: ..." e "Êxito registrado: ...".',
            'O cliente não recebe aviso de andamento.',
          ],
        },
      ],
    },
    {
      id: 'cadastrar-prazo',
      title: 'Cadastrar um prazo',
      path: '/juridico/processos',
      simple: [
        { text: 'Cadastre cada prazo para ele aparecer na tela Prazos e gerar um aviso por e-mail.' },
        {
          steps: [
            'Abra o processo e clique na aba Prazos.',
            'Clique em Novo prazo.',
            'Descreva em Prazo. Exemplo: Réplica à contestação.',
            'Informe o Vencimento.',
            'Em Avisar com antecedência, escolha No dia ou de 1 a 15 dias antes.',
            'Em Quem cuida, escolha a pessoa.',
            'Clique em Salvar.',
          ],
        },
        { warn: 'O prazo não pode ser editado nem excluído depois de salvo. Confira a data. Se errar, marque como cumprido e cadastre outro: isso também gera um andamento "Prazo cumprido".' },
        { warn: 'O sistema não conta dias úteis, feriados nem recessos. O Vencimento é a data que você digitar.' },
      ],
      technical: [
        {
          list: [
            'Permissão: legal.cases.write. Quem cuida precisa ser da equipe: "Pessoa não faz parte da equipe".',
            'Antecedência padrão de 3 dias.',
            'Aviso por e-mail, enviado uma vez por prazo, por rotina de hora em hora, quando a data de vencimento menos a antecedência chega.',
            'Destino: Quem cuida; sem ele, o Responsável pelo processo; sem nenhum dos dois, toda a equipe ativa.',
            'Prazo cadastrado já dentro da antecedência gera aviso na rotina seguinte. O aviso sai mesmo que o processo esteja encerrado, se o prazo estiver em aberto.',
            'Se o e-mail falhar, o prazo continua visível na tela. Não há reenvio, nem aviso por WhatsApp.',
          ],
        },
      ],
    },
    {
      id: 'acompanhar-prazos',
      title: 'Acompanhar e cumprir prazos',
      path: '/juridico/prazos',
      simple: [
        { text: 'A tela Prazos mostra tudo o que está em aberto, dos vencidos aos próximos. Use como lista de trabalho do dia.' },
        {
          steps: [
            'Abra Prazos.',
            'Escolha Todo o escritório ou Só os meus.',
            'Escolha o período: Até 7, 15, 30 ou 90 dias.',
            'Feito o prazo, clique em Marcar cumprido, confira a data em Cumprido em e confirme.',
          ],
        },
        { tip: 'Prazo com até 2 dias, ou já vencido, aparece em destaque vermelho.' },
        { text: 'Prazos cumpridos saem desta tela. Para vê-los, ou para clicar em Reabrir, use a aba Prazos do processo.' },
      ],
      technical: [
        {
          list: [
            'Permissões: legal.cases.read para ver e legal.cases.write para cumprir e reabrir.',
            'Só os meus filtra por Quem cuida. Prazo sem ninguém designado não aparece aí, mesmo que a pessoa seja Responsável pelo processo.',
            'Vencidos sempre aparecem, em qualquer período. A tela mostra até 500 prazos.',
            'Cumprido em aceita passado, nunca futuro. O andamento "Prazo cumprido" sai com essa data.',
            'Reabrir não apaga esse andamento e não envia novo aviso.',
            'A coluna Próximo prazo, em Processos, mostra o prazo em aberto de vencimento mais próximo.',
          ],
        },
      ],
    },
    {
      id: 'marcar-audiencia',
      title: 'Marcar audiência ou reunião',
      path: '/agenda',
      simple: [
        { text: 'A agenda do escritório guarda audiências, reuniões e diligências. Ligue o horário ao processo para ele aparecer dentro do caso.' },
        {
          steps: [
            'Abra Agenda e clique em Novo horário.',
            'Busque o cliente.',
            'No campo Processo, escolha o caso, ou deixe em Nenhum (atendimento avulso).',
            'Marque o serviço: Audiência, Reunião com cliente, Consulta inicial ou Diligência.',
            'Escolha o Profissional e o Dia, clique num horário e em Marcar.',
          ],
        },
        { tip: 'O que foi ligado ao processo aparece na aba Agenda dele.' },
        { warn: 'A audiência vai para a agenda como qualquer horário, e o cliente recebe o aviso automático de "horário marcado". Revise o texto em Configurações › Notificações, aba Mensagens, se precisar.' },
        { warn: 'O horário de audiência é informado à mão. Se a audiência estiver fora do expediente cadastrado, use o campo Outro horário.' },
      ],
      technical: [
        {
          list: [
            'Permissões: shared.scheduling.write para marcar e shared.scheduling.read para a aba Agenda.',
            'O campo Processo lista só casos Em andamento e Suspenso, do cliente escolhido. É opcional.',
            'A aba Agenda do processo lista todos os horários ligados, inclusive cancelados, sem mostrar a situação.',
            'Marcação avulsa não confere expediente nem bloqueio. O banco recusa sobreposição no mesmo profissional.',
            'Repetir aceita até 52 datas e confere expediente e bloqueio em cada uma.',
            'O prazo e a audiência não se ligam: audiência não cria prazo, nem prazo cria horário.',
            'Lembrete automático ao cliente: padrão de 1 dia antes. Configure em Serviços da agenda.',
          ],
        },
      ],
    },
    {
      id: 'atender-agenda',
      title: 'Registrar comparecimento, remarcar e cancelar',
      path: '/agenda',
      simple: [
        { text: 'Abra o horário na agenda para registrar o que aconteceu.' },
        {
          steps: [
            'Clique em Confirmar, Chegou, Iniciar atendimento e Concluir, conforme o caso.',
            'Se o cliente não veio, clique em Faltou.',
            'Para mudar a data, clique em Remarcar. O cliente recebe um aviso.',
            'Para desmarcar, clique em Cancelar horário e escreva o motivo. O cliente também recebe um aviso.',
          ],
        },
        { warn: 'Concluído, Faltou e Cancelado não voltam atrás.' },
        { warn: 'Não dá para trocar o advogado, o serviço ou o processo de um horário já marcado. Cancele e marque de novo.' },
      ],
      technical: [
        {
          list: [
            'Transições: Agendado e Confirmado vão para Chegou, Em atendimento, Concluído, Faltou ou Cancelado (Agendado também para Confirmado). Chegou vai para Em atendimento, Concluído ou Cancelado. Em atendimento só para Concluído, embora a tela mostre Cancelar horário.',
            'Permissões: shared.scheduling.status e shared.scheduling.write.',
            'Remarcar só em Agendado e Confirmado, para horários livres do mesmo profissional. A situação volta para Agendado.',
            'Concluir horário com valor, como Consulta inicial, gera "a receber" do saldo.',
            'No WhatsApp manual, use Abrir no WhatsApp e Já enviei, dentro do horário.',
          ],
        },
      ],
    },
    {
      id: 'encerrar-processo',
      title: 'Mudar a situação ou encerrar um processo',
      path: '/juridico/processos',
      simple: [
        { text: 'A situação mostra em que pé está o caso. Ela não apaga nada.' },
        {
          steps: [
            'Abra o processo e clique em Editar.',
            'Em Situação, escolha Em andamento, Suspenso, Acordo, Encerrado — procedente, Encerrado — improcedente ou Arquivado.',
            'Clique em Salvar.',
          ],
        },
        { tip: 'A mudança fica registrada sozinha nos Andamentos.' },
        { warn: 'Mudar a situação não cumpre prazos nem cancela honorários. Resolva os dois nas abas próprias.' },
      ],
      technical: [
        {
          list: [
            'Permissão: legal.cases.write. A Situação só aparece ao editar; todo processo novo começa Em andamento.',
            'Só Em andamento e Suspenso aparecem no campo Processo da agenda.',
            'Não há exclusão de processo. O caminho é Arquivado.',
            'As situações são só registro. Não há bloqueio de novos andamentos, prazos ou honorários em caso encerrado.',
          ],
        },
      ],
    },
    {
      id: 'lancar-honorarios',
      title: 'Lançar honorários',
      path: '/juridico/processos',
      simple: [
        { text: 'Lance o que foi combinado com o cliente. As parcelas vão para o financeiro como valores a receber.' },
        {
          steps: [
            'Abra o processo e clique na aba Honorários.',
            'Clique em Lançar honorários.',
            'Escolha o Tipo: Valor fixo, Mensal ou Êxito (percentual).',
            'No fixo, preencha Valor total (R$), Parcelas e 1º vencimento. Exemplo: R$ 3.000 em 3 parcelas.',
            'No mensal, preencha Valor mensal (R$), Meses e 1º vencimento. Exemplo: R$ 500 por 12 meses.',
            'No êxito, preencha o Percentual sobre o valor obtido (%).',
            'Clique em Lançar.',
          ],
        },
        { warn: 'O botão Cancelar age na hora, sem pedir confirmação. Ele cancela as parcelas em aberto. As já recebidas continuam no financeiro.' },
        { warn: 'O sistema não confere se o valor ou o percentual seguem o contrato ou as regras da profissão. Isso é com o escritório.' },
      ],
      technical: [
        {
          list: [
            'Permissões: legal.fees.read para ver a aba e legal.fees.manage para lançar e cancelar.',
            'Fixo: o total é dividido nas parcelas. Mensal: o valor se repete a cada mês. De 1 a 60. Vencimentos mensais a partir do 1º.',
            'Cada parcela vira receita "a receber", com a descrição "Honorários" + título do processo, na categoria de serviços.',
            'O cartão mostra Lançado, recebido e em aberto, sem contar o que foi cancelado.',
            'Honorários não geram aviso automático ao cliente neste módulo.',
          ],
        },
      ],
    },
    {
      id: 'registrar-exito',
      title: 'Registrar o êxito',
      path: '/juridico/processos',
      simple: [
        { text: 'No honorário de êxito, nada é cobrado até o resultado. Quando sair, informe o valor obtido e o sistema calcula a sua parte.' },
        {
          steps: [
            'Abra o processo, aba Honorários.',
            'No honorário de êxito, clique em Registrar êxito.',
            'Preencha Valor obtido para o cliente (R$) e Vencimento.',
            'Confira o valor no botão Lançar e clique nele.',
          ],
        },
        { tip: 'Exemplo: 30% sobre R$ 100.000 lança R$ 30.000 a receber.' },
        { warn: 'Só é possível registrar uma vez. Se o valor estiver errado, cancele esse honorário, lance outro e registre de novo.' },
      ],
      technical: [
        {
          list: [
            'Permissão: legal.fees.manage. Valor obtido maior que zero.',
            'Cálculo: valor obtido × percentual ÷ 100, arredondado ao centavo. Gera uma parcela "a receber" com o vencimento informado.',
            'O honorário passa a Êxito registrado, e o andamento "Êxito registrado: valor obtido R$ ..." entra no processo com a data de hoje.',
            'Só para honorário de êxito ativo: "Este honorário não aguarda êxito".',
            'O cálculo não considera despesas nem retenções. Sobre isso, oriente-se com o contador do escritório.',
          ],
        },
      ],
    },
    {
      id: 'receber',
      title: 'Receber honorários e consultas',
      path: '/financeiro/lancamentos',
      simple: [
        { text: 'Honorários e consultas são recebidos em lugares diferentes.' },
        {
          list: [
            'Honorários: em Lançamentos, no Financeiro, encontre a parcela e clique em Baixar.',
            'Consulta inicial marcada na agenda: abra o horário, clique em Registrar pagamento, confira Valor (R$), Forma e Conta, e clique em Registrar.',
          ],
        },
        { tip: 'Em Lançamentos, busque por Honorários e filtre a Situação por Vencidos para ver o que está em atraso.' },
      ],
      technical: [
        {
          list: [
            'Baixar exige core.finance.write. Registrar pagamento na agenda exige shared.scheduling.payments. Os papéis padrão não trazem nenhuma das duas.',
            'Parcelas de honorários só são canceladas pela aba Honorários, não em Lançamentos.',
            'A tela Lançamentos não mostra o cliente. A parcela é identificada pelo título do processo, que faz parte da descrição.',
            'Pagamento na agenda: data de hoje, sem valor acima do saldo. Ao concluir, o saldo vira "a receber" e só se resolve pela agenda. Faltou ou Cancelado zera o saldo.',
          ],
        },
      ],
    },
    {
      id: 'agendamento-online',
      title: 'Receber agendamentos pela internet',
      path: '/agenda/servicos',
      simple: [
        { text: 'O cliente marca uma consulta por um link, sem ligar. É opcional e fica desligado até você ativar.' },
        {
          steps: [
            'Abra Serviços da agenda.',
            'Edite Audiência, Diligência e Reunião com cliente e desmarque Pode ser marcado online pelo cliente. Clique em Salvar em cada um.',
            'Desça até Lembretes e agendamento online e marque Receber agendamentos online.',
            'Preencha Antecedência mínima (horas) e Até quantos dias à frente.',
            'Clique em Salvar configurações, depois em Copiar, e divulgue o link.',
          ],
        },
        { warn: 'Todos os serviços vêm liberados para o link. Sem o passo 2, um visitante poderia marcar uma Audiência na agenda do escritório.' },
      ],
      technical: [
        {
          list: [
            'Cliente reconhecido pelo celular. Sem cadastro, um novo é criado com nome, celular e e-mail.',
            'A marcação online não liga o horário a um processo.',
            'Até 5 serviços por marcação e 5 marcações por IP a cada 10 minutos. A página mostra no máximo os próximos 14 dias.',
            'Salvar exige core.access.settings. Sem pagamento pelo link.',
          ],
        },
      ],
    },
  ],
};
