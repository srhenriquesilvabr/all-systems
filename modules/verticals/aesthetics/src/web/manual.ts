import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Clínica de estética',
  summary: 'Agenda, pacotes, prontuário e as especialidades: harmonização, clareamento, cirurgia plástica, micropigmentação, laser e tricologia.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/estetica/cadastros',
      simple: [
        { text: 'Antes da primeira paciente, configure a clínica nesta ordem. As especialidades são opcionais: sem nenhuma ligada, você usa agenda, pacotes, anamnese e evolução.' },
        {
          steps: [
            'Abra Serviços da agenda e ajuste os procedimentos, os tempos e os preços.',
            'Abra Profissionais e horários e cadastre quem atende, as salas e os equipamentos.',
            'Abra Especialidades da clínica. Na aba Especialidades, marque as que a clínica oferece e clique em Salvar. Isso cria serviços de exemplo e modelos de termo.',
            'Volte em Serviços da agenda e revise o que foi criado.',
            'Na aba Registro dos profissionais, clique em Informar registro em cada profissional.',
            'Na aba Produtos e lotes, cadastre o que é usado nas pacientes.',
            'Na aba Termos de consentimento, leia e ajuste os textos.',
          ],
        },
        { warn: 'Os termos que vêm prontos são modelos. A clínica deve ler e revisar o texto antes de usar.' },
        { tip: 'Desligar uma especialidade não apaga nada. As fichas continuam no prontuário, mas novas fichas dela ficam bloqueadas.' },
      ],
      technical: [
        {
          list: [
            'Ligar e desligar especialidades exige core.access.settings. Sem ela, a aba só mostra Ligada ou Desligada. A tela Especialidades da clínica exige aesthetics.setup.manage.',
            'Ao salvar, cada especialidade ligada ganha os serviços de exemplo (pelo nome) e os termos (pela chave). O que já existe, mesmo editado, fica como está. O termo Autorização de uso de imagem vem para todas.',
            'Os 9 serviços básicos só são criados na ativação se a agenda não tiver nenhum serviço.',
            'Retorno dos injetáveis (padrão 15 dias) e Retoque da micropigmentação (padrão 30 dias) preenchem a data prevista nas fichas. Ambos de 1 a 180.',
          ],
        },
        {
          list: [
            'Papel Esteticista: agenda (ver e situação), prontuário (ver e incluir), ver pacotes, ver clientes.',
            'Papel Médico(a) / dentista: o mesmo, mais marcar na agenda (shared.scheduling.write).',
            'Papel Recepção: agenda completa com pagamentos, vender pacotes (aesthetics.packages.sell), orçamentos (aesthetics.surgery.budget), clientes. Sem acesso ao prontuário.',
            'Papel Gestão da clínica: ver agenda, cadastros (aesthetics.setup.manage), orçamentos, pacotes, estoque (shared.sales.stock). Sem acesso ao prontuário.',
            'Nenhum papel padrão traz shared.scheduling.manage, core.finance.write nem shared.medical-records.audit. Dê em Configurações › Papéis.',
          ],
        },
      ],
    },
    {
      id: 'profissionais-salas-servicos',
      title: 'Cadastrar profissionais, salas e procedimentos',
      path: '/agenda/profissionais',
      simple: [
        { text: 'Profissional, sala e equipamento viram colunas na agenda. Com o equipamento cadastrado, duas pacientes não ficam marcadas no mesmo aparelho ao mesmo tempo.' },
        {
          steps: [
            'Clique em Novo profissional, preencha o nome e escolha o Tipo: Profissional ou Sala / equipamento.',
            'Marque os serviços que a pessoa faz, ou os que a sala atende.',
            'Clique em Salvar.',
            'No profissional, clique em Horários para ajustar os dias, e em Bloqueios para folgas e cursos.',
            'Em Serviços da agenda, edite o procedimento. Se ele precisa de aparelho, marque Precisa de sala/equipamento livre e escolha as salas que servem.',
          ],
        },
        { tip: 'Tornou um procedimento dependente de sala depois de já ter horários marcados? Use o botão Distribuir salas nos atendimentos sem sala, em Profissionais e horários.' },
      ],
      technical: [
        {
          list: [
            'Novo cadastro começa com segunda a sexta 9h às 12h e 13h às 18h, e sábado 9h às 13h.',
            'O serviço com alguém marcado em Quem faz só pode ser feito por essas pessoas, mesmo por um profissional sem nenhum serviço marcado.',
            'Com Precisa de sala, a agenda só oferece horários com sala livre e reserva a primeira livre se nenhuma for escolhida.',
            'Distribuir salas alcança atendimentos futuros sem sala, em aberto, até 500 por vez, e lista os que ficaram sem. Permissão: shared.scheduling.write.',
            'Telas de cadastro: shared.scheduling.manage. Registro no conselho depende de o profissional estar ligado a uma pessoa da equipe.',
          ],
        },
      ],
    },
    {
      id: 'marcar-sessao',
      title: 'Marcar uma sessão',
      path: '/agenda',
      simple: [
        { text: 'Reserva o horário da paciente. Se ela tem pacote daquele procedimento, a sessão sai do pacote sozinha, com valor zerado.' },
        {
          steps: [
            'Clique em Novo horário, ou no espaço vazio da coluna do profissional.',
            'Busque a paciente. Se não encontrar, use Cadastrar cliente.',
            'Marque o procedimento, o Profissional e o Dia.',
            'Se aparecer Sala/equipamento, escolha ou deixe na opção automática.',
            'Clique num horário livre e em Marcar.',
          ],
        },
        { text: 'Para sessões fixas, marque Repetir e escolha a Frequência e quando Termina. As datas que não couberem aparecem no final.' },
        { text: 'A paciente também pode marcar sozinha pelo link. Ligue em Serviços da agenda, em Lembretes e agendamento online.' },
        { warn: 'Procedimentos que vieram das especialidades, como toxina e fios, vêm fora do agendamento online. Confira a lista antes de divulgar o link.' },
      ],
      technical: [
        {
          list: [
            'Permissão: shared.scheduling.write. Sobreposição no mesmo profissional ou sala é recusada.',
            'Outro horário não confere expediente nem bloqueio na marcação avulsa. A repetição confere as duas coisas em cada data e aceita até 52 datas.',
            'O pacote é usado também em marcação online, repetição e retorno pela ficha. Veja o assunto de pacotes.',
            'Avisos automáticos ao cliente: marcado, remarcado, cancelado e lembrete (padrão 1 dia antes), conforme a configuração de notificações.',
            'Online: até 5 serviços por marcação e 5 marcações por IP a cada 10 minutos. A página mostra no máximo os próximos 14 dias. O pagamento não é feito pelo link.',
          ],
        },
      ],
    },
    {
      id: 'atender-e-receber',
      title: 'Atender, receber e remarcar',
      path: '/agenda',
      simple: [
        { text: 'Abra o horário na agenda para registrar cada etapa. É a conclusão que gasta a sessão do pacote.' },
        {
          steps: [
            'Clique em Confirmar quando a paciente confirmar, e em Chegou quando ela chegar.',
            'Clique em Iniciar atendimento e, no fim, em Concluir.',
            'Se ela não veio, clique em Faltou.',
            'Para receber, clique em Registrar pagamento, confira Valor (R$), Forma e Conta, e clique em Registrar.',
            'Para mudar a data, clique em Remarcar. Para desmarcar, em Cancelar horário, com o motivo.',
          ],
        },
        { warn: 'Concluído, Faltou e Cancelado não voltam atrás.' },
        { warn: 'Sessão de pacote fica com valor zero e não tem cobrança na agenda. As parcelas do pacote são recebidas no financeiro.' },
      ],
      technical: [
        {
          list: [
            'Transições: Agendado e Confirmado vão para Chegou, Em atendimento, Concluído, Faltou ou Cancelado (Agendado também para Confirmado). Chegou vai para Em atendimento, Concluído ou Cancelado. Em atendimento só para Concluído, embora a tela mostre Cancelar horário.',
            'Permissões: shared.scheduling.status para a situação, shared.scheduling.payments para receber, shared.scheduling.write para remarcar e cancelar.',
            'Pagamento vira receita paga na categoria de serviços, com a data de hoje. Valor acima do saldo é recusado.',
            'Ao concluir, o saldo vira "a receber" no dia do atendimento e se resolve pela agenda. Faltou ou Cancelado zera o saldo. Valor já pago não é devolvido automaticamente.',
            'Remarcar só em Agendado e Confirmado. Volta para Agendado e reenvia o lembrete. A tela não troca profissional nem serviço.',
            'Se o serviço pede sala, na remarcação vale a atual, se livre, ou outra que sirva.',
          ],
        },
      ],
    },
    {
      id: 'pacotes',
      title: 'Vender e acompanhar pacotes',
      path: '/estetica/pacotes',
      simple: [
        { text: 'Pacote é um conjunto de sessões de um procedimento, vendido por um valor combinado. Exemplo: 10 sessões de drenagem linfática em 5 vezes.' },
        {
          steps: [
            'Clique em Vender pacote e busque a paciente.',
            'Escolha o Procedimento e preencha Sessões e Valor do pacote (R$).',
            'Escolha Parcelas e 1º vencimento. Validade é opcional.',
            'Clique em Vender.',
          ],
        },
        { text: 'A partir daí, cada horário marcado desse procedimento sai do pacote. A tela mostra algo como "3 de 10 usadas · 1 marcada".' },
        { warn: 'Para cancelar um pacote, não pode haver horário marcado usando ele. Cancele ou conclua esses horários antes.' },
        { warn: 'Depois da Validade, novas marcações voltam a ser cobradas pelo preço normal. O pacote continua aparecendo como Ativo.' },
      ],
      technical: [
        {
          list: [
            'Permissões: aesthetics.packages.read (Ver pacotes de sessões) e aesthetics.packages.sell (Vender e cancelar pacotes).',
            'De 2 a 100 sessões. A tela oferece até 12 parcelas. As parcelas viram "a receber" mensais, e a baixa é feita em Lançamentos. Baixar exige core.finance.write.',
            'A tela Lançamentos não mostra a paciente: a descrição é só "Pacote <procedimento> (<n> sessões)" e a parcela. Pacotes iguais de pacientes diferentes ficam indistinguíveis ali.',
            'Ao marcar: se a paciente tem pacote ativo, dentro da validade e com saldo daquele serviço, a sessão fica reservada e a linha sai com R$ 0 e o texto "pacote 3/10". Vale o pacote mais antigo.',
            'Concluído usa a sessão. Cancelado ou Faltou devolve. A configuração noShowConsumesSession faria a falta gastar a sessão, mas não há campo para ela nesta tela.',
            'Com todas as sessões usadas, o pacote passa a Concluído e entra no histórico da paciente.',
            'Cancelar: motivo de ao menos 3 letras. Parcelas em aberto são canceladas. As pagas ficam, e o estorno é feito no financeiro. Recusa: "Há horários marcados usando este pacote: cancele ou conclua antes".',
          ],
        },
      ],
    },
    {
      id: 'prontuario',
      title: 'Registrar anamnese e evolução',
      path: '/clientes',
      simple: [
        { text: 'O prontuário guarda a história clínica da paciente. O que entra não pode ser apagado nem editado, só corrigido por uma retificação.' },
        {
          steps: [
            'Abra Clientes, entre na ficha da paciente e clique na aba Prontuário.',
            'Com especialidades ligadas, use a aba Prontuário completo.',
            'Clique em + Anamnese, + Evolução ou + Anotação.',
            'Confira a Data do atendimento, preencha e clique em Incluir no prontuário.',
            'Para anexar exame ou foto, clique em Anexar arquivo no registro.',
            'Para corrigir, clique em Retificar, ajuste, escreva o Motivo da retificação e salve.',
          ],
        },
        { tip: 'Atendimento antigo? Informe na Data do atendimento o dia em que ele aconteceu. Data futura não é aceita.' },
      ],
      technical: [
        {
          list: [
            'Permissões: shared.medical-records.read (dado sensível) para ver e write para incluir, anexar e retificar. O botão Quem acessou exige shared.medical-records.audit.',
            'Retificação cria um novo registro. O original fica visível, marcado como Retificado. Só a versão mais recente pode ser retificada. Motivo de 3 a 500 caracteres.',
            'Anexos: JPG, PNG, WebP ou PDF, até 15 MB, sem remoção.',
            'Registro vazio é recusado: "Preencha algum campo ou escreva uma anotação". Na Anamnese a Queixa principal é obrigatória e na Evolução, o Procedimento.',
            'Log de acesso: abrir o prontuário, incluir, retificar, anexar e abrir anexo. A janela mostra os 500 mais recentes.',
            'O prontuário não é apagado nem anonimizado junto com o cadastro do cliente.',
            'As fichas das especialidades só entram pela tela da especialidade. O registro não fica ligado ao horário da agenda.',
          ],
        },
      ],
    },
    {
      id: 'produtos-e-lotes',
      title: 'Cadastrar produtos e rastrear lotes',
      path: '/estetica/cadastros',
      simple: [
        { text: 'Cada toxina, preenchedor, pigmento, gel ou implante é cadastrado com lote e validade. Assim, se um lote tiver problema, você descobre em minutos quem o recebeu.' },
        {
          steps: [
            'Em Especialidades da clínica, abra a aba Produtos e lotes.',
            'Clique em Novo produto. Preencha Nome, Tipo e Unidade de uso, e clique em Salvar.',
            'Clique em + Lote no produto. Preencha Lote e Validade, e clique em Salvar.',
            'Para dar baixa no estoque, edite o produto e preencha Quantidade por embalagem e Baixa no estoque (produto do PDV).',
            'Para rastrear, clique em Quem recebeu ao lado do lote.',
          ],
        },
        { text: 'Tem muitos lotes? Use Baixar modelo e Importar planilha. Produto que ainda não existe é criado com o tipo e a unidade da linha.' },
        { warn: 'Depois que o lote é usado em alguém, o número e a validade não mudam mais. Se estiver errado, cadastre outro lote.' },
      ],
      technical: [
        {
          list: [
            'Cadastrar: aesthetics.setup.manage. Quem recebeu: shared.medical-records.read. Cada paciente listada entra no log de acesso do prontuário dela.',
            'Lote é único por produto, gravado em maiúsculas: "O lote X de Y já está cadastrado".',
            'Lote vencido no dia do atendimento não aparece na ficha e é recusado no servidor.',
            'Quantidade recebida é só informativa. O sistema mostra o total usado, mas não impede usar mais do que entrou.',
            'Baixa no estoque: quantidade usada dividida pela Quantidade por embalagem. Exemplo: 30 U de um frasco de 100 U baixa 0,3. O saldo pode ficar negativo. O movimento se chama Uso em atendimento e não traz o nome da paciente.',
            'O campo Baixa no estoque só aparece para quem pode ver os produtos do PDV (shared.sales.sell ou shared.sales.products).',
            'Retificar uma ficha não altera o uso do lote nem o estoque já baixado.',
          ],
        },
      ],
    },
    {
      id: 'termo-de-consentimento',
      title: 'Colher o termo de consentimento',
      path: '/estetica/especialidades',
      simple: [
        { text: 'O termo registra que a paciente foi informada e aceitou o procedimento. O texto aceito fica guardado no prontuário.' },
        {
          steps: [
            'Abra a ficha da paciente, aba Prontuário, e a aba da especialidade.',
            'Em Fichas, clique em + Termo de consentimento.',
            'Escolha o Modelo e o Profissional, e preencha o Procedimento.',
            'Se houver tratamento aberto, escolha o Tratamento.',
            'Peça para a paciente ler o texto e assinar na tela.',
            'Clique em Registrar aceite.',
          ],
        },
        { tip: 'Assinou em papel? Registre sem desenhar a assinatura e anexe o documento pelo Prontuário completo.' },
        { warn: 'Só a cirurgia plástica exige o termo para seguir. Nas outras especialidades, o sistema não impede o procedimento sem termo: fica a cargo da clínica.' },
      ],
      technical: [
        {
          list: [
            'Editar modelos: aesthetics.setup.manage, em Termos de consentimento. Registrar aceite: shared.medical-records.write.',
            'Variáveis: {{paciente}}, {{procedimento}}, {{profissional}} e {{data}}, preenchidas no aceite. Texto de 20 a 9.000 caracteres.',
            'Editar título ou texto sobe a versão. O aceite guarda o texto e a versão do momento.',
            'Assinado por: pelo menos 3 letras. É o paciente ou o responsável legal. A assinatura desenhada é opcional e vira um anexo PNG.',
            'Procedimento vazio usa o título do tratamento ou do modelo. Modelo inativo é recusado.',
            'O modelo aparece se for da especialidade ou de todas. O cartão do tratamento mostra Termo aceito ou Sem termo.',
          ],
        },
      ],
    },
    {
      id: 'tratamentos-fotos-intercorrencias',
      title: 'Tratamentos, fotos e intercorrências',
      path: '/estetica/especialidades',
      simple: [
        { text: 'Tratamento agrupa as sessões previstas. Exemplo: Protocolo para eflúvio, 10 sessões. A tela Especialidades mostra todos, por especialidade.' },
        {
          steps: [
            'Abra Especialidades, escolha a aba da especialidade e clique em Novo tratamento.',
            'Busque a paciente, preencha o nome do tratamento, o Profissional responsável e as Sessões previstas. Clique em Abrir tratamento.',
            'Clique no nome da paciente para abrir as Fichas, os Tratamentos e as Fotos dela.',
            'Ao preencher uma ficha, escolha o Tratamento para a sessão ser contada.',
            'Ao terminar, clique em Encerrar no tratamento e escolha Concluído (alta) ou Cancelado.',
          ],
        },
        { text: 'Para fotos, na aba Fotos clique em + Foto e informe Região, Ângulo e Momento. Com duas fotos ou mais, clique em Comparar antes e depois.' },
        { text: 'Se algo inesperado aconteceu, clique em + Intercorrência e registre o que aconteceu e a conduta.' },
        { tip: 'Use sempre a mesma distância, luz e fundo nas fotos. A comparação fica mais justa.' },
        { warn: 'Foto incluída entra no prontuário e não pode ser apagada.' },
      ],
      technical: [
        {
          list: [
            'Abrir, atualizar e encerrar tratamento: shared.medical-records.write. A tela não oferece edição do título depois de aberto.',
            'Só contam as fichas de sessão ligadas ao tratamento e não retificadas: Aplicação de injetáveis, Sessão de clareamento, Micropigmentação, Sessão de laser e Sessão capilar.',
            'Encerrar como Cancelado exige motivo e cancela as parcelas em aberto do orçamento. Tratamento cancelado não recebe novas fichas.',
            'Fotos: JPG, PNG ou WebP, até 8 MB. Momentos: Antes, Durante, Depois, Retorno. A região é texto livre, com sugestões. Cada foto aberta entra no log de acesso.',
            'Intercorrência: Tipo e O que aconteceu são obrigatórios. Gravidade, Conduta e Resolvida são opcionais. Não exige registro em conselho.',
          ],
        },
      ],
    },
    {
      id: 'harmonizacao',
      title: 'Harmonização: registrar uma aplicação',
      path: '/estetica/especialidades',
      simple: [
        { text: 'A ficha guarda onde foi aplicado, quanto e de qual lote. O mapa do rosto ajuda a marcar cada ponto.' },
        {
          steps: [
            'Na aba Harmonização facial da paciente, clique em + Aplicação de injetáveis.',
            'Escolha o Profissional e o Procedimento.',
            'Clique no rosto para marcar cada ponto. O lado direito da paciente fica à esquerda da tela.',
            'Em cada ponto, escolha Produto e lote e preencha a Quantidade. O próximo ponto já herda o mesmo lote.',
            'Confira a data de Retorno / retoque previsto e clique em Incluir no prontuário.',
            'Depois, no cartão da ficha, clique em Agendar retorno / retoque para marcar na agenda.',
          ],
        },
        { warn: 'Só profissional com registro em conselho de saúde pode assinar. Quem não tem o registro aparece desativado na lista.' },
      ],
      technical: [
        {
          list: [
            'Conselhos aceitos: CRM, CRO, CRBM, CRF ou COREN. Recusa: "Injetáveis exigem profissional com registro em conselho de saúde".',
            'Pontos de aplicação é obrigatório, com ao menos uma linha. Cada ponto exige Região e Quantidade.',
            'O lote em cada ponto é opcional no sistema. Ponto sem lote não entra no rastreio nem na baixa de estoque.',
            'Produto, lote e validade na ficha vêm do cadastro. O nome e o registro do profissional ficam gravados na ficha, mesmo que o cadastro mude.',
            'Tipos de produto oferecidos: toxina, preenchedor, bioestimulador, fio e outro.',
            'Retorno: data do atendimento + Retorno dos injetáveis (dias). O botão de agendar exige shared.scheduling.write e sugere o serviço Retorno de injetáveis.',
          ],
        },
      ],
    },
    {
      id: 'clareamento',
      title: 'Clareamento: registrar uma sessão',
      path: '/estetica/especialidades',
      simple: [
        { text: 'A ficha registra o tipo de clareamento, a cor antes e depois, o gel usado e a sensibilidade relatada.' },
        {
          steps: [
            'Se houver mais de uma sessão, abra um tratamento antes.',
            'Na aba Clareamento dental da paciente, clique em + Sessão de clareamento.',
            'Escolha o Profissional e o Tipo: Consultório, Caseiro ou Combinado.',
            'Escolha Cor inicial (VITA) e Cor final (VITA), e o gel em Gel clareador.',
            'Preencha Concentração, Tempo de aplicação e Sensibilidade.',
            'Clique em Incluir no prontuário.',
          ],
        },
        { warn: 'Clareamento exige profissional com CRO cadastrado.' },
      ],
      technical: [
        {
          list: [
            'Sem CRO, o servidor recusa: "Clareamento dental exige profissional com CRO".',
            'Obrigatório: Tipo. O número da Sessão é sugerido a partir do tratamento em aberto.',
            'Tipos de produto oferecidos: gel clareador e outro. O lote de gel vencido é recusado.',
            'A ficha não tem campo de quantidade: o lote entra no rastreio com quantidade zero e não há baixa automática no estoque do gel.',
            'Serviços criados ao ligar: avaliação, clareamento em consultório, caseiro e retorno. Só a avaliação vem liberada para marcação online.',
            'Esta ficha não oferece botão de agendar retorno. Marque pela agenda.',
          ],
        },
      ],
    },
    {
      id: 'cirurgia-plastica',
      title: 'Cirurgia plástica: da avaliação à alta',
      path: '/estetica/orcamentos',
      simple: [
        { text: 'A cirurgia segue etapas. O sistema só deixa marcar na agenda com orçamento aprovado, termo aceito e pré-operatório liberado.' },
        {
          steps: [
            'Na aba Cirurgia plástica da paciente, em Tratamentos, clique em + Novo tratamento. Preencha Cirurgia e Cirurgião.',
            'Em Fichas, clique em + Avaliação cirúrgica e escolha o Tratamento.',
            'Em Orçamentos de cirurgia, clique em Montar. Preencha os valores e, em cada item, escolha Cobrado pela clínica ou Pago direto ao prestador.',
            'Clique em Salvar rascunho enquanto negocia. Fechado, escolha Parcelas e 1º vencimento e clique em Aprovar e lançar no financeiro.',
            'Em Fichas, clique em + Termo de consentimento e escolha o Tratamento.',
            'Clique em + Pré-operatório, escolha o Tratamento e marque Avaliação anestésica: liberado(a) e Liberado(a) para a cirurgia quando for o caso.',
            'Em Tratamentos, clique em Marcar cirurgia. Preencha cirurgião, procedimento, dia, hora, local e equipe, e clique em Marcar na agenda.',
            'Depois da cirurgia, inclua + Descrição cirúrgica e + Retorno pós-operatório, sempre escolhendo o Tratamento.',
            'Na alta, escolha Etapa: Alta no tratamento.',
          ],
        },
        { warn: 'Escolha o Tratamento no termo e no pré-operatório. Sem isso, o sistema não os encontra e a cirurgia não pode ser marcada.' },
        { warn: 'Orçamento aprovado não pode ser alterado. Para refazer, é preciso cancelar o tratamento.' },
        { tip: 'Com a cirurgia marcada, use Pacote de drenagem (pós-operatório) para vender as sessões, se a clínica oferece.' },
      ],
      technical: [
        {
          list: [
            'Etapas: Avaliação, Pré-operatório, Cirurgia marcada, Operado(a), Pós-operatório, Alta. Fichas ligadas ao tratamento avançam sozinhas, nunca para trás. À mão, a etapa pode voltar. Cirurgia marcada só pela marcação. Alta conclui o tratamento.',
            'Marcar exige, nesta ordem: orçamento aprovado; termo ligado ao tratamento; pré-operatório mais recente com as duas liberações; cirurgião com CRM e RQE. Recusas: "Aprove o orçamento antes de marcar a cirurgia", "Registre o termo de consentimento da cirurgia antes de marcar", "O pré-operatório mais recente precisa estar liberado, inclusive pela avaliação anestésica".',
            'Todas as fichas da cirurgia exigem profissional com CRM. Avaliação cirúrgica e Descrição cirúrgica exigem também o RQE.',
            'O horário vai para a agenda do cirurgião, com o preço do serviço escolhido. O serviço de exemplo custa R$ 0, com valor pelo orçamento. A marcação não confere o expediente. Remarque pela agenda: a data do tratamento acompanha.',
            'Horário cancelado ou falta libera nova marcação, que passa pelas mesmas conferências.',
            'Orçamento: só a parte Cobrado pela clínica vira "a receber", em parcelas mensais baixadas em Lançamentos. A parte de terceiros é só informativa. Aprovar sem parte da clínica é recusado. A validade é informativa e não bloqueia a aprovação.',
            'Cancelar o tratamento cancela as parcelas em aberto. As pagas ficam, com estorno pelo financeiro.',
            'Permissões: aesthetics.surgery.budget para orçamento, shared.scheduling.write para marcar, shared.medical-records.write para fichas e etapas, aesthetics.packages.sell para o pacote de drenagem.',
          ],
        },
        { warn: 'O papel Recepção vê os tratamentos em Orçamentos de cirurgia › Detalhes, mas não carrega a lista de cirurgiões, que exige shared.medical-records.write ou aesthetics.setup.manage. A marcação só funciona para ela se o tratamento já tiver cirurgião.' },
      ],
    },
    {
      id: 'micropigmentacao',
      title: 'Micropigmentação: registrar uma sessão',
      path: '/estetica/especialidades',
      simple: [
        { text: 'A ficha guarda a área, a técnica, os pigmentos com lote e a data prevista do retoque.' },
        {
          steps: [
            'Na aba Micropigmentação da paciente, clique em + Micropigmentação.',
            'Escolha Área, Sessão e Técnica.',
            'Em Pigmentos, clique em + Item, escolha o pigmento e o lote, e preencha Cor e Quantidade.',
            'Marque Desenho aprovado pela cliente (foto anexada).',
            'Confira o Retoque previsto e clique em Incluir no prontuário.',
            'Depois, no cartão da ficha, clique em Agendar retoque.',
          ],
        },
        { warn: 'A ficha não tem campo para anexar a foto do desenho. Inclua a foto pela aba Fotos da paciente.' },
      ],
      technical: [
        {
          list: [
            'Não exige registro em conselho. Profissional é opcional.',
            'Obrigatórios: Área, Pigmentos (ao menos uma linha) e Desenho aprovado. Sem a marcação de Desenho aprovado, o sistema recusa a ficha.',
            'Retoque previsto: data do atendimento + Retoque da micropigmentação (dias). O botão de agendar sugere o serviço Retoque de micropigmentação.',
            'Linha de pigmento sem Quantidade entra no rastreio, mas não baixa o estoque.',
            'Tipos de produto oferecidos: pigmento e outro.',
          ],
        },
      ],
    },
    {
      id: 'laser',
      title: 'Laser: marcar e registrar uma sessão',
      path: '/estetica/especialidades',
      simple: [
        { text: 'Ao ligar a especialidade, o sistema cria o equipamento e os serviços de laser. Ao marcar, o aparelho fica reservado para a paciente.' },
        {
          steps: [
            'Marque a sessão na agenda, com o serviço de laser da área.',
            'No atendimento, na aba Depilação a laser e corporal da paciente, clique em + Sessão de laser.',
            'Escolha o Fototipo (Fitzpatrick) e o Equipamento / sala.',
            'Em Áreas e parâmetros, clique em + Linha para cada área. Preencha Área, Fluência, Pulso, Spot e Disparos.',
            'Registre a Reação e a Próxima sessão, e clique em Incluir no prontuário.',
            'Depois, no cartão da ficha, clique em Agendar retorno.',
          ],
        },
        { warn: 'Confira em Serviços da agenda se Depilação a laser (área pequena) está com Precisa de sala/equipamento livre marcado. Esse serviço também faz parte dos exemplos básicos e, nesse caso, não vem ligado ao aparelho.' },
      ],
      technical: [
        {
          list: [
            'Equipamento criado: Laser de diodo (equipamento), ligado apenas aos serviços de laser criados naquele momento.',
            'Serviços: área pequena, média e grande, com sala obrigatória, e Laser corporal, com sala obrigatória e fora do online.',
            'Obrigatórios: Fototipo e ao menos uma linha com Área. Não exige registro em conselho.',
            'A escolha do equipamento na ficha é só um registro. Ela não confere com a reserva da agenda.',
            'A ficha não usa lote nem baixa estoque. Parâmetros e reação são registrados como informados: o sistema não valida valores nem bloqueia por fototipo.',
            'Dois atendimentos no mesmo aparelho são recusados: "Esta sala/equipamento já está ocupado neste horário".',
          ],
        },
      ],
    },
    {
      id: 'tricologia',
      title: 'Tricologia: avaliação e protocolo',
      path: '/estetica/especialidades',
      simple: [
        { text: 'A tricologia tem quatro fichas, que acompanham a paciente da primeira consulta às sessões.' },
        {
          steps: [
            'Na aba Tricologia (capilar) da paciente, clique em + Anamnese capilar.',
            'Clique em + Tricoscopia e, em Regiões, use + Linha para cada região avaliada.',
            'Inclua as fotos na aba Fotos, por região.',
            'Clique em + Diagnóstico capilar e preencha o Protocolo de tratamento.',
            'Em Tratamentos, clique em + Novo tratamento e informe as Sessões previstas.',
            'A cada sessão, clique em + Ficha no tratamento, ou em + Sessão capilar. Escolha o Procedimento, o ativo e a Quantidade.',
          ],
        },
        { tip: 'O cartão do tratamento mostra o andamento, como "3 de 10 sessões".' },
      ],
      technical: [
        {
          list: [
            'Não exige registro em conselho. Profissional é opcional.',
            'Obrigatórios: Queixa principal na anamnese; ao menos uma região na tricoscopia; Diagnóstico e Protocolo de tratamento no diagnóstico; Procedimento na sessão.',
            'Sessões previstas da ficha de diagnóstico não preenche o tratamento: informe também ao abrir o tratamento.',
            'Tipos de produto oferecidos: ativo capilar e outro. A Quantidade, em ml, é usada no rastreio e na baixa de estoque.',
            'Só a Sessão capilar conta como sessão do tratamento. Esta ficha não oferece botão de agendar: marque pela agenda.',
            'O diagnóstico é um registro do profissional. O sistema não sugere nem confere conduta.',
          ],
        },
      ],
    },
  ],
};
