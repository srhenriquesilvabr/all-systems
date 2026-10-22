# 07 — Vertical Lavanderia (`laundry`)

Primeira vertical a ser construída. Ela valida o sistema de módulos, o `shared.service-orders`, o financeiro e, opcionalmente, a integração com a loja Shopify do tenant.

## Pacotes

| Pacote | Módulos |
|---|---|
| **Lavanderia Essencial** | core + `shared.service-orders` + `shared.notifications` + `laundry` |
| **Lavanderia Profissional** | Essencial + `integration.payments` (Pix) + `integration.whatsapp` + até 3 unidades |
| Add-ons | `integration.shopify` (loja online e delivery), `integration.nfse`, `shared.subscriptions` (planos mensais, fase 2), unidade extra |

## O que vem do shared e o que é da vertical

**`shared.service-orders`** (genérico, reaproveitado depois pelo cartório):
- OS com número sequencial por tenant, cliente, unidade, canal, status, prazo, valor e situação de pagamento
- Máquina de estados **configurável pela vertical**, com histórico (`so_status_history`)
- Anexos (S3), observações internas e para o cliente
- Faturamento da OS → evento para `core.finance`

**`laundry`** (específico):
- Catálogo de serviços com modo de cobrança (peça, kg, m²)
- Itens da OS **por peça**: tipo, cor, marca, avarias, fotos, etiqueta
- Status por peça e quadro de produção (kanban)
- Coleta e entrega (delivery)
- Relatórios operacionais da lavanderia

> **Ajuste da Fase 2:** os itens da OS ficam no `shared.service-orders` (`so_items`, genérico, com
> `ref_type/ref_id` apontando para o serviço da lavanderia). Os dados por peça (cor, marca, avaria,
> fotos, etiqueta, status da peça) entram na Fase 3 como extensão 1:1 do item (`laundry_item_details`)
> em vez de uma tabela de itens paralela. Assim totais, pagamentos e financeiro ficam num só lugar.
> A lavanderia registra o próprio fluxo de status via `ServiceOrderWorkflows.register(...)`.

## Modelo de dados

```mermaid
erDiagram
    CUSTOMERS ||--o{ SO_ORDERS : solicita
    SO_ORDERS ||--o{ SO_STATUS_HISTORY : registra
    SO_ORDERS ||--o{ LAUNDRY_ORDER_ITEMS : contem
    LAUNDRY_SERVICES ||--o{ LAUNDRY_ORDER_ITEMS : ""
    LAUNDRY_GARMENT_TYPES ||--o{ LAUNDRY_ORDER_ITEMS : ""
    LAUNDRY_ORDER_ITEMS ||--o{ FILES : fotos
    SO_ORDERS ||--o| LAUNDRY_LOGISTICS : coleta_entrega
    LAUNDRY_SERVICES ||--o{ LAUNDRY_SERVICE_PRICES : precifica
```

| Tabela | Campos principais |
|---|---|
| `so_orders` (shared) | tenant_id, number, customer_id, unit_id, channel (`counter`, `online`, `pos`, `whatsapp`), status, received_at, due_at, delivered_at, subtotal, discount, total, paid_amount, payment_status (`pending`, `partial`, `paid`), external_order_id?, notes_internal, notes_customer |
| `so_status_history` (shared) | order_id, from, to, user_id, at, reason |
| `laundry_services` | tenant_id, name (ex.: "Lavar e passar"), pricing_unit (`piece`, `kg`, `sqm`), turnaround_hours, active, shopify_product_id? |
| `laundry_service_prices` | service_id, garment_type_id? (null = preço por kg/m²), price |
| `laundry_garment_types` | tenant_id, name (camisa, calça, edredom, tapete…), seed padrão no `onEnable` |
| `laundry_order_items` | order_id, service_id, garment_type_id, quantity, weight_kg?, area_sqm?, color, brand, damage_notes, tag_code (QR/etiqueta), item_status, unit_price, total |
| `laundry_logistics` | order_id, pickup_address, pickup_window_start/end, delivery_address, delivery_window_start/end, driver_user_id?, pickup_status, delivery_status, fee |

## Estados

```mermaid
stateDiagram-v2
    [*] --> aguardando_coleta: pedido online com coleta
    [*] --> recebido: balcão
    aguardando_coleta --> recebido: coletado e conferido
    recebido --> em_processo: entrou na produção
    em_processo --> pronto: todas as peças prontas
    pronto --> saiu_para_entrega: delivery
    pronto --> aguardando_retirada: retirada no balcão
    saiu_para_entrega --> entregue
    aguardando_retirada --> entregue
    recebido --> cancelado
    aguardando_coleta --> cancelado
    entregue --> [*]
```

O **status por peça** (`laundry_order_items.item_status`) segue: `recebida → lavagem → secagem → passadoria → pronta`, com desvios `retrabalho` e `avaria`. A OS passa para `pronto` automaticamente quando **todas** as peças estão `pronta`.

