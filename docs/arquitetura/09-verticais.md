# 09 — Verticais e módulos compartilhados

Estado em 22/10/2026. Cada vertical é um pacote em `modules/verticals/*` que depende do core e de módulos compartilhados. Nenhuma vertical importa outra (checado no CI por `scripts/check-boundaries.mjs`).

## Módulos compartilhados

| Módulo | O que faz | Usado por |
|---|---|---|
| `shared.notifications` | Templates por canal (e-mail, WhatsApp), fila e reenvio | Todos |
| `shared.service-orders` | Ordens com fluxo de status por vertical, pagamentos, "a receber" | Lavanderia, padaria (encomendas) |
| `shared.scheduling` | Agenda por profissional, horários, bloqueios, lembretes, agendamento online, confirmação pelo WhatsApp | Salão, pet shop, veterinária, estética, ortodontia, advocacia, imobiliária |
| `shared.pets` | Pets ligados ao tutor, abas extras na ficha do pet | Pet shop, veterinária |
| `shared.medical-records` | Prontuário **só de inclusão** (o banco recusa UPDATE/DELETE), retificação, anexos protegidos, log de acesso | Veterinária, estética, ortodontia |
| `shared.sales` | Produtos, estoque com movimentos, PDV (balança, troco, fiado), cancelamento com estorno, sessão de caixa (abertura, sangria/suprimento, fechamento com quebra/sobra — ADR-024) | Padaria, pet shop |
| `integration.banking` | Simulação, proposta e acompanhamento em bancos e administradoras ([10](10-integracao-bancaria.md)) | Veículos, imobiliária, consórcio |

## Pontos de extensão (sem import entre verticais)

| Ponto | Quem registra | Para quê |
|---|---|---|
| `ServiceOrderWorkflows.register` | Lavanderia, padaria | Fluxo de status e avisos da ordem |
| `SchedulingService.registerPricer` | Estética (pacotes), ortodontia (manutenção coberta) | Preço do serviço ao marcar |
| `registerSubjectPicker` (web) | Pets, advocacia, imobiliária | "Para quem/o quê" é o horário (pet, processo, imóvel) |
| `MedicalRecordsService.registerForm/registerSubject` | Veterinária, estética, ortodontia | Formulários do prontuário; prontuário do pet |
| `registerPetTab` (web) | Veterinária | Abas Prontuário e Vacinas na ficha do pet |
| Evento `shared.scheduling.status_changed` | Pet shop, estética | "Pet pronto", consumo de sessão do pacote |
| Evento `integration.banking.proposal_updated` | Veículos, imobiliária, consórcio | Crédito aprovado/recusado, adesão aceita |
| `MenuItem.replaces` | Padaria | "Encomendas" no lugar de "Ordens de serviço" |

## Verticais

