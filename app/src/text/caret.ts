/**
 * Dónde va el cursor dentro de un bloque de texto.
 *
 * Las posiciones salen de los glifos que devuelve el núcleo
 * (`layout::glyphs`), que son los de la composición de Typst: el cursor no
 * se estima aquí ni se mide el texto en la interfaz (principio 3). Este
 * módulo solo elige **qué glifo** corresponde a la posición del cursor y a
 * qué lado de él se pinta.
 *
 * # Dos formas de contar
 *
 * El campo invisible cuenta en unidades de JavaScript (UTF-16) y el núcleo
 * en bytes UTF-8. La traducción está aquí ([`byteIndex`] y [`textIndex`]) y
 * no sale de este módulo.
 *
 * # Líneas partidas
 *
 * Cuando Typst parte una línea, el espacio donde la partió no se dibuja: no
 * hay ningún glifo para él. El cursor puesto ahí no encuentra glifo exacto,
 * así que se pinta **al final de la línea anterior**, que es donde se está
 * escribiendo.
 */
import type { Glyph } from "../types/layout";

/** Dónde se pinta el cursor, en milímetros de la página y sin girar. */
export interface Caret {
  /** Su vertical. */
  x: number;
  /** El borde de arriba. */
  y: number;
  /** Lo que mide de alto: el de la línea en la que está. */
  height: number;
  /** En qué línea de las que decidió Typst está. */
  line: number;
  /**
   * En qué página cayó. De un texto normal es la suya; de un flujo, la de
   * la zona donde quedó esa parte del texto.
   */
  page: number;
}

const encoder = new TextEncoder();

/** El byte del texto en el que empieza la posición `at`, contada en
 * unidades de JavaScript. */
export function byteIndex(text: string, at: number): number {
  return encoder.encode(text.slice(0, at)).length;
}

/** Lo contrario: la posición en unidades de JavaScript del byte `byte`. */
export function textIndex(text: string, byte: number): number {
  if (byte <= 0) {
    return 0;
  }
  let bytes = 0;
  for (let at = 0; at < text.length; at += 1) {
    // Un par subrogado (un emoji) son dos unidades y un solo carácter.
    const code = text.codePointAt(at) ?? 0;
    const size = code > 0xffff ? 2 : 1;
    const length = encoder.encode(text.slice(at, at + size)).length;
    // Un byte de en medio de un carácter cae en su principio: el cursor no
    // se mete dentro de una letra.
    if (byte < bytes + length) {
      return at;
    }
    bytes += length;
    if (size === 2) {
      at += 1;
    }
  }
  return text.length;
}

/**
 * Dónde va el cursor puesto en el byte `byte`, o `null` si el texto no
 * dibuja nada (está vacío, o todavía no se ha compilado).
 */
export function caretAt(glyphs: readonly Glyph[], byte: number): Caret | null {
  if (glyphs.length === 0) {
    return null;
  }
  // Delante de un glifo: en su borde izquierdo.
  const exact = glyphs.find((glyph) => glyph.text_index === byte);
  if (exact !== undefined) {
    return {
      x: exact.x,
      y: exact.y,
      height: exact.line_height,
      line: exact.line,
      page: exact.page,
    };
  }

  // Si no, detrás del último que empieza antes: el final de una línea
  // partida, o el final del texto.
  let previous: Glyph | null = null;
  for (const glyph of glyphs) {
    if (glyph.text_index < byte) {
      previous = glyph;
    }
  }
  if (previous === null) {
    const first = glyphs[0]!;
    return {
      x: first.x,
      y: first.y,
      height: first.line_height,
      line: first.line,
      page: first.page,
    };
  }
  return {
    x: previous.x + previous.width,
    y: previous.y,
    height: previous.line_height,
    line: previous.line,
    page: previous.page,
  };
}

/** A dónde lleva subir o bajar una línea. */
export interface LineMove {
  /** El byte al que va el cursor. */
  byte: number;
  /** La columna que se quiere conservar, para el siguiente salto. */
  x: number;
}

/**
 * El byte al que lleva subir (`-1`) o bajar (`1`) una línea desde `byte`,
 * conservando la columna `desired` si se da.
 *
 * `text` es el texto entero del bloque, para saber dónde acaba cada línea.
 * Devuelve `null` si no hay línea a la que ir.
 */
export function lineMove(
  glyphs: readonly Glyph[],
  byte: number,
  direction: -1 | 1,
  desired: number | null,
  text: string,
): LineMove | null {
  const from = caretAt(glyphs, byte);
  if (from === null) {
    return null;
  }
  const x = desired ?? from.x;
  const line = from.line + direction;
  const target = glyphs.filter((glyph) => glyph.line === line);
  if (target.length === 0) {
    return null;
  }

  // El glifo de esa línea en cuya mitad izquierda cae la columna: el cursor
  // va delante de él. Si la columna pasa del final, al final de la línea.
  const found = target.find((glyph) => x < glyph.x + glyph.width / 2);
  if (found !== undefined) {
    return { byte: found.text_index, x };
  }
  return { byte: lineEnd(glyphs, line, text), x };
}

/**
 * El byte en el que acaba una línea: detrás de su último carácter dibujado.
 *
 * No es donde empieza la línea siguiente: entre las dos puede haber un
 * espacio que Typst no dibujó al partir, y el cursor puesto ahí saldría al
 * principio de la línea de abajo en vez de al final de esta.
 */
export function lineEnd(glyphs: readonly Glyph[], line: number, text: string): number {
  const last = glyphs.filter((glyph) => glyph.line === line).at(-1);
  if (last === undefined) {
    return byteIndex(text, text.length);
  }
  const at = textIndex(text, last.text_index);
  const size = (text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
  return byteIndex(text, Math.min(at + size, text.length));
}
