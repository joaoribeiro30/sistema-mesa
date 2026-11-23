# Contratos da API do Sistema Mesa

## Convenções

- IDs e `Idempotency-Key` são UUIDs. Use datas ISO 8601 com fuso, por exemplo `2027-03-10T21:00:00-03:00`. As respostas retornam datas em UTC.
- Valores em `priceMinor`, `basePriceMinor` e `amountMinor` são inteiros em unidades menores da moeda. `9900` em BRL representa R$ 99,00.
- Rotas protegidas aceitam `Authorization: Bearer <accessToken>` ou o cookie de sessão Google. Escritas autenticadas por cookie exigem `Origin` igual a `APP_ORIGIN`. Rotas `/admin/*` exigem `ADMIN`, e rotas de reservas exigem `CUSTOMER`.
- Envie JSON com `Content-Type: application/json`. Uploads de imagem usam o binário como corpo. Respostas `204` têm corpo vazio.
- A paginação por `limit` e `offset` usa padrões 20 e 0, com limites de 100 e 10000. Erros retornam `{ "code": "...", "message": "..." }`. Requisições limitadas recebem `429` e `Retry-After`.

## Catálogo público

| Rota | Resposta |
| --- | --- |
| `GET /events` | `200` com `{ "events": [eventSummary] }`. Aceita paginação e filtros. |
| `GET /events/:slug` | `200` com `{ "event": eventDetail }`, incluindo setores, mesas e planta. Aceita os mesmos filtros sem paginação. |
| `GET /events/:eventId/images/:kind` | `200` com os bytes e o tipo MIME da imagem que foi enviada para o evento. |
| `GET /events/:eventId/stream` | `200` com `text/event-stream`. Use UUID neste endpoint. |

O catálogo e o SSE mostram eventos publicados com início no futuro. Eventos fora desse recorte retornam `404` por slug e no SSE. Imagens de upload disponíveis no catálogo usam URLs relativas à origem da API. O administrador autenticado também pode carregar uploads de eventos fora do catálogo.

| Query | Semântica |
| --- | --- |
| `startsFrom`, `startsTo` | Intervalo inclusivo para a data de início. |
| `city`, `venue`, `category` | Correspondência por nome sem distinção de maiúsculas. |
| `minPriceMinor`, `maxPriceMinor` | Faixa inclusiva de preço das mesas, na moeda de cada evento. |
| `availability` | `AVAILABLE`, `RESERVED` ou `SOLD`. |

Na lista, um filtro de mesa exige ao menos uma mesa habilitada que satisfaça todos os critérios. No detalhe, filtros de mesa mantêm apenas as mesas correspondentes e omitem setores sem resultados. Reservas pendentes vencidas já liberam a mesa no catálogo. Mesas vendidas sempre têm `available: false`.

```json
{
  "event": {
    "id": "31a296b5-d833-4ccb-a2cd-6f320dd5f35b",
    "slug": "noite-na-serra",
    "title": "Noite na Serra",
    "description": "Música e cultura",
    "venue": "Armazém Serra",
    "city": "Nova Serra",
    "category": "Música",
    "currency": "BRL",
    "startsAt": "2027-03-11T00:00:00.000Z",
    "endsAt": "2027-03-11T03:00:00.000Z",
    "displayMode": "BOTH",
    "coverImageUrl": "https://example.com/capa.webp",
    "bannerImageUrl": null,
    "floorPlanImageUrl": null,
    "sectors": [{
      "id": "b81228f5-fa25-4d36-9ada-c3381bc119f0",
      "name": "Pista",
      "description": null,
      "basePriceMinor": 9900,
      "tables": [{
        "id": "5a4a0bc9-7990-47ea-b61c-4ed2b9d5e68b",
        "label": "P1",
        "capacity": 4,
        "priceMinor": 9900,
        "x": 42.5,
        "y": 26,
        "status": "AVAILABLE",
        "available": true,
        "expiresAt": null
      }]
    }]
  }
}
```

