import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnalyzer, type Analyzer } from "../src/analyzer.js";
import { createTesseractEngine, type OcrEngine } from "../src/ocr/engine.js";

// OCR real sobre capturas de ejemplo (sin LLM). Descarga el idioma "spa" la primera vez.
const img = (n: string) => readFileSync(join(import.meta.dirname, "fixtures", n));

let ocr: OcrEngine;
let analyzer: Analyzer;

beforeAll(async () => {
  ocr = await createTesseractEngine({ workers: 2 });
  analyzer = createAnalyzer({ ocr, anchos: [1000, 1400, 1800], llmMinScore: 2 });
}, 120_000);

afterAll(() => ocr.close());

describe("OCR real: comprobantes", () => {
  it("Yape S/25", async () => {
    expect(await analyzer.analizar(img("comprobant2e.jpg"))).toMatchObject({
      es_comprobante_pago: true,
      metodo_pago: "Yape",
      monto: 25,
      codigo_operacion: "26101992",
      codigo_seguridad: "992",
    });
  });

  it("Yape S/14 (dígitos del código en cajas grises, lectura dedicada)", async () => {
    expect(await analyzer.analizar(img("comprobante2.jpg"))).toMatchObject({
      es_comprobante_pago: true,
      metodo_pago: "Yape",
      monto: 14,
      codigo_operacion: "27034291",
      codigo_seguridad: "291",
      fuente: "ocr",
      receptor: "Erick San*",
    });
  });

  it("Plin de comercio S/250", async () => {
    expect(await analyzer.analizar(img("comprobante.jpg"))).toMatchObject({
      es_comprobante_pago: true,
      metodo_pago: "Plin",
      monto: 250,
      receptor: "Shopstar",
      codigo_operacion: "00051136547657787543",
    });
  });

  it("Plin a contacto S/29.90", async () => {
    expect(await analyzer.analizar(img("comprobantsse.jpg"))).toMatchObject({
      es_comprobante_pago: true,
      metodo_pago: "Plin",
      monto: 29.9,
      codigo_operacion: "02227848",
      receptor: "BAIRO JUNIOR CABALLERO",
    });
  });

  it("Transferencia BCP S/340", async () => {
    expect(await analyzer.analizar(img("comprobante22.jpg"))).toMatchObject({
      es_comprobante_pago: true,
      entidad: "BCP",
      monto: 340,
      codigo_operacion: "00778966",
    });
  });
});

describe("OCR real: imágenes que NO son comprobantes", () => {
  it.each(["lista.png", "boleta.png", "foto.jpg"])("ignora %s", async (n) => {
    expect(await analyzer.analizar(img(n))).toMatchObject({ es_comprobante_pago: false });
  });
});
