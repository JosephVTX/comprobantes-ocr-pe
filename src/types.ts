export type Fuente = "llm";

export interface CamposDetectados {
  monto: boolean;
  codigo_operacion: boolean;
  codigo_seguridad: boolean;
  entidad: boolean;
  fecha: boolean;
  hora: boolean;
  receptor: boolean;
  numero_cuenta_o_celular: boolean;
}

export interface ComprobanteValido {
  es_comprobante_pago: true;
  metodo_pago: string;
  entidad: string;
  banco_o_billetera: string;
  tipo: string;
  monto: number;
  moneda: string;
  codigo_operacion: string | null;
  codigo_seguridad: string | null;
  fecha: string | null;
  hora: string | null;
  pagador: string | null;
  receptor: string | null;
  numero_cuenta_o_celular: string | null;
  concepto: string | null;
  puntaje: number;
  texto_detectado: string;
  confianza: number;
  campos_detectados: CamposDetectados;
}

export interface NoComprobante {
  es_comprobante_pago: false;
  motivo: string;
  puntaje: number;
  texto_detectado: string;
}

export type Resultado = ComprobanteValido | NoComprobante;

/** Resultado final del analizador, con la fuente que lo produjo. */
export type Analisis = Resultado & {
  fuente: Fuente;
};
