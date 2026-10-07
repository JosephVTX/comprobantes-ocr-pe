import type { OcrEngine } from "./ocr/engine.js";
import sharp from "sharp";
import type { Modo } from "./ocr/preproceso.js";
import { parsear } from "./ocr/parser.js";
import type { LlmClient } from "./llm/openrouter.js";
import type { Analisis, ComprobanteValido, Resultado } from "./types.js";

/** Puntaje mínimo para gastar CPU en pasadas de rescate (más bajo que el del LLM). */
const RESCATE_MIN_SCORE = 2;

const cuenta = (c: ComprobanteValido): number => Object.values(c.campos_detectados).filter(Boolean).length;

/** Ancho máximo de trabajo: más grande solo cuesta tiempo (decodificar y reescalar en cada pasada). */
const ANCHO_MAX = 2000;

/** Reduce una sola vez las imágenes grandes (nunca agranda) y aplica la orientación EXIF. */
async function reducir(imagen: Buffer): Promise<Buffer> {
  try {
    const { width = 0 } = await sharp(imagen).metadata();
    if (width <= ANCHO_MAX) return imagen;
    return await sharp(imagen).rotate().resize({ width: ANCHO_MAX }).jpeg({ quality: 95 }).toBuffer();
  } catch {
    return imagen;
  }
}

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
    async analizar(original) {
      const imagen = await reducir(original);
      const lecturas: { texto: string; confianza: number }[] = [];
      let r: Resultado = parsear("", 0);
      let codigoIntentado = false;
      let codigo: string | null = null;
      const menciona = () => lecturas.some((l) => /seguridad/i.test(l.texto));

      const completo = (x: Resultado): boolean => {
        if (!x.es_comprobante_pago) return false;
        const c = x.campos_detectados;
        return Boolean(c.codigo_operacion && c.fecha && (x.codigo_seguridad || !menciona()));
      };

      /** Mejor candidato: el texto de todas las lecturas junto y cada lectura por separado; se completan huecos entre ellos. */
      const consolidar = (): Resultado => {
        const confianza = Math.max(...lecturas.map((l) => l.confianza));
        const candidatos = [
          parsear(lecturas.map((l) => l.texto).join("\n"), confianza),
          ...lecturas.map((l) => parsear(l.texto, l.confianza)),
        ];
        const validos = candidatos.filter((c): c is ComprobanteValido => c.es_comprobante_pago);
        const mejor = validos.sort((x, y) => y.puntaje - x.puntaje || cuenta(y) - cuenta(x))[0];
        if (!mejor) return candidatos.sort((x, y) => y.puntaje - x.puntaje)[0] ?? parsear("", 0);
        const out: ComprobanteValido = { ...mejor, campos_detectados: { ...mejor.campos_detectados } };
        for (const k of ["codigo_operacion", "codigo_seguridad", "fecha", "hora"] as const) {
          if (out[k]) continue;
          const otro = validos.find((v) => v[k]);
          if (otro) {
            out[k] = otro[k];
            out.campos_detectados[k] = true;
          }
        }
        if (!out.codigo_seguridad && codigo) {
          out.codigo_seguridad = codigo;
          out.campos_detectados.codigo_seguridad = true;
        }
        return out;
      };

      /** Yape: si solo falta el código de seguridad, se lee esa franja aparte antes de recurrir al LLM. */
      const completarCodigo = async (): Promise<void> => {
        if (codigoIntentado || !ocr.leerCodigo || !r.es_comprobante_pago || r.codigo_seguridad || !menciona()) return;
        codigoIntentado = true;
        codigo = await ocr.leerCodigo(imagen, anchos[anchos.length - 1] ?? 1400).catch(() => null);
        if (codigo) r = consolidar();
      };

      const intentar = async (ancho: number, modo: Modo): Promise<"fin" | "seguir"> => {
        const lectura = await ocr.leer(imagen, ancho, modo).catch(() => null);
        if (!lectura) return "seguir";
        lecturas.push(lectura);
        r = consolidar();
        if (completo(r)) return "fin";
        await completarCodigo();
        if (completo(r)) return "fin";
        return "seguir";
      };

      let terminado = false;
      for (const ancho of anchos) {
        if ((await intentar(ancho, "normal")) === "fin") { terminado = true; break; }
        if (r.puntaje === 0) { terminado = true; break; } // sin ningún indicio: no insistir
      }
      // Pasadas de rescate (fotos, márgenes, inclinación, contraste, modo oscuro), solo si ya parece comprobante
      if (!terminado && r.puntaje >= RESCATE_MIN_SCORE) {
        const base = anchos[Math.min(1, anchos.length - 1)] ?? 1400;
        const mayor = anchos[anchos.length - 1] ?? base;
        const pasadas: [number, Modo][] = [[base, "recortado"], [base, "enderezado"], [base, "binario"], [base, "invertido"], [base, "realzado"], [mayor, "recortado"], [mayor, "enderezado"], [mayor, "realzado"]];
        for (const [ancho, modo] of pasadas) {
          if ((await intentar(ancho, modo)) === "fin") break;
        }
      }
      if (completo(r)) return { ...r, fuente: "ocr" };

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
