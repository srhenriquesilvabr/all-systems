import type { ManualGuide } from '@all/module-sdk/web';

/** O que é igual em todos os ramos. */
export const commonGuide: ManualGuide = {
  title: 'Recursos comuns',
  summary: 'O que funciona igual em todos os ramos: acesso, dados da empresa, equipe, clientes, planilhas, financeiro e auditoria.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      path: '/configuracoes/empresa',
      simple: [
        { text: 'Antes de usar as telas do seu ramo, deixe a base pronta. Assim os documentos saem com o nome certo e cada pessoa vê só o que precisa. Faça nesta ordem:' },
        {
          steps: [
            'Em Dados da empresa, preencha o nome, o CNPJ, o contato e o logo.',
            'Em Contas e categorias, crie as contas de banco da empresa, com o saldo inicial.',
            'Em Usuários, convide as pessoas e escolha o papel de cada uma.',
            'Em Equipe, cadastre quem trabalha na empresa.',
            'Em Clientes, cadastre ou importe os seus clientes.',
            'Abra o guia do seu ramo neste manual e siga os primeiros passos dele.',
          ],
        },
        { warn: 'Enquanto o envio de e-mail não estiver ligado, os convites e os links de senha não chegam. A tela de Usuários avisa quando isso acontece, e você dá o acesso com Copiar link de convite.' },
        { tip: 'Só o que a empresa contratou aparece no menu. Se um item citado aqui não aparece para você, seu papel pode não dar acesso a ele.' },
      ],
      technical: [
        { text: 'Toda empresa nasce com os módulos do core: login, manual, dados da empresa, usuários, permissões, auditoria, clientes, financeiro, segmentação e equipe. Ao ativar o financeiro, o sistema cria a conta Caixa e as categorias padrão.' },
        { text: 'Quem cria a conta recebe o papel Dono, com todas as permissões dos módulos ativos. Permissão efetiva = permissões dos papéis ∩ permissões dos módulos ativos. O item de menu e a rota dependem da permissão indicada em cada assunto.' },
        { text: 'Em produção, o envio de e-mail depende da chave do Resend (RESEND_API_KEY). Sem ela, a mensagem é descartada com um aviso no log; a tela de Usuários avisa e oferece o link de convite.' },
      ],
    },
    {
      id: 'entrar-no-sistema',
      title: 'Entrar no sistema e recuperar a senha',
      simple: [
        { text: 'Existem três formas de chegar à sua conta: contratar a Palmer, aceitar um convite ou entrar com e-mail e senha.' },
        { list: ['Empresa nova: na tela de login, clique em Contratar a Palmer, escolha o ramo, preencha os dados e clique em Criar conta. Você já entra no sistema.', 'Convidado: abra o link do e-mail, confirme seu nome, crie a senha e clique em Salvar senha.', 'Já tem senha: informe e-mail e senha e clique em Entrar.'] },
        {
          steps: ['Esqueceu a senha? Na tela de login, clique em Esqueci minha senha.', 'Informe o e-mail e clique em Enviar link.', 'Abra o link recebido e crie a senha nova. O link vale por 30 minutos.'],
        },
        { warn: 'Se o e-mail não chegar, procure quem administra o sistema: o envio pode estar desligado. Para o primeiro acesso, ele pode copiar o link de convite em Usuários. Para recuperar uma senha já criada, ainda é preciso o e-mail.' },
        { tip: 'Tem acesso a mais de uma empresa? O sistema pergunta qual abrir. Depois, troque pela lista no alto do menu. No fim do menu ficam o tema (Claro, Escuro ou Automático) e o botão Sair.' },
      ],
      technical: [
        {
          list: [
            'Senha com no mínimo 10 caracteres.',
            'Depois de 5 senhas erradas, a conta fica bloqueada por 15 minutos. A mensagem continua E-mail ou senha inválidos.',
            'Convite vale 7 dias; link de redefinição, 30 minutos, com uso único. Trocar a senha encerra todas as sessões.',
            'Esqueci minha senha sempre responde que enviou, para não revelar quais e-mails existem. Muitas tentativas: Muitas tentativas. Aguarde alguns minutos.',
            'Contratação: um ramo por vez, conta em teste (trial), CNPJ ou CPF opcional e validado. E-mail já usado é recusado (Este e-mail já tem uma conta). Há limite de 5 cadastros por hora por IP e um limite diário.',
            'Empresa suspensa fica só para leitura (Empresa suspensa: acesso somente leitura).',
          ],
        },
        { text: 'O cadastro pelo site não depende de e-mail, porque o dono define a senha na hora. Redefinição de senha depende do envio, que em produção fica desligado enquanto não houver a chave do Resend. Convite tem também o link copiado em Usuários (ver Dar acesso e definir o que cada um pode fazer).' },
      ],
    },
    {
      id: 'dados-da-empresa',
      title: 'Preencher os dados e a marca da empresa',
      path: '/configuracoes/empresa',
      simple: [
        { text: 'Aqui ficam o cadastro da empresa e a aparência do painel. O nome, o logo e a cor valem para toda a equipe e aparecem nas páginas públicas, como o agendamento online.' },
        {
          steps: [
            'Em Logo, clique em Enviar logo. Ele é gravado na hora.',
            'Preencha Identificação, Contato e Endereço. Ao completar o CEP, o endereço é preenchido sozinho.',
            'Em Cor do painel, escolha uma sugestão ou outra cor. Veja a prévia nos temas claro e escuro.',
            'Clique em Salvar.',
          ],
        },
        { warn: 'A cor só é gravada se tiver contraste suficiente. Se o sistema avisar, escolha um tom mais escuro.' },
        { tip: 'Prefira o logo horizontal com fundo transparente, em PNG, JPG, SVG ou WebP, de até 1 MB.' },
      ],
      technical: [
        { text: 'Permissão: core.company.manage (Editar dados da empresa, logo e cor do painel). Nome fantasia entre 2 e 120 caracteres. O CNPJ ou CPF, o site, o Instagram e o telefone são validados, com a mensagem ao lado de cada campo.' },
        { text: 'Cor em #rrggbb, com contraste mínimo de 4,5:1 para o texto dos botões. Voltar ao padrão Palmer limpa a cor. Sem logo, o menu mostra a marca Palmer. O endereço público da empresa não aparece nesta tela. O CEP é consultado pelo servidor (GET /cep/:cep).' },
        { text: 'Logo e Remover agem na hora; os demais campos, ao clicar em Salvar. Nome, cor e logo vêm da sessão, por isso o menu muda em seguida.' },
      ],
    },
    {
      id: 'usuarios-e-papeis',
      title: 'Dar acesso e definir o que cada um pode fazer',
      path: '/configuracoes/usuarios',
      simple: [
        { text: 'Usuário é quem entra no sistema. Papel é o conjunto do que essa pessoa pode ver e fazer.' },
        {
          steps: [
            'Em Usuários, clique em Convidar usuário.',
            'Informe nome e e-mail, marque os papéis e clique em Enviar convite.',
            'A pessoa aparece como Convite pendente até criar a senha.',
            'Para mudar papéis ou tirar o acesso, clique em Editar na linha da pessoa e use Acesso ativo.',
          ],
        },
        { text: 'Se nenhum papel padrão servir, crie o seu: em Papéis, clique em Novo papel, dê um nome, marque as permissões e clique em Salvar.' },
        { text: 'A pessoa não recebeu o convite? Clique em Convite na linha dela. Reenviar convite manda um novo e-mail. Copiar link de convite gera um link para você entregar por outro canal, como o WhatsApp.' },
        { warn: 'Quem tem o link define a senha da conta: entregue só à própria pessoa. Se o envio de e-mail estiver desligado, a tela avisa e o convite por e-mail não sai.' },
        { tip: 'Desative o acesso de quem saiu da empresa. Isso também encerra as sessões abertas dessa pessoa na empresa.' },
      ],
      technical: [
        {
          list: [
            'core.users.read: Ver usuários. core.users.manage: Convidar, desativar e alterar papéis de usuários.',
            'core.access.read: Ver papéis e permissões. core.access.manage: Criar e editar papéis.',
            'Só um dono concede ou remove o papel de dono. A empresa precisa de ao menos um dono ativo (A empresa precisa de ao menos um dono ativo).',
            'Ninguém desativa o próprio acesso (Você não pode desativar o próprio acesso).',
            'E-mail já vinculado: Este e-mail já tem acesso à empresa. Quem já tem senha em outra empresa entra na hora, sem criar senha.',
            'Papéis padrão vêm dos módulos, ficam como Ver e não podem ser alterados (Papéis padrão não podem ser alterados. Crie um papel novo). O papel Dono não abre.',
          ],
        },
        { text: 'Convite vale 7 dias. Rotas, com core.users.manage: POST /users/:id/resend-invite e POST /users/:id/invite-link, só para quem ainda não criou a senha e com o acesso ativo (Esta pessoa já criou a senha). GET /users/email-status diz se o e-mail está ligado. O link recusa quem também foi convidado por outra empresa, porque a senha é da conta e daria entrada lá também (Esta pessoa também foi convidada por outra empresa); nesse caso, só por e-mail. Só um dono gera o link de outro dono. Gerar outro link invalida os anteriores. A auditoria registra quem gerou, sem o link. Não há exclusão de usuário nem de vínculo: só desativar. Excluir um papel tira as permissões de quem o usa. As permissões oferecidas são só as dos módulos ativos.' },
      ],
    },
    {
      id: 'cadastrar-equipe',
      title: 'Cadastrar a equipe',
      path: '/equipe',
      simple: [
        { text: 'A Equipe guarda os dados de quem trabalha na empresa, num cadastro só. A coluna Atua como mostra onde cada pessoa aparece, como na agenda ou no RH.' },
        {
          steps: [
            'Em Equipe, clique em Nova pessoa.',
            'Preencha nome, CPF, contato, endereço e Início na empresa. Se quiser, envie a foto e o currículo.',
            'Se a pessoa usa o sistema, escolha o usuário dela em Login do sistema.',
            'Clique em Salvar.',
          ],
        },
        { warn: 'Estar na Equipe não dá acesso ao sistema. Para entrar, a pessoa precisa de um convite em Usuários.' },
        { tip: 'Quando alguém sair, preencha Data de encerramento. Depois dessa data, a pessoa sai da agenda. Na lista, use o filtro Encerrados para vê-la.' },
      ],
      technical: [
        { text: 'Permissões: core.team.read (Ver a equipe e os dados pessoais: CPF, endereço, currículo) e core.team.manage (Cadastrar e editar pessoas da equipe). Sem manage, a ficha abre só para leitura. Abrir a ficha e baixar o currículo ficam registrados na auditoria.' },
        {
          list: [
            'CPF único na equipe: Este CPF já é de ..., da equipe, com o link para o cadastro.',
            'Encerramento antes do início é recusado.',
            'Currículo em PDF ou Word, até 15 MB; foto até 8 MB.',
            'Passada a Data de encerramento, o evento core.team.member_ended é publicado, ao salvar ou por uma rotina de hora em hora.',
            'Não há exclusão de pessoa. RH e agenda gravam neste mesmo cadastro.',
          ],
        },
      ],
    },
    {
      id: 'cuidar-dos-clientes',
      title: 'Cadastrar e cuidar dos clientes',
      path: '/clientes',
      simple: [
        { text: 'O cadastro de clientes é usado por todas as telas do sistema. Na ficha ficam os dados, as abas do seu ramo, a linha do tempo e a privacidade.' },
        {
          steps: [
            'Em Clientes, clique em Novo cliente.',
            'Em Tipo, escolha Pessoa física ou Empresa.',
            'Preencha nome, CPF ou CNPJ, telefone, e-mail e endereço. Ao completar o CEP, o endereço é preenchido sozinho.',
            'Clique em Salvar. Se houver cadastro parecido, confira. Se for mesmo outra pessoa, clique em Salvar mesmo assim.',
          ],
        },
        { text: 'Quer guardar mais alguma informação? Em Campos de clientes, clique em Novo campo. Exemplo: Como conheceu a empresa.' },
        { text: 'Na aba Privacidade, marque quais mensagens o cliente autorizou. Se ele pedir, use Exportar dados (JSON) ou Anonimizar.' },
        { warn: 'Anonimizar apaga nome, documento, contatos e observações para sempre. Os valores financeiros ficam. Não dá para desfazer.' },
      ],
      technical: [
        {
          list: [
            'core.customers.read: Ver clientes. core.customers.write: Cadastrar e editar clientes.',
            'core.customers.privacy: Exportar e anonimizar dados de clientes (LGPD).',
            'core.customers.fields: Configurar campos extras do cadastro.',
          ],
        },
        { text: 'CPF e CNPJ são validados e nunca se repetem (Já existe um cliente com este CPF/CNPJ). E-mail ou telefone igual gera aviso, que pode ser ignorado no cadastro manual (Há cadastros com o mesmo e-mail ou telefone). Telefone precisa de DDD. Cadastro anonimizado não pode ser editado.' },
        { text: 'Campos extras: Texto, Número, Data, Sim/Não ou Lista de opções, com até 50 opções. O tipo não muda depois. A tela só cria e exclui; excluir esconde os valores já preenchidos. Campo obrigatório vale também para importação e edição.' },
        { text: 'Autorizações: avisos sobre os serviços valem por padrão; ofertas por e-mail e WhatsApp exigem autorização. Cada mudança fica na linha do tempo, que mostra os 100 registros mais recentes. A exportação traz o que os módulos ativos guardam sobre o cliente e fica na auditoria.' },
      ],
    },
    {
      id: 'importar-planilhas',
      title: 'Importar planilhas',
      simple: [
        { text: 'A importação evita digitar um cadastro por vez. Ela aparece nas telas de cadastro com os botões Baixar modelo e Importar planilha: Clientes, Usuários, Lançamentos, Contas e categorias e várias telas dos ramos.' },
        {
          steps: [
            'Clique em Baixar modelo. A aba Instruções explica cada coluna.',
            'Preencha uma linha por cadastro.',
            'Clique em Importar planilha e em Escolher planilha.',
            'Veja quantas linhas estão prontas e quais têm problema.',
            'Clique em Importar e não feche a tela até terminar.',
            'Se alguma linha não entrar, clique em Baixar linhas com erro, corrija e importe só essas de novo.',
          ],
        },
        { warn: 'Em Lançamentos, o sistema não reconhece repetição. Importar de novo o arquivo inteiro duplica tudo.' },
        { warn: 'Em Usuários, cada linha importada envia um convite.' },
      ],
      technical: [
        { text: 'Aceita .xlsx, .xls e .csv. A planilha é lida no navegador e cada linha vai para a mesma rota do cadastro manual, com a mesma permissão e as mesmas validações, 3 linhas por vez. Se a API pedir calma (429), a linha espera e tenta de novo até 5 vezes. As linhas boas ficam gravadas mesmo quando outras falham.' },
        { text: 'As colunas são localizadas pelo cabeçalho, sem diferenciar maiúsculas e acentos. Falta de coluna obrigatória bloqueia a importação. A prévia mostra as 50 primeiras linhas. Datas em dd/mm/aaaa, aaaa-mm-dd ou data do Excel; valores como 1.234,56 ou R$ 1.234,56.' },
        {
          list: [
            'Clientes: inclui os campos extras. E-mail ou telefone repetido é recusado na importação, porque não há a opção Salvar mesmo assim.',
            'Usuários: um papel por linha, pelo nome; vazio entra sem papel; Dono não entra por planilha.',
            'Lançamentos: conta, categoria e cliente são procurados pelo nome (cliente também pelo CPF/CNPJ). Pago exige Data do pagamento e Conta.',
            'Contas e categorias: cada lista tem o próprio modelo.',
          ],
        },
      ],
    },
    {
      id: 'contas-e-categorias',
      title: 'Organizar contas e categorias',
      path: '/financeiro/cadastros',
      simple: [
        { text: 'As contas dizem onde o dinheiro fica. As categorias dizem do que é cada entrada ou saída. Isso é feito uma vez e raramente muda.' },
        {
          steps: [
            'Em Contas e categorias, clique em Nova conta.',
            'Informe o nome, o tipo (Caixa, Banco ou Gateway de pagamento) e o saldo inicial.',
            'Clique em Criar.',
            'Faça o mesmo em Nova categoria, escolhendo Despesa ou Receita.',
          ],
        },
        { text: 'Para renomear uma conta ou corrigir o saldo inicial, clique em Editar na linha dela. A correção do saldo pede o motivo.' },
        { warn: 'Corrigir o saldo inicial muda o saldo da conta, mas não entra como receita nem despesa. O valor anterior e o motivo ficam no histórico da conta.' },
        { tip: 'A empresa já começa com a conta Caixa e com as categorias mais comuns. Em vez de excluir, use Desativar.' },
      ],
      technical: [
        { text: 'Permissão: core.finance.manage (Gerenciar contas e categorias). A leitura usa core.finance.read. Saldo da conta = saldo inicial + recebidos − pagos na conta.' },
        { text: 'Categorias do sistema: Serviços, Venda de produtos, Outras receitas, Aluguel, Salários e encargos, Insumos e materiais, Taxas e tarifas, Impostos e Outras despesas. Elas não têm o botão Desativar, porque os módulos as usam. A tela de categorias só oferece Desativar e Reativar. Não há exclusão.' },
        { text: 'POST /finance/accounts/:id/initial-balance exige o motivo e recusa o mesmo valor (O saldo inicial já é esse valor). GET /finance/accounts/:id/history mostra as mudanças. A correção é no campo, e não por lançamento de ajuste, para não sujar o resultado com dinheiro que não entrou nem saiu.' },
      ],
    },
    {
      id: 'lancamentos',
      title: 'Lançar, dar baixa e acompanhar o financeiro',
      path: '/financeiro/lancamentos',
      simple: [
        { text: 'Lançamentos são as contas a receber e a pagar. Os módulos do seu ramo criam muitos deles sozinhos; os demais você cria aqui.' },
        {
          steps: [
            'Em Lançamentos, clique em Novo lançamento.',
            'Escolha Despesa ou Receita, informe valor, descrição, vencimento e categoria.',
            'Em Situação, deixe Em aberto ou escolha Já pago e informe data e conta.',
            'Clique em Salvar.',
            'Quando o dinheiro entrar ou sair, clique em Baixar, informe data e conta e clique em Confirmar.',
          ],
        },
        { text: 'Em Visão geral, veja o que foi recebido e pago, o resultado, os vencidos, o saldo das contas e o que está previsto por mês.' },
        { text: 'Errou? Clique em Editar para corrigir. Baixa dada por engano: clique em Estornar baixa e informe o motivo; o lançamento volta a ficar em aberto. Histórico mostra tudo o que aconteceu com o lançamento.' },
        { warn: 'Lançamento pago não muda de valor nem de conta: estorne a baixa antes. Lançamento gerado por um módulo só muda a categoria e as observações, e a conta enquanto está em aberto. O resto se corrige na tela de origem.' },
        { tip: 'Para receita de um cliente entrar nos Segmentos, ela precisa estar ligada a ele: preencha o campo Cliente ao lançar. A lista mostra o cliente de cada lançamento, e a busca encontra pelo nome dele.' },
      ],
      technical: [
        {
          list: [
            'core.finance.read: Ver financeiro e relatórios (Visão geral, Lançamentos, Exportar CSV).',
            'core.finance.write: Lançar, editar, dar baixa, estornar e cancelar lançamentos.',
            'Situações: Em aberto, Pago, Cancelado. Vencido é um filtro: em aberto com vencimento antes de hoje, no fuso de São Paulo.',
            'Lançamento de módulo: Baixar e Estornar baixa só aparecem quando o módulo deixa a baixa com o financeiro. Cancelar só aparece nos manuais (Este valor é controlado por outro módulo).',
            'Estorno: POST /finance/entries/:id/reverse, com motivo. Volta para em aberto, sem conta nem data. A data, a conta e a forma do pagamento desfeito ficam na auditoria. Só pago (Só lançamentos pagos podem ter a baixa estornada).',
            'Edição: PATCH /finance/entries/:id. Pago recusa valor e conta (Lançamento pago: estorne a baixa antes). De módulo recusa valor, descrição, datas e cliente. Cancelado não edita. Categoria precisa ser do mesmo tipo.',
            'Cancelar pago é recusado (Estorne a baixa antes de cancelar este lançamento).',
            'Valor maior que zero, até 100 milhões; Pago exige data e conta.',
            'Exportar CSV respeita os filtros, até 10.000 linhas, com ; e vírgula decimal.',
          ],
        },
        { text: 'Visão geral: Realizado usa a data de pagamento; Previsto, os lançamentos em aberto pelo vencimento. Períodos de 1, 3, 6 ou 12 meses. O rodapé Receitas e Despesas soma o que está no filtro, sem os cancelados; eles só entram com o filtro Cancelados. A origem aparece pelo nome, na tela e no CSV (Manual, Ordem de serviço, Folha de pagamento, Honorários da consultoria de RH etc.).' },
        { text: 'Tudo é registrado na auditoria, com o valor anterior e o novo de cada campo editado. GET /finance/entries/:id/history (core.finance.read) traz o histórico do lançamento. Na planilha, Boleto e Transferência gravam valores diferentes (boleto e transfer); o que foi importado antes como Boleto continua como transfer.' },
      ],
    },
    {
      id: 'segmentos',
      title: 'Ver os segmentos de clientes',
      path: '/segmentos',
      simple: [
        { text: 'Os segmentos mostram quem são seus melhores clientes e quem está sumindo, para você saber com quem falar. Tudo vem dos recebimentos registrados no financeiro.' },
        {
          steps: [
            'Abra Segmentos.',
            'Clique num grupo: Campeões, Leais, Promissores, Novos, Em risco, Hibernando ou Perdidos.',
            'Leia a ação sugerida e veja a lista de clientes.',
            'Escolha quem entra na planilha: todos do segmento, só quem autorizou ofertas por e-mail ou só quem autorizou por WhatsApp. Clique em Exportar planilha.',
          ],
        },
        { warn: 'A planilha respeita as autorizações da aba Privacidade: o e-mail só sai de quem autorizou ofertas por e-mail, e o telefone só de quem autorizou por WhatsApp. Quem não autorizou fica na lista sem o contato. A tela mostra o cadastro e, ao lado, o que cada cliente autorizou.' },
        { tip: 'Cliente sem nenhum recebimento ligado a ele aparece só na conta de Sem compras. Na ficha de cada cliente também aparecem o segmento e a sugestão.' },
      ],
      technical: [
        { text: 'Permissões: core.segmentation.read (Ver segmentos de clientes e exportar listas) e core.segmentation.manage (Recalcular os segmentos). Atualiza uma vez por dia; Recalcular agora faz na hora.' },
        { text: 'Base: receitas pagas ligadas a um cliente. Recência pela última compra; frequência e valor nos últimos 12 meses. Frequência conta origens distintas: parcelas de um mesmo pacote são uma compra. Notas de 1 a 5 pela posição dentro da empresa; com um cliente só, nota 3.' },
        {
          list: [
            'Campeões: R, F e M a partir de 4.',
            'Em risco: R até 2 e F a partir de 3.',
            'Leais: F a partir de 4.',
            'Novos: R a partir de 4, até uma compra, primeira compra há menos de 60 dias.',
            'Promissores: R a partir de 3.',
            'Hibernando: R igual a 2.',
            'Perdidos: os demais.',
          ],
        },
        { text: 'A regra é aplicada de cima para baixo. A tela mostra até 500 clientes por segmento; o arquivo exportado, até 5.000. A exportação (GET /segmentation/customers.csv, opção consent=marketing_email ou marketing_whatsapp) vai para a auditoria e traz as colunas Autoriza ofertas por e-mail e por WhatsApp; sem registro de autorização, conta como Não.' },
      ],
    },
    {
      id: 'contratar-ramos-e-modulos',
      title: 'Contratar ramos e módulos',
      simple: [
        { text: 'Ramo é o tipo de negócio, com as telas dele. Módulo é um recurso que se soma ao que a empresa já usa. Quem é dono da empresa vê as opções na página inicial.' },
        {
          steps: [
            'Abra Início.',
            'Desça até Ramos disponíveis para contratar ou Módulos disponíveis para contratar.',
            'Clique em Contratar.',
            'Confirme em Confirmar. As telas novas entram no menu na hora.',
          ],
        },
        { text: 'Para desativar, abra Módulos contratados, no grupo Configurações (ou clique em Gerenciar na página inicial), clique em Desativar e confirme.' },
        { warn: 'A ativação e a desativação são imediatas, para todos da empresa. Módulo do qual outro depende não pode ser desativado: desative antes o que depende dele.' },
        { tip: 'Os dados não são apagados ao desativar: só o acesso é bloqueado. Contratando de novo, tudo volta.' },
      ],
      technical: [
        { text: 'Só o dono contrata (Só o dono da empresa pode contratar). Camadas contratáveis: vertical, shared e integration; o core já vem em toda empresa. A ativação inclui as dependências, cria os papéis padrão e fica na auditoria como Módulos ativados.' },
        { text: 'A tela não mostra preço nem gera cobrança. Só o dono desativa (Só o dono da empresa pode desativar), em POST /modules/:key/deactivate; a lista vem de GET /modules/contracted (core.access.settings). Recusas: outro módulo ativo depende daquele (… é usado por …) e módulo do core. Fica na auditoria como Módulo desativado. A plataforma também desativa pelo comando cli module:disable. Depois de contratar, o manual do ramo aparece aqui como um novo guia.' },
        { text: 'As configurações dos módulos usam a permissão core.access.settings (Configurar os módulos contratados), em telas próprias de cada módulo.' },
      ],
    },
    {
      id: 'auditoria',
      title: 'Conferir quem fez o quê',
      path: '/configuracoes/auditoria',
      simple: [
        { text: 'A Auditoria é o histórico da empresa: quem fez cada ação, quando e de onde. Use quando precisar entender uma mudança.' },
        {
          steps: ['Abra Auditoria, no grupo Configurações.', 'Filtre por período, usuário ou ação. Em Busca, digite um nome ou um motivo: ela procura também nos detalhes.', 'Os registros mais novos vêm primeiro. Clique em Carregar mais para ver os anteriores.', 'Clique em Detalhes para ver o que foi gravado, como o motivo de um estorno.'],
        },
        { tip: 'Quando aparece Sistema no lugar do nome, a ação foi automática.' },
      ],
      technical: [
        { text: 'Permissão: core.audit.read (Ver trilha de auditoria). Colunas: Quando, Quem, Ação e IP, 50 registros por vez. Filtros em GET /audit: from e to (dias no fuso de São Paulo), userId (ou system, para as automáticas), action e q. GET /audit/filters lista as ações e as pessoas que já aparecem.' },
        { text: 'As ações aparecem pelo nome em português (apps/admin/src/pages/auditLabels.ts). Uma ação sem nome cadastrado aparece com um texto montado a partir do código. A leitura de dados sensíveis também é registrada, como abrir uma pessoa da equipe e exportar um cliente.' },
      ],
    },
  ],
};
