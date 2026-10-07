export interface Config {
  port: number;
  apiKeys: string[];
  authDisabled: boolean;
  maxBytes: number;
  maxConcurrent: number;
  maxQueue: number;
  llm: { apiKey: string; timeoutMs: number };
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
  if (!llmKey) throw new Error("Define OPENROUTER_API_KEY.");
  return {
    port: num(env.PORT, 3000),
    apiKeys,
    authDisabled,
    maxBytes: num(env.MAX_MB, 10) * 1024 * 1024,
    maxConcurrent: Math.max(1, Math.floor(num(env.MAX_CONCURRENT, 8))),
    maxQueue: Math.max(0, Math.floor(num(env.MAX_QUEUE, 50))),
    llm: { apiKey: llmKey, timeoutMs: num(env.LLM_TIMEOUT_MS, 60_000) },
  };
}
