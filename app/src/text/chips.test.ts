import { describe, expect, it } from "vitest";

import { arrow, chipAround, chipAt, chipBefore, deletion, openChip, withChip } from "./chips";

const TEXT = "Hola {{nombre}}, van {{total}} euros";

describe("encontrar fichas", () => {
  it("una ficha empieza en `{{` y acaba en `}}`", () => {
    expect(chipAt(TEXT, 5)).toEqual({ name: "nombre", from: 5, to: 15 });
    expect(chipAt(TEXT, 6)).toBeNull();
    expect(chipAt("{{}}", 0)).toBeNull();
    expect(chipAt("{{con espacio}}", 0)).toBeNull();
    expect(chipAt("{nombre}", 0)).toBeNull();
  });

  it("y se encuentra también desde su final", () => {
    expect(chipBefore(TEXT, 15)).toEqual({ name: "nombre", from: 5, to: 15 });
    expect(chipBefore(TEXT, 14)).toBeNull();
    expect(chipBefore("}}", 2)).toBeNull();
  });

  it("una posición de dentro cae en su ficha", () => {
    expect(chipAround(TEXT, 8)?.name).toBe("nombre");
    // Los extremos no están dentro: ahí el cursor sí puede estar.
    expect(chipAround(TEXT, 5)).toBeNull();
    expect(chipAround(TEXT, 15)).toBeNull();
    expect(chipAround(TEXT, 3)).toBeNull();
  });
});

describe("escribir una ficha", () => {
  /** El criterio de la tarea: se inserta escribiendo `{{`. */
  it("un `{{` recién abierto dice lo que se lleva escrito", () => {
    expect(openChip("Hola {{", 7)).toEqual({ prefix: "", from: 5 });
    expect(openChip("Hola {{nom", 10)).toEqual({ prefix: "nom", from: 5 });
    // Con la ficha ya cerrada, no hay nada abierto.
    expect(openChip(TEXT, 15)).toBeNull();
    expect(openChip("Hola", 4)).toBeNull();
    // Un nombre imposible cierra la lista.
    expect(openChip("Hola {{con espacio", 18)).toBeNull();
  });

  it("poner una ficha deja el cursor detrás", () => {
    expect(withChip("Hola {{", 5, 7, "nombre")).toEqual({
      text: "Hola {{nombre}}",
      at: 15,
    });
    expect(withChip("Hola ", 5, 5, "total")).toEqual({
      text: "Hola {{total}}",
      at: 14,
    });
  });
});

describe("borrar y moverse", () => {
  /** El criterio de la tarea: la ficha se borra de una pieza. */
  it("retroceso detrás de una ficha se la lleva entera", () => {
    expect(deletion(TEXT, 15, 15, "backward")).toEqual({ from: 5, to: 15 });
    // Y suprimir delante de ella, también.
    expect(deletion(TEXT, 5, 5, "forward")).toEqual({ from: 5, to: 15 });
    // Donde no hay ficha, borra el campo como siempre.
    expect(deletion(TEXT, 4, 4, "backward")).toBeNull();
    // Con algo seleccionado manda la selección.
    expect(deletion(TEXT, 5, 15, "backward")).toBeNull();
  });

  /** El criterio de la tarea: el cursor no se mete dentro. */
  it("las flechas saltan la ficha entera", () => {
    expect(arrow(TEXT, 15, -1)).toBe(5);
    expect(arrow(TEXT, 5, 1)).toBe(15);
    // Fuera de una ficha, que se mueva el campo.
    expect(arrow(TEXT, 3, 1)).toBeNull();
    expect(arrow(TEXT, 20, -1)).toBeNull();
  });

  it("si el cursor acaba dentro, sale por el lado al que va", () => {
    expect(arrow(TEXT, 8, -1)).toBe(5);
    expect(arrow(TEXT, 8, 1)).toBe(15);
  });
});