O resumo da lista contém os campos do evento acima, exceto `description`, `floorPlanImageUrl` e `sectors`. Em dados legados, `city` e `category` podem ser `null`, e o preço base do setor pode ser zero.

### Mensagens SSE

A conexão começa com `snapshot` e o estado das mesas habilitadas. Use os eventos nomeados para atualizar a mesa pelo `tableId`. O cursor no campo `id` é um inteiro decimal representado como texto na interface do navegador. O `EventSource` envia automaticamente `Last-Event-ID` ao reconectar. Um cursor válido com até 500 mudanças pendentes recebe replay. Uma conexão sem cursor ou com cursor fora dessa janela recebe novo `snapshot`. [Padrão de Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html)

```text
id: 0
event: snapshot
data: {"eventId":"31a296b5-d833-4ccb-a2cd-6f320dd5f35b","tables":[{"tableId":"5a4a0bc9-7990-47ea-b61c-4ed2b9d5e68b","status":"AVAILABLE","available":true,"expiresAt":null}]}

id: 1
event: table.locked
data: {"eventId":"31a296b5-d833-4ccb-a2cd-6f320dd5f35b","tableId":"5a4a0bc9-7990-47ea-b61c-4ed2b9d5e68b","status":"RESERVED","available":false,"expiresAt":"2027-03-10T23:20:00.000Z"}
```

`table.released` representa cancelamento ou expiração, com `status: "AVAILABLE"`, `expiresAt: null` e `available` verdadeiro quando a mesa está habilitada. `table.sold` representa uma reserva confirmada, com `status: "SOLD"`, `available: false` e `expiresAt: null`. Para atualizar preços, imagens ou posições depois de uma edição administrativa, recarregue o detalhe do catálogo. O servidor encerra o stream ao fechar o evento ou chegar à hora de início.

## Administração

### Eventos e imagens

| Método e rota | Entrada | Resposta |
| --- | --- | --- |
| `GET /admin/overview` | — | `200` com `{ "events": 4, "reservations": 12 }`. |
| `GET /admin/events` | Query opcional `status`, `limit`, `offset` | `200` com `{ "events": [event] }`, em ordem decrescente de início. |
| `POST /admin/events` | Evento conforme o exemplo abaixo | `201` com `{ "event": event }`. |
| `GET /admin/events/:eventId` | — | `200` com `{ "event": event }`, incluindo `sectors[].tables`. |
| `PATCH /admin/events/:eventId` | Um ou mais campos do cadastro | `200` com `{ "event": event }`. |
| `DELETE /admin/events/:eventId` | — | `204` quando não há histórico de reservas. Remove também a estrutura e os uploads do evento. |
| `POST /admin/events/:eventId/images/:kind` | Binário PNG, JPEG ou WebP, até 5 MiB (5.242.880 bytes) | `201` com `{ "image": { "kind": "COVER", "url": "/events/<eventId>/images/cover", "mediaType": "image/png" } }`. Acima do limite, retorna `413 IMAGE_TOO_LARGE`. |

O cadastro exige `slug`, `title`, `startsAt`, `endsAt`, `venue`, `city` e `category`. Os outros campos são opcionais. O padrão é `status: "DRAFT"`, `displayMode: "BOTH"` e `currency: "BRL"`. As respostas administrativas incluem `id`, `status`, `createdAt` e `updatedAt`.

```json
{
  "slug": "noite-na-serra",
  "title": "Noite na Serra",
  "description": "Música e cultura",
  "startsAt": "2027-03-10T21:00:00-03:00",
  "endsAt": "2027-03-11T00:00:00-03:00",
  "venue": "Armazém Serra",
  "city": "Nova Serra",
  "category": "Música",
  "currency": "BRL",
  "status": "PUBLISHED",
  "displayMode": "BOTH",
  "coverImageUrl": "https://example.com/capa.webp",
  "bannerImageUrl": null,
  "floorPlanImageUrl": null
}
```

