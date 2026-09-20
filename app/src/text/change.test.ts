import { describe, expect, it } from "vitest";

import { change, count, textOf } from "./change";

/** La espiga con mujer: cuatro puntos de código, siete unidades UTF-16. */
const FARMER = "👩‍🌾";
/** Una `é` escrita como `e` más tilde combinante. */
const COMBINED = "é";

describe("qué ha cambiado en el texto", () => {
  it("el texto de un bloque son sus tramos seguidos", () => {
    expect(
      textOf([
        { text: "Hola ", bold: false, italic: false, underline: false },
        { text: "mundo", bold: true, italic: false, underline: false },
      ]),
    ).toBe("Hola mundo");
  });

  it("sin cambios no hay nada que mandar", () => {
    expect(change("Hola", "Hola")).toBeNull();
  });

  it("escribir al final es meter texto ahí", () => {
    expect(change("Hola", "Hola!")).toEqual({ from: 4, to: 4, text: "!" });
  });

  it("escribir en medio también", () => {
    expect(change("Hola mundo", "Hola buen mundo")).toEqual({ from: 5, to: 5, text: "buen " });
  });

  it("borrar es un trozo sin texto nuevo", () => {
    expect(change("Hola!", "Hola")).toEqual({ from: 4, to: 5, text: "" });
    expect(change("Hola mundo", "Hola")).toEqual({ from: 4, to: 10, text: "" });
  });

  it("cambiar lo seleccionado quita y escribe a la vez", () => {
    expect(change("Hola mundo", "Hola tú")).toEqual({ from: 5, to: 10, text: "tú" });
  });

  it("las posiciones se cuentan en caracteres, no en unidades", () => {
    // El emoji ocupa siete unidades y un solo carácter.
    expect(change(`Hola ${FARMER}`, `Hola ${FARMER}!`)).toEqual({ from: 6, to: 6, text: "!" });
    expect(count(`Hola ${FARMER}`, `Hola ${FARMER}`.length)).toBe(6);
  });

  it("un emoji se borra entero, nunca por la mitad", () => {
    expect(change(`Hola ${FARMER}`, "Hola ")).toEqual({ from: 5, to: 6, text: "" });
  });

  it("escribir justo detrás de un emoji no lo parte", () => {
    // Sin llevar el corte al límite del carácter, el principio común
    // acabaría dentro del emoji.
    const before = `a${FARMER}`;
    const after = `a${FARMER}${FARMER}`;
    expect(change(before, after)).toEqual({ from: 2, to: 2, text: FARMER });
  });

  it("una letra con tilde combinante es un carácter", () => {
    expect(change(`caf${COMBINED}`, "caf")).toEqual({ from: 3, to: 4, text: "" });
    expect(count(`caf${COMBINED}`, 5)).toBe(4);
  });

  it("cambiar dentro de un carácter compuesto lo cambia entero", () => {
    // Quitar solo la tilde combinante: el comando toca la letra entera.
    expect(change(`caf${COMBINED}`, "cafe")).toEqual({ from: 3, to: 4, text: "e" });
  });
});
