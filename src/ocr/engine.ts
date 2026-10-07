import sharp from "sharp";
import { createScheduler, createWorker, OEM, PSM } from "tesseract.js";

export interface LecturaOcr {
  texto: string;
  /** 0-100 */
  confianza: number;
}

/** Motor OCR intercambiable (en los tests se reemplaza por uno falso). */
export interface OcrEngine {
  leer(imagen: Buffer, ancho: number): Promise<LecturaOcr>;
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

  return {
    async leer(imagen, ancho) {
      const { data } = await scheduler.addJob("recognize", await preprocesar(imagen, ancho));
      return { texto: data.text, confianza: data.confidence };
    },
    async close() {
      await scheduler.terminate();
      await Promise.all(lista.map((w) => w.terminate()));
    },
  };
}