Use `DRAFT`, `PUBLISHED` ou `CLOSED` em `status` e `MAP`, `LIST` ou `BOTH` em `displayMode`. Fechar um evento impede novos bloqueios. Reservas existentes conservam seus prazos e podem concluir o pagamento. O histórico de reservas também impede alteração da moeda.

O upload aceita `kind` igual a `cover`, `banner` ou `floor-plan`. A API armazena os bytes no PostgreSQL e atualiza o campo correspondente do evento na mesma transação. Para usar uma imagem externa, envie uma URL HTTPS no cadastro, no `PATCH` ou, no caso da planta, no `PUT /layout`. Enviar `null` remove a imagem. Use a URL relativa retornada pelo upload para exibir o arquivo a partir da origem da API.

### Setores, mesas e planta

Nas rotas abaixo, `E` é `/admin/events/:eventId` e `S` é `E/sectors/:sectorId`.

| Método e rota | Entrada | Resposta |
| --- | --- | --- |
| `GET E/sectors` | — | `200` com `{ "sectors": [sector] }`. |
| `POST E/sectors` | `{ "name": "Pista", "description": "Frente do palco", "basePriceMinor": 9900 }` | `201` com `{ "sector": sector }`. |
| `GET S` | — | `200` com `{ "sector": sector }`, incluindo `tables`. |
| `PATCH S` | Um ou mais campos do cadastro do setor | `200` com `{ "sector": sector }`. |
| `DELETE S` | — | `204` quando as mesas do setor não têm histórico de reservas. |
| `POST S/tables` | `{ "label": "P1", "capacity": 4, "priceMinor": 9900, "isEnabled": true }` | `201` com `{ "table": table }`. |
| `POST S/tables/batch` | `{ "prefix": "P", "startNumber": 2, "count": 10, "capacity": 4 }` | `201` com `{ "tables": [table] }`, na ordem da numeração. |
| `GET S/tables/:tableId` | — | `200` com `{ "table": table }`. |
| `PATCH S/tables/:tableId` | Qualquer campo de criação, ou `sectorId` de destino no mesmo evento | `200` com `{ "table": table }`. |
| `DELETE S/tables/:tableId` | — | `204` quando a mesa não tem histórico de reservas. |
| `PUT E/layout` | Alterações de posição e imagem, conforme o exemplo abaixo | `200` com `{ "layout": { "eventId": "...", "floorPlanImageUrl": "...", "tables": [...] } }`. |

`sector` contém `id`, `eventId`, `name`, `description` (opcional e nula quando ausente) e `basePriceMinor`. `table` contém `id`, `eventId`, `sectorId`, `label`, `capacity`, `priceMinor`, `isEnabled`, `x` e `y`. Na criação, `priceMinor` pode ser omitido para herdar o preço base positivo do setor, e `isEnabled` é verdadeiro por padrão. Alterar o preço base não modifica mesas existentes. O lote aceita até 250 mesas com prefixo opcional e é gravado por inteiro ou rejeitado por inteiro.

```json
{
  "floorPlanImageUrl": "https://example.com/planta.webp",
  "tables": [{ "tableId": "5a4a0bc9-7990-47ea-b61c-4ed2b9d5e68b", "x": 42.5, "y": 26 }]
}
```

`x` e `y` são percentuais de 0 a 100 em relação ao canto superior esquerdo. Use ambos como `null` para limpar a posição. Envie até 250 mesas do mesmo evento, sem IDs repetidos. Mudanças de imagem e posições são gravadas juntas. Omitir a imagem preserva o valor atual, e `tables: []` permite atualizar apenas a imagem.

