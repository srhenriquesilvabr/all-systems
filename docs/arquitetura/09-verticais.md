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
| `shared.sales` | Produtos, estoque com movimentos, PDV (balança, troco, fiado), cancelamento com estorno | Padaria, pet shop |
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
| Imobiliária | `real_estate` | Imóveis com fotos e preço por m², visitas na agenda, proposta com entrada e FGTS (até 80% financiado), comissão |
| Consórcio | `consortium` | Simulador de planos das administradoras, adesão pela integração, grupo/cota, assembleias e contemplação com aviso |
| Contabilidade | `accounting` | Carteira por regime, calendário de obrigações gerado todo dia, alertas, honorários mensais |
| RH e DP | `hr` | Colaboradores, folha com INSS/IRRF/FGTS, holerite, férias por período aquisitivo, fechamento no financeiro |

## O que não faz (de propósito, por enquanto)

- **Fiscal:** sem NFC-e/NFS-e (ADR-P3, ADR-P6). O cupom do PDV diz "não é documento fiscal".
- **Folha:** calcula e registra; não transmite eSocial, DCTFWeb nem FGTS Digital (ADR-P7). Tabelas de INSS/IRRF são configuráveis e precisam ser conferidas a cada mudança de lei.
- **Contabilidade:** o calendário é um ponto de partida editável; prazos estaduais e municipais variam.
- **Crédito real:** depende de contrato com cada instituição (ADR-P8).
