# comprobantes-ocr

API (Hono + TypeScript) que lee comprobantes de pago peruanos (Yape, Plin, bancos) con un LLM de visión
vía OpenRouter: siempre `inclusionai/ling-3.0-flash-vl`, solo por el proveedor `novita/bf16` (sin fallbacks).
Si la imagen no es un comprobante, se ignora (`es_comprobante_pago: false`).

## Uso

```bash
curl -X POST http://localhost:3000/api/analizar \
  -H "x-api-key: TU_CLAVE" --data-binary @comprobante.jpg
# o multipart: -F file=@comprobante.jpg
```

`GET /` es un cliente web; `GET /health` es público.
Códigos: 400 vacío, 401 clave, 413 tamaño, 415 formato, 500 error del LLM, 503 cola llena (`Retry-After`).

## Variables de entorno

Ver `.env.example`. `API_KEYS` y `OPENROUTER_API_KEY` son obligatorias.
`MAX_CONCURRENT` limita llamadas simultáneas al LLM; `MAX_QUEUE` cuántas esperan antes de responder 503.

## Desarrollo

```bash
pnpm install
cp .env.example .env
pnpm dev
pnpm test
pnpm build && pnpm start
```

## Docker / Dokploy

Aplicación desde GitHub, build type **Dockerfile**, puerto 3000. Define `API_KEYS` y `OPENROUTER_API_KEY` en
las variables de entorno de Dokploy (nunca en la imagen).
