import type { LlmClient } from "./llm/openrouter.js";
import type { Analisis } from "./types.js";

export interface Analyzer {
  analizar(imagen: Buffer): Promise<Analisis>;
}

/** Solo LLM: cada imagen se envía al modelo; si falla, el error se propaga (no hay respaldo). */
export function createAnalyzer(llm: LlmClient): Analyzer {
  return {
    async analizar(imagen) {
      return { ...(await llm.analizar(imagen)), fuente: "llm" };
    },
  };
}