| Transição | Notificação ao cliente (WhatsApp/e-mail) |
|---|---|
| → `recebido` | "Recebemos suas N peças. Previsão: dd/mm hh:mm" + link de acompanhamento |
| peça → `avaria` | "Identificamos uma avaria na peça X", com foto. Exige confirmação |
| → `pronto` | "Seu pedido está pronto" + valor em aberto e link de pagamento |
| → `saiu_para_entrega` | "Saiu para entrega" + janela |
| prazo estourado | Alerta **interno** ao gerente antes de estourar |

## Fluxos

### 1. Balcão (sem Shopify)
1. O atendente busca ou cadastra o cliente (dedup por telefone).
2. Cria a OS e adiciona as peças: tipo, serviço, cor, observações e **fotos das avarias pré-existentes**. As fotos são obrigatórias se `requirePhotosOnReceive` estiver ligado.
3. O sistema calcula o total e o prazo (maior `turnaround_hours` entre os serviços).
4. Imprime o **comprovante** (com QR do acompanhamento) e as **etiquetas** das peças (`tag_code`).
5. Pagamento na entrada ou na retirada: dinheiro, maquininha (registro manual) ou **Pix** (`integration.payments`, com baixa automática por webhook do gateway).
6. A produção move as peças no kanban → a OS fica `pronto` → notificação → retirada com conferência do código.

### 2. Online com coleta (`integration.shopify` ativo)

```mermaid
sequenceDiagram
    actor C as Cliente final
    participant L as Loja do tenant (Shopify)
    participant W as Worker
    participant ADM as Admin (lavanderia)
    C->>L: escolhe "Cesto até 5 kg - Lavar e passar"
    C->>L: bloco "Agendar coleta" (theme app ext.) → atributos do carrinho
    C->>L: checkout + pagamento (Pix/cartão)
    L->>W: orders/paid
    W->>ADM: cliente (upsert) + OS status aguardando_coleta + itens estimados + lançamento financeiro
    W->>L: metacampo do pedido: nº OS e status
    ADM->>ADM: motorista coleta → conferência: peso real e peças
    alt valor real > pago
        ADM->>L: draft order com invoice (ou cobrança Pix)
        L-->>C: link para pagar a diferença
    else valor real < pago
        ADM->>ADM: crédito para o próximo pedido ou reembolso parcial
    end
    ADM->>L: atualiza metacampo de status a cada transição
    C->>L: conta do cliente → "Minhas ordens" (customer account ext.)
```

### 3. Balcão com Shopify POS (opcional)
A venda é feita no POS da Shopify e o `orders/paid` com `source_name = pos` gera a OS com `channel = pos`. A POS UI extension mostra as OS em aberto do cliente.

## Integração Shopify — específico da lavanderia

| Onde | Metacampo (`$app:allsystems`) | Tipo | Uso |
|---|---|---|---|
| Produto | `laundry_service_key` | single_line_text | Liga o produto ao `laundry_services` |
| Produto | `pricing_unit` | single_line_text (`piece`/`kg`/`sqm`) | Vitrine mostra "por peça" ou "por kg" |
| Produto | `turnaround_hours` | number_integer | Vitrine mostra o prazo |
| Pedido | `service_order_number` | single_line_text | Exibido na conta do cliente |
| Pedido | `service_order_status` | single_line_text | Status para a conta do cliente e a página de status do pedido |
| Cliente | `segment` | single_line_text | Segmento RFM (ver [04](04-core.md#clusterização-de-clientes)) |
| Metaobjeto | `laundry_price_table` | — | Tabela de preços por tipo de peça exibida na loja |

Não vão para a Shopify: fotos das peças, observações de avaria, endereço do motorista ou dados de produção.

## Permissões e papéis padrão

| Permissão | Dono | Atendente | Operador | Motorista |
|---|:-:|:-:|:-:|:-:|
| `laundry.orders.read` | ✓ | ✓ | ✓ | ✓ (só as atribuídas) |
| `laundry.orders.write` | ✓ | ✓ | | |
| `laundry.orders.status` | ✓ | ✓ | ✓ | |
| `laundry.logistics.manage` | ✓ | ✓ | | ✓ |
| `laundry.catalog.manage` | ✓ | | | |
| `laundry.reports.read` | ✓ | | | |

## Relatórios da vertical
- Peças processadas por dia, etapa e operador (produtividade)
- **% de OS entregues no prazo** e tempo médio por etapa (gargalos)
- Peças com avaria e retrabalho (qualidade)
- Receita por serviço, canal e unidade (vem do core.finance, filtrado por `source_type = service_order` ou `shopify_order`)
- Coletas e entregas por janela e motorista

## Features para a clusterização
- `laundry.avg_days_between_orders`: intervalo médio entre OS
- `laundry.avg_pieces_per_order` e `laundry.avg_kg_per_order`
- `laundry.delivery_ratio`: % de pedidos com coleta/entrega
- `laundry.top_service`: serviço mais usado

## MVP (o que entra primeiro)
**Entra:** catálogo de serviços, OS de balcão com peças, fotos e etiquetas, kanban de produção, notificações por e-mail, pagamento manual e Pix, relatórios de prazo e receita.
**Depois:** Shopify (online e coleta), WhatsApp, motorista/rotas, planos mensais, NFS-e automática.
