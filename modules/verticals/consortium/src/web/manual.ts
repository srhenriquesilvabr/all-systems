import type { ManualGuide } from '@all/module-sdk/web';

export const manual: ManualGuide = {
  title: 'Consórcio',
  summary: 'Captação de clientes, venda de cotas pelas administradoras, parcelas, assembleias, lances, crédito e comissões.',
  topics: [
    {
      id: 'primeiros-passos',
      title: 'Primeiros passos',
      simple: [
        { text: 'Antes de vender, a corretora precisa de administradoras, planos e equipe. Siga esta ordem.' },
        {
          steps: [
            'Em Configurações, abra Dados da empresa e preencha nome, logo e cor. Eles aparecem no simulador público.',
            'Abra Usuários e convide a equipe, com o papel "Consultor(a)" ou "Gestor(a)".',
            'Abra Bancos e financeiras e cadastre as administradoras.',
            'No Simulador, clique em "Atualizar planos das administradoras".',
            'Em Comissões, defina a comissão padrão, o prazo de estorno e o aviso de atraso.',
            'Em Captação de clientes, ligue o simulador público e a distribuição dos leads.',
          ],
        },
        { warn: 'A administradora que vem pronta é de demonstração. Ela aceita as adesões sozinha e gera grupos fictícios. Não use para vendas reais.' },
      ],
      technical: [
        {
          list: [
            'Papel "Consultor(a)": consortium.read, consortium.sell, consortium.track, consortium.leads.read, consortium.leads.work, integration.banking.simulate, integration.banking.propose, core.customers.read e core.customers.write.',
            'Papel "Gestor(a)": os anteriores, consortium.manage (Sincronizar planos, lançar assembleias, grupos e comissões) e consortium.leads.manage (Cadastrar e importar leads, distribuir para vendedores, indicações, canais de anúncio e relatório de conversão).',
            'Bancos e financeiras e Captação de clientes exigem core.access.settings.',
            'Consulta de crédito é contratada à parte.',
            'Baixa de comissão no financeiro exige core.finance.write, fora desses papéis.',
          ],
        },
        { text: 'A corretora acompanha a cota; quem cobra as parcelas e faz as assembleias é a administradora. O módulo Vendas e estoque acompanha o ramo, mas a venda de cota não passa pelo caixa.' },
      ],
    },
    {
      id: 'administradoras-planos',
      title: 'Ligar as administradoras e atualizar os planos',
      path: '/configuracoes/bancos',
      simple: [
        { text: 'A administradora é quem opera o consórcio. Depois de ligada, os planos dela aparecem no simulador e na venda.' },
        {
          steps: [
            'Em Bancos e financeiras, clique em "Nova conexão".',
            'Escolha a administradora no catálogo ou clique em "Outra instituição".',
            'Confira se o produto "Consórcio" está marcado.',
            'Sem acesso direto a ela, escolha o modo "Manual (sem API)".',
            'Clique em "Adicionar plano" e preencha plano, bem, crédito, prazo, taxa de administração, fundo de reserva e seguro. Use a tabela da administradora.',
            'Clique em "Salvar".',
            'No Simulador, clique em "Atualizar planos das administradoras".',
          ],
        },
        { warn: 'Se uma administradora der erro, a atualização inteira para e nenhum plano muda. Corrija ou desative essa conexão e tente de novo.' },
        { tip: 'Nova tabela da administradora? Altere os planos na conexão, salve e atualize de novo.' },
      ],
      technical: [
        { text: 'Conexão: core.access.settings. Atualizar planos: consortium.manage. O catálogo é material de referência, marcado "A confirmar". Nenhuma administradora publica API aberta: a integração real depende de contrato e credenciais da corretora.' },
        {
          list: [
            'Simulação: seis planos fictícios e adesão aceita com grupo e cota gerados.',
            'Manual (sem API): até 60 planos, com protocolo local e resposta registrada pela equipe.',
            'API com REST genérico: OAuth2 e webhook assinado.',
            'API com adaptador da administradora: esqueleto que falha com "a confirmar com a administradora". Use o modo manual.',
            'Plano que sumiu da oferta sai do simulador e fica "Fora de oferta" em Comissões. Cotas vendidas não mudam.',
            'Parcela = crédito × (1 + taxa de administração + fundo de reserva) ÷ prazo + crédito × seguro mensal.',
            'Custo total = parcela × prazo menos crédito.',
            'Estes valores são estimativas da tabela cadastrada; a administradora pode praticar outros.',
          ],
        },
      ],
    },
    {
      id: 'captacao',
      title: 'Configurar a captação e o simulador público',
      path: '/configuracoes/captacao',
      simple: [
        { text: 'O simulador público é uma página com a marca da empresa. O visitante simula, deixa o contato e vira um lead para a equipe atender.' },
        {
          steps: [
            'Em Captação de clientes, marque "Publicar o simulador com a marca da empresa".',
            'Copie o endereço mostrado e use no site e nas redes.',
            'Informe o e-mail para pedidos do titular.',
            'Se quiser, marque o rodízio e escolha os vendedores.',
            'Ajuste a mensagem pronta do WhatsApp.',
            'Clique em "Salvar".',
          ],
        },
        { tip: 'Em anúncios, acrescente ao endereço os códigos de campanha, por exemplo ?utm_source=instagram&utm_campaign=imovel-out. Assim, o relatório mostra de onde veio cada lead.' },
        { warn: 'Sem plano ativo, o simulador avisa que não há planos para simular. Atualize os planos antes de divulgar.' },
      ],
      technical: [
        { text: 'Permissão: core.access.settings. A página pública fica em /consorcio/<endereço da empresa> e não exige login. Ela não mostra os nomes das administradoras.' },
        {
          list: [
            'A parcela exibida é estimada pelos planos do mesmo tipo e do prazo mais próximo: faixa de menor a maior valor.',
            'O aceite é obrigatório; texto e versão ficam gravados no lead.',
            'Proteções: campo oculto contra robôs, tempo mínimo de 3 segundos, 10 leads por hora por IP, 3 simulações por dia por telefone e 5 envios em 10 minutos.',
            'Mesmo celular com lead aberto nas últimas 24 horas: atualiza o lead em vez de duplicar.',
            'Guarda de lead sem compra: padrão de 24 meses, de 1 a 60. Depois, os dados são anonimizados por rotina diária.',
            'Rodízio: um vendedor por vez, só os ativos na equipe. Sem rodízio, o lead fica sem vendedor.',
            'Variáveis da mensagem: {{nome}}, {{vendedor}}, {{empresa}}, {{tipo}}, {{credito}}, {{prazo}}, {{parcela}}.',
            'O sistema não compra, raspa nem cruza listas de pessoas.',
          ],
        },
      ],
    },
    {
      id: 'receber-leads',
      title: 'Receber e cadastrar leads',
      path: '/consorcio/leads',
      simple: [
        { text: 'Lead é quem pediu contato. Em Leads, cada pessoa aparece em uma coluna do Funil, conforme a etapa do atendimento.' },
        { text: 'Os leads chegam sozinhos pelo simulador e pelos anúncios. Para quem pediu contato no balcão, por telefone ou em um evento:' },
        {
          steps: [
            'Clique em "Novo lead".',
            'Preencha nome e celular ou e-mail.',
            'Informe o que a pessoa procura, se souber.',
            'Em "Por que podemos chamar esta pessoa", escolha o motivo.',
            'Escolha o vendedor ou deixe vazio.',
            'Clique em "Salvar".',
          ],
        },
        { tip: 'Tem uma lista de um evento? Use "Baixar modelo" e "Importar planilha".' },
        { warn: 'Só cadastre quem pediu contato. Não é permitido comprar listas nem procurar quem tem ou já teve carta de consórcio.' },
      ],
      technical: [
        { text: 'Cadastro e importação: consortium.leads.manage. Ver: consortium.leads.read. Quem não gerencia vê só os próprios leads e os sem vendedor; ao abrir um de outro: "Este lead é de outro vendedor".' },
        {
          list: [
            'Etapas: Novo, Em contato, Simulação enviada, Proposta, Venda e Perdido.',
            'Telefone ou e-mail obrigatório. Telefone com DDD.',
            'Lead aberto com o mesmo telefone ou e-mail é recusado: "Já existe o lead nº".',
            'Importação: mesma regra por linha, e Nome é obrigatório. Vendedor pelo nome exato do usuário.',
            'A parcela estimada usa o menor valor dos planos do tipo e do prazo mais próximo.',
            'Leads de anúncio não passam pela checagem de duplicidade por telefone; só pelo identificador da plataforma.',
            'Abas: Funil, Lista e Retornos. Até 500 leads por consulta.',
          ],
        },
      ],
    },
    {
      id: 'atender-lead',
      title: 'Atender um lead',
      path: '/consorcio/leads',
      simple: [
        { text: 'Na ficha do lead fica tudo do atendimento: contato, próximos retornos e histórico.' },
        {
          steps: [
            'No Funil, abra o lead.',
            'Sem vendedor? Clique em "Assumir este lead".',
            'Clique em "WhatsApp". A mensagem pronta abre no aplicativo; revise e envie.',
            'Anote o que foi conversado em Histórico.',
            'Mude a etapa pelos botões.',
            'Em Retornos, defina a data e clique em "Agendar".',
            'Sem interesse? Clique em "Marcar perdido", escolha o motivo e confirme.',
          ],
        },
        { tip: 'Abra a aba Retornos do Funil no começo do dia. Atrasados aparecem em vermelho. Depois de ligar, clique em "Feito".' },
        { warn: 'A etapa "Venda" não tem botão. O lead vira venda sozinho quando a administradora aceita a cota.' },
      ],
      technical: [
        { text: 'Trabalhar: consortium.leads.work, nos próprios ou nos sem vendedor. Distribuir: consortium.leads.manage. Excluir dados: consortium.leads.manage.' },
        {
          list: [
            'WhatsApp abre o link do aplicativo, não envia pela integração. Registra o evento e passa Novo para Em contato.',
            'Retorno agendado não gera notificação; aparece só nas telas. Com lead encerrado, não dá para agendar.',
            'Perdido fecha os retornos abertos e cancela a recompensa aguardando. Clicar em uma etapa aberta reabre o lead, mas a recompensa continua cancelada.',
            'Distribuir para outro vendedor leva os retornos em aberto.',
            '"Excluir dados pessoais (pedido do titular)" apaga nome, telefone, e-mail, cidade e anotações, sem volta. O lead fica nas estatísticas.',
          ],
        },
      ],
    },
    {
      id: 'anuncios',
      title: 'Receber leads de anúncios (Meta e Google)',
      path: '/consorcio/canais',
      simple: [
        { text: 'Quem preenche o formulário do anúncio no Facebook, Instagram ou Google entra direto no funil, com a campanha anotada.' },
        {
          steps: [
            'Em Anúncios (Meta/Google), clique em "Novo canal Meta" ou "Novo canal Google Ads".',
            'Dê um nome e escolha "Simulado" para testar.',
            'Preencha os dados pedidos e clique em "Salvar".',
            'Clique em "Gerar lead de teste" e veja o lead no funil.',
            'Quando estiver pronto, edite o canal e troque para "Produção".',
            'Siga o passo a passo da própria tela para ligar a plataforma.',
          ],
        },
        { warn: 'Este canal só recebe quem preencheu o formulário. Público, verba e segmentação são configurados nas plataformas de anúncio.' },
        { warn: 'A chave do Google não volta para a tela depois de salva. Copie para o Google Ads antes de salvar.' },
      ],
      technical: [
        { text: 'Permissão: consortium.leads.manage. Segredos ficam cifrados e em branco mantêm os atuais. A base de contato gravada é o aceite no formulário.' },
        {
          list: [
            'Meta: um webhook para todas as empresas, configurado pela Palmer. Sem essa configuração, o recebimento fica indisponível. Exige id da página e, em Produção, token de acesso. As permissões da Meta estão como "a confirmar".',
            'A mesma página não pode estar em dois canais: "Esta página do Facebook já está ligada a outro canal".',
            'Ids de formulário são opcionais; vazio aceita todos da página.',
            'Google: um endereço por canal, validado pela chave.',
            'Teste: Meta só em Simulado; em Produção, use a ferramenta da Meta. O Google aceita o botão nos dois modos e o lead vem marcado.',
            'Lead repetido pela plataforma é ignorado pelo identificador. O canal só é desligado por "Ativo"; o tipo não muda.',
          ],
        },
      ],
    },
    {
      id: 'indicacoes',
      title: 'Criar indicações premiadas',
      path: '/consorcio/indicacoes',
      simple: [
        { text: 'Um cliente ou vendedor recebe um link próprio. Quem entra por ele vira lead com a indicação anotada, e a recompensa fica a pagar quando a cota é aceita.' },
        {
          steps: [
            'Em Captação de clientes, escreva a recompensa e o valor padrão.',
            'Em Indicações, escolha quem indica.',
            'Busque o cliente, ou escolha o vendedor e clique em "Criar link".',
            'Clique em "copiar" e envie o link à pessoa.',
            'Depois da venda, abra o lead e clique em "Marcar paga".',
          ],
        },
        { warn: 'A transferência é com a empresa: o sistema não paga ninguém. Quando a cota é aceita, a recompensa aparece no Financeiro como despesa a pagar.' },
      ],
      technical: [
        { text: 'Permissão: consortium.leads.manage. Um link por pessoa: pedir de novo devolve o mesmo. "Desativar" impede novas indicações pelo link e mantém o histórico.' },
        {
          list: [
            'Situações: Aguardando a venda, A pagar, Paga e Cancelada.',
            'Vira A pagar quando a adesão é aceita, com o valor padrão se houver.',
            'Paga antes da venda é recusado: "A recompensa só é paga depois da venda".',
            'Lead perdido: recompensa aguardando vira Cancelada.',
            'A pagar: entra no financeiro como despesa em aberto (uma só por lead), em outras despesas, com a origem "Indicação de consórcio". Sem valor informado, não entra até informarem. Mudar o valor cancela o lançamento anterior e cria outro.',
            '"Marcar paga" dá baixa nesse mesmo lançamento, hoje, na conta padrão. Baixa dada em Financeiro também vale: o lead passa a mostrar Paga.',
            'Paga não volta nem é cancelada pelo lead: "Esta recompensa já foi paga".',
            'Cota cancelada dentro do prazo de estorno: a pagar vira Cancelada e o lançamento é cancelado; a já paga vira Estornada, com um valor a receber de quem indicou no financeiro. Fora do prazo, a recompensa é mantida. Tudo fica no histórico do lead.',
            'Cadastro manual: "Indicado por" cria a mesma ligação e a origem fica Indicação.',
          ],
        },
      ],
    },
    {
      id: 'consulta-credito',
      title: 'Consultar o crédito do cliente',
      path: '/credito/consultas',
      simple: [
        { text: 'A consulta mostra o score e um resumo de pendências, para decidir se vale seguir com a venda. Sempre precisa da autorização do cliente. Disponível para quem contratou o módulo.' },
        {
          steps: [
            'Na ficha do lead, na venda da cota ou em "Nova consulta", preencha o CPF ou CNPJ e o nome.',
            'Mostre ou leia ao cliente o texto de "Autorização do cliente".',
            'Informe a data e como ele autorizou.',
            'Marque a confirmação e clique em "Consultar".',
            'Veja o resultado e clique em "Seguir com a venda" ou "Reprovar".',
          ],
        },
        { warn: 'Nunca consulte sem o cliente concordar antes. Cada consulta fica registrada com o seu usuário e pode ter custo.' },
      ],
      technical: [
        { text: 'Permissões: integration.credit_bureau.query (consultar e decidir) e integration.credit_bureau.read (histórico). Configuração em Configurações, Consulta de crédito (core.access.settings).' },
        {
          list: [
            'Simulação: gera resultado fictício a partir do documento e mostra "Modo simulado". É o único adaptador pronto.',
            'Serasa Experian, Boa Vista (Equifax) e Quod: esqueletos, dependem de contrato. A consulta termina em erro, "a confirmar com o birô".',
            'O texto da autorização é guardado com data, forma, prova e versão. Abrir o detalhe e decidir vão para a auditoria.',
            'Faixas: de 700 baixo risco; de 500 médio; de 300 alto; abaixo, muito alto.',
            'Score mínimo sugerido (padrão 500) só orienta. A decisão é da pessoa e pode ser revista.',
            'Consulta com erro fica no histórico, sem custo e sem contar no mês.',
            'Teto mensal (zero = sem limite): ao atingir, novas consultas são recusadas até o mês seguinte.',
            'Exigência na venda: em Captação de clientes, ligue "Exigir consulta de crédito aprovada". Vale consulta do mesmo documento nos últimos 30 dias, com decisão "Seguir com a venda".',
          ],
        },
      ],
    },
    {
      id: 'vender-cota',
      title: 'Vender uma cota',
      path: '/consorcio',
      simple: [
        { text: 'A venda registra a adesão e a envia à administradora. A cota só fica ativa depois que ela aceitar.' },
        {
          steps: [
            'No Simulador, escolha o bem e digite o crédito desejado.',
            'Compare Parcela e Custo total e clique em "Vender cota". Vindo de um lead, clique em "Vender cota" na ficha dele e depois em "Escolher" no plano.',
            'Busque o cliente.',
            'Se houver consulta de crédito, faça agora.',
            'Em "Proponente e adesão", confira CPF ou CNPJ, Dia de vencimento e Vendedor.',
            'Clique em "Enviar adesão".',
          ],
        },
        { text: 'A cota abre como "Adesão em análise". Se a administradora for manual, envie pelo portal dela. Depois, na ficha da cota, clique em "Registrar resposta", informe Grupo e Cota, se aprovada, e clique em "Registrar".' },
        { warn: 'Digite Grupo e Cota como a administradora informou, com as letras. Zeros à esquerda, espaços e maiúsculas não atrapalham: "12" e "012" são a mesma cota no resultado da assembleia.' },
        { tip: 'Compare planos usando o crédito: o Simulador mostra os de 80% a 125% do valor digitado.' },
      ],
      technical: [
        { text: 'Permissão: consortium.sell; propostas com integration.banking.propose. Vender a partir de lead cria ou reaproveita o cliente pelo telefone ou e-mail (precisa de core.customers.write) e leva o lead a Proposta.' },
        {
          list: [
            'Plano fora de oferta: "Plano não encontrado ou fora de oferta".',
            'Dia de vencimento: de 1 a 28.',
            'Se a administradora recusar o envio, a cota fica "Adesão recusada" e o erro aparece.',
            'Recusada ou cancelada pela administradora: "Adesão não aceita pela administradora". O lead continua em Proposta e pode ter outra venda.',
            'Simulação: aceita na consulta (a cada 10 minutos ou em "Consultar status").',
            'Manual: aprovada exige grupo e cota: "Informe o grupo e a cota que a administradora atribuiu".',
            'Na ativação: grupo e cota gravados, parcelas geradas, grupo cadastrado, comissão lançada, lead em Venda e aviso "Adesão aceita" ao cliente.',
            'O sistema não gera contrato de adesão.',
          ],
        },
      ],
    },
    {
      id: 'parcelas',
      title: 'Acompanhar parcelas e inadimplência',
      path: '/consorcio/inadimplencia',
      simple: [
        { text: 'Quem cobra as parcelas é a administradora. O sistema só acompanha, para a corretora avisar o cliente e não perder a cota de vista.' },
        {
          steps: [
            'Em Inadimplência, veja as cotas com parcelas vencidas.',
            'Filtre pelo atraso, se quiser.',
            'Clique em "Avisar agora" para enviar o aviso ao cliente.',
            'O cliente pagou? Abra a cota, vá em Parcelas e clique em "Marcar paga".',
            'Informe a data e o valor e clique em "Registrar".',
            'Registrou errado? Clique em "desfazer".',
          ],
        },
        { warn: 'Marcar como paga não recebe dinheiro nem entra no financeiro. É só uma anotação do que o cliente ou a administradora informou.' },
        { tip: 'Se o calendário for diferente do da administradora, clique em "Ajustar calendário" antes de registrar pagamentos.' },
      ],
      technical: [
        { text: 'Ver: consortium.read. Registrar e avisar: consortium.track. Ajustar calendário: consortium.manage. Só cotas Ativa e Contemplada têm parcelas.' },
        {
          list: [
            'Geração: na ativação, a partir do próximo dia de vencimento, na quantidade e no valor do plano.',
            'Situações: A vencer, Paga, Em atraso e Cancelada. Em atraso: vencimento anterior a hoje e sem pagamento.',
            'Ajustar calendário: só sem parcela paga, 1º vencimento até o dia 28, de 1 a 420 parcelas: "desfaça os pagamentos antes de refazer".',
            'Pagamento com data futura é recusado.',
            'Aviso automático: rotina de hora em hora, uma vez por parcela, quando o atraso atinge os dias configurados (padrão 5; zero desliga). Usa o modelo "Parcela em atraso".',
            '"Avisar agora" ignora o prazo e pode ser repetido.',
            'O atraso não bloqueia lance nem contemplação. Quem decide se a cota concorre é a administradora, pelas regras de cada grupo; aqui as parcelas são só anotações. Por isso o aviso ao cliente diz que o atraso "pode impedir" e a tela de lance mostra o alerta, em vez de barrar.',
            'Valores não têm correção de assembleia, multa ou juros.',
          ],
        },
      ],
    },
    {
      id: 'assembleias-lances',
      title: 'Agendar assembleias e registrar lances',
      path: '/consorcio/assembleias',
      simple: [
        { text: 'A assembleia precisa estar agendada para receber lances. A corretora agenda, e o consultor registra o lance do cliente.' },
        {
          steps: [
            'Em Assembleias, clique em "Agendar assembleia".',
            'Escolha a Administradora, digite o Grupo e a Data e clique em "Agendar".',
            'Abra a cota do cliente e vá na aba Lances.',
            'Clique em "Registrar lance".',
            'Escolha a Assembleia e o Tipo: Livre, Embutido ou Fixo.',
            'Informe o percentual ou o valor e clique em "Registrar".',
            'Envie o lance à administradora e clique em "marcar enviado".',
          ],
        },
        { warn: 'O sistema não envia o lance à administradora. Faça pelo canal dela: "marcar enviado" é só uma anotação.' },
        { tip: 'No lance embutido, o valor sai do próprio crédito se ele vencer. O cliente recebe menos crédito.' },
      ],
      technical: [
        { text: 'Agendar e remarcar: consortium.manage. Lances: consortium.track. Só cota Ativa dá lance: "Só cotas ativas (não contempladas) dão lance".' },
        {
          list: [
            'A assembleia precisa ser do mesmo grupo e da mesma administradora, e sem resultado. A tela lista só as de hoje em diante.',
            'Uma por administradora, grupo e data: "Já existe assembleia deste grupo nesta data". Data passada: lance o resultado direto.',
            'Sem escolher a administradora, vale a única que tem o grupo. Código em mais de uma: "existe em mais de uma administradora: escolha qual".',
            'Um lance por cota e assembleia: "Já há lance desta cota para esta assembleia".',
            'Percentual sobre o crédito do plano; informado o valor, calcula o outro. Acima do crédito: "O lance não pode passar do valor do crédito".',
            'Remarcar leva os lances junto. Excluir só sem lances.',
            'Com resultado lançado, o lance não muda nem é excluído: "A assembleia deste lance já tem resultado". A correção do resultado refaz a situação dos lances.',
            'O sistema não valida lance mínimo, máximo ou regras de grupo.',
          ],
        },
      ],
    },
    {
      id: 'resultado-assembleia',
      title: 'Lançar o resultado da assembleia',
      path: '/consorcio/assembleias',
      simple: [
        { text: 'Depois da assembleia, digite o resultado informado pela administradora. O sistema acha as cotas da sua carteira, marca como contempladas e avisa os clientes.' },
        {
          steps: [
            'Em Próximas assembleias, clique em "Lançar resultado". Se não estava agendada, use o botão do topo e escolha a Administradora.',
            'Em "Cotas sorteadas", digite os números separados por vírgula: 012, 145.',
            'Em "Lances vencedores", digite cota:percentual, por exemplo 045:32,5, 210:28.',
            'Confira com a lista da administradora.',
            'Clique em "Lançar".',
          ],
        },
        { warn: 'Confira antes de lançar: o cliente é avisado na hora. Lance sem percentual é recusado, com o aviso de qual cota ficou incompleta.' },
        { text: 'Lançou errado? Em Resultados lançados, clique em "Corrigir resultado", ajuste as listas, escreva o motivo e salve. Para tirar só uma cota, clique em "desfazer" ao lado dela, ou em "Desfazer contemplação" na ficha da cota.' },
        { warn: 'O aviso de contemplação já enviado não volta. Deixe marcado "Avisar os clientes" para o cliente receber a correção. Se o crédito já foi liberado, confirme com a administradora e volte o crédito para "Aguardando documentação" antes de corrigir.' },
        { tip: 'A tela Grupos mostra o lance vencedor médio de cada grupo, útil para orientar o cliente.' },
      ],
      technical: [
        { text: 'Permissão: consortium.manage. A contemplação vale para cota Ativa da mesma administradora, com o mesmo grupo e o mesmo número de cota. Grupo e cota são comparados sem espaços, sem diferenciar maiúsculas e sem zeros à esquerda: "12" encontra "012". O que foi digitado fica como está. Cotas de outras corretoras são só registradas.' },
        {
          list: [
            'Efeitos: cota Contemplada com data e forma, linha do tempo do cliente e aviso "Cota contemplada".',
            'Lances: Vencedor (por lance), Sem efeito (contemplada por sorteio), Perdedor (demais).',
            'Abre o acompanhamento do crédito. Lance embutido vencedor é descontado.',
            'Lançar de novo a mesma assembleia: "Esta assembleia já foi lançada".',
            'Correção: a lista nova vale inteira no lugar da anterior. Quem sai volta a Ativa, com a contemplação e o crédito em aberto retirados, entrada na linha do tempo e o aviso "Correção de contemplação" (opcional). Quem entra é contemplado e avisado normalmente. Os lances são refeitos.',
            'Crédito Liberado ou Adquirido bloqueia a correção da cota: "já foi liberado". O crédito não é desfeito sozinho, porque a liberação aconteceu na administradora.',
            'Motivo obrigatório. Antes, depois e efeito em cada cota ficam em "Correções", na própria assembleia, e na auditoria. Esse histórico não é alterado nem apagado.',
            'Desfazer uma cota tira o número dela do resultado lançado e passa pelo mesmo caminho da correção.',
            'A correção não muda grupo nem data. Lançou no grupo ou no dia errado? Corrija deixando as listas vazias, com o motivo, e lance de novo no lugar certo.',
            'Comissão e parcelas não mudam: a contemplação não mexe nelas.',
          ],
        },
        { text: 'Assembleia antiga sem administradora identificada: a correção pede para escolher. Grupos: criados na ativação da cota; "Cadastrar grupo" ou "editar" completam plano, participantes e meses restantes (consortium.manage). Os meses restantes diminuem com o tempo. O lance médio considera os resultados lançados.' },
      ],
    },
    {
      id: 'credito-contemplada',
      title: 'Acompanhar o crédito da cota contemplada',
      path: '/consorcio/cotas',
      simple: [
        { text: 'Depois da contemplação, acompanhe o que falta para o cliente usar o crédito, até a compra do bem.' },
        {
          steps: [
            'Em Cotas, abra a cota contemplada.',
            'Clique na aba Crédito.',
            'Atualize a Situação: Aguardando documentação, Crédito liberado ou Bem adquirido.',
            'Preencha a data de liberação e, se comprou, o bem e a data.',
            'Clique em "Salvar".',
          ],
        },
        { warn: 'Esta tela é um acompanhamento. Ela não libera crédito nem envia documentos à administradora.' },
      ],
      technical: [
        { text: 'Ver: consortium.read. Salvar: consortium.track. Só cota Contemplada: "Só cotas contempladas têm crédito a acompanhar". O valor inicial é o do plano, menos o lance embutido vencedor.' },
        {
          list: [
            'Crédito liberado exige data: "Informe quando o crédito foi liberado".',
            'Bem adquirido exige descrição: "Descreva o bem adquirido".',
            'Liberado e adquirido entram na linha do tempo do cliente.',
            'Não gera lançamento no financeiro nem aviso ao cliente.',
            'O sistema não faz correção do crédito nem controla documentos.',
          ],
        },
      ],
    },
    {
      id: 'comissoes-cancelamento',
      title: 'Definir comissões e cancelar uma cota',
      path: '/consorcio/comissoes',
      simple: [
        { text: 'Comissão é o que a administradora paga à corretora quando a cota é ativada. Se a cota for cancelada logo depois, a comissão pode ser estornada.' },
        {
          steps: [
            'Em Comissões, defina a "Comissão padrão (%)" e o prazo de estorno.',
            'Para uma administradora diferente, preencha "Comissão da administradora" e clique em "Salvar".',
            'Para um plano específico, preencha o "Percentual do plano" e clique em "Salvar".',
            'Quando receber, dê baixa em Financeiro, Lançamentos.',
          ],
        },
        { text: 'Para cancelar: abra a cota, clique em "Cancelar cota", escreva o motivo e confirme.' },
        { warn: 'Cota contemplada não pode ser cancelada pela tela. Alterar percentuais não muda cotas já ativas.' },
      ],
      technical: [
        { text: 'Permissão: consortium.manage. Configurações do topo exigem também core.access.settings. Vale o percentual do plano; sem ele, o da administradora; sem os dois, o padrão (2%). O percentual é congelado na ativação. Campo vazio significa herdar.' },
        {
          list: [
            'Comissão = crédito × percentual. Lançada como receita em aberto na ativação, vencimento no dia, categoria de serviços. Comissão paga pela administradora em várias parcelas não é tratada.',
            'Cancelamento: só Adesão em análise ou Ativa; motivo de ao menos 3 caracteres.',
            'Estorno: cancelada dentro do prazo (padrão 6 meses, zero = nunca). A comissão em aberto é cancelada; a já recebida vira despesa em aberto "Estorno de comissão".',
            'Fora do prazo: comissão mantida.',
            'A comissão é da corretora: a parte do vendedor não é calculada.',
            'Lead ligado: em Venda, passa a Perdido com o motivo do cancelamento e pode ser reaberto para outra venda; em Proposta, continua lá. A recompensa da indicação segue o mesmo prazo de estorno da comissão.',
            'Trocar vendedor: "trocar" na lista de cotas, enquanto não recusada ou cancelada.',
          ],
        },
      ],
    },
    {
      id: 'conversao',
      title: 'Medir a conversão dos leads',
      path: '/consorcio/conversao',
      simple: [
        { text: 'Este relatório mostra de onde vêm as vendas: qual origem, vendedor e campanha trazem resultado, e por que os leads são perdidos.' },
        {
          steps: [
            'Em Conversão, escolha o período.',
            'Veja o total de leads, atendidos, propostas e vendas.',
            'Compare Por origem, Por vendedor e Por campanha.',
            'Leia os Motivos de perda.',
          ],
        },
        { tip: 'Em Cotas, "Vendas do mês por vendedor" mostra as adesões de cada pessoa no mês.' },
      ],
      technical: [
        { text: 'Permissão: consortium.leads.manage. Considera leads criados no período, pela situação atual de cada um; uma venda de hoje conta no mês em que o lead entrou.' },
        {
          list: [
            'Atendidos: saíram de Novo.',
            'Propostas: em Proposta ou Venda, ou com cota ligada.',
            'Vendas: em Venda. Conversão = vendas ÷ total de leads.',
            'Crédito vendido: soma do crédito das cotas dos leads em Venda.',
            'Campanha: a informada ou o utm_campaign do endereço.',
            'O relatório não inclui custo de anúncio e não calcula retorno sobre investimento. Vendas sem lead não entram.',
          ],
        },
      ],
    },
  ],
};