Conflitos de slug, nome de setor ou número de mesa retornam `409 ADMIN_RESOURCE_CONFLICT`. Alterações impedidas por histórico retornam `409 RESERVATION_HISTORY_EXISTS`. Recursos fora do escopo do evento ou setor retornam `404`.

### Dashboard e portaria

`GET /admin/events/:eventId/dashboard?limit=20&offset=0` retorna um retrato consistente do estoque e do faturamento. `reserved` conta bloqueios ativos em `PENDING_PAYMENT`. `sold` conta mesas com reserva confirmada. `disabled` conta mesas desabilitadas sem bloqueio ou venda. A soma de pagamentos `SUCCEEDED` de reservas confirmadas vem como string decimal para preservar a precisão. A lista inclui o histórico paginado e identifica cada comprador. Reconsulte o dashboard ao receber mudanças SSE e após um check-in para atualizar os dados da portaria.

`dashboard.settlement.totals` soma as vendas confirmadas do evento inteiro. `byOperation` discrimina as vendas classificadas pelo meio de pagamento. Os totais monetários são strings decimais na unidade mínima de `currency` (centavos para `BRL`) e `paymentCount` é inteiro. Em cada reserva paginada, `settlement` identifica o pagamento confirmado e mostra os valores inteiros na mesma unidade e as taxas em pontos-base (`100` pontos-base correspondem a `1%`). O campo é `null` quando a reserva ainda não tem uma venda classificada elegível.

| `operation` | Operação | Taxa de processamento sobre o bruto |
| --- | --- | --- |
| `PIX` | Pix | 1,20% |
| `DEBIT` | Débito | 1,20% |
| `CREDIT` | Crédito sem antecipação | 2,99% |
| `ANTICIPATED_CREDIT` | Crédito com antecipação | 4,99% |

O serviço da plataforma corresponde a 15% do bruto. O cálculo arredonda os 15% e os 5% da instituição financeira para o centavo mais próximo, com meio centavo arredondado para cima. `convenienceFeeMinor` recebe a diferença para os 15%, atribuindo à comodidade o ajuste de centavos quando necessário. `processingFeeMinor` é calculado separadamente sobre o bruto com o mesmo arredondamento. `netMinor` é o bruto menos as três taxas. O checkout registra os valores e percentuais por pagamento, antes de solicitar a cobrança ao provedor.

Pagamentos confirmados antigos sem meio registrado compõem `totals.grossMinor`, `totals.paymentCount`, `unclassifiedGrossMinor` e `unclassifiedPaymentCount`. As taxas e o líquido dos totais se referem às vendas classificadas. A migração classifica Pix e crédito já identificados, usando a tarifa de crédito sem antecipação para os cartões históricos.

`schedule.weeklyDates` contém as terças-feiras e os sábados a partir da data de criação do evento, inclusive, até a véspera do fechamento final. `schedule.finalDate` é o segundo dia útil após a data de `endsAt`, pulando sábados e domingos. Se o fechamento cair em uma terça-feira, essa data aparece como fechamento final. As datas são civis no fuso `America/Sao_Paulo`, no formato `AAAA-MM-DD`.