| Vertical | Módulo | Destaques |
|---|---|---|
| Lavanderia | `laundry` | Balcão, etiquetas, produção, retirada ([07](07-vertical-lavanderia.md)) |
| Salão de beleza | `beauty` | Agenda por profissional, agendamento online, WhatsApp, comissões |
| Pet shop | `petshop` | Banho e tosa (quadro do dia), aviso de pet pronto, PDV de produtos |
| Veterinária | `vet` | Prontuário do pet (consulta, exame, procedimento), carteira de vacinação com lembrete de reforço |
| Clínica de estética | `aesthetics` | Anamnese e evolução, pacotes de sessões em parcelas, sessão do pacote sai a R$ 0 e é consumida ao concluir |
| Clínica ortodôntica | `orthodontics` | Avaliação e manutenções no prontuário, tratamento que lança as mensalidades, prorrogação e cancelamento |
| Padaria | `bakery` | PDV com balança, estoque, encomendas com aviso de pronta, produção do dia |
| Escritório de advocacia | `legal` | Processos com número CNJ validado, andamentos, prazos com alerta por e-mail, honorários (fixo, mensal, êxito), audiências na agenda |
| Revenda de veículos | `vehicles` | Estoque com fotos e FIPE (BrasilAPI), negociação com troca, financiamento nos bancos parceiros, venda que lança entrada e repasse |
| Imobiliária | `real_estate` | Imóveis com fotos e preço por m², visitas na agenda, proposta com entrada e FGTS (até 80% financiado), comissão. Locação: contrato com garantia (caução até 3 aluguéis, fiador, seguro-fiança, título), aluguel a receber e repasse ao proprietário (aluguel − taxa de administração + condomínio/IPTU) sempre 12 meses à frente no financeiro, reajuste anual (IGP-M/IPCA informado, fixo aplicado sozinho) que recalcula só o que está em aberto, rescisão com proporcional e multa, lembrete de vencimento, extrato do proprietário |
| Consórcio | `consortium` | Simulador de planos das administradoras, adesão pela integração, grupo/cota, parcelas e inadimplência (só acompanhamento), lances, calendário de assembleias, contemplação com aviso, uso do crédito, comissão por administradora/plano com estorno |
| Contabilidade | `accounting` | Carteira por regime, calendário de obrigações gerado todo dia, alertas, honorários mensais |
| RH e DP | `hr` | Colaboradores (empregado ou aprendiz), folha mensal com INSS/IRRF/FGTS e DSR, 13º (1ª e 2ª parcelas), rescisão com termo para imprimir, afastamentos, férias por período aquisitivo, fechamento no financeiro |

## Consórcio: acompanhamento das cotas

A corretora vende cotas das administradoras e acompanha a carteira; quem cobra as parcelas e libera o crédito é a administradora.

- **Parcelas** (`cons_installments`): geradas quando a adesão é aceita, pelo plano (crédito + taxa de administração + fundo de reserva + seguro, dividido pelo prazo), no dia de vencimento da cota a partir do próximo vencimento. O calendário pode ser refeito (primeiro vencimento, quantidade, valor) enquanto não houver parcela paga — também serve para cotas ativadas antes do acompanhamento existir. "Marcar paga" registra o pagamento informado pelo cliente ou pela administradora e **não** gera lançamento no financeiro (não é receita da corretora). Situação calculada: a vencer, paga, em atraso, cancelada (cota cancelada).
- **Inadimplência:** cotas ativas ou contempladas com parcelas vencidas sem pagamento. O job `consortium.late-notices` (de hora em hora) envia o template `consortium.installment_late` quando a parcela passa de `lateNoticeDays` dias (padrão 5; 0 desliga), uma vez por parcela e um aviso por cota; há também o aviso manual.
- **Assembleias:** podem ser agendadas (status `scheduled`, sem resultado) para o calendário e para receber lances; o resultado preenche a mesma linha (`held`), pelo id ou pelo fluxo de grupo + data. Grupo + data continua único.
- **Lances** (`cons_bids`): por cota ativa e assembleia agendada do grupo dela — livre, embutido ou fixo, por percentual ou valor. Registrado → enviado à administradora; o resultado marca vencedor (contemplada por lance), sem efeito (contemplada por sorteio) ou perdedor.
- **Crédito** (`cons_credits`): aberto na contemplação (o lance embutido sai do valor): aguardando documentação → crédito liberado (data, valor) → bem adquirido (descrição).
- **Grupos** (`cons_groups`): administradora + código, cadastrados na ativação; participantes e meses restantes informados pela administradora; lance vencedor médio, mínimo e máximo calculados dos resultados lançados.
- **Comissão:** percentual do plano, senão o da administradora (`cons_administrators`), senão o padrão; gravado na cota na ativação. Lançada como "a receber" (`consortium_quota`, baixa no financeiro). Cota ativa cancelada em até `reversalMonths` meses da ativação (padrão 6; 0 desliga): a comissão pendente é cancelada; a já recebida vira despesa pendente `consortium_commission_reversal` (baixa no financeiro).

## RH e DP: folha, 13º e rescisão

