# comprobantes-ocr

API (Hono + TypeScript) que lee comprobantes de pago peruanos (Yape, Plin, bancos) de forma **híbrida**:
primero OCR local (Tesseract.js); si el resultado queda incompleto, consulta un modelo de OpenRouter.
Si la imagen no es un comprobante, se ignora (`es_comprobante_pago: false`).

## Uso

```bash
curl -X POST http://localhost:3000/api/analizar \
  -H "x-api-key: TU_CLAVE" --data-binary @comprobante.jpg
# o multipart: -F file=@comprobante.jpg
```

La respuesta incluye `fuente` (`ocr` | `llm`) y `llm_error` si el respaldo falló. `GET /` es un cliente web; `GET /health` es público.
Códigos: 400 vacío, 401 clave, 413 tamaño, 415 formato, 503 cola llena (`Retry-After`).

## Variables de entorno

Ver `.env.example`. `API_KEYS` es obligatoria. Sin `OPENROUTER_API_KEY` solo se usa OCR.
`OCR_WORKERS` controla la concurrencia; `MAX_QUEUE` cuántas peticiones esperan antes de responder 503.

## Desarrollo

```bash
pnpm install
cp .env.example .env
pnpm dev        # servidor con recarga
pnpm test       # incluye OCR real sobre test/fixtures (descarga el idioma la primera vez)
pnpm build && pnpm start
```

## Docker / Dokploy

Aplicación desde GitHub, build type **Dockerfile**, puerto 3000. Define `API_KEYS` y `OPENROUTER_API_KEY` en
las variables de entorno de Dokploy (nunca en la imagen). Memoria estimada: ~300–500 MB con 2 workers.
