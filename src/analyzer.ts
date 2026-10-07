import type { LlmClient } from "./llm/openrouter.js";
import type { Analisis } from "./types.js";

export interface Analyzer {
  analizar(imagen: Buffer): Promise<Analisis>;
}

export function createAnalyzer(llm: LlmClient): Analyzer {
  return { analizar: (imagen) => llm.analizar(imagen) };
}
