import sharp from "sharp";
import type { CamposDetectados, Resultado } from "../types.js";

/** Modelo y proveedor fijos: siempre este modelo, solo por Novita, sin respaldo a otros proveedores. */
export const MODELO = "inclusionai/ling-3.0-flash-vl";
const PROVIDER = { only: ["novita/bf16"], allow_fallbacks: false };

export interface LlmOptions {
  apiKey: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface LlmClient {
  analizar(imagen: Buffer): Promise<Resultado>;
}

const PROMPT = `Eres un sistema OCR especializado en comprobantes de pago de Perú (Yape, Plin, transferencias, depósitos, POS, QR).
Analiza solo lo visible en la imagen. NO inventes datos: lo que no aparezca va en null (monto ilegible: 0).
- codigo_operacion: solo el número rotulado como operación/transacción. No lo confundas con celular, cuenta o tarjeta.
- codigo_seguridad: solo si aparece rotulado como "código de seguridad" (Yape). Va separado de codigo_operacion.
- Respeta los números exactamente. monto es número. moneda: "PEN" soles, "USD" dólares.
- metodo_pago (Yape, Plin, transferencia bancaria, depósito...) y entidad (BCP, Interbank, BBVA...) son distintos; entidad solo con evidencia.
- Solo son comprobantes de pago las constancias de Yape, Plin, transferencias, depósitos o pagos de apps/bancos (con número de operación o código de transacción). Una boleta, factura, ticket de compra, lista de precios, captura sin operación o cualquier otra imagen NO lo es: es_comprobante_pago false.
Devuelve SOLO un JSON con estas claves: es_comprobante_pago, metodo_pago, entidad, tipo, monto, moneda, codigo_operacion, codigo_seguridad, fecha, hora, pagador, receptor, numero_cuenta_o_celular, concepto, confianza (0-1).`;

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

export function normalizar(data: unknown): Resultado {
  const d = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!d || typeof d !== "object") throw new Error("La respuesta JSON no tiene un formato válido.");

  const monto = typeof d.monto === "number" && d.monto > 0 ? d.monto : 0;

  if (d.es_comprobante_pago !== true || monto === 0) {
    return {
      es_comprobante_pago: false,
      motivo: "El modelo indicó que no es un comprobante de pago (o no pudo leer el monto).",
      puntaje: 0,
      texto_detectado: JSON.stringify(d).slice(0, 300),
    };
  }

  const metodo = str(d.metodo_pago) ?? "DESCONOCIDO";
  const entidad = str(d.entidad) ?? "DESCONOCIDO";
  const campos: CamposDetectados = {
    monto: true,
    codigo_operacion: Boolean(str(d.codigo_operacion)),
    codigo_seguridad: Boolean(str(d.codigo_seguridad)),
    entidad: entidad !== "DESCONOCIDO",
    fecha: Boolean(str(d.fecha)),
    hora: Boolean(str(d.hora)),
    receptor: Boolean(str(d.receptor)),
    numero_cuenta_o_celular: Boolean(str(d.numero_cuenta_o_celular)),
  };

  return {
    es_comprobante_pago: true,
    metodo_pago: metodo,
    entidad,
    banco_o_billetera: metodo === "Yape" || metodo === "Plin" ? metodo : entidad,
    tipo: str(d.tipo) ?? "DESCONOCIDO",
    monto,
    moneda: str(d.moneda) ?? "PEN",
    codigo_operacion: str(d.codigo_operacion),
    codigo_seguridad: str(d.codigo_seguridad),
    fecha: str(d.fecha),
    hora: str(d.hora),
    pagador: str(d.pagador),
    receptor: str(d.receptor),
    numero_cuenta_o_celular: str(d.numero_cuenta_o_celular),
    concepto: str(d.concepto),
    puntaje: 0,
    texto_detectado: "",
    confianza: typeof d.confianza === "number" ? Math.max(0, Math.min(1, d.confianza)) : 0,
    campos_detectados: campos,
  };
}

export function createOpenRouterClient(opts: LlmOptions): LlmClient {
  const doFetch = opts.fetch ?? fetch;
  return {
    async analizar(imagen) {
      // Reduce la imagen: menos tokens, más rápido y barato
      const jpg = await sharp(imagen)
        .rotate()
        .resize({ width: 1400, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      const res = await doFetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs),
        body: JSON.stringify({
          model: MODELO,
          provider: PROVIDER,
          temperature: 0,
          messages: [
            { role: "system", content: PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Analiza este comprobante y devuelve solo el JSON." },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpg.toString("base64")}` } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter respondió ${res.status}`);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const contenido = body.choices?.[0]?.message?.content;
      if (!contenido) throw new Error("OpenRouter no devolvió contenido.");
      return normalizar(extraerJson(contenido));
    },
  };
}
