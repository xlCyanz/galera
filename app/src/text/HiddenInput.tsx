/**
 * El campo invisible que recibe el teclado al escribir en un texto.
 *
 * Lo que se ve es el render de Typst (principio 2): este campo no se ve
 * nunca. Está encima del bloque de texto, transparente y sin ratón, y solo
 * sirve para que el sistema le hable: teclado, teclas muertas, IME,
 * dictado y portapapeles (ver `docs/decisiones/ime.md`, spike #55).
 *
 * # Por qué el campo lleva una copia del texto
 *
 * Porque así ⌘A, inicio, fin, ⌥← y ⌥→, y seleccionar con ⇧ los hace el
 * sistema, con las costumbres de cada plataforma, en vez de reimplementarlos
 * aquí. El texto de verdad sigue estando en el documento, que lleva el
 * backend: el campo es una copia de trabajo y **cada cambio se manda como
 * un comando**, con su paso en el historial. Si el documento cambia por otro
 * lado (deshacer, el inspector), la copia se vuelve a poner al día.
 *
 * # Composición
 *
 * Mientras el sistema tiene algo a medias —el `´` de una tilde, los
 * candidatos del IME— no se manda nada: compilar a medias enseñaría el
 * acento suelto. Se manda al confirmarse.
 *
 * # Un comando por cambio, no el texto entero
 *
 * Lo que se manda no es el contenido completo: es «borra este trozo» y
 * «escribe esto aquí» (`ops::text`), con las posiciones en caracteres. El
 * reparto en tramos —qué formato hereda lo que se escribe, qué tramos se
 * parten— lo hace el núcleo (principio 5). Aquí solo se compara lo que
 * enseña el campo con lo que dice el documento (`change.ts`).
 *
 * Los cambios van de uno en uno: hasta que el backend no contesta no se
 * manda el siguiente, y el siguiente se calcula con lo que haya entonces.
 * Así, teclear rápido no manda posiciones de un texto que ya ha cambiado.
 *
 * # Listas
 *
 * Dentro de una lista, Tab y ⇧Tab cambian el nivel de las líneas que toca
 * la selección. Fuera de una lista no hacen nada —pero tampoco sacan el
 * foco del texto, que es lo que hace un tabulador en cualquier campo.
 *
 * # El cursor
 *
 * Dónde está la selección se guarda en el estado de edición, en bytes del
 * texto, y con eso lo dibuja `Cursor.tsx` sobre las posiciones de los
 * glifos. Subir y bajar de línea **no las hace el campo**: sus líneas no
 * son las del documento, que las parte Typst con otro ancho y otra fuente,
 * así que ↑ y ↓ se atienden aquí y se resuelven con esas posiciones,
 * conservando la columna entre saltos. El resto —⌘A, inicio, fin, palabra a
 * palabra— sí lo hace el campo.
 *
 * Colocar el cursor con el ratón llega con F4-07 (#61).
 *
 * # Las fichas de variable
 *
 * `{{nombre}}` es una ficha: en la página se ve su valor, y aquí se trata
 * como una sola pieza (`chips.ts`). Las flechas la saltan entera, Retroceso
 * y Supr se la llevan de una vez, y escribir `{{` abre la lista de
 * variables (`ChipPicker.tsx`), que inserta la ficha por el store.
 */
import { useEffect, useEffectEvent, useRef } from "react";

import { applyOp } from "../commands";
import type { CanvasTransform } from "../canvas/transform";
import { rectToCanvas } from "../canvas/transform";
import { runHistory } from "../hooks/useUndoRedo";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import { byteIndex, lineMove, textIndex } from "./caret";
import { change, textOf } from "./change";
import { arrow, deletion } from "./chips";
import { indent } from "./lines";
import { nextCell } from "./table";
import {
  type EditTarget,
  deleteOp,
  glyphsOfTarget,
  insertOp,
  keyOf,
  linesOf,
  runsOf,
} from "./target";
import { applyLines } from "./useTextFormat";

/** Teclear seguido es un solo paso del historial; tras esta pausa, en
 * milisegundos, empieza otro. */
const BURST_MS = 1500;

let bursts = 0;
/** La ráfaga a la que pertenece lo que se escribe ahora. */
let burst: { group: string; at: number } | null = null;

/**
 * El grupo del historial para este cambio: el mismo que el anterior si no
 * ha pasado [`BURST_MS`] desde entonces, y si no, uno nuevo.
 */
