import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnalyzer, type Analyzer } from "../src/analyzer.js";
import { createTesseractEngine, type OcrEngine } from "../src/ocr/engine.js";
import { VARIANTES } from "./helpers/variantes.js";

let ocr: OcrEngine;
let analyzer: Analyzer;
beforeAll(async () => {
  ocr = await createTesseractEngine({ workers: 2 });
  analyzer = createAnalyzer({ ocr, anchos: [1000, 1400, 1800], llmMinScore: 5 });
}, 120_000);
afterAll(() => ocr.close());

describe("Yape degradado (código 291)", () => {
  const img = readFileSync("test/fixtures/comprobante2.jpg");
  for (const v of ["baja_resolucion", "jpeg_comprimido", "desenfoque", "oscuro", "con_margenes", "modo_oscuro"]) {
    it(v, async () => {
      const r = await analyzer.analizar(await VARIANTES[v]!(img));
      expect(r).toMatchObject({ es_comprobante_pago: true, monto: 14, codigo_operacion: "27034291", codigo_seguridad: "291", fuente: "ocr" });
    }, 120_000);
  }
});
