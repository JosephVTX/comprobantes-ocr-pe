import { describe, expect, it } from "vitest";
import { esCompleto, parsear } from "../src/ocr/parser.js";

const YAPE = `¡Yapeaste!
S/14
Erick San*
05 oct. 2026 | 06:37 p. m.
CÓDIGO DE SEGURIDAD
2 9 1
DATOS DE LA TRANSACCIÓN
Nro. de celular *** *** 294
Destino Yape
Nro. de operación 27034291`;

const PLIN = `Enviaste S/ 29.90
Gratis e inmediato
Contacto Plin: BAIRO JUNIOR CABALLERO
940278653
Fecha: 08 Abr 2022 03:36 PM
Código de operación: 02227848`;

const PLIN_COMERCIO = `Constancia
¡Pago exitoso!
S/250.00
Regresa a la ventana del comercio para finalizar tu compra
Comercio: Shopstar
Fecha y hora: 01 Mar 2022 10:34 AM
Código de Operación: 00051136547657787543`;

const BCP = `2BCP> TRANS.INTERBANCARIA.BM
5/ 340.00
Viernes 30 Junio 2023 - 12:49 pm.
Enviado a
Asociacion Peruana De Ciencias E.
Interbank - Soles
Total cobrado S/ 340.00
Desde
Cuenta Digital Soles
Número de operación 00778966`;

describe("parsear", () => {
  it("lee un Yape completo con código de seguridad", () => {
    const r = parsear(YAPE, 90);
    expect(r).toMatchObject({
      es_comprobante_pago: true,
      metodo_pago: "Yape",
      monto: 14,
      codigo_operacion: "27034291",
      codigo_seguridad: "291",
      fecha: "05 oct. 2026",
      hora: "06:37 p. m.",
      receptor: "Erick San*",
    });
    expect(esCompleto(r)).toBe(true);
  });

  it("lee un Plin con contacto, fecha abreviada y celular", () => {
    const r = parsear(PLIN, 90);
    expect(r).toMatchObject({
      es_comprobante_pago: true,
      metodo_pago: "Plin",
      monto: 29.9,
      codigo_operacion: "02227848",
      receptor: "BAIRO JUNIOR CABALLERO",
      numero_cuenta_o_celular: "940278653",
      fecha: "08 Abr 2022",
    });
  });

  it("reconoce Plin en una constancia de comercio aunque el logo no sea texto", () => {
    const r = parsear(PLIN_COMERCIO, 90);
    expect(r).toMatchObject({ es_comprobante_pago: true, metodo_pago: "Plin", monto: 250, receptor: "Shopstar" });
  });

  it("lee una transferencia BCP: entidad de origen, 5/ por S/ y mes completo", () => {
    const r = parsear(BCP, 90);
    expect(r).toMatchObject({
      es_comprobante_pago: true,
      entidad: "BCP",
      monto: 340,
      fecha: "30 Junio 2023",
      codigo_operacion: "00778966",
      receptor: "Asociacion Peruana De Ciencias E.",
    });
  });

  it("es incompleto si se lee la etiqueta de seguridad pero no los dígitos", () => {
    const r = parsear(YAPE.replace("2 9 1", ""), 90);
    expect(r.es_comprobante_pago).toBe(true);
    expect(esCompleto(r)).toBe(false);
  });

  it("rechaza texto sin monto ni operación", () => {
    const r = parsear("Lista de compras\nleche\npan\nhuevos", 90);
    expect(r).toMatchObject({ es_comprobante_pago: false, puntaje: 0 });
    expect(esCompleto(r)).toBe(false);
  });

  it("rechaza una boleta con monto pero sin datos de operación ni app", () => {
    const r = parsear("Tienda SAC\nTotal S/ 59.90\n12/03/2024", 90);
    expect(r.es_comprobante_pago).toBe(false);
  });

  it("no toma una fecha como monto (5/ sin dígito previo)", () => {
    const r = parsear("Pago 15/03/2024 sin monto", 90);
    expect(r.es_comprobante_pago).toBe(false);
  });
});
