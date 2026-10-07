import sharp from "sharp";
import type { Analisis, Receipt } from "../types.js";

/** Primero el modelo gratis; si falla (límite, error, JSON inválido), el mismo modelo de pago con el proveedor más barato. */
export const INTENTOS: ReadonlyArray<{ model: string; provider?: Record<string, unknown> }> = [
  { model: "google/gemma-4-26b-a4b-it:free" },
  { model: "google/gemma-4-26b-a4b-it", provider: { sort: "price" } },
];

export interface LlmOptions {
  apiKey: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface LlmClient {
  analizar(imagen: Buffer): Promise<Analisis>;
}

const PROMPT = `Read this Peruvian payment receipt (Yape, Plin, bank transfer, deposit). Reply ONLY with JSON:
{"is_receipt":bool,"method":"Yape|Plin|BCP|Interbank|BBVA|...","amount":number,"currency":"PEN|USD","operation":"operation/transaction number","security_code":"Yape security code or null","date":"YYYY-MM-DD","time":"HH:mm 24h","receiver":"name or null"}
Rules: copy digits exactly; use null for anything not visible; never invent. operation is only the number labeled operation/transaction (not phone/account). Invoices, sales tickets, price lists, or any image without an operation number are NOT receipts: reply {"is_receipt":false}.`;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Extrae el objeto JSON aunque el modelo lo envuelva en markdown o texto. */
export function extraerJson(texto: string): unknown {
  const limpio = texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(limpio);
  } catch {
    const a = limpio.indexOf("{");
    const b = limpio.lastIndexOf("}");
    if (a !== -1 && b > a) return JSON.parse(limpio.slice(a, b + 1));
    throw new Error("La respuesta del modelo no contiene JSON válido.");
  }
}

export function normalizar(data: unknown): Receipt {
  const d = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!d || typeof d !== "object") throw new Error("La respuesta JSON no tiene un formato válido.");

  const amount = typeof d.amount === "number" && d.amount > 0 ? d.amount : 0;
  if (d.is_receipt !== true || amount === 0 || !str(d.operation)) return { is_receipt: false };

  return {
    is_receipt: true,
    method: str(d.method),
    amount,
    currency: str(d.currency) ?? "PEN",
    operation: str(d.operation),
    security_code: str(d.security_code),
    date: str(d.date),
    time: str(d.time),
    receiver: str(d.receiver),
  };
}

export function createOpenRouterClient(opts: LlmOptions): LlmClient {
  const doFetch = opts.fetch ?? fetch;

  async function consultar(intento: (typeof INTENTOS)[number], dataUrl: string): Promise<Receipt> {
    const res = await doFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs),
      body: JSON.stringify({
        model: intento.model,
        ...(intento.provider ? { provider: intento.provider } : {}),
        temperature: 0,
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: [{ type: "image_url", image_url: { url: dataUrl } }] },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter respondió ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const contenido = body.choices?.[0]?.message?.content;
    if (!contenido) throw new Error("OpenRouter no devolvió contenido.");
    return normalizar(extraerJson(contenido));
  }

  return {
    async analizar(imagen) {
      const jpg = await sharp(imagen).rotate().resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      const dataUrl = `data:image/jpeg;base64,${jpg.toString("base64")}`;
      const errores: string[] = [];
      for (const intento of INTENTOS) {
        try {
          return { receipt: await consultar(intento, dataUrl), model: intento.model };
        } catch (e) {
          errores.push(`${intento.model}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      throw new Error(errores.join(" | "));
    },
  };
}
