import type { CamposDetectados, Resultado } from "../types.js";

// ============================================================
// Parseo del texto OCR de comprobantes peruanos (Yape, Plin, bancos)
// ============================================================

const ENTIDADES: ReadonlyArray<readonly [string, RegExp]> = [
  ["BCP", /bcp|banco de cr[eé]dito/i],
  ["INTERBANK", /interbank/i],
  ["BBVA", /bbva/i],
  ["SCOTIABANK", /scotiabank/i],
  ["BANCO DE LA NACION", /banco de la naci[oó]n/i],
  ["CAJA AREQUIPA", /caja arequipa/i],
  ["BANBIF", /banbif/i],
  ["MIBANCO", /mibanco/i],
];

const MESES =
  "ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|set(?:iembre)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?";

const RE_FECHA = new RegExp(
  `(\\d{1,2}\\s+(?:${MESES})\\.?\\s+\\d{4})|(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})`,
  "i",
);
const RE_HORA = "\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s?[ap]\\.?\\s?m\\.?)?";

/** Palabras que indican un comprobante de pago o transferencia. */
const RE_CLAVES =
  /yapeaste|yapeo|enviaste|plineaste|pago exitoso|transferencia|constancia|operaci[oó]n exitosa|pagaste|dep[oó]sito|comprobante de|total cobrado|n[uú]mero de operaci[oó]n|c[oó]digo de operaci[oó]n|nro\.? de operaci[oó]n/i;

/** Puntaje mínimo (monto 2, operación 2, fecha 1, hora 1, claves 1, marca 1). */
export const PUNTAJE_MIN = 5;

function primero(texto: string, regex: RegExp): string | null {
  return texto.match(regex)?.[1]?.trim() ?? null;
}

/** Valor de una etiqueta: en la misma línea o, si no hay, en la siguiente. */
function porEtiqueta(lineas: string[], etiqueta: RegExp): string | null {
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i] ?? "";
    const m = linea.match(etiqueta);
    if (!m || m.index === undefined) continue;
    const resto = linea.slice(m.index + m[0].length).replace(/^[\s:.-]+/, "");
    if (resto.length > 1) return resto;
    const siguiente = lineas[i + 1];
    if (siguiente) return siguiente;
  }
  return null;
}

