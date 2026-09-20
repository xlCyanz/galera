/**
 * Las líneas de un bloque de texto: cuáles son elementos de una lista.
 *
 * Qué línea es un elemento no está en el texto sino en `lines` del elemento
 * (`model::Line`): aquí solo se mira cuáles toca la selección y qué comando
 * mandar. Repartir y recortar esa lista lo hace el núcleo
 * (`Op::SetLines`).
 *
 * Las posiciones del texto van en bytes, como en el resto.
 */
import type { Line, ListKind } from "../types/model";
import { MIXED, type Mixed } from "../ui/shapeFields";
import { textIndex } from "./caret";

/**
 * Cuánto se puede anidar una lista. Es el mismo número que el núcleo
 * (`MAX_LIST_LEVEL`), que rechaza lo que pase de ahí.
 */
export const MAX_LEVEL = 8;

/** Una línea sin nada: texto normal. */
const PLAIN: Line = {};

/** El nivel de una línea, que el JSON no escribe cuando es 0. */
function levelIn(line: Line): number {
  return line.level ?? 0;
}

/** Qué líneas toca el tramo `[from, to)`, contando desde 0. */
export function linesTouched(text: string, from: number, to: number): { first: number; last: number } {
  const [start, end] = from <= to ? [from, to] : [to, from];
  return { first: newlinesBefore(text, start), last: newlinesBefore(text, end) };
}

/** El estilo de una línea; texto normal si no tiene. */
export function lineAt(lines: readonly Line[], index: number): Line {
  return lines[index] ?? PLAIN;
}

/**
 * La lista que comparten las líneas que toca la selección: su tipo, `null`
 * si ninguna es lista, o [`MIXED`] si no todas son lo mismo.
 */
export function listOf(
  text: string,
  lines: readonly Line[],
  from: number,
  to: number,
): ListKind | null | Mixed {
  const { first, last } = linesTouched(text, from, to);
  const kinds = new Set<ListKind | null>();
  for (let index = first; index <= last; index += 1) {
    kinds.add(lineAt(lines, index).list ?? null);
  }
  const [only] = kinds;
  return kinds.size === 1 ? (only ?? null) : MIXED;
}

/** El nivel de la primera línea que toca la selección. */
export function levelOf(text: string, lines: readonly Line[], from: number, to: number): number {
  return levelIn(lineAt(lines, linesTouched(text, from, to).first));
}

/**
 * Cómo quedan las líneas al pulsar el botón de una lista: si ya son todas
 * de ese tipo, dejan de ser lista; si no, pasan a serlo con el nivel que
 * tuvieran.
 */
export function toggleList(
  text: string,
  lines: readonly Line[],
  from: number,
  to: number,
  kind: ListKind,
): Line {
  if (listOf(text, lines, from, to) === kind) {
    return {};
  }
  return { list: kind, level: levelOf(text, lines, from, to) };
}

/**
 * Cómo quedan las líneas al cambiar de nivel con Tab o ⇧Tab, o `null` si no
 * hay nada que cambiar: fuera de una lista, o ya en el borde.
 *
 * Todas las líneas que toca la selección quedan al mismo nivel, que es el
 * de la primera: anidar de una en una cada línea de una selección haría
 * falta un comando por línea.
 */
export function indent(
  text: string,
  lines: readonly Line[],
  from: number,
  to: number,
  by: 1 | -1,
): Line | null {
  const { first } = linesTouched(text, from, to);
  const line = lineAt(lines, first);
  if (line.list === undefined || line.list === null) {
    return null;
  }
  const level = levelIn(line) + by;
  if (level < 0 || level > MAX_LEVEL) {
    return null;
  }
  return { list: line.list, level };
}

/** Cuántos saltos de línea hay antes de esa posición, en bytes. */
function newlinesBefore(text: string, byte: number): number {
  return [...text.slice(0, textIndex(text, byte))].filter((character) => character === "\n").length;
}
