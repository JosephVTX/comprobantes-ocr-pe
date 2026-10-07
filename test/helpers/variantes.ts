import sharp from "sharp";

/** Degrada una captura como lo harían fotos o reenvíos reales (WhatsApp, pantallas, mala luz). */
export const VARIANTES: Record<string, (img: Buffer) => Promise<Buffer>> = {
  original: async (b) => b,
  baja_resolucion: (b) => sharp(b).resize({ width: 560 }).jpeg({ quality: 80 }).toBuffer(),
  jpeg_comprimido: (b) => sharp(b).jpeg({ quality: 20 }).toBuffer(),
  desenfoque: (b) => sharp(b).blur(1.4).toBuffer(),
  oscuro: (b) => sharp(b).modulate({ brightness: 0.55 }).linear(0.8, 0).toBuffer(),
  sobreexpuesto: (b) => sharp(b).modulate({ brightness: 1.5 }).linear(0.7, 60).toBuffer(),
  inclinado: (b) => sharp(b).rotate(4, { background: "#ffffff" }).toBuffer(),
  con_margenes: async (b) => {
    const { width = 800 } = await sharp(b).metadata();
    const m = Math.round(width * 0.15);
    return sharp(b).extend({ top: m, bottom: m, left: m, right: m, background: "#222222" }).toBuffer();
  },
  ruido: async (b) => {
    const { data, info } = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 60;
    for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + rnd()));
    return sharp(data, { raw: info }).jpeg({ quality: 70 }).toBuffer();
  },
  modo_oscuro: (b) => sharp(b).negate({ alpha: false }).toBuffer(),
};
