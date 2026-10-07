import sharp from "sharp";

/**
 * Variantes de preprocesado de la imagen. Cada una ayuda con un tipo distinto de problema;
 * el analizador las prueba solo si la lectura normal quedó incompleta.
 */
export type Modo = "normal" | "recortado" | "clahe" | "binario" | "invertido" | "enderezado" | "realzado";

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const base = (imagen: Buffer) => sharp(imagen, { sequentialRead: true }).rotate();

/** Estima la inclinación del texto (grados, ±10) por proyección horizontal de píxeles oscuros. */
export async function estimarInclinacion(imagen: Buffer): Promise<number> {
  const { data, info } = await base(imagen)
    .grayscale()
    .normalize()
    .resize({ width: 500, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  let suma = 0;
  for (const v of data) suma += v;
  const umbral = suma / data.length - 25;
  let oscuros = 0;
  for (const v of data) if (v < umbral) oscuros++;
  const invertir = oscuros > data.length / 2; // fondo oscuro: el texto es lo claro
  const puntos: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const oscuro = (data[y * w + x] ?? 255) < umbral;
      if (oscuro !== invertir) puntos.push(x, y);
    }
  }
  if (puntos.length < 200) return 0;

  const puntaje = (grados: number): number => {
    const rad = (grados * Math.PI) / 180;
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    const filas = new Float64Array(h + w + 2);
    const desfase = w;
    for (let i = 0; i < puntos.length; i += 2) {
      const x = puntos[i] ?? 0;
      const y = puntos[i + 1] ?? 0;
      const yr = Math.round(y * c - x * s) + desfase;
      filas[yr] = (filas[yr] ?? 0) + 1;
    }
    let sq = 0;
    for (const f of filas) sq += f * f;
    return sq;
  };

  let mejor = 0;
  let mejorPuntaje = puntaje(0);
  for (let g = -10; g <= 10; g += 1) {
    const p = puntaje(g);
    if (p > mejorPuntaje) [mejor, mejorPuntaje] = [g, p];
  }
  const centro = mejor;
  for (let g = centro - 0.75; g <= centro + 0.75; g += 0.25) {
    const p = puntaje(g);
    if (p > mejorPuntaje) [mejor, mejorPuntaje] = [g, p];
  }
  return Math.abs(mejor) < 0.5 ? 0 : mejor;
}

export async function preprocesar(imagen: Buffer, ancho: number, modo: Modo = "normal"): Promise<Buffer> {
  switch (modo) {
    case "normal":
      return base(imagen).grayscale().normalize().resize({ width: ancho }).sharpen().png().toBuffer();

    case "realzado":
      // Fotos quemadas/sobreexpuestas: estira solo el rango útil y refuerza bordes
      return base(imagen)
        .grayscale()
        .normalize({ lower: 15, upper: 99 })
        .clahe({ width: 32, height: 32, maxSlope: 5 })
        .resize({ width: ancho })
        .sharpen({ sigma: 1.5 })
        .png()
        .toBuffer();

    case "clahe":
      return base(imagen)
        .grayscale()
        .clahe({ width: 48, height: 48, maxSlope: 3 })
        .normalize()
        .resize({ width: ancho })
        .sharpen()
        .png()
        .toBuffer();

    case "recortado": {
      // Quita márgenes/bordes uniformes (capturas con fondo, fotos de pantalla con marco)
      const sinBordes = await base(imagen).trim({ threshold: 25 }).toBuffer().catch(() => imagen);
      return sharp(sinBordes)
        .grayscale()
        .clahe({ width: 48, height: 48, maxSlope: 3 })
        .normalize()
        .resize({ width: ancho })
        .sharpen()
        .png()
        .toBuffer();
    }

    case "binario":
      return base(imagen)
        .grayscale()
        .clahe({ width: 48, height: 48, maxSlope: 4 })
        .normalize()
        .resize({ width: ancho })
        .median(1)
        .threshold(135)
        .png()
        .toBuffer();

    case "invertido":
      return base(imagen).grayscale().normalize().negate().resize({ width: ancho }).sharpen().png().toBuffer();

    case "enderezado": {
      const grados = await estimarInclinacion(imagen);
      const { data } = await base(imagen).grayscale().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      const fondo = data[0] ?? 255;
      const girada = grados === 0
        ? await base(imagen).toBuffer()
        : await base(imagen).rotate(-grados, { background: { r: fondo, g: fondo, b: fondo } }).toBuffer();
      return sharp(girada)
        .grayscale()
        .clahe({ width: 48, height: 48, maxSlope: 3 })
        .normalize()
        .resize({ width: ancho })
        .sharpen()
        .png()
        .toBuffer();
    }
  }
}
