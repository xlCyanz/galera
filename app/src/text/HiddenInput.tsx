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
 * # Lo que todavía no
 *
 * El cursor y la selección se dibujarán a partir de las posiciones de
 * glifos en F4-06 (#60) y F4-07 (#61); aquí solo se guarda por dónde van.
 * El reparto del texto en tramos lo hará el núcleo en F4-03 (#57).
 */
import { useEffect, useEffectEvent, useRef } from "react";

import { applyOp } from "../commands";
import type { CanvasTransform } from "../canvas/transform";
import { rectToCanvas } from "../canvas/transform";
import { runHistory } from "../hooks/useUndoRedo";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import type { LayoutBox } from "../types/layout";
import type { Run } from "../types/model";
import { textOf, withText } from "./runs";

/** Teclear seguido es un solo paso del historial; tras esta pausa, en
 * milisegundos, empieza otro. */
const BURST_MS = 1500;

let bursts = 0;

export interface HiddenInputProps {
  /** El texto que se está escribiendo. */
  id: string;
  /** Su caja, la que midió Typst. */
  box: LayoutBox;
  /** Para pasar la caja a píxeles del lienzo. */
  transform: CanvasTransform;
}

export function HiddenInput({ id, box, transform }: HiddenInputProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  /** El texto que se mandó por última vez: lo que el backend ya tiene. */
  const sent = useRef<string | null>(null);
  const burst = useRef<{ group: string; at: number } | null>(null);

  const commit = useEffectEvent((text: string) => {
    if (text === sent.current) {
      return;
    }
    const runs = runsOf(id);
    if (runs === null) {
      return;
    }
    sent.current = text;
    const now = performance.now();
    if (burst.current === null || now - burst.current.at > BURST_MS) {
      bursts += 1;
      burst.current = { group: `text-${id}-${bursts}`, at: now };
    } else {
      burst.current = { ...burst.current, at: now };
    }
    void applyOp(
      { op: "set_property", id, property: { name: "content", value: withText(runs, text) } },
      burst.current.group,
    )
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => {
        // El núcleo no lo ha aceptado: la copia vuelve a lo que hay.
        sent.current = null;
        sync();
      });
  });

  /** Pone la copia al día con el documento, si han dejado de coincidir. */
  const sync = useEffectEvent(() => {
    const element = field.current;
    const runs = runsOf(id);
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
    sent.current = text;
    remember();
  });

  /** Guarda dónde está la selección, para dibujar el cursor. */
  const remember = useEffectEvent(() => {
    const element = field.current;
    if (element !== null) {
      useEditingStore.getState().setSelection(element.selectionStart, element.selectionEnd);
    }
  });

  // Al entrar a escribir, el campo toma el foco y la copia se pone al día.
  useEffect(() => {
    const element = field.current;
    if (element === null) {
      return;
    }
    const runs = runsOf(id);
    const text = runs === null ? "" : textOf(runs);
    element.value = text;
    sent.current = text;
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

  return (
    <textarea
      ref={field}
      className="text-input"
      aria-label={`Texto de ${id}`}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      style={position(box, transform)}
      onInput={(event) => {
        if (!useEditingStore.getState().composing) {
          commit(event.currentTarget.value);
        }
        remember();
      }}
      onCompositionStart={() => useEditingStore.getState().setComposing(true)}
      onCompositionEnd={(event) => {
        useEditingStore.getState().setComposing(false);
        commit(event.currentTarget.value);
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
        commit(element.value);
        remember();
      }}
      onKeyDown={(event) => {
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
      onBlur={() => useEditingStore.getState().stop()}
    />
  );
}

/** Los tramos del texto `id` en el documento abierto, o `null` si ya no
 * está o no es un texto. */
function runsOf(id: string): Run[] | null {
  const document = useDocumentStore.getState().document;
  const element = document?.pages
    .flatMap((page) => page.elements)
    .find((candidate) => candidate.id === id);
  return element !== undefined && element.type === "text" ? element.content : null;
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