const esNombre = (l: string): boolean =>
  /^[\p{L}][\p{L}.*' -]{2,}$/u.test(l) && !/^(yape|plin|gratis|compartir)\b/i.test(l);

export function parsear(texto: string, ocrConfidence: number): Resultado {
  const plano = texto.replace(/[ \t]+/g, " ");
  const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);

  // Monto: "S/", y "5/" cuando el OCR confunde la S (sin dígito antes, para no tomar fechas)
  const montos = [...plano.matchAll(/(?<!\d)[S5]\s*\/\s*\.?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi)].map((m) =>
    Number((m[1] ?? "0").replace(/,/g, "")),
  );
  const monto = montos.find((n) => n > 0) ?? 0;

  const codigoOperacion = primero(plano, /operaci[oó]n\s*:?\s*(\d{5,})/i);
  const seguridad =
    primero(plano, /seguridad\s*:?\s*(\d[ \t]?\d[ \t]?\d)(?![ \t]?\d)/i)?.replace(/\s/g, "") ?? null;

  const fechaM = plano.match(RE_FECHA);
  const fecha = fechaM?.[0] ?? null;

  // Hora: la que sigue a la fecha; si no, una con am/pm; si no, la primera
  const hora =
    (fechaM?.index !== undefined
      ? primero(
          plano.slice(fechaM.index + fechaM[0].length, fechaM.index + fechaM[0].length + 25),
          new RegExp(`(${RE_HORA})`, "i"),
        )
      : null) ??
    primero(plano, /(\d{1,2}:\d{2}\s?[ap]\.?\s?m\.?)/i) ??
    primero(plano, new RegExp(`(${RE_HORA})`, "i"));

  const celular =
    primero(plano, /(?:celular|cuenta)\s*:?\s*([*xX•\d%\s]{6,})/i)?.replace(/\s+/g, " ") ??
    primero(plano, /(?<!\d)(9\d{8})(?!\d)/) ??
    primero(plano, /(\*{2,}\s?\d{3,4})/);

  // Receptor, por orden de confianza
  const iTitulo = lineas.findIndex((l) => /yapeaste|plineaste|transferiste/i.test(l));
  const receptor =
    porEtiqueta(lineas, /contacto\s+(?:plin|yape)\s*:?/i) ??
    porEtiqueta(lineas, /^(?:(?:enviado a|destinatario|beneficiario)\b\s*:?|para\s*:)/i) ??
    (iTitulo >= 0 ? lineas.slice(iTitulo + 1, iTitulo + 4).find(esNombre) : undefined) ??
    porEtiqueta(lineas, /^comercio\s*:/i);

  const pagador = porEtiqueta(lineas, /^(?:desde|origen|pagado por|titular)\b\s*:?/i);
  const concepto = primero(plano, /(?:concepto|mensaje|motivo)\s*:?\s*([^\n]+)/i);

  const entidad =
    ENTIDADES.map(([nombre, re]) => [nombre, plano.search(re)] as const)
      .filter(([, i]) => i >= 0)
      .sort((a, b) => a[1] - b[1])[0]?.[0] ?? "DESCONOCIDO";

  // El logo de Plin no sale en el OCR: la constancia de pago a comercio lo delata
  const esPlinComercio =
    /pago exitoso/i.test(plano) && /comercio\s*:/i.test(plano) && /ventana del comercio/i.test(plano);

  const metodo = /yap(e|easte)|yapeo/i.test(plano)
    ? "Yape"
    : /plin/i.test(plano) || esPlinComercio
      ? "Plin"
      : /dep[oó]sito/i.test(plano)
        ? "depósito"
        : entidad !== "DESCONOCIDO"
          ? "transferencia bancaria"
          : "DESCONOCIDO";

  const tipo = /yapeaste|enviaste|plineaste|transfer|enviado a/i.test(plano)
    ? "transferencia"
    : /pago exitoso|pagaste|comercio/i.test(plano)
      ? "pago"
      : /dep[oó]sito/i.test(plano)
        ? "depósito"
        : "DESCONOCIDO";

  const campos: CamposDetectados = {
    monto: monto > 0,
    codigo_operacion: Boolean(codigoOperacion),
    codigo_seguridad: Boolean(seguridad),
    entidad: entidad !== "DESCONOCIDO",
    fecha: Boolean(fecha),
    hora: Boolean(hora),
    receptor: Boolean(receptor),
    numero_cuenta_o_celular: Boolean(celular),
  };

  // ---- Puerta: ¿es un comprobante de pago? ----
  const marca = metodo !== "DESCONOCIDO" || entidad !== "DESCONOCIDO";
  const puntaje =
    (campos.monto ? 2 : 0) +
    (campos.codigo_operacion ? 2 : 0) +
    (campos.fecha ? 1 : 0) +
    (campos.hora ? 1 : 0) +
    (RE_CLAVES.test(plano) ? 1 : 0) +
    (marca ? 1 : 0);
  const esComprobante = campos.monto && (campos.codigo_operacion || marca) && puntaje >= PUNTAJE_MIN;

  const cobertura =
    (["monto", "codigo_operacion", "fecha", "hora"] as const).filter((k) => campos[k]).length / 4;
  const confianza = Number(Math.min(1, (ocrConfidence / 100) * 0.5 + cobertura * 0.5).toFixed(2));

  const textoPlano = [...new Set(lineas)].join(" ");

  if (!esComprobante) {
    return {
      es_comprobante_pago: false,
      motivo: campos.monto
        ? "Hay un monto pero faltan datos de operación o de la app/banco."
        : "No se detectó un monto ni datos de un comprobante de pago.",
      puntaje,
      texto_detectado: textoPlano.slice(0, 300),
    };
  }

  return {
    es_comprobante_pago: true,
    metodo_pago: metodo,
    entidad,
    banco_o_billetera: metodo === "Yape" || metodo === "Plin" ? metodo : entidad,
    tipo,
    monto,
    moneda: "PEN",
    codigo_operacion: codigoOperacion,
    codigo_seguridad: seguridad,
    fecha,
    hora,
    pagador,
    receptor,
    numero_cuenta_o_celular: celular,
    concepto,
    puntaje,
    texto_detectado: textoPlano,
    confianza,
    campos_detectados: campos,
  };
}

/**
 * ¿El resultado del OCR es suficiente? Debe ser comprobante con operación y fecha, y,
 * si el texto menciona "seguridad" (Yape), también los dígitos del código.
 */
export function esCompleto(r: Resultado): boolean {
  if (!r.es_comprobante_pago) return false;
  const c = r.campos_detectados;
  return c.codigo_operacion && c.fecha && (c.codigo_seguridad || !/seguridad/i.test(r.texto_detectado));
}