```json
{
  "dashboard": {
    "eventId": "31a296b5-d833-4ccb-a2cd-6f320dd5f35b",
    "asOf": "2027-03-10T23:30:00.000Z",
    "currency": "BRL",
    "totals": { "available": 8, "reserved": 0, "sold": 1, "disabled": 0, "checkedIn": 0, "confirmedRevenueMinor": "9900" },
    "settlement": {
      "totals": {
        "grossMinor": "9900", "financialFeeMinor": "495", "convenienceFeeMinor": "990",
        "processingFeeMinor": "119", "netMinor": "8296", "paymentCount": 1
      },
      "byOperation": [{
        "operation": "PIX", "grossMinor": "9900", "financialFeeMinor": "495", "convenienceFeeMinor": "990",
        "processingFeeMinor": "119", "netMinor": "8296", "paymentCount": 1
      }],
      "unclassifiedGrossMinor": "0",
      "unclassifiedPaymentCount": 0,
      "schedule": {
        "timeZone": "America/Sao_Paulo", "weeklyDates": ["2027-03-09", "2027-03-13"], "finalDate": "2027-03-15"
      }
    },
    "pagination": { "limit": 20, "offset": 0, "total": 1 },
    "reservations": [{
      "id": "2498f052-4af1-4803-be22-14548849b179",
      "status": "CONFIRMED",
      "guestCount": 4,
      "amountMinor": 9900,
      "createdAt": "2027-03-10T23:05:00.000Z",
      "expiresAt": "2027-03-10T23:15:00.000Z",
      "confirmedAt": "2027-03-10T23:06:00.000Z",
      "checkedInAt": null,
      "settlement": {
        "paymentId": "ce670fdd-7806-495a-8d75-f0d890bfab5b", "operation": "PIX", "grossMinor": 9900,
        "financialFeeBps": 500, "convenienceFeeBps": 1000, "processingFeeBps": 120,
        "financialFeeMinor": 495, "convenienceFeeMinor": 990, "processingFeeMinor": 119, "netMinor": 8296
      },
      "table": { "id": "5a4a0bc9-7990-47ea-b61c-4ed2b9d5e68b", "label": "P1" },
      "buyer": { "id": "dbc234d9-3330-40cb-b310-326f129a5e43", "name": "Ana", "email": "ana@example.com" }
    }]
  }
}
```

`POST /admin/check-in` recebe o conteúdo decodificado do QR Code no campo `token`. Envie também `eventId` quando a portaria estiver operando para um evento específico.

```json
{ "token": "mesa-ticket-v1.<nonce>.<payload>.<tag>", "eventId": "31a296b5-d833-4ccb-a2cd-6f320dd5f35b" }
```

```json
{
  "checkIn": {
    "reservationId": "2498f052-4af1-4803-be22-14548849b179",
    "eventId": "31a296b5-d833-4ccb-a2cd-6f320dd5f35b",
    "tableId": "5a4a0bc9-7990-47ea-b61c-4ed2b9d5e68b",
    "guestCount": 4,
    "checkedInAt": "2027-03-10T23:45:00.000Z"
  }
}
```

O sucesso retorna `200`. Um ingresso inválido retorna `400 INVALID_TICKET`. Ingresso de outro evento, reserva sem confirmação e ingresso usado retornam `409` com `TICKET_EVENT_MISMATCH`, `RESERVATION_NOT_CONFIRMED` ou `TICKET_ALREADY_USED`, respectivamente.

## Autenticação, compra e comprovante

