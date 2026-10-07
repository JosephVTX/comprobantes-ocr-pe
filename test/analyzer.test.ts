import { describe, expect, it, vi } from "vitest";
import { createAnalyzer } from "../src/analyzer.js";
import type { OcrEngine } from "../src/ocr/engine.js";
import type { LlmClient } from "../src/llm/openrouter.js";
import type { Resultado } from "../src/types.js";

const YAPE_COMPLETO = `¡Yapeaste!\nS/14\nErick San*\n05 oct. 2026 | 06:37 p. m.\nCÓDIGO DE SEGURIDAD\n2 9 1\nNro. de operación 27034291`;
const YAPE_SIN_DIGITOS = YAPE_COMPLETO.replace("2 9 1", "");
const RUIDO = "xyz qwerty";
const SOLO_MONTO = "Total S/ 25.00";

const ocrCon = (...textos: string[]): OcrEngine & { leer: ReturnType<typeof vi.fn> } => {
  let i = 0;
  return {
    leer: vi.fn(async () => ({ texto: textos[Math.min(i++, textos.length - 1)] ?? "", confianza: 80 })),
    close: async () => {},
  };
};

const llmValido: Resultado = {
  es_comprobante_pago: true,
  metodo_pago: "Yape",
  entidad: "DESCONOCIDO",
  banco_o_billetera: "Yape",
  tipo: "transferencia",
  monto: 14,
  moneda: "PEN",
  codigo_operacion: "27034291",
  codigo_seguridad: "291",
  fecha: "05 oct. 2026",
  hora: "06:37 p. m.",
  pagador: null,
  receptor: "Erick San*",
  numero_cuenta_o_celular: null,
  concepto: null,
  puntaje: 0,
  texto_detectado: "",
  confianza: 0.9,
  campos_detectados: {
    monto: true,
    codigo_operacion: true,
    codigo_seguridad: true,
    entidad: false,
    fecha: true,
    hora: true,
    receptor: true,
    numero_cuenta_o_celular: false,
  },
};

const llmCon = (impl: LlmClient["analizar"]) => {
  const analizar = vi.fn(impl);
  return { analizar } satisfies LlmClient;
};

const base = { anchos: [1000, 1400, 1800], llmMinScore: 2 };
const img = Buffer.from("x");

describe("analyzer híbrido", () => {
  it("usa solo OCR cuando el resultado es completo (no llama al LLM)", async () => {
    const llm = llmCon(async () => llmValido);
    const ocr = ocrCon(YAPE_COMPLETO);
    const r = await createAnalyzer({ ...base, ocr, llm }).analizar(img);

    expect(r).toMatchObject({ fuente: "ocr", es_comprobante_pago: true, codigo_seguridad: "291" });
    expect(ocr.leer).toHaveBeenCalledTimes(1);
    expect(llm.analizar).not.toHaveBeenCalled();
  });

  it("ignora sin LLM lo que no tiene ningún indicio de comprobante", async () => {
    const llm = llmCon(async () => llmValido);
    const ocr = ocrCon(RUIDO);
    const r = await createAnalyzer({ ...base, ocr, llm }).analizar(img);

    expect(r).toMatchObject({ fuente: "ocr", es_comprobante_pago: false });
    expect(ocr.leer).toHaveBeenCalledTimes(1);
    expect(llm.analizar).not.toHaveBeenCalled();
  });

  it("no gasta LLM si el puntaje está por debajo del mínimo", async () => {
    const llm = llmCon(async () => llmValido);
    const r = await createAnalyzer({ ...base, llmMinScore: 3, ocr: ocrCon("S/ 5"), llm }).analizar(img);
    expect(r.fuente).toBe("ocr");
    expect(llm.analizar).not.toHaveBeenCalled();
  });

  it("si solo falta el código de seguridad, lo lee con leerCodigo y no llama al LLM", async () => {
    const llm = llmCon(async () => llmValido);
    const ocr = { ...ocrCon(YAPE_SIN_DIGITOS), leerCodigo: vi.fn(async () => "291") };
    const r = await createAnalyzer({ ...base, ocr, llm }).analizar(img);

    expect(r).toMatchObject({ fuente: "ocr", codigo_seguridad: "291" });
    expect(ocr.leerCodigo).toHaveBeenCalledTimes(1);
    expect(llm.analizar).not.toHaveBeenCalled();
  });

  it("si leerCodigo no encuentra dígitos, sigue al LLM", async () => {
    const llm = llmCon(async () => llmValido);
    const ocr = { ...ocrCon(YAPE_SIN_DIGITOS), leerCodigo: vi.fn(async () => null) };
    const r = await createAnalyzer({ ...base, ocr, llm }).analizar(img);
    expect(r.fuente).toBe("llm");
    expect(ocr.leerCodigo).toHaveBeenCalledTimes(1);
  });

  it("reintenta con más resoluciones y luego cae al LLM si sigue incompleto", async () => {
    const llm = llmCon(async () => llmValido);
    const ocr = ocrCon(YAPE_SIN_DIGITOS);
    const r = await createAnalyzer({ ...base, ocr, llm }).analizar(img);

    expect(ocr.leer).toHaveBeenCalledTimes(11);
    expect(llm.analizar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ fuente: "llm", codigo_seguridad: "291" });
  });

  it("consulta al LLM cuando el OCR ve algo (solo un monto) pero no alcanza", async () => {
    const llm = llmCon(async () => llmValido);
    const r = await createAnalyzer({ ...base, ocr: ocrCon(SOLO_MONTO), llm }).analizar(img);
    expect(r.fuente).toBe("llm");
  });

  it("si el LLM falla, devuelve el resultado del OCR con llm_error", async () => {
    const llm = llmCon(async () => {
      throw new Error("OpenRouter respondió 429");
    });
    const r = await createAnalyzer({ ...base, ocr: ocrCon(YAPE_SIN_DIGITOS), llm }).analizar(img);

    expect(r).toMatchObject({ fuente: "ocr", es_comprobante_pago: true, llm_error: "OpenRouter respondió 429" });
  });

  it("si el LLM dice que no es comprobante pero el OCR sí, conserva el OCR", async () => {
    const llm = llmCon(async () => ({ es_comprobante_pago: false, motivo: "no", puntaje: 0, texto_detectado: "" }));
    const r = await createAnalyzer({ ...base, ocr: ocrCon(YAPE_SIN_DIGITOS), llm }).analizar(img);
    expect(r).toMatchObject({ fuente: "ocr", es_comprobante_pago: true });
  });

  it("si el LLM descarta lo que el OCR tampoco confirmaba, el resultado es no comprobante", async () => {
    const llm = llmCon(async () => ({ es_comprobante_pago: false, motivo: "no", puntaje: 0, texto_detectado: "" }));
    const r = await createAnalyzer({ ...base, ocr: ocrCon(SOLO_MONTO), llm }).analizar(img);
    expect(r).toMatchObject({ fuente: "llm", es_comprobante_pago: false });
  });

  it("sin LLM configurado devuelve el resultado del OCR aunque esté incompleto", async () => {
    const r = await createAnalyzer({ ...base, ocr: ocrCon(YAPE_SIN_DIGITOS) }).analizar(img);
    expect(r).toMatchObject({ fuente: "ocr", es_comprobante_pago: true, codigo_seguridad: null });
  });
});
