import sharp from "sharp";
import { createScheduler, createWorker, OEM, PSM, type Worker } from "tesseract.js";

export interface LecturaOcr {
  texto: string;
  /** 0-100 */
  confianza: number;
}

/** Motor OCR intercambiable (en los tests se reemplaza por uno falso). */
export interface OcrEngine {
  leer(imagen: Buffer, ancho: number): Promise<LecturaOcr>;
  /** Lee solo los dígitos a la derecha de la etiqueta "CÓDIGO DE SEGURIDAD" (Yape). */
  leerCodigo?(imagen: Buffer, ancho: number): Promise<string | null>;
  close(): Promise<void>;
}

function preprocesar(imagen: Buffer, ancho: number): Promise<Buffer> {
  return sharp(imagen, { sequentialRead: true })
    .rotate()
    .grayscale()
    .normalize()
    .resize({ width: ancho })
    .sharpen()
    .png()
    .toBuffer();
}

export interface TesseractOptions {
  workers: number;
  /** Carpeta con spa.traineddata.gz (sin red). Si no se da, se descarga y cachea. */
  tessdataDir?: string | undefined;
}

export async function createTesseractEngine({ workers, tessdataDir }: TesseractOptions): Promise<OcrEngine> {
  const scheduler = createScheduler();
  const lista = await Promise.all(
    Array.from({ length: workers }, async () => {
      const w = await createWorker("spa", OEM.LSTM_ONLY, tessdataDir ? { langPath: tessdataDir } : {});
      // PSM 3 (auto): con el modo por defecto se pierde el monto grande
      await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      scheduler.addWorker(w);
      return w;
    }),
  );

  // Worker aparte (solo dígitos, una línea); se crea la primera vez que hace falta
  let digitos: Promise<Worker> | undefined;
  const workerDigitos = () =>
    (digitos ??= createWorker("spa", OEM.LSTM_ONLY, tessdataDir ? { langPath: tessdataDir } : {}).then(async (w) => {
      await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: "0123456789" });
      return w;
    }));

  return {
    async leerCodigo(imagen, ancho) {
      const pre = await preprocesar(imagen, ancho);
      const { data } = await scheduler.addJob("recognize", pre, {}, { blocks: true });
      const palabras = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
      const etiqueta = palabras.find((p) => /seguridad/i.test(p.text));
      if (!etiqueta) return null;
      const { width = 0 } = await sharp(pre).metadata();
      const { x1, y0, y1 } = etiqueta.bbox;
      const pad = 10;
      const left = x1 + 5;
      if (width - left < 20) return null;
      const recorte = await sharp(pre)
        .extract({ left, top: Math.max(0, y0 - pad), width: width - left, height: y1 - y0 + 2 * pad })
        .resize({ height: 120 })
        .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#fff" })
        .png()
        .toBuffer();
      const lectura = await (await workerDigitos()).recognize(recorte);
      const codigo = lectura.data.text.replace(/\D/g, "");
      return codigo.length >= 3 && codigo.length <= 6 ? codigo : null;
    },
    async leer(imagen, ancho) {
      const { data } = await scheduler.addJob("recognize", await preprocesar(imagen, ancho));
      return { texto: data.text, confianza: data.confidence };
    },
    async close() {
      await scheduler.terminate();
      await (await digitos)?.terminate();
      await Promise.all(lista.map((w) => w.terminate()));
    },
  };
}
