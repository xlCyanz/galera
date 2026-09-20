/**
 * El formato de lo que está seleccionado, y cómo cambiarlo.
 *
 * El formato vive en los tramos del documento (`model::text`), así que lo
 * que hay aquí es solo mirarlos: qué comparte el tramo seleccionado y qué
 * comando manda el botón o el atajo. Repartir los tramos —partir los que
 * toca, juntar los que quedan iguales— lo hace el núcleo con
 * `Op::FormatText` (principio 5).
 *
 * Las posiciones van en bytes, como en el resto del texto.
 */
import { MIXED, type Mixed } from "../ui/shapeFields";
import type { Run } from "../types/model";
import type { Format } from "../types/ops";

/** El formato que comparte un tramo del texto. */
export interface RunFormat {
  /** Todo lo elegido va en negrita. */
  bold: boolean;
  /** Todo en cursiva. */
  italic: boolean;
  /** Todo subrayado. */
  underline: boolean;
  /** El color que comparte, `null` si ninguno lo tiene, o [`MIXED`] si no
   * todos llevan el mismo. */
  color: string | null | Mixed;
  /** El enlace que comparte, con las mismas reglas que el color. */
  link: string | null | Mixed;
}

/** Nada marcado: lo que se enseña cuando no hay texto. */
const PLAIN: RunFormat = {
  bold: false,
  italic: false,
  underline: false,
  color: null,
  link: null,
};

/**
 * El formato del tramo `[start, end)`, o el del cursor si los dos son
 * iguales.
 *
 * Con el cursor suelto se mira el tramo de su izquierda, que es el formato
 * que heredaría lo que se escriba ahí.
 */
export function formatOf(runs: readonly Run[], start: number, end: number): RunFormat {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const encoder = new TextEncoder();
  const chosen: Run[] = [];
  let at = 0;

  for (const run of runs) {
    const next = at + encoder.encode(run.text).length;
    const touches = from === to ? at < to && next >= to : at < to && next > from;
    if (touches) {
      chosen.push(run);
    }
    at = next;
  }
  if (chosen.length === 0) {
    // Al principio del todo, o sin texto: el primer tramo si lo hay.
    const first = runs[0];
    return first === undefined ? PLAIN : single(first);
  }

  const first = single(chosen[0]!);
  return chosen.slice(1).reduce<RunFormat>((shared, run) => {
    const one = single(run);
    return {
      bold: shared.bold && one.bold,
      italic: shared.italic && one.italic,
      underline: shared.underline && one.underline,
      color: shared.color === one.color ? shared.color : MIXED,
      link: shared.link === one.link ? shared.link : MIXED,
    };
  }, first);
}

/** El formato de un solo tramo. */
function single(run: Run): RunFormat {
  return {
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    color: run.color ?? null,
    link: run.link ?? null,
  };
}

/** Lo que cambia al pulsar negrita, cursiva o subrayado: si ya lo está
 * todo, se quita; si no, se pone. */
export function toggle(current: RunFormat, what: "bold" | "italic" | "underline"): Format {
  return { [what]: !current[what] };
}
