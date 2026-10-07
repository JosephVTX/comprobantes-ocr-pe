import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("exige API_KEYS salvo AUTH_DISABLED=true", () => {
    expect(() => loadConfig({})).toThrow(/API_KEYS/);
    expect(loadConfig({ AUTH_DISABLED: "true" }).authDisabled).toBe(true);
  });

  it("separa las claves por coma y aplica valores por defecto", () => {
    const c = loadConfig({ API_KEYS: " a , b ,," });
    expect(c.apiKeys).toEqual(["a", "b"]);
    expect(c).toMatchObject({ port: 3000, ocrWorkers: 2, maxQueue: 50, ocrWidths: [1000, 1400, 1800], llm: null });
    expect(c.maxBytes).toBe(10 * 1024 * 1024);
  });

  it("activa el LLM solo si hay OPENROUTER_API_KEY", () => {
    const c = loadConfig({ API_KEYS: "a", OPENROUTER_API_KEY: "sk", OPENROUTER_MODEL: "x/y" });
    expect(c.llm).toMatchObject({ apiKey: "sk", model: "x/y", minScore: 2 });
  });

  it("ignora números inválidos y fuerza al menos 1 worker", () => {
    const c = loadConfig({ API_KEYS: "a", PORT: "abc", OCR_WORKERS: "0" });
    expect(c.port).toBe(3000);
    expect(c.ocrWorkers).toBe(1);
  });
});
