import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createAnalyzer } from "./analyzer.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Limiter } from "./limiter.js";
import { createOpenRouterClient } from "./llm/openrouter.js";
import { createTesseractEngine } from "./ocr/engine.js";

const config = loadConfig();

const ocr = await createTesseractEngine({ workers: config.ocrWorkers, tessdataDir: config.tessdataDir });
const llm = config.llm
  ? createOpenRouterClient({ apiKey: config.llm.apiKey, model: config.llm.model, timeoutMs: config.llm.timeoutMs })
  : undefined;

const analyzer = createAnalyzer({
  ocr,
  llm,
  anchos: config.ocrWidths,
  llmMinScore: config.llm?.minScore ?? 5,
  log: (m) => console.log(m),
});

// Con el LLM en el camino, un trabajo puede esperar red: se permiten más simultáneos que workers OCR
const limiter = new Limiter(config.ocrWorkers * (llm ? 2 : 1), config.maxQueue);

const html = readFileSync(join(import.meta.dirname, "..", "public", "index.html"), "utf8");

const app = createApp({
  analyzer,
  limiter,
  apiKeys: config.apiKeys,
  authDisabled: config.authDisabled,
  maxBytes: config.maxBytes,
  html,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `http://localhost:${info.port} | OCR workers: ${config.ocrWorkers} | LLM: ${config.llm ? config.llm.model : "desactivado"} | auth: ${config.authDisabled ? "OFF" : "API key"}`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    void ocr.close().finally(() => process.exit(0));
  });
}
