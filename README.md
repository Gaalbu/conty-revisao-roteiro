# Revisão de roteiro

Antes do vídeo, a campanha trava no roteiro. A marca diz o que muda e até quando, o criador manda outra versão, e o histórico fica preso à versão que recebeu o pedido.

Estados, sem pular: `awaiting_review` → `changes_requested` → `awaiting_review` → `approved`. Aprovado não reabre.

Comece a leitura por [`src/review.ts`](src/review.ts). A rota em `src/app.ts` só lê o JSON, chama a função e devolve o status.

**Entrada:** corpo precisa ser `application/json` (senão 415), JSON válido e objeto (senão 400) e ter até 64 KB (senão 413). Campo fora do contrato da rota → 400 com o nome do campo. Erro inesperado vira `500 {"error":"erro interno"}`, sem stack na resposta.

## Como rodar

Node 22.13 ou maior (primeira versão com `node:sqlite` sem flag).

```bash
npm install
npm test
npm run typecheck
npm run dev
```

A API sobe em `http://127.0.0.1:43121`, com SQLite em memória.

## Requests

`at` é o relógio do request. O prazo nunca usa o relógio do servidor.

| Método | Regra | Fora da regra |
| --- | --- | --- |
| `POST /scripts` `{body, at}` | versão 1, `awaiting_review`, timezone `America/Sao_Paulo` | body vazio → 400 |
| `POST /scripts/:id/change-requests` `{reason, deadline_date, at}` | só em `awaiting_review`; vale se o dia civil de `at` em São Paulo ≤ prazo | sem motivo → 400 `motivo é obrigatório`; sem prazo → 400 `prazo é obrigatório`; dia inexistente (`2026-02-30`, `2026-99-99`) → 400; dia civil maior → 409 `prazo encerrado`; aprovado ou pedido já aberto → 409 |
| `POST /scripts/:id/versions` `{body, at}` | só em `changes_requested`; número incrementa, versões antigas ficam | aprovado → 409; sem pedido aberto → 409 |
| `POST /scripts/:id/approval` `{at}` | só em `awaiting_review`; grava a versão atual | aprovado → 409 `roteiro aprovado não reabre`; pedido aberto sem versão nova → 409 |
| `GET /scripts/:id` | versões em ordem, pedidos presos à versão, aprovação ou `null` | 404 |

### Exemplo: o fluxo inteiro

O teste `cada resposta do fluxo diz o estado e o que cada lado pode fazer` executa estes quatro requests. Toda resposta traz o roteiro completo, com `status` e `allowed_actions`, então ninguém precisa adivinhar o próximo passo.

```bash
API=http://127.0.0.1:43121
curl -s -X POST $API/scripts -H 'content-type: application/json' \
  -d '{"body":"Abre com o produto na mão.","at":"2026-03-10T12:00:00.000Z"}'
# guarde o "id" em ID
curl -s -X POST $API/scripts/$ID/change-requests -H 'content-type: application/json' \
  -d '{"reason":"Mostrar o preço","deadline_date":"2026-03-12","at":"2026-03-11T15:00:00.000Z"}'
curl -s -X POST $API/scripts/$ID/versions -H 'content-type: application/json' \
  -d '{"body":"Abre com o preço na tela.","at":"2026-03-12T10:00:00.000Z"}'
curl -s -X POST $API/scripts/$ID/approval -H 'content-type: application/json' \
  -d '{"at":"2026-03-12T18:00:00.000Z"}'
```

| Passo | `status` | `allowed_actions` |
| --- | --- | --- |
| criar | `awaiting_review` | marca: `request_changes`, `approve` |
| pedir alteração | `changes_requested` | criador: `submit_version` |
| nova versão | `awaiting_review` | marca: `request_changes`, `approve` |
| aprovar | `approved` | nenhuma: aprovado não reabre |

A versão 1 continua no histórico com o pedido preso a ela.

### Exemplo: o limite do prazo

O teste `aceita o pedido no último milissegundo do dia do prazo em São Paulo (02:59:59.999Z)` executa estes requests.

```bash
curl -s -X POST http://127.0.0.1:43121/scripts \
  -H 'content-type: application/json' \
  -d '{"body":"Abre com o produto na mão.","at":"2026-03-10T12:00:00.000Z"}'
# guarde o "id" da resposta em ID

curl -s -X POST "http://127.0.0.1:43121/scripts/$ID/change-requests" \
  -H 'content-type: application/json' \
  -d '{"reason":"Trocar a trilha","deadline_date":"2026-03-12","at":"2026-03-13T02:59:59.999Z"}'
```

