# Melhorias encontradas

Levantadas em 30/10/2026, ao escrever o manual de cada ramo. A lista original foi resolvida no mesmo dia; as decisões estão em `docs/arquitetura/decisoes.md` (ADR-037 a 040). Fica aqui o que ainda não foi feito.

## Agenda

- Cancelar atendimento já pago não devolve o valor nem tira do caixa: não há estorno de pagamento na agenda.
- A repetição de horários não tem "marcar mesmo assim": a data que não couber fica de fora.
- Em Alterar, o processo ligado ao horário não muda: é preciso cancelar e marcar de novo.

## RH

- Desfazer rescisão não traz de volta sozinho as férias canceladas nem o profissional na agenda: a tela avisa.
- `POST /hr/employees` pela API ainda aceita colaborador já desligado (a carga de demonstração usa isso). Ele aparece como "Desligado sem termo".

## Veículos

- Carro vendido que volta na troca com a mesma placa continua recusado: a placa é única, e reaproveitar o registro reescreveria o histórico.

## Formulários em janela

Ainda abrem em janela, em vez de na própria página: Convidar e Editar usuário, Rescindir, Marcar férias, Afastamento, Lançamentos da folha, abertura de negociação de veículo, agendar e lançar assembleia.