function burstGroup(id: string): string {
  const now = performance.now();
  if (burst === null || now - burst.at > BURST_MS) {
    bursts += 1;
    burst = { group: `text-${id}-${bursts}`, at: now };
  } else {
    burst = { group: burst.group, at: now };
  }
  return burst.group;
}

export interface HiddenInputProps {
  /** Qué texto se está escribiendo: el de un bloque o el de un flujo. */
  target: EditTarget;
  /** Su caja, la que midió Typst. */
  box: LayoutBox;
  /** Para pasar la caja a píxeles del lienzo. */
  transform: CanvasTransform;
}

/** Adonde puede ir el foco sin dejar de escribir: lo que trabaja sobre el
 * texto que se escribe. */
const KEEPS_EDITING = ".table-menu, .format-bar";

export function HiddenInput({ target, box, transform }: HiddenInputProps) {
  // Con qué nombre se agrupan los cambios en el historial y se etiqueta el
  // campo: el id del bloque, o el del flujo.
  const id = keyOf(target);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Los cambios que están de camino al backend, uno detrás de otro. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** La columna que se quiere conservar al subir y bajar de línea, en mm. */
  const column = useRef<number | null>(null);
  // Las posiciones de los glifos son las de la última compilación buena:
  // se vuelven a pedir cuando llega otra.
  const revision = useLayoutStore((state) => state.revision);
  // Cuando la selección la cambia el ratón, el campo se pone al día: así
  // escribir sustituye lo seleccionado y ⌘C copia lo que se ve.
  const selectionRequests = useEditingStore((state) => state.selectionRequests);
  // Lo que pide insertar la lista de variables: una ficha en el cursor.
  const insertRequests = useEditingStore((state) => state.insertRequests);

  /** Los tramos del texto que se escribe, sean de un bloque o de un flujo. */
  const current = () => runsOf(useDocumentStore.getState().document, target);

  /** Cómo se compone cada línea, si el texto es de un bloque. */
  const lines = () => linesOf(useDocumentStore.getState().document, target);

  const commit = useEffectEvent(() => {
    // Un cambio detrás de otro: el siguiente se calcula cuando el anterior
    // ya está en el documento.
    queue.current = queue.current.then(push).catch(() => {
      // El núcleo no lo ha aceptado: la copia vuelve a lo que hay.
      sync();
    });
  });

  /** Manda al backend lo que el campo tiene y el documento todavía no. */
  const push = useEffectEvent(async () => {
    const element = field.current;
    const runs = current();
    if (element === null || runs === null) {
      return;
    }
    const edit = change(textOf(runs), element.value);
    if (edit === null) {
      return;
    }

    const group = burstGroup(id);
    const apply = (applied: Awaited<ReturnType<typeof applyOp>>) =>
      useDocumentStore.getState().applyEdit(applied);
    if (edit.to > edit.from) {
      apply(await applyOp(deleteOp(target, edit.from, edit.to), group));
    }
    if (edit.text !== "") {
      apply(await applyOp(insertOp(target, edit.from, edit.text), group));
    }
  });

  /** Pone la copia al día con el documento, si han dejado de coincidir. */
  const sync = useEffectEvent(() => {
    const element = field.current;
    const runs = current();
    if (runs === null) {
      // El texto ya no está: lo ha borrado otro, o se ha cerrado el
      // documento.
      useEditingStore.getState().stop();
      return;
    }
    if (element === null || useEditingStore.getState().composing) {
      return;
    }
    const text = textOf(runs);
    if (element.value === text) {
      return;
    }
    const at = Math.min(element.selectionStart, text.length);
    element.value = text;
    element.setSelectionRange(at, at);
    remember();
  });

  /** Guarda dónde está la selección, para dibujar el cursor. En bytes,
   * como los cuenta el núcleo. */
  const remember = useEffectEvent(() => {
    const element = field.current;
    if (element !== null) {
      useEditingStore
        .getState()
        .setSelection(
          byteIndex(element.value, element.selectionStart),
          byteIndex(element.value, element.selectionEnd),
        );
    }
  });

  /** Sube o baja una línea de las que decidió Typst. */
  const moveLine = useEffectEvent((direction: -1 | 1, extend: boolean) => {
    const element = field.current;
    const { glyphs } = useEditingStore.getState();
    if (element === null || glyphs.length === 0) {
      return false;
    }
    const text = element.value;
    // El extremo que se mueve, y el que se queda si se está seleccionando.
    const moving = element.selectionDirection === "backward" ? element.selectionStart : element.selectionEnd;
    const anchor = element.selectionDirection === "backward" ? element.selectionEnd : element.selectionStart;
    const moved = lineMove(glyphs, byteIndex(text, moving), direction, column.current, text);
    if (moved === null) {
      return false;
    }
    column.current = moved.x;

    const at = textIndex(text, moved.byte);
    if (extend) {
      element.setSelectionRange(Math.min(anchor, at), Math.max(anchor, at), at < anchor ? "backward" : "forward");
    } else {
      element.setSelectionRange(at, at);
    }
    remember();
    return true;
  });

  // Al entrar a escribir, el campo toma el foco y la copia se pone al día.
  useEffect(() => {
    const element = field.current;
    if (element === null) {
      return;
    }
    const runs = current();
    const text = runs === null ? "" : textOf(runs);
    element.value = text;
    element.setSelectionRange(text.length, text.length);
    element.focus();
    remember();

    // Dónde está el cursor no llega como un evento de entrada: el sistema
    // lo mueve con las flechas, con ⌘A, con inicio y fin. Se mira cada vez
    // que la selección del campo cambia.
    const track = () => {
      if (window.document.activeElement === element) {
        remember();
      }
    };
    window.document.addEventListener("selectionchange", track);
    element.addEventListener("select", remember);
    element.addEventListener("keyup", remember);
    return () => {
      window.document.removeEventListener("selectionchange", track);
      element.removeEventListener("select", remember);
      element.removeEventListener("keyup", remember);
    };
  }, [id]);

  // Cambios que llegan de otro sitio: deshacer, rehacer, el inspector.
  useEffect(() => useDocumentStore.subscribe(() => sync()), []);

  useEffect(() => {
    const element = field.current;
    if (element === null || selectionRequests === 0) {
      return;
    }
    const { start, end } = useEditingStore.getState();
    const [from, to] = start <= end ? [start, end] : [end, start];
    element.setSelectionRange(
      textIndex(element.value, from),
      textIndex(element.value, to),
      start <= end ? "forward" : "backward",
    );
    element.focus();
  }, [selectionRequests]);

  // Lo que pida insertarse desde fuera: una ficha de variable.
  useEffect(() => {
    const element = field.current;
    const { insert } = useEditingStore.getState();
    if (element === null || insertRequests === 0 || insert === null) {
      return;
    }
    const { text, from, to } = insert;
    const value = element.value;
    element.value = value.slice(0, from) + text + value.slice(to);
    const at = from + text.length;
    element.setSelectionRange(at, at);
    element.focus();
    commit();
    remember();
  }, [insertRequests]);

  // Dónde quedó cada glifo, de la compilación que se está viendo.
  useEffect(() => {
    let current = true;
    void glyphsOfTarget(target)
      .then((found) => {
        // Sin compilación todavía, la lista viene vacía.
        if (current) {
          useEditingStore.getState().setGlyphs(Array.isArray(found) ? found : []);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [id, revision]);

  return (
    <textarea
      ref={field}
      className="text-input"
      aria-label={`Texto de ${id}`}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      style={position(box, transform)}
      onInput={() => {
        if (!useEditingStore.getState().composing) {
          commit();
        }
        column.current = null;
        useEditingStore.getState().typed();
        remember();
      }}
      onCompositionStart={() => useEditingStore.getState().setComposing(true)}
      onCompositionEnd={() => {
        useEditingStore.getState().setComposing(false);
        commit();
        useEditingStore.getState().typed();
        remember();
      }}
      onPaste={(event) => {
        // Lo que se pega entra como texto: el formato llega con F4-08 (#62).
        event.preventDefault();
        const text = pastedText(event.clipboardData);
        if (text === "") {
          return;
        }
        const element = event.currentTarget;
        const { selectionStart: from, selectionEnd: to, value } = element;
        element.value = value.slice(0, from) + text + value.slice(to);
        const at = from + text.length;
        element.setSelectionRange(at, at);
        commit();
        remember();
      }}
      onKeyDown={(event) => {
        // En una tabla, el tabulador pasa a la celda siguiente. Dentro de
        // una lista, cambia el nivel. Fuera de las dos no hace nada: sacar
        // el foco del texto sería peor.
        // ⌥F10 lleva el foco a la barra de formato, que es como se llega a
        // una barra de herramientas sin ratón; Esc desde ella vuelve aquí.
        // Así el color y el enlace no son solo del ratón (F8-02, #89).
        if (event.altKey && event.key === "F10") {
          const first = document.querySelector<HTMLElement>(".format-bar button");
          if (first !== null) {
            event.preventDefault();
            event.stopPropagation();
            first.focus();
          }
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          const runs = current();
          const { start, end, element, cell } = useEditingStore.getState();
          // En una tabla el tabulador pasa a la celda siguiente, con el
          // cursor al final de su texto; ⇧ va a la anterior.
          if (cell !== null) {
            const document = useDocumentStore.getState().document;
            const next = nextCell(document, cell.table, cell.row, cell.column, event.shiftKey);
            if (next !== null) {
              const content = runsOf(document, {
                kind: "cell",
                table: cell.table,
                row: next.row,
                column: next.column,
              });
              const text = content === null ? "" : textOf(content);
              useEditingStore
                .getState()
                .editCell(cell.table, next.row, next.column, byteIndex(text, text.length));
            }
            return;
          }
          if (runs !== null && element !== null) {
            const style = indent(textOf(runs), lines(), start, end, event.shiftKey ? -1 : 1);
            if (style !== null) {
              void applyLines(style);
            }
          }
          return;
        }
        // Las líneas del campo no son las del documento: subir y bajar se
        // resuelve con las posiciones de los glifos.
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          if (moveLine(event.key === "ArrowUp" ? -1 : 1, event.shiftKey)) {
            event.preventDefault();
          }
          return;
        }
        // Una ficha de variable se borra y se salta entera: el cursor no
        // se mete dentro de `{{nombre}}`.
        if (event.key === "Backspace" || event.key === "Delete") {
          const element = event.currentTarget;
          const range = deletion(
            element.value,
            element.selectionStart,
            element.selectionEnd,
            event.key === "Backspace" ? "backward" : "forward",
          );
          if (range !== null) {
            event.preventDefault();
            element.value = element.value.slice(0, range.from) + element.value.slice(range.to);
            element.setSelectionRange(range.from, range.from);
            commit();
            remember();
            return;
          }
        }
        if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.shiftKey) {
          const element = event.currentTarget;
          if (element.selectionStart === element.selectionEnd) {
            const at = arrow(
              element.value,
              element.selectionStart,
              event.key === "ArrowLeft" ? -1 : 1,
            );
            if (at !== null) {
              event.preventDefault();
              element.setSelectionRange(at, at);
              remember();
              return;
            }
          }
        }
        column.current = null;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          useEditingStore.getState().stop();
          return;
        }
        // Deshacer es el del documento, no el del campo: el cambio de texto
        // ya es un paso del historial.
        const history = historyCommand(event);
        if (history !== null) {
          event.preventDefault();
          event.stopPropagation();
          void runHistory(history);
        }
      }}
      onBlur={(event) => {
        // Salir del texto deja de escribirlo, salvo si el foco va a algo
        // que trabaja sobre él: el menú de la tabla o la barra de formato.
        // Desde ahí, Esc devuelve el foco aquí y se sigue escribiendo
        // (F8-02, #89).
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest(KEEPS_EDITING) !== null) {
          return;
        }
        useEditingStore.getState().stop();
      }}
    />
  );
}



/** Lo que se pega, siempre como texto plano: si solo viene HTML, se queda
 * con lo que dice, sin las etiquetas. */
function pastedText(data: DataTransfer | null): string {
  const plain = data?.getData("text/plain") ?? "";
  if (plain !== "") {
    return plain;
  }
  const html = data?.getData("text/html") ?? "";
  if (html === "") {
    return "";
  }
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.body.textContent ?? "";
}

/** Si la tecla pide deshacer o rehacer. */
function historyCommand(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): "undo" | "redo" | null {
  if (!event.metaKey && !event.ctrlKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  return key === "y" && event.ctrlKey ? "redo" : null;
}

/** Dónde va el campo: encima del bloque de texto, con su tamaño. Así la
 * ventana de candidatos del IME sale sobre el texto y no en una esquina. */
function position(box: LayoutBox, transform: CanvasTransform) {
  const rect = rectToCanvas(transform, { x: box.x, y: box.y, w: box.w, h: box.h });
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    transform: box.rotation === 0 ? undefined : `rotate(${box.rotation}deg)`,
  };
}
