import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createAnalyzer } from "./analyzer.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Limiter } from "./limiter.js";
import { MODELO, createOpenRouterClient } from "./llm/openrouter.js";

const config = loadConfig();

const analyzer = createAnalyzer(createOpenRouterClient({ apiKey: config.llm.apiKey, timeoutMs: config.llm.timeoutMs }));
const limiter = new Limiter(config.maxConcurrent, config.maxQueue);
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
  console.log(`http://localhost:${info.port} | LLM: ${MODELO} | auth: ${config.authDisabled ? "OFF" : "API key"}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