| Método e rota | Entrada | Resposta |
| --- | --- | --- |
| `POST /auth/register` | `{ "name": "Ana", "email": "ana@example.com", "password": "Uma frase longa e segura" }` | `201` com `{ "user": user }`, com o e-mail pendente de verificação. |
| `POST /auth/login` | `{ "email": "ana@example.com", "password": "Uma frase longa e segura" }` | `200` com `{ "accessToken": "...", "tokenType": "Bearer", "expiresIn": 900, "user": user }`. |
| `GET /auth/me` | — | `200` com `{ "user": user }`. |
| `POST /auth/email/resend`, `POST /auth/password/forgot` | `{ "email": "ana@example.com" }` | `202` com `{ "accepted": true }`. |
| `POST /auth/email/verify` | `{ "token": "..." }` | `204`. |
| `POST /auth/password/reset` | `{ "token": "...", "password": "Uma nova frase longa" }` | `204`, com revogação das sessões antigas. |
| `GET /auth/google` | — | Redireciona ao Google. O callback em `/auth/google/callback` cria o cookie e redireciona para `/auth/callback` na origem configurada em `FRONTEND_ORIGIN`, ou para `/auth/me` na API quando a variável está ausente. |
| `POST /auth/google/link` | Sessão com e-mail verificado | `200` com `{ "authorizationUrl": "..." }`. |
| `POST /reservations` | `Idempotency-Key` e `{ "eventId": "...", "tableId": "...", "guestCount": 4 }` | `201` com `{ "reservation": reservation }`, ou `200` ao repetir a mesma chave e os mesmos dados. |
| `GET /reservations/me` | Query opcional `limit`, `offset` | `200` com `{ "reservations": [...] }`. |
| `DELETE /reservations/:id` | — | `204` para cancelar um bloqueio do titular. |
| `POST /reservations/:id/checkout` | `Idempotency-Key` e dados de pagamento | `201` com `{ "payment": payment }`, ou `200` em replay aceito. O Pix pendente traz `payment.pix.copyPasteCode` e `payment.pix.qrCode`. |
| `GET /reservations/:id/payments/:paymentId` | — | `200` com `{ "payment": payment }` para o titular. |
| `POST /reservations/:id/payments/:paymentId/simulate` | Titular da cobrança mock. Disponível em produção com `PAYMENT_PROVIDER=mock`. | `204` após confirmação simulada. Use quando checkout ou status informarem `payment.canSimulate`. |
| `GET /reservations/:id/receipt` | — | `200` com `{ "receipt": receipt }` após a confirmação. `receipt.ticket.token` é o texto do QR e `receipt.ticket.qrCode` é sua Data URL PNG. |
| `POST /webhooks/payment` | Notificação assinada pelo gateway | `200` com `{ "received": true, "duplicate": false }` para um evento aceito pela primeira vez. |

`user` contém `id`, `email`, `name`, `role` e `emailVerifiedAt`. Quando habilitado, o CAPTCHA é enviado como `captchaToken` nos fluxos descritos no [README](../README.md#segurança-da-api). Somente clientes com e-mail verificado podem reservar.

O checkout Pix recebe `{ "method": "PIX" }`. O Mercado Pago também requer `identification: { "type": "CPF", "number": "..." }` ou CNPJ conforme o documento. Cartão exige `method: "CREDIT_CARD"` ou `method: "DEBIT_CARD"`, `cardToken`, `paymentMethodId` e `installments`. No débito, `installments` deve ser `1`. `issuerId` e `identification` acompanham a solicitação quando necessários. O servidor usa o preço gravado na reserva e o webhook é chamado pelo gateway.

Configure `PAYMENT_CREDIT_ADVANCE=true` quando a operação do estabelecimento tiver antecipação de crédito contratada. A opção classifica novas cobranças de crédito como `ANTICIPATED_CREDIT` para fins de prestação de contas. A antecipação financeira é contratada no provedor. O padrão é `false`, que usa `CREDIT` tanto para crédito à vista quanto para o parcelamento já aceito pelo checkout. A classificação gravada permanece vinculada à cobrança em tentativas idempotentes.

O bloqueio dura 10 minutos. Nas rotas do titular, `reservation` inclui `id`, `tableId`, `eventId`, `guestCount`, `capacity`, `amountMinor`, `currency`, `status` e `expiresAt`. Em `GET /reservations/me`, cada item também traz `event` (`slug`, `title`, `venue`, `city`, `startsAt`) e `table` (`label`, `sector.name`). A consulta de pagamento inclui `id`, `method`, `status`, `amountMinor`, `currency` e `paidAt`. Os estados da reserva são `PENDING_PAYMENT`, `CONFIRMED`, `EXPIRED` e `CANCELLED`.

`receipt` contém `reservationId`, `guestCount`, `confirmedAt`, `checkedInAt` (nulo até a entrada na portaria), `event` (`id`, `title`, `venue`, `city`, `startsAt`), `table` (`label`, `sector.name`), `payment` (`id`, `amountMinor`, `currency`, `method`, `paidAt`) e `ticket` (`token`, `qrCode`).
