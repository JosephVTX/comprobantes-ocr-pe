import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createOpenRouterClient, extraerJson, normalizar } from "../src/llm/openrouter.js";

const imagen = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } })
  .png()
  .toBuffer();

const respuesta = (contenido: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: contenido } }] }), { status });

describe("extraerJson", () => {
  it("acepta JSON limpio, con markdown y rodeado de texto", () => {
    expect(extraerJson('{"a":1}')).toEqual({ a: 1 });
    expect(extraerJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extraerJson('Aquí va: {"a":1} listo')).toEqual({ a: 1 });
    expect(extraerJson('Aquí: [{"a":1},{"a":2}] listo')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("falla si no hay JSON", () => {
    expect(() => extraerJson("nada")).toThrow();
  });
});

describe("normalizar", () => {
  it("devuelve siempre un array con solo los campos mínimos", () => {
    const esperado = {
      method: "Yape",
      amount: 14,
      currency: "PEN",
      operation: "27034291",
      security_code: "291",
      date: "2026-10-05",
      time: "18:37",
      receiver: null,
    };
    const crudo = { method: "Yape", amount: 14, operation: "27034291", security_code: "291", date: "2026-10-05", time: "18:37", extra: 1 };
    expect(normalizar([crudo])).toEqual([esperado]);
    expect(normalizar(crudo)).toEqual([esperado]);
    expect(normalizar([crudo, { ...crudo, operation: "2" }]).map((r) => r.operation)).toEqual(["27034291", "2"]);
  });

  it("descarta lo que no es comprobante (sin monto u operación)", () => {
    expect(normalizar([])).toEqual([]);
    expect(normalizar([{ amount: 0, operation: "1" }, { amount: 5, operation: null }])).toEqual([]);
  });
});

describe("createOpenRouterClient", () => {
  const opts = { apiKey: "sk-test", timeoutMs: 5000 };
  const ok = '[{"amount":10,"method":"Plin","operation":"123"}]';
  const cliente = (f: unknown) => createOpenRouterClient({ ...opts, fetch: f as typeof fetch });

  it("usa primero el modelo gratis, con la imagen como data URL", async () => {
    const fetchMock = vi.fn(async () => respuesta(ok));
    const r = await cliente(fetchMock).analizar(imagen);

    expect(r).toMatchObject({ model: "google/gemma-4-26b-a4b-it:free", receipts: [{ amount: 10, method: "Plin" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.provider).toBeUndefined();
    expect(body.messages[1].content[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("si el gratis falla, usa el de pago con el proveedor más barato", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 429 })).mockResolvedValueOnce(respuesta(ok));
    const r = await cliente(fetchMock).analizar(imagen);

    expect(r.model).toBe("google/gemma-4-26b-a4b-it");
    const body = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body.model).toBe("google/gemma-4-26b-a4b-it");
    expect(body.provider).toEqual({ sort: "price" });
  });

  it("también cae al de pago si el gratis devuelve JSON inválido", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuesta("nada")).mockResolvedValueOnce(respuesta(ok));
    expect((await cliente(fetchMock).analizar(imagen)).model).toBe("google/gemma-4-26b-a4b-it");
  });

  it("lanza error si fallan los dos", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    await expect(cliente(fetchMock).analizar(imagen)).rejects.toThrow(/:free: .*500 \| .*500/);
  });
});
