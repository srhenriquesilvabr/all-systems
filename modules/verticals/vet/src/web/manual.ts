import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Veterinária',
  summary: 'Consultas pela agenda, ficha dos pets, prontuário e carteira de vacinação com lembrete.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/agenda/profissionais',
      simple: [
        { text: 'A agenda só funciona depois de saber quem atende e em que horário. Comece por aí e depois traga os dados que você já tem.' },
        {
          steps: [
            'Abra Profissionais e horários e clique em Novo profissional para cada veterinário.',
            'Clique em Horários e ajuste o expediente de cada um.',
            'Se usa consultório ou centro cirúrgico, cadastre também como Sala / equipamento, no campo Tipo.',
            'Abra Serviços da agenda. O sistema já traz consultas, vacinas e outros procedimentos de exemplo. Ajuste preços e duração.',
            'No Financeiro, em Contas e categorias, confira se existe uma conta de caixa.',
            'Em Configurações, Usuários, convide a equipe e escolha o papel: Veterinário(a) ou Recepção.',
            'Se vem de outro sistema, importe clientes, pets e histórico de vacinas, nessa ordem.',
          ],
        },
      ],
      technical: [
        { text: 'Ao ativar o módulo, se não houver serviços, são criados 8 de exemplo. Profissional não é criado: sem ele, a agenda mostra “Nenhum profissional cadastrado”.' },
        {
          list: [
            'Veterinário(a): ver a agenda e mudar status, prontuário (ver e incluir), pets, vacinas (ver e registrar), ver clientes.',
            'Recepção: agenda completa, pagamentos, pets, ver vacinas, clientes. Não vê o prontuário e não registra vacina.',
            'Veterinário(a) não marca horários (shared.scheduling.write) nem registra pagamentos, a menos que receba isso em outro papel.',
            'A Recepção vende no caixa (shared.sales.sell e shared.sales.register). O papel Gerente soma shared.scheduling.manage, shared.medical-records.audit, produtos, estoque, vendas e histórico de caixas.',
          ],
        },
        { text: 'Novo profissional começa com expediente de segunda a sexta, das 9h às 12h e das 13h às 18h, e sábado das 9h às 13h.' },
      ],
    },
    {
      id: 'tutores-e-pets',
      title: 'Cadastrar tutores e pets',
      path: '/pets',
      simple: [
        { text: 'Cada pet fica ligado ao tutor, que é o cliente. É na ficha do pet que ficam o prontuário e a carteira de vacinação.' },
        {
          steps: [
            'Abra Pets e clique em Novo pet.',
            'Busque o tutor. Se não encontrar, clique em Cadastrar cliente.',
            'Preencha Nome e Espécie. Se puder, informe Raça, Sexo, Nascimento, Peso, Porte e Microchip.',
            'Em Observações, anote temperamento, alergias e cuidados no manejo.',
            'Clique em Salvar.',
          ],
        },
        { tip: 'Na hora de marcar, o botão Novo, ao lado da lista de pets, cadastra sem sair da agenda.' },
        { warn: 'Não há como apagar um pet nem trocar o tutor. Se o pet faleceu, abra a ficha, clique em Editar e marque Falecido(a).' },
      ],
      technical: [
        { list: ['Permissões: shared.pets.read e shared.pets.write.', 'A lista é paginada, 25 por página. A busca é por nome, raça ou tutor.', 'Importar planilha: o tutor precisa já existir e é achado por CPF/CNPJ ou telefone. A coluna Tutor (nome) desempata telefones repetidos.', 'A idade é calculada pelo nascimento.'] },
        { text: 'Pet Falecido(a) sai da lista de marcação e dos reforços e lembretes de vacina. O prontuário e a carteira continuam na ficha. O campo Peso da ficha é independente do peso digitado em cada consulta.' },
      ],
    },
    {
      id: 'marcar-consulta',
      title: 'Marcar consulta, vacina ou retorno',
      path: '/agenda',
      simple: [
        { text: 'Marcar reserva o horário do veterinário e já avisa o tutor. Se o serviço exigir, reserva também a sala.' },
        {
          steps: [
            'Abra Agenda e clique em Novo horário, ou clique em um espaço vazio na coluna do profissional.',
            'Busque o Cliente e escolha o Pet.',
            'Marque os Serviços. Exemplo: Consulta clínica e Vacina V10.',
            'Escolha o Profissional e o Dia. Clique em um dos horários livres.',
            'Clique em Marcar.',
          ],
        },
        { tip: 'Clique no horário para Confirmar, Remarcar, Cancelar horário ou marcar Faltou.' },
        { warn: 'Escolha sempre o pet. A tela avisa enquanto ele não estiver escolhido: sem ele, o horário fica só no nome do tutor. Marcar a vacina na agenda não a registra na carteira. Depois de aplicar, registre na ficha do pet.' },
      ],
      technical: [
        { list: ['Marcar, remarcar e cancelar: shared.scheduling.write. Confirmar e Faltou: shared.scheduling.status.', 'Duração: soma da duração e do intervalo de cada serviço.', 'Conflitos: “Este horário já está ocupado para este profissional” e “Nenhuma sala/equipamento livre neste horário”.', 'Outro horário confere expediente e folga. Para uma exceção, quem tem shared.scheduling.manage clica em Marcar mesmo assim, e isso fica na auditoria.', 'Só horário Agendado ou Confirmado pode ser remarcado. Profissional, serviço, preço e desconto mudam em Alterar, até concluir.'] },
        { text: 'Avisos: Horário marcado, Horário remarcado, Horário cancelado e o lembrete, por padrão 1 dia antes, em Serviços da agenda. Com WhatsApp ativo, o lembrete traz os botões Confirmar e Cancelar. Em Serviços da agenda também se liga o agendamento online, onde o tutor informa o nome e a espécie do pet.' },
      ],
    },
    {
      id: 'atender-e-receber',
      title: 'Receber o paciente e registrar o pagamento',
      path: '/agenda',
      simple: [
        { text: 'A situação do horário mostra para a equipe quem chegou, quem está em atendimento e quem já terminou.' },
        {
          steps: [
            'Na Agenda, clique no horário.',
            'Quando chegar, clique em Chegou.',
            'Ao entrar no consultório, clique em Iniciar atendimento.',
            'Ao terminar, clique em Concluir.',
            'Clique em Registrar pagamento, confira Valor, Forma e Conta e clique em Registrar.',
          ],
        },
        { warn: 'Concluído é definitivo: não há como voltar a situação. Se ficou saldo, ele segue como valor a receber no financeiro.' },
      ],
      technical: [
        { list: ['Status: shared.scheduling.status. Pagamento: shared.scheduling.payments.', 'Agendado e Confirmado vão para Chegou, Em atendimento, Concluído, Faltou ou Cancelado. Chegou vai para Em atendimento, Concluído ou Cancelado. Em atendimento só vai para Concluído, e o botão Cancelar horário não aparece.', 'Pagamento na data informada (padrão hoje; futuro é recusado). Com Caixa escolhido e sessão aberta, entra na conferência do fechamento, sem outro lançamento no financeiro.'] },
        { text: 'Pagamento vira receita paga no financeiro, categoria de serviços. Ao concluir, o saldo vira valor a receber, no dia do atendimento. Cancelar ou Faltou zera. A tela do horário não abre o prontuário: abra a ficha do pet em Pets. É lá, ao incluir o registro, que se escolhe o Horário da agenda.' },
      ],
    },
    {
      id: 'prontuario',
      title: 'Registrar a consulta no prontuário',
      path: '/pets',
      simple: [
        { text: 'O prontuário guarda o histórico do pet, do registro mais recente ao mais antigo. O sistema só organiza o que o profissional escreve: ele não sugere diagnóstico nem conduta.' },
        {
          steps: [
            'Abra Pets, busque o pet e clique nele.',
            'Na aba Prontuário, clique em + Consulta, + Exame, + Procedimento ou + Anotação.',
            'Confira a Data do atendimento e o Horário da agenda, que já vem sugerido quando o pet está em atendimento hoje. Preencha os campos. Em Consulta, Queixa principal é obrigatória.',
            'Clique em Incluir no prontuário.',
            'Para anexar um laudo ou imagem, clique em Anexar arquivo no registro.',
          ],
        },
        { warn: 'Depois de incluído, o registro não pode ser apagado nem editado. Só pode ser retificado.' },
        { tip: 'Preencheu o campo Retorno? Depois de incluir, clique em Marcar retorno no registro, escolha o serviço, o profissional e um horário livre. O horário já nasce com o pet.' },
      ],
      technical: [
        { list: ['Ver: shared.medical-records.read (Ver prontuários, dado sensível). Incluir e anexar: shared.medical-records.write.', 'Consulta: queixa, anamnese, peso, temperatura, frequências cardíaca e respiratória, hidratação, mucosas, exame físico, diagnóstico ou suspeita, conduta e prescrição, retorno.', 'Exame: tipo (obrigatório), laboratório e resultado. Procedimento: nome (obrigatório), anestesia ou sedação, descrição, intercorrências, orientações, termo de consentimento assinado (só uma marcação; o termo não é gerado).', 'Data do atendimento: nunca futura. Registro vazio: “Preencha algum campo ou escreva uma anotação”.', 'Anexo: JPEG, PNG, WebP ou PDF, até 15 MB.', 'Horário da agenda: só um horário do próprio pet (ou do tutor, se foi marcado sem pet). Outro é recusado: “Este horário da agenda não é deste paciente”. Aparece para quem tem shared.scheduling.read.', 'Marcar retorno: shared.medical-records.write ou shared.scheduling.write. Com o retorno marcado para o dia, o registro mostra o horário no lugar do botão. Horário ocupado é recusado como na agenda.'] },
        { text: 'O registro guarda autor, data do atendimento e quando foi digitado. Abrir o prontuário, incluir, retificar, anexar e abrir anexo ficam no registro de acessos. Este prontuário não é apagado nem anonimizado junto com o cadastro do tutor.' },
      ],
    },
    {
      id: 'retificar-prontuario',
      title: 'Corrigir um registro e ver quem acessou',
      path: '/pets',
      simple: [
        { text: 'Errou algo? A correção cria uma nova versão e mantém a original visível, marcada como retificada. Assim o histórico fica transparente.' },
        {
          steps: [
            'Na aba Prontuário, clique em Retificar no registro.',
            'Corrija os campos e escreva o Motivo da retificação. Exemplo: peso digitado errado.',
            'Clique em Salvar retificação.',
          ],
        },
        { tip: 'Quem tem permissão vê o botão Quem acessou, com cada pessoa que abriu este prontuário.' },
      ],
      technical: [
        { list: ['Retificar: shared.medical-records.write. Motivo de 3 a 500 caracteres.', 'Quem acessou: shared.medical-records.audit (mostra até 500 eventos).', 'Só a versão mais recente pode ser retificada: “Este registro já foi retificado: retifique a versão mais recente”.'] },
        { text: 'A retificação é um novo registro, com novo autor e o selo Retificação. O original recebe o selo Retificado e fica esmaecido, sem os botões. Os anexos do original aparecem na nova versão, marcados com a data do registro de onde vêm. É só referência: o arquivo continua no original, nada é copiado nem apagado.' },
      ],
    },
    {
      id: 'registrar-vacina',
      title: 'Registrar uma vacina',
      path: '/pets',
      simple: [
        { text: 'A carteira guarda as vacinas do pet. Com a data do reforço preenchida, o tutor é lembrado antes e o reforço entra na lista de vacinas a vencer.' },
        {
          steps: [
            'Abra a ficha do pet em Pets e clique na aba Vacinas.',
            'Clique em Registrar vacina.',
            'Escolha da lista ou digite a Vacina. A tela mostra como ela vai contar. Preencha Dose, Lote e Fabricante.',
            'Confira Aplicada em. Pode ser uma data passada, para vacina de outra clínica.',
            'Informe Próximo reforço. O botão +1 ano preenche a mesma data no ano seguinte.',
            'Clique em Registrar.',
          ],
        },
        { tip: 'Nomes diferentes da mesma vacina contam como uma só: V10, V-10 e V10 polivalente são a V10 (polivalente canina) do catálogo. O reforço antigo sai da lista quando chega a dose nova. O que foi digitado fica guardado.' },
        { warn: 'O sistema não define o esquema vacinal. A data do reforço é a que o profissional informar.' },
      ],
      technical: [
        { list: ['Ver: vet.vaccines.read. Registrar: vet.vaccines.write (Recepção não tem).', 'Nome de 2 a 80 caracteres. Aplicação nunca futura: “A data da aplicação não pode ser no futuro”.', 'Reforço depois da aplicação: “O reforço tem de ser depois da aplicação”.', 'Responsável: gravado com o nome de quem está logado, sem escolha na tela.', 'A mesma vacina na mesma data: “X já está registrada em dd/mm/aaaa para Y”. Anulada não conta.', 'Vacina que não está no catálogo entra nele com o nome digitado. Em Vacinas a vencer, Catálogo de vacinas, é possível editar, acrescentar apelidos e Juntar duas que são a mesma. Ao juntar, as aplicações passam para a que fica, o nome digitado é preservado e a repetida no mesmo dia fica anulada, com o motivo.'] },
        { text: 'A vacina não baixa estoque, não gera cobrança e não cria registro no prontuário. As Observações aparecem na carteira, também na impressão. Uma nova aplicação da mesma vacina, com data posterior, tira a anterior da lista de reforços.' },
      ],
    },
    {
      id: 'carteira',
      title: 'Imprimir a carteira e anular uma vacina',
      path: '/pets',
      simple: [
        { text: 'A carteira impressa serve para entregar ao tutor. A anulação corrige um lançamento errado sem apagar o histórico.' },
        {
          steps: [
            'Na aba Vacinas, clique em Imprimir carteira.',
            'Para corrigir, clique em Anular na vacina, escreva o Motivo e confirme em Anular.',
            'Se precisar, registre a vacina de novo com os dados certos.',
          ],
        },
        { warn: 'A carteira impressa é só um resumo do que está no sistema. Confira se ela atende ao que você precisa antes de usá-la como comprovante.' },
      ],
      technical: [
        { list: ['Anular: vet.vaccines.write. Motivo de 3 a 300 caracteres.', 'Já anulada: “Vacina não encontrada ou já anulada”.', 'Colunas impressas: vacina, dose e observações, aplicada, reforço, lote e fabricante, responsável.'] },
        { text: 'A vacina anulada continua na carteira, riscada, com o motivo, e sai das listas e dos lembretes. A anterior da mesma vacina, se houver, volta a valer para o reforço. A anulação fica na auditoria.' },
      ],
    },
    {
      id: 'vacinas-a-vencer',
      title: 'Avisar sobre reforços a vencer',
      path: '/vet/vacinas',
      simple: [
        { text: 'A lista mostra quem está com reforço vencido ou perto de vencer. Use para ligar ou mandar mensagem e marcar o horário.' },
        {
          steps: [
            'Abra Vacinas a vencer.',
            'Escolha o período: Próximos 7, 30 ou 90 dias.',
            'Veja as marcadas como Vencida primeiro. Clique no nome do pet para abrir a ficha.',
            'Na coluna Lembrete, Enviado mostra que o aviso automático saiu. Não enviado mostra o motivo, como cliente sem contato: nesse caso, quem avisa é a clínica.',
          ],
        },
        { warn: 'O lembrete automático é enviado uma vez, antes do vencimento. Reforço já vencido não recebe lembrete: quem precisa fazer o contato é a clínica.' },
      ],
      technical: [
        { list: ['Permissão: vet.vaccines.read.', 'A lista inclui todos os vencidos, sem limite de data, até o período escolhido. Só a dose mais recente de cada vacina de cada pet, sem pets falecidos, tutores anonimizados ou vacinas anuladas.', 'A tarefa roda a cada hora e envia o modelo Lembrete de vacina (reforço) para reforços entre hoje e o número de dias configurado.'] },
        { text: 'O prazo fica em Lembrete automático, no fim desta tela (core.access.settings): de 0 a 60 dias, padrão 7, e 0 desliga. Envio por e-mail e, com o módulo de WhatsApp ativo, também por WhatsApp. A coluna Lembrete mostra o melhor resultado entre os canais: Enviado, Aguardando envio pela equipe, Na fila, Falhou ou Não enviado, quando não há contato ou o tutor pediu para não receber. O lembrete é gerado uma vez por dose: corrigir o contato depois não reenvia.' },
      ],
    },
    {
      id: 'importar-historico',
      title: 'Trazer o histórico de vacinas de outro sistema',
      path: '/vet/vacinas',
      simple: [
        { text: 'Use uma vez, ao começar, para trazer as vacinas antigas de uma planilha.' },
        {
          steps: [
            'Importe primeiro os clientes e depois os pets.',
            'Em Vacinas a vencer, clique em Baixar modelo e preencha a planilha.',
            'Clique em Importar planilha e escolha o arquivo.',
            'Confira as linhas e clique em Importar.',
            'Se houver erro, baixe as linhas com erro, corrija e importe só elas.',
          ],
        },
        { tip: 'Pode importar a mesma planilha de novo: a mesma vacina, no mesmo pet e na mesma data, é ignorada, mesmo escrita de outro jeito, e a linha conta como importada.' },
        { warn: 'Reforços futuros também geram lembrete ao tutor. Confira as datas.' },
      ],
      technical: [
        { list: ['Permissão: vet.vaccines.write.', 'Tutor: CPF, telefone ou nome exatamente como em Clientes. Dois cadastros iguais: “Tutor: há mais de um cadastro X; informe o CPF”.', 'Pet: nome exato entre os do tutor, sem diferenciar acento e maiúscula.', 'Obrigatórias: Tutor, Pet, Vacina e Aplicada em. Datas em dd/mm/aaaa.'] },
        { text: 'A coluna Veterinário vai para as observações, como “Aplicada por...”. Na carteira, Responsável fica com o nome de quem importou, e as observações aparecem abaixo do nome da vacina.' },
      ],
    },
    {
      id: 'vender-no-caixa',
      title: 'Vender produtos no caixa',
      path: '/pdv',
      simple: [
        { text: 'O caixa serve para produtos da loja da clínica. Consultas e vacinas marcadas são cobradas no próprio horário da agenda.' },
        {
          steps: [
            'Cadastre os produtos em Produtos e estoque, com Novo produto.',
            'Abra Caixa (PDV) e, se precisar, clique em Abrir caixa e informe o Troco inicial.',
            'Passe o código de barras ou digite o nome do produto.',
            'Clique em Receber, escolha a forma de pagamento e clique em Concluir venda.',
            'No fim do dia, clique em Sangria, suprimento e fechamento e depois em Fechar caixa.',
          ],
        },
        { warn: 'Pagamentos registrados na agenda não entram no fechamento do caixa. Separe os valores ao contar a gaveta.' },
      ],
      technical: [
        { list: ['Nenhum papel padrão da veterinária traz vendas. Dê o papel Caixa (shared.sales.sell, shared.sales.register) ou Estoquista (produtos, estoque e relatório de vendas).', 'Até 5 formas por venda. Troco só em dinheiro. Fiado exige cliente identificado.', 'O cupom traz “Não é documento fiscal”.'] },
        { text: 'A venda gera receita da categoria de produtos e baixa o estoque do que é controlado. O módulo não controla validade ou lote de medicamentos e não liga a venda ao prontuário do pet. Ao ativar, a veterinária não cria produtos de exemplo.' },
      ],
    },
  ],
};
