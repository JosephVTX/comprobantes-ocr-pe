import sharp from "sharp";
import { preprocesar, type Modo } from "./preproceso.js";
import { createScheduler, createWorker, OEM, PSM, type Worker } from "tesseract.js";

export interface LecturaOcr {
  texto: string;
  /** 0-100 */
  confianza: number;
}

/** Motor OCR intercambiable (en los tests se reemplaza por uno falso). */
export interface OcrEngine {
  leer(imagen: Buffer, ancho: number, modo?: Modo): Promise<LecturaOcr>;
  /** Lee solo los dígitos a la derecha de la etiqueta "CÓDIGO DE SEGURIDAD" (Yape). */
  leerCodigo?(imagen: Buffer, ancho: number): Promise<string | null>;
  close(): Promise<void>;
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
      const votos = new Map<string, number>();
      const registrar = (txt: string, conf: number) => {
        const d = txt.replace(/\D/g, "");
        if (d.length !== 3) return; // los códigos de Yape son de 3 dígitos
        votos.set(d, (votos.get(d) ?? 0) + (conf >= 80 ? 2 : 1));
      };
      const lector = await workerDigitos();

      for (const modo of ["normal", "enderezado", "invertido", "realzado", "clahe"] as const) {
        const pre = await preprocesar(imagen, ancho, modo);
        const { data } = await scheduler.addJob("recognize", pre, {}, { blocks: true });
        const palabras = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
        const etiqueta = palabras.find((p) => /segur/i.test(p.text));
        if (!etiqueta) continue;
        const { width = 0 } = await sharp(pre).metadata();
        const { x1, y0, y1 } = etiqueta.bbox;
        const left = x1 + 5;
        if (width - left < 20) continue;

        for (const pad of [10, 18]) {
          const region = await sharp(pre)
            .extract({ left, top: Math.max(0, y0 - pad), width: width - left, height: y1 - y0 + 2 * pad })
            .resize({ height: 120 })
            .toBuffer();
          const variantes = [
            region,
            await sharp(region).threshold(150).toBuffer(),
            await sharp(region).negate().toBuffer(),
            await sharp(region).clahe({ width: 16, height: 16, maxSlope: 3 }).normalize().toBuffer(),
          ];
          for (const v of variantes) {
            const png = await sharp(v).extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#fff" }).png().toBuffer();
            const l = await lector.recognize(png);
            registrar(l.data.text, l.data.confidence);
          }
        }
        // con una etiqueta ubicada y lecturas coherentes no hace falta seguir
        const mejor = [...votos.entries()].sort((x, y) => y[1] - x[1])[0];
        if (mejor && mejor[1] >= 4) break;
      }

      const ordenados = [...votos.entries()].sort((x, y) => y[1] + (y[0].length === 3 ? 1 : 0) - (x[1] + (x[0].length === 3 ? 1 : 0)));
      const top = ordenados[0];
      return top && top[1] >= 3 ? top[0] : null;
    },
    async leer(imagen, ancho, modo = "normal") {
      const { data } = await scheduler.addJob("recognize", await preprocesar(imagen, ancho, modo));
      return { texto: data.text, confianza: data.confidence };
    },
    async close() {
      await scheduler.terminate();
      await (await digitos)?.terminate();
      await Promise.all(lista.map((w) => w.terminate()));
    },
  };
}
