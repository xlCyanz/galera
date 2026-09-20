/**
 * El texto de un bloque, repartido en tramos.
 *
 * Un texto del documento son varios [`Run`], cada uno con su formato. Lo
 * que se escribe es texto plano: hay que meterlo en los tramos que ya hay
 * sin perder su formato, que es lo que hace [`withText`].
 *
 * # Provisional
 *
 * Esto vive aquí, en la interfaz, mientras el núcleo no tenga comandos por
 * tramos (F4-03, #57): entonces el cambio se mandará como «mete este texto
 * en este punto» y el reparto lo hará el núcleo, que es donde va la lógica
 * (principio 5). Hasta entonces se manda el contenido entero, y este módulo
 * se encarga de que el formato de los tramos sobreviva a cada tecla.
 *
 * # Índices
 *
 * En unidades de JavaScript (UTF-16), como los cuenta el DOM. El núcleo
 * cuenta bytes: quien junte las dos cosas convierte.
 */
import type { Run } from "../types/model";

/** Un tramo sin formato, para empezar. */
const PLAIN: Omit<Run, "text"> = { bold: false, italic: false, underline: false };

/** El texto de un bloque: sus tramos, uno detrás de otro. */
export function textOf(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join("");
}

/**
 * Los tramos que dicen `text`, conservando el formato de los que ya había.
 *
 * Solo cambia lo que de verdad ha cambiado: se compara el principio y el
 * final del texto de antes con el de ahora, y el tramo de en medio se mete
 * en los tramos que tocan. Escribir dentro de una palabra en negrita sigue
 * en negrita; escribir al final del texto sigue el formato del último
 * tramo.
 */
export function withText(runs: readonly Run[], text: string): Run[] {
  const before = textOf(runs);
  if (before === text) {
    return runs.map((run) => ({ ...run }));
  }
  if (runs.length === 0) {
    return [{ text, ...PLAIN }];
  }

  const { start, end, replacement } = change(before, text);
  const out: Run[] = [];
  let at = 0;
  let written = false;

  for (const run of runs) {
    const from = at;
    const to = at + run.text.length;
    at = to;

    // Lo que queda fuera del cambio se conserva tal cual.
    const head = run.text.slice(0, Math.max(0, Math.min(start - from, run.text.length)));
    const tail = run.text.slice(Math.max(0, Math.min(end - from, run.text.length)));

    // El texto nuevo entra en el primer tramo que toca el cambio.
    const touched = start <= to && end >= from;
    const middle = touched && !written ? replacement : "";
    if (touched) {
      written = true;
    }

    const kept = head + middle + tail;
    if (kept !== "") {
      out.push({ ...run, text: kept });
    }
  }

  if (!written) {
    out.push({ text: replacement, ...PLAIN });
  }
  return out.length === 0 ? [{ ...(runs[0] ?? { text: "", ...PLAIN }), text: "" }] : out;
}

/** El tramo que ha cambiado: lo que hay entre el principio y el final que
 * los dos textos tienen en común. */
function change(before: string, after: string): { start: number; end: number; replacement: string } {
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
  return {
    start,
    end: before.length - tail,
    replacement: after.slice(start, after.length - tail),
  };
}