`2026-03-13T02:59:59.999Z` é 23:59:59.999 do dia 12 em São Paulo. Resposta `201` (ids variam):

```json
{
  "id": "scr_ebfd0b20-8f6e-41f0-a7f9-260fd26206d8",
  "status": "changes_requested",
  "timezone": "America/Sao_Paulo",
  "versions": [
    {
      "id": "ver_c81312cd-a4a4-4f41-8f3c-f3edb787a160",
      "number": 1,
      "body": "Abre com o produto na mão.",
      "created_at": "2026-03-10T12:00:00.000Z",
      "change_requests": [
        {
          "id": "chg_4b38da1f-ed6a-432f-9ea9-98e31853846a",
          "reason": "Trocar a trilha",
          "deadline_date": "2026-03-12",
          "requested_at": "2026-03-13T02:59:59.999Z",
          "answered_by_version_id": null
        }
      ]
    }
  ],
  "approval": null
}
```

Com `"at":"2026-03-13T03:00:00.000Z"` (meia-noite do dia 13 em São Paulo) a resposta é `409 {"error":"prazo encerrado"}`.

## Critérios do enunciado → testes

| Critério ou entrega | Teste |
| --- | --- |
| Seguir o fluxo inteiro sem adivinhar o estado | `percorre o fluxo inteiro…`, `cada resposta do fluxo diz o estado e o que cada lado pode fazer` |
| Pedido sem motivo ou sem prazo não passa | `recusa pedido com motivo em branco e com prazo vazio` |
| Prazo no fuso da marca não vira o dia errado | `aceita o pedido no último milissegundo do dia do prazo…(02:59:59.999Z)`, `recusa o pedido à meia-noite seguinte…(03:00:00.000Z)` |
| Aprovado não aceita nova versão nem novo pedido | `roteiro aprovado recusa versão, pedido de mudança e segunda aprovação` |
| Versão antiga não se perde | `percorre o fluxo inteiro e termina aprovado com as duas versões` |
| Prazo é data real | testes de calendário (`2026-02-30`, `2026-99-99`, 29 de fevereiro) |
| Falha no meio não deixa estado pela metade | `falha na versão inicial não deixa roteiro órfão…`, `falha no status de %s desfaz toda a transição…` |
| Concorrência | `aprovação e pedido de alteração na mesma versão, em threads diferentes: só um vence` |

## Decisões que eu deixaria diferentes com mais tempo

- **Papéis explícitos.** Hoje a API confia em quem chama; `allowed_actions` diz o que marca e criador podem fazer, mas não verifica quem é quem. Com autenticação, cada rota checaria o papel.
- **Prazo para o criador responder.** O prazo do pedido vale para a marca pedir a alteração; com mais tempo, a versão nova enviada depois do prazo também ficaria marcada.
- **Prazo herdado da campanha** e **vários revisores**, que deixei de fora.
- **Fuso fixo em São Paulo.** O roteiro grava o fuso, mas ele não é configurável por marca.

## Ficou de fora

Vários revisores e prazo herdado da campanha.

## Nota da entrega

Comece por `src/review.ts`: as quatro transições e a regra do prazo estão ali, a rota só repassa. O prazo é dia civil em America/Sao_Paulo, calculado com `Intl` sobre o `at` do request, e não os dez primeiros caracteres do ISO. Por isso `2026-03-13T02:59:59.999Z` ainda vale para o prazo `2026-03-12` e `03:00:00.000Z` já é 409 `prazo encerrado`; os dois instantes têm teste. Cada pedido de mudança fica preso à versão que o recebeu e guarda qual versão o respondeu. Aprovado não reabre: versão, pedido e segunda aprovação dão 409.

Cada transição (criar, pedir mudança, nova versão, aprovar) grava numa transação `BEGIN IMMEDIATE`: falha no meio desfaz tudo e o retry funciona. O prazo é validado contra o calendário real, aceitando 29 de fevereiro só em ano bissexto.

Testes: `npm test` com 25 passando, `npm run typecheck` sem erro. O exemplo deste README é o request do teste do último milissegundo.

Ficou de fora: vários revisores e prazo herdado da campanha.

IA: código, testes e README escritos com assistente de código (Claude Code), a partir de um plano com as regras do desafio. As correções de calendário e atomicidade vieram de programação em pares: o Codex auditou a entrega, reproduziu os defeitos e escreveu as primeiras correções; o Claude Code integrou, validou e publicou.
