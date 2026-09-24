/**
 * El foco de un diálogo: entra al abrirlo, no se escapa mientras está
 * abierto, `Esc` lo cierra y, al cerrarlo, vuelve a donde estaba.
 *
 * Es lo que hace falta para usar la aplicación sin ratón (F8-02, #89):
 * quien abre un diálogo con el teclado tiene que poder recorrerlo, salir de
 * él y seguir exactamente donde lo dejó, sin tener que volver a buscar su
 * sitio desde el principio de la ventana.
 *
 * - **Al abrir**, el foco va al primer control del diálogo; si no tiene
 *   ninguno, al propio diálogo, que por eso lleva `tabIndex={-1}`.
 * - **Mientras está abierto**, el tabulador da la vuelta dentro de él: del
 *   último control vuelve al primero y, con ⇧, al revés.
 * - **`Esc`** llama a `onEscape`. Se escucha en la fase de captura y se
 *   corta ahí, para que no llegue a los atajos del lienzo: si no, cerrar el
 *   diálogo quitaría además la selección.
 * - **Al cerrar**, el foco vuelve al elemento que lo tenía antes de abrir,
 *   si sigue en la página.
 */
import { type RefObject, useEffect, useEffectEvent, useLayoutEffect } from "react";

/** Lo que puede recibir el foco con el tabulador. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Los controles de un contenedor que el tabulador recorre, en orden. */
export function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute("inert") && element.getAttribute("aria-hidden") !== "true",
  );
}

export interface DialogFocusOptions {
  /** Si el diálogo está abierto. El hook se llama siempre —las reglas de
   * React no dejan llamarlo a ratos— y solo hace algo mientras es cierto. */
  active?: boolean;
  /** Qué hacer con `Esc`: normalmente, cerrar. Sin él, `Esc` no hace nada. */
  onEscape?: () => void;
  /** Si el tabulador se queda dentro. Sí por defecto: es un diálogo. */
  trap?: boolean;
}

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  { active = true, onEscape, trap = true }: DialogFocusOptions = {},
): void {
  const escape = useEffectEvent(() => onEscape?.());

  // Antes de pintar: el foco tiene que estar dentro cuando el diálogo se ve.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!active || dialog === null) {
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (focusables(dialog)[0] ?? dialog).focus();

    return () => {
      // Solo si sigue en la página: el botón que abrió el diálogo puede
      // haberse ido con él.
      if (previous !== null && previous.isConnected) {
        previous.focus();
      }
    };
  }, [ref, active]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = ref.current;
      if (dialog === null) {
        return;
      }
      if (event.key === "Escape" && onEscape !== undefined) {
        event.preventDefault();
        event.stopImmediatePropagation();
        escape();
        return;
      }
      if (event.key !== "Tab" || !trap) {
        return;
      }
      const inside = focusables(dialog);
      const first = inside[0];
      const last = inside.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const focused = document.activeElement;
      // Fuera del diálogo —por un clic en el fondo, por ejemplo— el
      // tabulador lo devuelve dentro.
      if (!(focused instanceof Node) || !dialog.contains(focused)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && focused === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [ref, active, trap, onEscape === undefined]);
}
