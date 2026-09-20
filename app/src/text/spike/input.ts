/**
 * Lo que hace cada evento de entrada sobre un texto.
 *
 * Es la pieza que el spike (#55) pone a prueba: un campo invisible recibe
 * el teclado, el IME, el dictado y lo pegado, y de cada evento sale un
 * cambio sobre el texto. Aquí solo está el cambio, sin DOM, para poder
 * probarlo y para que F4-02 (#56) lo herede ya con pruebas.
 *
 * # Índices
 *
 * En unidades de JavaScript (UTF-16), que es como los cuenta el DOM. El
 * núcleo trabaja en bytes: la conversión es de quien junte las dos cosas,
 * no de aquí.
 *
 * # Puntos de código, no unidades
 *
 * Borrar hacia atrás quita un punto de código entero: un emoji ocupa dos
 * unidades y se borra de una, no por mitades.
 */

/** Un texto y dónde está la selección. Si `start` y `end` son iguales, es
 * el cursor. */
export type Field = {
  /** El texto entero. */
  text: string;
  /** Principio de la selección. */
  start: number;
  /** Final de la selección. */
  end: number;
};

/** El tramo que el IME está componiendo, o `null` si no hay nada a medias. */
export type Composition = { start: number; end: number } | null;

/** Lo que se mira de un `InputEvent`: qué clase de cambio es y con qué
 * texto. */
export type Signal = {
  /** El `inputType` del evento. */
  inputType: string;
  /** El texto que trae, si trae. */
  data: string | null;
};

/** El resultado de aplicar un evento. */
export type Applied = {
  field: Field;
  composition: Composition;
};

/**
 * Aplica un evento de entrada. Devuelve `null` si el `inputType` no se
 * conoce: en el spike eso se enseña en rojo, que es justo lo que hay que
 * descubrir.
 */
export function apply(field: Field, composition: Composition, signal: Signal): Applied | null {
  const { inputType, data } = signal;

  switch (inputType) {
    // El IME va enseñando lo que lleva escrito: cada evento sustituye lo
    // anterior, no se añade detrás.
    case "insertCompositionText": {
      const range = composition ?? selection(field);
      const text = data ?? "";
      return {
        field: replace(field, range, text),
        composition: { start: range.start, end: range.start + text.length },
      };
    }

    // Lo que el IME da por bueno: ya es texto normal.
    case "insertFromComposition":
    case "insertReplacementText":
    case "insertText":
    case "insertFromPaste":
    case "insertFromDrop":
    case "insertFromYank": {
      const range = composition ?? selection(field);
      return { field: replace(field, range, data ?? ""), composition: null };
    }

    case "insertLineBreak":
    case "insertParagraph":
      return { field: replace(field, selection(field), "\n"), composition: null };

    case "deleteContentBackward":
    case "deleteWordBackward":
    case "deleteSoftLineBackward":
    case "deleteHardLineBackward": {
      const range = composition ?? selection(field);
      const start =
        range.start !== range.end
          ? range.start
          : back(field.text, range.start, inputType === "deleteContentBackward" ? "character" : "word");
      return { field: replace(field, { start, end: range.end }, ""), composition: null };
    }

    case "deleteContentForward":
    case "deleteWordForward":
    case "deleteSoftLineForward":
    case "deleteHardLineForward": {
      const range = composition ?? selection(field);
      const end =
        range.start !== range.end
          ? range.end
          : forward(field.text, range.end, inputType === "deleteContentForward" ? "character" : "word");
      return { field: replace(field, { start: range.start, end }, ""), composition: null };
    }

    case "deleteByCut":
    case "deleteByDrag":
    case "deleteContent":
      return { field: replace(field, selection(field), ""), composition: null };

    default:
      return null;
  }
}

/** La selección como tramo, siempre con el principio delante. */
function selection(field: Field): { start: number; end: number } {
  return field.start <= field.end
    ? { start: field.start, end: field.end }
    : { start: field.end, end: field.start };
}

/** Cambia un tramo por otro texto y deja el cursor detrás. */
function replace(field: Field, range: { start: number; end: number }, text: string): Field {
  const at = range.start + text.length;
  return {
    text: field.text.slice(0, range.start) + text + field.text.slice(range.end),
    start: at,
    end: at,
  };
}

/** Dónde queda el cursor al borrar hacia atrás un carácter o una palabra. */
function back(text: string, at: number, unit: "character" | "word"): number {
  if (at === 0) {
    return 0;
  }
  if (unit === "character") {
    // Un punto de código entero: un emoji no se parte por la mitad.
    const before = text.codePointAt(at - 2);
    return before !== undefined && before > 0xffff ? at - 2 : at - 1;
  }
  let start = at;
  while (start > 0 && isSpace(text[start - 1])) {
    start -= 1;
  }
  while (start > 0 && !isSpace(text[start - 1])) {
    start -= 1;
  }
  return start;
}

/** Lo mismo hacia delante. */
function forward(text: string, at: number, unit: "character" | "word"): number {
  if (at >= text.length) {
    return text.length;
  }
  if (unit === "character") {
    const next = text.codePointAt(at);
    return next !== undefined && next > 0xffff ? at + 2 : at + 1;
  }
  let end = at;
  while (end < text.length && isSpace(text[end])) {
    end += 1;
  }
  while (end < text.length && !isSpace(text[end])) {
    end += 1;
  }
  return end;
}

function isSpace(character: string | undefined): boolean {
  return character === undefined || /\s/u.test(character);
}
