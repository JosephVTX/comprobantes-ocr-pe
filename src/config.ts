export interface Config {
  port: number;
  apiKeys: string[];
  authDisabled: boolean;
  maxBytes: number;
  ocrWorkers: number;
  ocrWidths: number[];
  maxQueue: number;
  tessdataDir: string | undefined;
  llm: { apiKey: string; model: string; timeoutMs: number; minScore: number } | null;
}

const num = (v: string | undefined, def: number): number => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : def;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKeys = (env.API_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const authDisabled = env.AUTH_DISABLED === "true";
  if (apiKeys.length === 0 && !authDisabled) {
    throw new Error("Define API_KEYS (separadas por coma) o AUTH_DISABLED=true solo para desarrollo.");
  }
  const llmKey = env.OPENROUTER_API_KEY?.trim();
  return {
    port: num(env.PORT, 3000),
    apiKeys,
    authDisabled,
    maxBytes: num(env.MAX_MB, 10) * 1024 * 1024,
    ocrWorkers: Math.max(1, Math.floor(num(env.OCR_WORKERS, 2))),
    ocrWidths: (env.OCR_WIDTHS ?? "1000,1400,1800").split(",").map(Number).filter((n) => n > 0),
    maxQueue: Math.max(0, Math.floor(num(env.MAX_QUEUE, 50))),
    tessdataDir: env.TESSDATA_DIR || undefined,
    llm: llmKey
      ? {
          apiKey: llmKey,
          model: env.OPENROUTER_MODEL || "google/gemma-4-26b-a4b-it:free",
          timeoutMs: num(env.LLM_TIMEOUT_MS, 60_000),
          minScore: num(env.LLM_MIN_SCORE, 5),
        }
      : null,
  };
}
