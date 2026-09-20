/**
 * El único sitio que escucha el teclado para los atajos.
 *
 * Hay **un solo** listener en la ventana, que se engancha con el primer
 * atajo que alguien registra y se quita con el último. Reparte cada tecla
 * al atajo que le corresponda, según el registro (`shortcuts.ts`). Quien
 * quiera responder a uno lo dice con [`useShortcut`], desde donde tenga lo
 * que hace falta para atenderlo: el lienzo los suyos, el riel los suyos.
 *
 * Así no hay listeners de atajos sueltos por componentes, y la lista de lo
 * que hace cada tecla está en un solo archivo.
 *
 * # Mientras se escribe
 *
 * En un campo de texto una letra suelta es texto, no un atajo: solo pasan
 * los que llevan ⌘ o Ctrl, y ni siquiera deshacer y rehacer, que ahí son
 * los del propio campo.
 *
 * # Lo que no es un atajo
 *
 * Esc o Shift **mientras se arrastra** son parte del gesto, no atajos: los
 * escuchan los propios gestos (`useDrag`, `useResize`, `useRotate`,
 * `useCreate`) mientras duran, y se quitan al terminar.
 */
import { useEffect } from "react";

import { type ShortcutId, isMac, isTypingTarget, shortcutFor, worksWhileTyping } from "../shortcuts";

/** Lo que hace un atajo. Devolver `false` deja pasar la tecla. */
export type ShortcutHandler = (event: KeyboardEvent) => boolean | void;

const handlers = new Map<ShortcutId, ShortcutHandler[]>();

/** El sistema, para saber si el modificador es ⌘ o Ctrl. */
let mac = isMac();

/** Solo para pruebas: hacer como si fuera macOS, o no. */
export function pretendMac(value: boolean): void {
  mac = value;
}

const listener = (event: KeyboardEvent) => {
  if (event.repeat && event.key.length === 1) {
    // Una letra repetida por dejar la tecla pulsada no repite el atajo; las
    // flechas sí, para mover seguido.
    return;
  }
  const id = shortcutFor(event, mac);
  if (id === null) {
    return;
  }
  if (isTypingTarget(event.target) && !worksWhileTyping(id)) {
    return;
  }
  if (runShortcut(id, event)) {
    event.preventDefault();
  }
};

/** Cuántos atajos hay registrados: con el primero se escucha, con ninguno no. */
let listening = 0;

/** Registra qué hace un atajo mientras el componente está montado. */
export function registerShortcut(id: ShortcutId, handler: ShortcutHandler): () => void {
  const list = handlers.get(id) ?? [];
  handlers.set(id, [...list, handler]);
  listening += 1;
  if (listening === 1) {
    window.addEventListener("keydown", listener);
  }
  return () => {
    const rest = (handlers.get(id) ?? []).filter((candidate) => candidate !== handler);
    if (rest.length === 0) {
      handlers.delete(id);
    } else {
      handlers.set(id, rest);
    }
    listening -= 1;
    if (listening === 0) {
      window.removeEventListener("keydown", listener);
    }
  };
}

/**
 * Atiende un atajo mientras el componente esté montado y `enabled` sea
 * cierto.
 *
 * El último que se registra manda: si el lienzo y otro panel atienden lo
 * mismo, gana el que se montó después. Devolver `false` deja que lo intente
 * el siguiente.
 */
export function useShortcut(id: ShortcutId, handler: ShortcutHandler, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return registerShortcut(id, handler);
  });
}

/** Dispara un atajo como si se hubiera pulsado. Devuelve si alguien lo atendió. */
export function runShortcut(id: ShortcutId, event: KeyboardEvent): boolean {
  const list = handlers.get(id) ?? [];
  for (const handler of [...list].reverse()) {
    if (handler(event) !== false) {
      return true;
    }
  }
  return false;
}
