# Melhorias encontradas

Levantadas em 30/10/2026, ao escrever o manual de cada ramo. Vêm da leitura do código e, salvo indicação, ainda não foram testadas nas telas nem corrigidas. Quando corrigir uma, ajuste o manual do ramo (`src/web/manual.ts`), que cita várias delas.

## Podem gerar dado errado

- **Consórcio, lances vencedores** (confirmado no código): a dica da tela sugere `045:32,5`, mas a vírgula separa os itens. Vira cota 045 com 32% e cota 5 com 0%, e uma cota "5" pode ser contemplada por engano. Até corrigir, use ponto (`045:32.5`).
- **Consórcio:** o resultado da assembleia não pode ser corrigido e a cota contemplada por engano não volta pela tela. O grupo é comparado sem considerar a administradora, e "12" não encontra "012".
- **Consórcio:** cancelar a cota não atualiza o lead nem a recompensa da indicação, e a recompensa nunca entra no financeiro.
- **Veículos:** quem edita o veículo sem `vehicles.costs.read` vê o Custo vazio e apaga o valor ao salvar. Os papéis padrão não têm essa combinação.
- **Veículos e imóveis:** a Situação é editável à mão. Tirar de Reservado permite segunda negociação, e Vendido à mão não lança nada no financeiro.
- **RH:** Situação = Desligado na edição não gera termo, esconde Rescindir e tira a pessoa do 13º. Folha aberta não recebe mudanças de salário ou admissões posteriores, e não há como excluí-la.
- **RH:** tabelas de INSS e IRRF sem tela, e o padrão ainda é INSS 2025 e IRRF maio/2025.
- **Comissões do salão:** o percentual não fica gravado no atendimento, então mudá-lo hoje recalcula os meses passados.
- **Ortodontia:** a taxa de instalação não se liga ao serviço "Instalação de aparelho", com risco de cobrança dupla.
- **Estética:** o clareamento não informa quantidade, então o lote entra no rastreio com 0 e não baixa estoque. Retificar uma ficha não corrige o uso do lote.

## Atrapalham o dia a dia

- **Financeiro:** a tela de lançamentos não mostra nem filtra por cliente, e parcelas ficam com o mesmo nome para todos. O formulário não tem campo Cliente, o que também afeta os Segmentos. Não há como desfazer a baixa nem editar, e o rodapé soma os cancelados quando não há filtro.
- **Convites:** não há reenvio, e sem o Resend a pessoa fica em "Convite pendente" sem nenhum erro na tela.
- **Agenda:** "Outro horário" permite marcar em cima de folga. "Cancelar horário" aparece em atendimento, e o servidor recusa. O pagamento sai sempre com a data de hoje e não entra no caixa.
- **Agendamento online:** mostra só 14 dias, e serviços novos já vêm liberados. Na advocacia, um visitante pode marcar uma Audiência se o link for ligado sem desmarcar.
- **Lavanderia:** ordem aberta não pode ser editada na tela, e cancelar a ordem não cancela a entrega agendada. O motorista vê o saldo, mas só registra a taxa.
- **Padaria:** a escrita do bolo não aparece na Produção do dia, e a encomenda não baixa estoque. A data de retirada não pode ser editada.
- **Veterinária:** nomes diferentes (V10 e V10 polivalente) contam como outra vacina, e importar a planilha de novo duplica as vacinas.
- **Advocacia:** prazo e andamento não podem ser editados nem excluídos. "Cancelar" o honorário age sem pedir confirmação.
- **Imobiliária:** contrato de locação e proposta de compra não têm edição. A foto do imóvel não tem botão de remover.
- **Contabilidade:** não há tela para criar obrigação, e mudar o regime não remove as que estão em aberto.
- **Consultoria de RH:** honorário errado não pode ser cancelado por nenhuma tela. A contratação pelo Head hunter abre a admissão como "Própria empresa", mesmo em vaga de empresa atendida.
- **Auditoria:** sem filtro nem busca, e com ações em código.
- **Dados da empresa:** o endereço não tem a busca por CEP.

## Permissões que faltam nos papéis padrão

O dono vê tudo; os demais podem não conseguir fazer a tarefa do próprio cargo.

- **Recepção da estética:** `core.finance.write` (dar baixa); abre "Marcar cirurgia", mas a lista de cirurgiões vem vazia.
- **Advocacia:** `legal.fees.manage` e `shared.scheduling.payments`.
- **Salão:** `beauty.commissions.*`, e não existe visão só da própria comissão.
- **Lavanderia:** catálogo e relatórios.
- **Padaria:** cancelar venda e histórico de caixas.
- **Pet shop:** configurar agenda, produtos, estoque e ver vendas.
- **Veterinária:** vendas e auditoria do prontuário.
- **Consultoria de RH:** `core.finance.read`, para ver os honorários lançados.

## Configurações sem tela

Só existem pela API: dias do lembrete de vacina, bloquear estoque negativo, conta bancária do PDV, rodapé do cupom e falta que consome sessão de pacote. Na lavanderia, `requirePhotosOnReceive` e `pricingMode` não têm efeito nenhum.
