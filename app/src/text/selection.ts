/**
 * Del puntero al texto: qué se señala y qué se selecciona.
 *
 * Trabaja sobre los glifos que devuelve el núcleo (`layout::glyphs`), que
 * son los de la composición de Typst: aquí no se mide texto ni se adivinan
 * anchos (principio 3). Lo que hace este módulo es geometría sobre esas
 * cajas —qué glifo hay bajo el punto, qué rectángulos cubren un tramo—, del
 * mismo tipo que `canvas/transform.ts`, y se hace en la interfaz porque las
 * posiciones ya están aquí: arrastrar no puede ir y volver al backend en
 * cada movimiento del ratón.
 *
 * Las posiciones del texto van en bytes, como en el núcleo; las palabras y
 * los párrafos se cortan con `Intl.Segmenter`, que sabe de acentos, comillas
 * y escrituras sin espacios.
 */
import type { Glyph, LayoutBox, MmRect } from "../types/layout";
import { byteIndex, lineEnd, textIndex } from "./caret";

/** Un tramo del texto, en bytes. */
export interface Range {
  /** Dónde empieza. */
  start: number;
  /** Dónde acaba, sin incluirlo. */
  end: number;
}

/**
 * El punto, llevado a las coordenadas del elemento **sin girar**: los
 * glifos están ahí, igual que la caja que devuelve el layout.
 */
export function unrotate(box: LayoutBox, x: number, y: number): { x: number; y: number } {
  if (box.rotation === 0) {
    return { x, y };
  }
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  const radians = (-box.rotation * Math.PI) / 180;
  const dx = x - centerX;
  const dy = y - centerY;
  return {
    x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

/**
 * El byte del texto que se señala con el punto `(x, y)`, en mm de la página
 * y sin girar.
 *
 * Se elige la línea que contiene el punto —la primera si está por encima, la
 * última si está por debajo— y, dentro de ella, el lado del glifo más
 * cercano: pulsar en la mitad izquierda de una letra pone el cursor delante.
 */
export function indexAt(glyphs: readonly Glyph[], text: string, x: number, y: number): number {
  if (glyphs.length === 0) {
    return 0;
  }
  const lines = [...new Set(glyphs.map((glyph) => glyph.line))].sort((a, b) => a - b);
  const line =
    lines.find((candidate) => {
      const first = glyphs.find((glyph) => glyph.line === candidate);
      return first !== undefined && y < first.y + first.line_height;
    }) ?? lines[lines.length - 1]!;

  const inLine = glyphs.filter((glyph) => glyph.line === line);
  const found = inLine.find((glyph) => x < glyph.x + glyph.width / 2);
  return found?.text_index ?? lineEnd(glyphs, line, text);
}

/**
 * La palabra que contiene el byte `byte`, o el hueco entre dos palabras si
 * cae en uno. Es lo que selecciona un doble clic.
 */
export function wordAt(text: string, byte: number): Range {
  const at = textIndex(text, byte);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  for (const segment of segmenter.segment(text)) {
    const end = segment.index + segment.segment.length;
    if (at < end) {
      return { start: byteIndex(text, segment.index), end: byteIndex(text, end) };
    }
  }
  const whole = byteIndex(text, text.length);
  return { start: whole, end: whole };
}

/**
 * El párrafo que contiene el byte: hasta los saltos de línea de los lados,
 * sin incluirlos. Es lo que selecciona un triple clic.
 */
export function paragraphAt(text: string, byte: number): Range {
  const at = textIndex(text, byte);
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at);
  return {
    start: byteIndex(text, start),
    end: byteIndex(text, end === -1 ? text.length : end),
  };
}

/**
 * Los rectángulos que cubren el tramo `[start, end)`, uno por cada línea de
 * las que decidió Typst, en mm y sin girar.
 *
 * Cubren los glifos, no el marco: lo que Typst no dibujó —el espacio por el
 * que partió una línea— no se pinta como seleccionado.
 */
export function selectionRects(glyphs: readonly Glyph[], start: number, end: number): MmRect[] {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const inside = glyphs.filter((glyph) => glyph.text_index >= from && glyph.text_index < to);
  const rects: MmRect[] = [];

  for (const glyph of inside) {
    const last = rects[rects.length - 1];
    const same = last !== undefined && last.y === glyph.y && last.h === glyph.line_height;
    if (same) {
      last.w = glyph.x + glyph.width - last.x;
    } else {
      rects.push({ x: glyph.x, y: glyph.y, w: glyph.width, h: glyph.line_height });
    }
  }
  return rects;
}
