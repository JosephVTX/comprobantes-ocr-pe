import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import sharp from "sharp";
import type { Analyzer } from "./analyzer.js";
import { Limiter, QueueFullError } from "./limiter.js";

export interface AppDeps {
  analyzer: Analyzer;
  limiter: Limiter;
  /** Claves válidas. Vacío + authDisabled = sin autenticación (solo desarrollo). */
  apiKeys: string[];
  authDisabled?: boolean;
  maxBytes: number;
  /** HTML del cliente web. */
  html: string;
}

const FORMATOS = new Set(["jpeg", "png", "webp"]);

const hash = (s: string): Buffer => createHash("sha256").update(s).digest();

function claveValida(recibida: string | undefined, validas: string[]): boolean {
  if (!recibida) return false;
  const h = hash(recibida);
  // Se compara contra todas (sin cortocircuito) en tiempo constante
  return validas.reduce((ok, k) => timingSafeEqual(h, hash(k)) || ok, false);
}

export function createApp({ analyzer, limiter, apiKeys, authDisabled = false, maxBytes, html }: AppDeps): Hono {
  const app = new Hono();

  app.get("/", (c) => c.html(html));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      enCurso: limiter.enCurso,
      enCola: limiter.enCola,
    }),
  );

  app.use("/api/*", async (c, next) => {
    if (authDisabled) return next();
    const auth = c.req.header("authorization");
    const recibida = c.req.header("x-api-key") ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : undefined);
    if (!claveValida(recibida, apiKeys)) return c.json({ error: "API key inválida o ausente." }, 401);
    return next();
  });

  app.post(
    "/api/analizar",
    bodyLimit({
      maxSize: maxBytes,
      onError: (c) => c.json({ error: `Imagen demasiado grande (máx. ${Math.round(maxBytes / 1048576)} MB).` }, 413),
    }),
    async (c) => {
      // Acepta los bytes de la imagen directos o multipart con el campo "file"
      let buffer: Buffer;
      if (c.req.header("content-type")?.startsWith("multipart/form-data")) {
        const file = (await c.req.parseBody())["file"];
        if (!(file instanceof File)) return c.json({ error: 'Falta el campo "file" con la imagen.' }, 400);
        buffer = Buffer.from(await file.arrayBuffer());
      } else {
        buffer = Buffer.from(await c.req.arrayBuffer());
      }
      if (buffer.length === 0) return c.json({ error: "Cuerpo vacío: envía la imagen." }, 400);

      try {
        const meta = await sharp(buffer).metadata();
        if (!meta.format || !FORMATOS.has(meta.format)) throw new Error("formato");
      } catch {
        return c.json({ error: "Formato no soportado. Usa JPG, PNG o WEBP." }, 415);
      }

      const t0 = performance.now();
      try {
        const resultado = await limiter.run(() => analyzer.analizar(buffer));
        return c.json({
          ...resultado,
          _meta: {
            ms: Math.round(performance.now() - t0),
            rssMB: Math.round(process.memoryUsage().rss / 1048576),
          },
        });
      } catch (e) {
        if (e instanceof QueueFullError) {
          c.header("Retry-After", "10");
          return c.json({ error: e.message }, 503);
        }
        console.error(e);
        return c.json({ error: "Error interno al analizar la imagen." }, 500);
      }
    },
  );

  app.notFound((c) => c.json({ error: "No encontrado" }, 404));
  return app;
}
