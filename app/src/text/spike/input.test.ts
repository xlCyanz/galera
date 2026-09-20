import { describe, expect, it } from "vitest";

import { type Composition, type Field, apply } from "./input";

const field = (text: string, start = text.length, end = start): Field => ({ text, start, end });

/** Aplica una tanda de eventos seguidos, como los manda el navegador. */
function run(
  start: Field,
  signals: Array<{ inputType: string; data?: string | null }>,
  composition: Composition = null,
) {
  let state = { field: start, composition };
  for (const signal of signals) {
    const applied = apply(state.field, state.composition, {
      inputType: signal.inputType,
      data: signal.data ?? null,
    });
    expect(applied, `${signal.inputType} sin manejar`).not.toBeNull();
    state = applied!;
  }
  return state;
}

describe("entrada de texto", () => {
  it("escribir inserta donde está el cursor", () => {
    const { field: after } = run(field("Hola", 4), [
      { inputType: "insertText", data: " " },
      { inputType: "insertText", data: "mundo" },
    ]);
    expect(after).toEqual({ text: "Hola mundo", start: 10, end: 10 });
  });

  it("escribir con algo seleccionado lo cambia", () => {
    const { field: after } = run(field("Hola mundo", 5, 10), [{ inputType: "insertText", data: "tú" }]);
    expect(after).toEqual({ text: "Hola tú", start: 7, end: 7 });
  });

  it("una tecla muerta compone y acaba en un solo carácter", () => {
    // `´` + `a` en un teclado español: el navegador manda la composición
    // entera cada vez, y al final la da por buena.
    const first = run(field("caf", 3), [{ inputType: "insertCompositionText", data: "´" }]);
    expect(first.field.text).toBe("caf´");
    expect(first.composition).toEqual({ start: 3, end: 4 });

    const second = apply(first.field, first.composition, {
      inputType: "insertCompositionText",
      data: "é",
    })!;
    expect(second.field).toEqual({ text: "café", start: 4, end: 4 });

    const end = apply(second.field, second.composition, {
      inputType: "insertFromComposition",
      data: "é",
    })!;
    expect(end.field).toEqual({ text: "café", start: 4, end: 4 });
    expect(end.composition).toBeNull();
  });

  it("el japonés compone varias veces y sustituye lo que llevaba", () => {
    // にほん: kana mientras se escribe, kanji al elegir el candidato.
    let state = run(field("", 0), [
      { inputType: "insertCompositionText", data: "に" },
      { inputType: "insertCompositionText", data: "にほ" },
      { inputType: "insertCompositionText", data: "にほん" },
    ]);
    expect(state.field.text).toBe("にほん");

    state = apply(state.field, state.composition, {
      inputType: "insertFromComposition",
      data: "日本",
    })!;
    expect(state.field).toEqual({ text: "日本", start: 2, end: 2 });
    expect(state.composition).toBeNull();
  });

  it("pegar y dictar entran como texto", () => {
    const pasted = run(field("", 0), [{ inputType: "insertFromPaste", data: "Dos\nlíneas" }]);
    expect(pasted.field.text).toBe("Dos\nlíneas");

    const dictated = run(field("", 0), [
      { inputType: "insertReplacementText", data: "hola qué tal" },
    ]);
    expect(dictated.field.text).toBe("hola qué tal");
  });

  it("borrar hacia atrás quita un emoji entero", () => {
    const { field: after } = run(field("trigo 🌾"), [{ inputType: "deleteContentBackward" }]);
    expect(after).toEqual({ text: "trigo ", start: 6, end: 6 });
  });

  it("borrar una palabra se lleva también los espacios de antes", () => {
    const { field: after } = run(field("una frase larga "), [{ inputType: "deleteWordBackward" }]);
    expect(after.text).toBe("una frase ");
  });

  it("borrar hacia delante y borrar lo seleccionado", () => {
    expect(run(field("hola", 0), [{ inputType: "deleteContentForward" }]).field.text).toBe("ola");
    expect(run(field("hola", 1, 3), [{ inputType: "deleteByCut" }]).field).toEqual({
      text: "ha",
      start: 1,
      end: 1,
    });
  });

  it("un salto de línea es un salto de línea", () => {
    expect(run(field("uno"), [{ inputType: "insertLineBreak" }]).field.text).toBe("uno\n");
  });

  it("lo que no se conoce no se aplica: el spike lo tiene que enseñar", () => {
    expect(apply(field("hola"), null, { inputType: "formatBold", data: null })).toBeNull();
  });
});
