# Melhorias encontradas

Levantadas em 30/10/2026, ao escrever o manual de cada ramo. Vêm da leitura do código e, salvo indicação, ainda não foram testadas nas telas nem corrigidas. Quando corrigir uma, ajuste o manual do ramo (`src/web/manual.ts`), que cita várias delas.

## Podem gerar dado errado

- **Consórcio:** o resultado da assembleia não pode ser corrigido e a cota contemplada por engano não volta pela tela. O grupo é comparado sem considerar a administradora, e "12" não encontra "012".
- **Consórcio:** cancelar a cota não atualiza o lead nem a recompensa da indicação, e a recompensa nunca entra no financeiro.
- **Veículos:** quem edita o veículo sem `vehicles.costs.read` vê o Custo vazio e apaga o valor ao salvar. Os papéis padrão não têm essa combinação.
- **Veículos e imóveis:** a Situação é editável à mão. Tirar de Reservado permite segunda negociação, e Vendido à mão não lança nada no financeiro.
- **RH:** Situação = Desligado na edição não gera termo, esconde Rescindir e tira a pessoa do 13º. Folha aberta não recebe mudanças de salário ou admissões posteriores, e não há como excluí-la.
- **Comissões do salão:** o percentual não fica gravado no atendimento, então mudá-lo hoje recalcula os meses passados.
- **Ortodontia:** a taxa de instalação não se liga ao serviço "Instalação de aparelho", com risco de cobrança dupla.
- **Estética:** o clareamento não informa quantidade, então o lote entra no rastreio com 0 e não baixa estoque. Retificar uma ficha não corrige o uso do lote.

## Atrapalham o dia a dia

- **Financeiro:** Não há como desfazer a baixa nem editar, e o rodapé soma os cancelados quando não há filtro.
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

## Configurações sem tela

Só existem pela API: dias do lembrete de vacina, bloquear estoque negativo, conta bancária do PDV, rodapé do cupom e falta que consome sessão de pacote. Na lavanderia, `requirePhotosOnReceive` e `pricingMode` não têm efeito nenhum.
