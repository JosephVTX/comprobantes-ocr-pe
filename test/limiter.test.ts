import { describe, expect, it } from "vitest";
import { Limiter, QueueFullError } from "../src/limiter.js";

const pausa = () => new Promise<void>((r) => setTimeout(r, 5));

describe("Limiter", () => {
  it("nunca supera la concurrencia", async () => {
    const l = new Limiter(2, 100);
    let activos = 0;
    let maximo = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        l.run(async () => {
          activos++;
          maximo = Math.max(maximo, activos);
          await pausa();
          activos--;
        }),
      ),
    );
    expect(maximo).toBe(2);
    expect(l.enCurso).toBe(0);
    expect(l.enCola).toBe(0);
  });

  it("rechaza con QueueFullError cuando la cola está llena", async () => {
    const l = new Limiter(1, 1);
    let liberar!: () => void;
    const bloqueada = l.run(() => new Promise<void>((r) => (liberar = r)));
    const enEspera = l.run(async () => "ok");
    await expect(l.run(async () => "x")).rejects.toBeInstanceOf(QueueFullError);
    liberar();
    await bloqueada;
    await expect(enEspera).resolves.toBe("ok");
  });

  it("libera el cupo aunque la tarea falle", async () => {
    const l = new Limiter(1, 0);
    await expect(l.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(l.run(async () => "sigue")).resolves.toBe("sigue");
  });
});
