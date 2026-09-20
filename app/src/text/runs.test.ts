import { describe, expect, it } from "vitest";

import type { Run } from "../types/model";
import { textOf, withText } from "./runs";

const run = (text: string, format: Partial<Omit<Run, "text">> = {}): Run => ({
  text,
  bold: false,
  italic: false,
  underline: false,
  ...format,
});

/** Los tramos como `texto` o `texto*` si van en negrita, para leerlos de un
 * vistazo. */
const shown = (runs: readonly Run[]) => runs.map((one) => one.text + (one.bold ? "*" : "")).join("|");

describe("el texto de un bloque", () => {
  it("es el de sus tramos, uno detrás de otro", () => {
    expect(textOf([run("Hola "), run("mundo", { bold: true })])).toBe("Hola mundo");
    expect(textOf([])).toBe("");
  });

  it("sin cambios devuelve los mismos tramos", () => {
    const runs = [run("Hola "), run("mundo", { bold: true })];
    expect(shown(withText(runs, "Hola mundo"))).toBe("Hola |mundo*");
  });

  it("escribir dentro de un tramo conserva su formato", () => {
    const runs = [run("Hola "), run("mundo", { bold: true })];
    expect(shown(withText(runs, "Hola mundillo"))).toBe("Hola |mundillo*");
    expect(shown(withText(runs, "Holaa mundo"))).toBe("Holaa |mundo*");
  });

  it("escribir al final sigue el formato del último tramo", () => {
    const runs = [run("Hola "), run("mundo", { bold: true })];
    expect(shown(withText(runs, "Hola mundo!"))).toBe("Hola |mundo!*");
  });

  it("borrar un tramo entero lo quita", () => {
    const runs = [run("Hola "), run("mundo", { bold: true }), run(" otra vez")];
    expect(shown(withText(runs, "Hola  otra vez"))).toBe("Hola | otra vez");
  });

  it("borrarlo todo deja un tramo vacío con el formato del primero", () => {
    const runs = [run("Hola", { bold: true })];
    const empty = withText(runs, "");
    expect(empty).toHaveLength(1);
    expect(empty[0]).toEqual({ text: "", bold: true, italic: false, underline: false });
  });

  it("un texto sin tramos empieza uno sin formato", () => {
    expect(withText([], "Hola")).toEqual([
      { text: "Hola", bold: false, italic: false, underline: false },
    ]);
  });

  it("un cambio que cruza varios tramos los deja como toca", () => {
    const runs = [run("uno "), run("dos", { bold: true }), run(" tres")];
    // Se cambia «dos» entero y parte de los vecinos: lo que sobrevive del
    // primero y del último se queda con su formato.
    expect(shown(withText(runs, "un CUATRO res"))).toBe("un CUATRO |res");
  });

  it("los saltos de línea son texto como cualquier otro", () => {
    const runs = [run("uno")];
    expect(shown(withText(runs, "uno\ndos"))).toBe("uno\ndos");
  });
});
