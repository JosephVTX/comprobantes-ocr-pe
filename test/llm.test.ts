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
  });

  it("falla si no hay JSON", () => {
    expect(() => extraerJson("nada")).toThrow();
  });
});

describe("normalizar", () => {
  it("convierte la respuesta del modelo al formato de comprobante", () => {
    const r = normalizar({
      es_comprobante_pago: true,
      metodo_pago: "Yape",
      monto: 14,
      codigo_operacion: "27034291",
      codigo_seguridad: "291",
      fecha: "05 oct. 2026",
      confianza: 7,
    });
    expect(r).toMatchObject({
      es_comprobante_pago: true,
      banco_o_billetera: "Yape",
      monto: 14,
      moneda: "PEN",
      codigo_seguridad: "291",
      confianza: 1,
      entidad: "DESCONOCIDO",
    });
  });

  it("trata como no comprobante si el modelo lo dice o no hay monto", () => {
    expect(normalizar({ es_comprobante_pago: false }).es_comprobante_pago).toBe(false);
    expect(normalizar({ es_comprobante_pago: true, monto: 0 }).es_comprobante_pago).toBe(false);
  });
});

describe("createOpenRouterClient", () => {
  const opts = { apiKey: "sk-test", timeoutMs: 5000 };

  it("envía la imagen como data URL con la API key y parsea la respuesta", async () => {
    const fetchMock = vi.fn(async () => respuesta('{"es_comprobante_pago":true,"monto":10,"metodo_pago":"Plin"}'));
    const r = await createOpenRouterClient({ ...opts, fetch: fetchMock as unknown as typeof fetch }).analizar(imagen);

    expect(r).toMatchObject({ es_comprobante_pago: true, monto: 10, metodo_pago: "Plin" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("inclusionai/ling-3.0-flash-vl");
    expect(body.provider).toEqual({ only: ["novita/bf16"], allow_fallbacks: false });
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("lanza error si OpenRouter responde con error HTTP", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(
      createOpenRouterClient({ ...opts, fetch: fetchMock as unknown as typeof fetch }).analizar(imagen),
    ).rejects.toThrow("429");
  });

  it("lanza error si la respuesta viene vacía", async () => {
    const fetchMock = vi.fn(async () => respuesta(""));
    await expect(
      createOpenRouterClient({ ...opts, fetch: fetchMock as unknown as typeof fetch }).analizar(imagen),
    ).rejects.toThrow();
  });
});
