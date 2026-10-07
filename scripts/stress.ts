import { readFileSync } from "node:fs";
import { createAnalyzer } from "../src/analyzer.js";
import { createTesseractEngine } from "../src/ocr/engine.js";
import { VARIANTES } from "../test/helpers/variantes.js";

const ESPERADO: Record<string, { monto: number; op: string; seg?: string }> = {
  "comprobant2e.jpg": { monto: 25, op: "26101992", seg: "992" },
  "comprobante2.jpg": { monto: 14, op: "27034291", seg: "291" },
  "comprobante.jpg": { monto: 250, op: "00051136547657787543" },
  "comprobante22.jpg": { monto: 340, op: "00778966" },
  "comprobantsse.jpg": { monto: 29.9, op: "02227848" },
};

const ocr = await createTesseractEngine({ workers: 2 });
const analyzer = createAnalyzer({ ocr, anchos: [1000, 1400, 1800], llmMinScore: 5 });
let ok = 0;
let total = 0;
for (const [f, e] of Object.entries(ESPERADO)) {
  const base = readFileSync(`test/fixtures/${f}`);
  for (const [nombre, fn] of Object.entries(VARIANTES)) {
    const t = Date.now();
    const r = await analyzer.analizar(await fn(base));
    const esComp = r.es_comprobante_pago;
    const bien = esComp && r.monto === e.monto && r.codigo_operacion === e.op && (!e.seg || r.codigo_seguridad === e.seg);
    total++;
    if (bien) ok++;
    else console.log(`FALLA ${f} / ${nombre}: comp=${esComp} monto=${esComp ? r.monto : "-"} op=${esComp ? r.codigo_operacion : "-"} seg=${esComp ? r.codigo_seguridad : "-"}`);
    if (process.env.V) console.log(`${bien ? "ok   " : "FAIL "}${f} ${nombre} ${Date.now() - t}ms`);
  }
}
console.log(`\n${ok}/${total}`);
await ocr.close();
