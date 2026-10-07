import type { OcrEngine } from "./ocr/engine.js";
import { esCompleto, parsear } from "./ocr/parser.js";
import type { LlmClient } from "./llm/openrouter.js";
import type { Analisis, Resultado } from "./types.js";

export interface AnalyzerDeps {
  ocr: OcrEngine;
  /** Si no se da, el analizador funciona solo con OCR. */
  llm?: LlmClient | undefined;
  anchos: number[];
  /** Puntaje mínimo para gastar una llamada al LLM (por debajo se considera "no es comprobante"). */
  llmMinScore: number;
  log?: (msg: string) => void;
}

export interface Analyzer {
  analizar(imagen: Buffer): Promise<Analisis>;
}

/**
 * Híbrido: OCR local primero (varias resoluciones). Si el resultado es incompleto pero hay
 * indicios de comprobante, consulta al LLM. Si no hay ningún indicio, lo ignora sin gastar LLM.
 */
export function createAnalyzer({ ocr, llm, anchos, llmMinScore, log = () => {} }: AnalyzerDeps): Analyzer {
  return {
    async analizar(imagen) {
      const textos: string[] = [];
      let confianza = 0;
      let r: Resultado = parsear("", 0);
      let codigoIntentado = false;

      /** Yape: si solo falta el código de seguridad, se lee esa franja aparte antes de recurrir al LLM. */
      const completarCodigo = async (): Promise<void> => {
        if (codigoIntentado || !ocr.leerCodigo || !r.es_comprobante_pago || r.codigo_seguridad) return;
        if (!/seguridad/i.test(r.texto_detectado)) return;
        codigoIntentado = true;
        const codigo = await ocr.leerCodigo(imagen, anchos[anchos.length - 1] ?? 1400).catch(() => null);
        if (codigo) r = { ...r, codigo_seguridad: codigo, campos_detectados: { ...r.campos_detectados, codigo_seguridad: true } };
      };

      for (const ancho of anchos) {
        const lectura = await ocr.leer(imagen, ancho);
        textos.push(lectura.texto);
        confianza = Math.max(confianza, lectura.confianza);
        r = parsear(textos.join("\n"), confianza);
        if (esCompleto(r)) return { ...r, fuente: "ocr" };
        await completarCodigo();
        if (esCompleto(r)) return { ...r, fuente: "ocr" };
        if (r.puntaje === 0) return { ...r, fuente: "ocr" }; // sin ningún indicio: no insistir
      }

      if (!llm || r.puntaje < llmMinScore) return { ...r, fuente: "ocr" };

      log(`OCR incompleto (puntaje ${r.puntaje}); consultando LLM`);
      try {
        const viaLlm = await llm.analizar(imagen);
        // Si el LLM no confirma pero el OCR sí había reconocido un comprobante, se conserva el OCR
        if (!viaLlm.es_comprobante_pago && r.es_comprobante_pago) return { ...r, fuente: "ocr" };
        return { ...viaLlm, fuente: "llm" };
      } catch (e) {
        const llm_error = e instanceof Error ? e.message : String(e);
        log(`LLM falló: ${llm_error}`);
        return { ...r, fuente: "ocr", llm_error };
      }
    },
  };
}
