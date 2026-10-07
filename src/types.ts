export interface Receipt {
  is_receipt: boolean;
  method?: string | null;
  amount?: number;
  currency?: string;
  /** Operation / transaction number */
  operation?: string | null;
  /** Yape security code */
  security_code?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
  /** HH:mm (24h) */
  time?: string | null;
  receiver?: string | null;
}

export interface Analisis {
  receipt: Receipt;
  /** Modelo que respondió */
  model: string;
}
