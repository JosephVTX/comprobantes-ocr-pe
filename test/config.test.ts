import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { OPENROUTER_API_KEY: "sk" };

describe("loadConfig", () => {
  it("exige API_KEYS salvo AUTH_DISABLED=true", () => {
    expect(() => loadConfig(base)).toThrow(/API_KEYS/);
    expect(loadConfig({ ...base, AUTH_DISABLED: "true" }).authDisabled).toBe(true);
  });

  it("exige OPENROUTER_API_KEY", () => {
    expect(() => loadConfig({ API_KEYS: "a" })).toThrow(/OPENROUTER_API_KEY/);
  });

  it("separa las claves por coma y aplica valores por defecto", () => {
    const c = loadConfig({ ...base, API_KEYS: " a , b ,," });
    expect(c.apiKeys).toEqual(["a", "b"]);
    expect(c).toMatchObject({ port: 3000, maxConcurrent: 8, maxQueue: 50, llm: { apiKey: "sk", timeoutMs: 60_000 } });
    expect(c.maxBytes).toBe(10 * 1024 * 1024);
  });

  it("ignora números inválidos y fuerza al menos 1 concurrente", () => {
    const c = loadConfig({ ...base, API_KEYS: "a", PORT: "abc", MAX_CONCURRENT: "0" });
    expect(c.port).toBe(3000);
    expect(c.maxConcurrent).toBe(1);
  });
});