Uma folha por competência e tipo (`hr_payrolls.type`): **mensal**, **13º 1ª parcela** (competência 11), **13º 2ª parcela** (competência 12) e **rescisões** (competência da saída). Cada folha guarda a cópia das tabelas; campos novos das tabelas têm valor padrão, então folhas antigas continuam válidas.

- **Mensal:** salário pelos dias de contrato (mês de 30 dias), horas extras pela jornada, comissões, **DSR** sobre horas extras e comissões (variáveis ÷ dias úteis × domingos e feriados; os feriados em dia útil são informados na folha), **faltas** com perda do DSR da semana (informada), **afastamento por doença** (15 primeiros dias pela empresa, do 16º em diante saem da folha), **licença-maternidade** (salário-maternidade pago e mostrado como compensável na DCTFWeb) e **férias** gozadas no mês (saem do salário; entram na base de INSS/FGTS do mês e são abatidas porque já foram pagas no recibo; o recibo pago no mês aparece no holerite). **Aprendiz:** FGTS de 2%. "Recalcular" aplica afastamentos e férias registrados depois de abrir a folha.
- **13º:** avos = meses com 15+ dias trabalhados (INSS não conta). 1ª parcela = metade de (salário + média das variáveis) ÷ 12 × avos (projetados até dezembro), sem INSS/IRRF, FGTS sobre o valor. 2ª parcela = 13º integral com INSS e IRRF em separado, menos a 1ª; FGTS sobre a diferença. Média: folhas mensais fechadas do ano (até outubro na 1ª, novembro na 2ª). Avos e média podem ser ajustados por colaborador. Lançamentos: 1ª — líquido 30/11, FGTS 20/12; 2ª — líquido e INSS 20/12, IRRF e FGTS 20/01.
- **Rescisão** (`hr_terminations`, uma por colaborador): sem justa causa, pedido de demissão, justa causa, término da experiência e acordo (art. 484-A). Prévia antes de confirmar. Verbas: saldo de salário, aviso prévio (30 + 3 por ano, até 90; indenizado projeta a saída; no acordo, metade; no pedido de demissão não cumprido, desconto de 30 dias), indenização do art. 479 (experiência rompida antes do termo), 13º proporcional (menos a 1ª parcela paga), férias vencidas (em dobro se passou o prazo) e proporcionais + 1/3, INSS e IRRF do saldo e do 13º em separado (aviso indenizado, férias indenizadas e indenizações isentos), FGTS rescisório e multa de 40% (20% no acordo) sobre saldo + depósito. O saldo do FGTS vem do extrato; vazio, é estimado pela soma das folhas registradas (sem juros nem depósitos de antes do sistema) e o termo avisa. Ao confirmar: colaborador desligado, férias futuras canceladas, sai das folhas abertas e o financeiro recebe líquido e guia do FGTS (10 dias, art. 477 §6º) e INSS + IRRF (dia 20 do mês seguinte), com baixa no financeiro.
- **Simplificações conhecidas:** média das variáveis em reais (não horas × salário atual); faltas não reduzem avos de 13º nem dias de férias (arts. 130 e 133); atestados da mesma doença em 60 dias não somam; INSS do saldo da rescisão calculado sozinho; recibo de férias não retém INSS/IRRF (o INSS das férias entra na folha do mês de gozo); diferença de médias de dezembro no 13º fica para ajuste manual; contribuições patronais (20%, RAT, terceiros) fora do cálculo; sem extinção antecipada específica do aprendiz (art. 433).

## O que não faz (de propósito, por enquanto)

- **Fiscal:** sem NFC-e/NFS-e (ADR-P3, ADR-P6). O cupom do PDV diz "não é documento fiscal".
- **Folha:** calcula e registra; não transmite eSocial, DCTFWeb nem FGTS Digital (ADR-P7). Tabelas de INSS/IRRF são configuráveis e precisam ser conferidas a cada mudança de lei.
- **Contabilidade:** o calendário é um ponto de partida editável; prazos estaduais e municipais variam.
- **Crédito real:** depende de contrato com cada instituição (ADR-P8).
