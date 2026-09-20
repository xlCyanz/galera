/**
 * Qué ha cambiado en el texto de un bloque, en caracteres.
 *
 * El campo invisible (`HiddenInput.tsx`) trabaja con el texto entero; el
 * núcleo trabaja con comandos —escribir aquí, borrar este trozo— y cuenta
 * las posiciones en **caracteres**, no en unidades de JavaScript
 * (ver `model/text.rs`). Este módulo hace la traducción: compara lo que el
 * documento tiene con lo que el campo enseña y dice qué comando mandar.
 *
 * # Por qué no basta con comparar unidades
 *
 * Un emoji ocupa dos unidades UTF-16, y algunos —una bandera, una familia—
 * bastantes más. Comparar el principio y el final en unidades puede dejar
 * el corte en mitad de un carácter, y el comando borraría medio emoji. Por
 * eso el corte se lleva siempre al límite del carácter que lo contiene,
 * con `Intl.Segmenter`, que es lo mismo que hace el núcleo con los
 * clústeres de grafemas.
 */
import type { Run } from "../types/model";

/** El texto de un bloque: sus tramos, uno detrás de otro. */
export function textOf(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join("");
}

/** El trozo que cambia, con las posiciones ya en caracteres. */
export interface Change {
  /** Dónde empieza lo que se quita, en caracteres. */
  from: number;
  /** Dónde acaba, sin incluirlo. Si es igual a `from`, no se quita nada. */
  to: number;
  /** Lo que se escribe en su lugar. Vacío si solo se borra. */
  text: string;
}

/**
 * Qué hay que hacerle a `before` para que diga `after`, o `null` si ya lo
 * dice.
 */
export function change(before: string, after: string): Change | null {
  if (before === after) {
    return null;
  }

  // El trozo que cambia: lo que hay entre el principio y el final comunes.
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  let end = before.length - tail;

  // Los dos extremos, al límite del carácter que los contiene.
  const bounds = boundaries(before);
  start = startOfCharacter(bounds, start);
  end = endOfCharacter(bounds, end);

  return {
    from: count(before, start),
    to: count(before, end),
    text: after.slice(start, after.length - (before.length - end)),
  };
}

/** Cuántos caracteres hay en `text` antes de la posición `at`, contada en
 * unidades de JavaScript. */
export function count(text: string, at: number): number {
  let characters = 0;
  for (const boundary of boundaries(text)) {
    if (boundary >= at) {
      break;
    }
    characters += 1;
  }
  return characters;
}

/** Dónde empieza cada carácter de `text`, y el final del texto, en
 * unidades de JavaScript. */
function boundaries(text: string): number[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...[...segmenter.segment(text)].map((segment) => segment.index), text.length];
}

/** El límite de carácter que hay en `at` o el anterior. */
function startOfCharacter(bounds: readonly number[], at: number): number {
  let found = 0;
  for (const boundary of bounds) {
    if (boundary > at) {
      break;
    }
    found = boundary;
  }
  return found;
}

/** El límite de carácter que hay en `at` o el siguiente. */
function endOfCharacter(bounds: readonly number[], at: number): number {
  for (const boundary of bounds) {
    if (boundary >= at) {
      return boundary;
    }
  }
  return at;
}
