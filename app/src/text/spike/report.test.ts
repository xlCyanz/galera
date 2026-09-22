import { describe, expect, it } from "vitest";

import { CHECKS, type Entry, type CheckResult, markdown, quote } from "./report";

const session = { agent: "Safari/605.1.15", date: "2026-09-21" };

const entry = (at: number, type: string, inputType: string | null, data: string | null): Entry => ({
  id: at,
  at,
  type,
  inputType,
  data,
  composing: false,
  outcome: inputType === null ? "nota" : "aplicado",
});

const ok = (model: string): CheckResult => ({ verdict: "ok", model, mirror: model, events: [] });

describe("el informe de la sesión a mano", () => {
  it("sale con los ocho casos, y los que no se probaron quedan pendientes", () => {
    const report = markdown({}, session);

    for (const check of CHECKS) {
      expect(report).toContain(check.title);
    }
    expect(report.match(/pendiente/gu)).toHaveLength(CHECKS.length);
    expect(report).toContain("Casos probados: 0 de 8");
    expect(report).toContain("2026-09-21");
    expect(report).toContain("Safari/605.1.15");
    // Sin fallos no hay sección de fallos.
    expect(report).not.toContain("Lo que falló");
  });

  it("un caso que funciona deja el texto que había en el modelo y en el espejo", () => {
    const report = markdown({ "teclado-espanol": ok("café") }, session);

    expect(report).toContain("| funciona | «café» | «café» |");
    expect(report).toContain("Casos probados: 1 de 8");
  });

  /** Lo que de verdad hace falta al cerrar la issue: qué se separó y con
   * qué eventos. */
  it("un caso que falla se marca y arrastra sus eventos", () => {
    const events = [
      entry(120, "keydown", null, "Dead"),
      entry(180, "beforeinput", "insertText", "´"),
    ];
    const report = markdown(
      {
        emojis: { verdict: "fail", model: "hola", mirror: "hola🙂", events },
        "teclado-espanol": ok("café"),
      },
      session,
    );

    expect(report).toContain("| **falla** | «hola» | «hola🙂» |");
    expect(report).toContain("## Lo que falló");
    expect(report).toContain("### Emojis desde el panel del sistema");
    expect(report).toContain("| 180 | beforeinput | insertText | «´» | aplicado |");
    // El que funciona no repite sus eventos abajo.
    expect(report).not.toContain("### Teclado español");
  });

  it("los saltos de línea se ven, que si no la tabla se rompe", () => {
    expect(quote("dos\nlíneas")).toBe("«dos⏎líneas»");
    const report = markdown({ pegar: ok("dos\nlíneas") }, session);
    expect(report.split("\n").filter((line) => line.startsWith("| Pegar"))).toHaveLength(1);
  });
});
