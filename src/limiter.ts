export class QueueFullError extends Error {
  constructor() {
    super("Servidor ocupado: cola llena, reintenta en unos segundos.");
    this.name = "QueueFullError";
  }
}

/** Limita tareas simultáneas y la cola de espera (rechaza en vez de acumular sin fin). */
export class Limiter {
  private activos = 0;
  private readonly espera: Array<() => void> = [];

  constructor(
    private readonly concurrencia: number,
    private readonly maxCola: number,
  ) {}

  get enCola(): number {
    return this.espera.length;
  }

  get enCurso(): number {
    return this.activos;
  }

  async run<T>(tarea: () => Promise<T>): Promise<T> {
    if (this.activos >= this.concurrencia) {
      if (this.espera.length >= this.maxCola) throw new QueueFullError();
      await new Promise<void>((resolver) => this.espera.push(resolver));
    } else {
      this.activos++;
    }
    try {
      return await tarea();
    } finally {
      const siguiente = this.espera.shift();
      if (siguiente) siguiente(); // el cupo pasa directo al siguiente
      else this.activos--;
    }
  }
}
