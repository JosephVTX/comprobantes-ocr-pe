# comprobantes-ocr

API (Hono + TypeScript) que lee comprobantes de pago peruanos (Yape, Plin, bancos) con un LLM de visión vía OpenRouter.
Primero `google/gemma-4-26b-a4b-it:free`; si da error o se agota el límite, el mismo modelo de pago con el proveedor más barato (`provider.sort: price`).

## Uso

```bash
curl -X POST http://localhost:3000/api/analizar \
  -H "x-api-key: TU_CLAVE" --data-binary @comprobante.jpg
# o multipart: -F file=@comprobante.jpg
```

Respuesta (si no es comprobante: `{"is_receipt":false}`):

```json
{"is_receipt":true,"method":"Yape","amount":14,"currency":"PEN","operation":"27034291","security_code":"291","date":"2026-10-05","time":"18:37","receiver":"Erick San*","_meta":{"ms":2568,"model":"google/gemma-4-26b-a4b-it"}}
```

`GET /` es un cliente web; `GET /health` es público.
Códigos: 400 vacío, 401 clave, 413 tamaño, 415 formato, 500 fallaron ambos modelos, 503 cola llena (`Retry-After`).

## Variables de entorno

Ver `.env.example`. `API_KEYS` y `OPENROUTER_API_KEY` son obligatorias.
`MAX_CONCURRENT` limita llamadas simultáneas al LLM; `MAX_QUEUE` cuántas esperan antes de responder 503.

## Desarrollo

```bash
pnpm install && cp .env.example .env
pnpm dev
pnpm test
```

## Docker / Dokploy

Aplicación desde GitHub, build type **Dockerfile**, puerto 3000. Define `API_KEYS` y `OPENROUTER_API_KEY` en las variables de Dokploy.
