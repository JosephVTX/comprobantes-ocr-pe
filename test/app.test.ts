import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Analyzer } from "../src/analyzer.js";
import { createApp } from "../src/app.js";
import { Limiter } from "../src/limiter.js";
import type { Analisis } from "../src/types.js";

const KEY = "clave-secreta";
const NO_COMPROBANTE: Analisis = {
  es_comprobante_pago: false,
  motivo: "no",
  puntaje: 0,
  texto_detectado: "",
  fuente: "llm",
};

let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer();
});

const montar = (opts: { analyzer?: Analyzer; limiter?: Limiter; maxBytes?: number; authDisabled?: boolean } = {}) =>
  createApp({
    analyzer: opts.analyzer ?? { analizar: async () => NO_COMPROBANTE },
    limiter: opts.limiter ?? new Limiter(1, 5),
    apiKeys: [KEY, "otra-clave"],
    authDisabled: opts.authDisabled ?? false,
    maxBytes: opts.maxBytes ?? 1024 * 1024,
    html: "<h1>cliente</h1>",
  });

const post = (app: ReturnType<typeof montar>, body: RequestInit["body"], headers: Record<string, string> = {}) =>
  app.request("/api/analizar", { method: "POST", body, headers: { "x-api-key": KEY, ...headers } });

describe("rutas públicas", () => {
  it("GET / sirve el cliente y GET /health no pide clave", async () => {
    const app = montar();
    expect(await (await app.request("/")).text()).toContain("cliente");
    const h = await app.request("/health");
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ ok: true });
  });

  it("404 en JSON para rutas desconocidas", async () => {
    expect((await montar().request("/nada")).status).toBe(404);
  });
});

describe("autenticación por API key", () => {
  it("401 sin clave o con clave incorrecta", async () => {
    const app = montar();
    expect((await app.request("/api/analizar", { method: "POST", body: png })).status).toBe(401);
    expect((await post(app, png, { "x-api-key": "mala" })).status).toBe(401);
  });

  it("acepta x-api-key y Authorization: Bearer (cualquiera de las claves)", async () => {
    const app = montar();
    expect((await post(app, png)).status).toBe(200);
    const bearer = await app.request("/api/analizar", {
      method: "POST",
      body: png,
      headers: { Authorization: "Bearer otra-clave" },
    });
    expect(bearer.status).toBe(200);
  });

  it("authDisabled permite el acceso sin clave", async () => {
    const app = montar({ authDisabled: true });
    expect((await app.request("/api/analizar", { method: "POST", body: png })).status).toBe(200);
  });
});

describe("POST /api/analizar", () => {
  it("devuelve el análisis con _meta", async () => {
    const analizar = vi.fn(async () => NO_COMPROBANTE);
    const res = await post(montar({ analyzer: { analizar } }), png);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ es_comprobante_pago: false, fuente: "llm", _meta: { ms: expect.any(Number) } });
    expect(analizar).toHaveBeenCalledOnce();
  });

  it("acepta multipart con el campo file", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(png)], "x.png", { type: "image/png" }));
    const res = await montar().request("/api/analizar", { method: "POST", body: form, headers: { "x-api-key": KEY } });
    expect(res.status).toBe(200);
  });

  it("400 si multipart no trae file y 400 con cuerpo vacío", async () => {
    const app = montar();
    const form = new FormData();
    form.set("otro", "x");
    expect((await app.request("/api/analizar", { method: "POST", body: form, headers: { "x-api-key": KEY } })).status).toBe(400);
    expect((await post(app, new Uint8Array(0))).status).toBe(400);
  });

  it("415 si no es una imagen válida o el formato no se admite", async () => {
    const app = montar();
    expect((await post(app, "hola")).status).toBe(415);
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).gif().toBuffer();
    expect((await post(app, gif)).status).toBe(415);
  });

  it("413 si supera el tamaño máximo", async () => {
    const res = await post(montar({ maxBytes: 100 }), png.length > 100 ? png : Buffer.alloc(200, 1), {
      "content-length": "200",
    });
    expect(res.status).toBe(413);
  });

  it("503 con Retry-After cuando la cola está llena", async () => {
    let liberar!: () => void;
    const bloqueo = new Promise<void>((r) => (liberar = r));
    const app = montar({
      limiter: new Limiter(1, 0),
      analyzer: { analizar: async () => (await bloqueo, NO_COMPROBANTE) },
    });
    const primera = post(app, png);
    await new Promise((r) => setTimeout(r, 50));
    const segunda = await post(app, png);
    expect(segunda.status).toBe(503);
    expect(segunda.headers.get("retry-after")).toBe("10");
    liberar();
    expect((await primera).status).toBe(200);
  });

  it("500 genérico (sin filtrar detalles) si el analizador falla", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(montar({ analyzer: { analizar: async () => Promise.reject(new Error("secreto interno")) } }), png);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secreto");
  });
});
