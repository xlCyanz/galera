/**
 * **El** mapa de atajos de Galera: uno solo, aquí.
 *
 * Cada atajo tiene un id, su nombre, el grupo en el que se enseña y qué
 * teclas lo disparan. Quien quiera responder a uno lo registra por su id
 * (`hooks/useShortcuts.ts`); no hay `addEventListener("keydown")` sueltos
 * por componentes, salvo los de un gesto en marcha (Esc mientras se arrastra,
 * por ejemplo), que no son atajos sino parte del gesto.
 *
 * `docs/atajos.md` es la misma lista escrita para leer, y una prueba
 * comprueba que no se separan.
 *
 * # macOS y el resto
 *
 * El modificador es ⌘ en macOS y Ctrl en Windows y Linux, y los atajos se
 * escriben con los símbolos de cada sistema (⌘⇧E o Ctrl+Shift+E).
 */

/** Lo que hace falta de un evento de teclado para reconocer un atajo. */
export type KeyPress = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** Las teclas de un atajo. */
export interface Keys {
  /** La tecla o teclas que valen, sin distinguir mayúsculas. */
  key: string | string[];
  /** Si hace falta el modificador del sistema (⌘ o Ctrl). */
  mod?: boolean;
  /**
   * Si hace falta Shift; sin decir nada, no puede estar pulsado. Con
   * `"any"` da igual: las flechas mueven 1 mm o 10 mm con Shift, pero son
   * el mismo atajo.
   */
  shift?: boolean | "any";
  /** Si hace falta Alt; sin decir nada, no puede estar pulsado. */
  alt?: boolean;
  /** Cómo se escribe, si no sale de las teclas: «+», «↑». */
  show?: string;
}

/** Un atajo del editor. */
export interface Shortcut {
  /** Su nombre en el código. */
  id: ShortcutId;
  /** Qué hace, para la ayuda y `docs/atajos.md`. */
  label: string;
  /** En qué parte de la ayuda se enseña. */
  group: Group;
  /** Las teclas en macOS y, si cambia, en el resto. */
  keys: Keys;
  /** Otras teclas que también valen fuera de macOS (Ctrl+Y para rehacer). */
  alsoOnOthers?: Keys;
}

/** Los grupos de la ayuda, en el orden en que se enseñan. */
export const GROUPS = ["Archivo", "Edición", "Herramientas", "Vista", "Ayuda"] as const;
export type Group = (typeof GROUPS)[number];

/**
 * Todos los atajos. Añadir uno es añadirlo aquí y a `docs/atajos.md`; quien
 * lo atienda lo registra con `useShortcut(id, …)`.
 */
export const SHORTCUTS = [
  { id: "openFolder", label: "Abrir una carpeta de proyecto", group: "Archivo", keys: { key: "o", mod: true } },
  { id: "openArchive", label: "Abrir un archivo .galera", group: "Archivo", keys: { key: "o", mod: true, shift: true } },
  { id: "save", label: "Guardar", group: "Archivo", keys: { key: "s", mod: true } },
  { id: "saveAs", label: "Guardar como .galera…", group: "Archivo", keys: { key: "s", mod: true, shift: true } },
  { id: "exportPdf", label: "Exportar a PDF…", group: "Archivo", keys: { key: "e", mod: true, shift: true } },

  { id: "undo", label: "Deshacer", group: "Edición", keys: { key: "z", mod: true } },
  {
    id: "redo",
    label: "Rehacer",
    group: "Edición",
    keys: { key: "z", mod: true, shift: true },
    alsoOnOthers: { key: "y", mod: true },
  },
  { id: "deselect", label: "Quitar la selección", group: "Edición", keys: { key: "escape", show: "Esc" } },
  {
    id: "nudgeLeft",
    label: "Mover 1 mm a la izquierda (10 mm con ⇧)",
    group: "Edición",
    keys: { key: "arrowleft", shift: "any", show: "←" },
  },
  { id: "nudgeRight", label: "Mover 1 mm a la derecha", group: "Edición", keys: { key: "arrowright", shift: "any", show: "→" } },
  { id: "nudgeUp", label: "Mover 1 mm hacia arriba", group: "Edición", keys: { key: "arrowup", shift: "any", show: "↑" } },
  { id: "nudgeDown", label: "Mover 1 mm hacia abajo", group: "Edición", keys: { key: "arrowdown", shift: "any", show: "↓" } },

  { id: "toolSelect", label: "Selección", group: "Herramientas", keys: { key: "v" } },
  { id: "toolText", label: "Texto", group: "Herramientas", keys: { key: "t" } },
  { id: "toolRect", label: "Rectángulo", group: "Herramientas", keys: { key: "r" } },
  { id: "toolEllipse", label: "Elipse", group: "Herramientas", keys: { key: "o" } },
  { id: "toolLine", label: "Línea", group: "Herramientas", keys: { key: "l" } },
  { id: "toolImage", label: "Imagen", group: "Herramientas", keys: { key: "i" } },
  { id: "toolHand", label: "Mano", group: "Herramientas", keys: { key: "h" } },

  { id: "zoomIn", label: "Acercar", group: "Vista", keys: { key: ["+", "="], mod: true, show: "+" } },
  { id: "zoomOut", label: "Alejar", group: "Vista", keys: { key: ["-", "_"], mod: true, show: "−" } },
  { id: "zoomReset", label: "Zoom al 100 %", group: "Vista", keys: { key: "0", mod: true } },
  { id: "zoomFit", label: "Ajustar la página a la ventana", group: "Vista", keys: { key: "1", mod: true } },
  { id: "toggleRulers", label: "Enseñar u ocultar las reglas", group: "Vista", keys: { key: "r", shift: true } },

  { id: "help", label: "Ver todos los atajos", group: "Ayuda", keys: { key: ["/", "?"], mod: true, show: "/" } },
] as const satisfies ReadonlyArray<Omit<Shortcut, "id" | "group"> & { id: string; group: Group }>;

/** El id de cada atajo. */
export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

/** Si la app corre en macOS, según el webview. */
export function isMac(platform: string = navigator.userAgent): boolean {
  return /Mac|iPhone|iPad/.test(platform);
}

/** Si esas teclas son las del evento. */
function pressed(keys: Keys, event: KeyPress, mac: boolean): boolean {
  const wanted = Array.isArray(keys.key) ? keys.key : [keys.key];
  if (!wanted.includes(event.key.toLowerCase())) {
    return false;
  }
  const shift = keys.shift === "any" || event.shiftKey === (keys.shift === true);
  if (!shift || event.altKey !== (keys.alt === true)) {
    return false;
  }
  if (keys.mod !== true) {
    // Una tecla suelta es suelta de verdad: ni ⌘ ni Ctrl.
    return !event.metaKey && !event.ctrlKey;
  }
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** El atajo que pide un evento, o `null` si no es ninguno. */
export function shortcutFor(event: KeyPress, mac: boolean): ShortcutId | null {
  for (const shortcut of SHORTCUTS) {
    const also = "alsoOnOthers" in shortcut ? (shortcut.alsoOnOthers as Keys | undefined) : undefined;
    if (pressed(shortcut.keys, event, mac) || (!mac && also !== undefined && pressed(also, event, mac))) {
      return shortcut.id;
    }
  }
  return null;
}

/** Un atajo por su id. */
export function shortcut(id: ShortcutId): Shortcut {
  // SHORTCUTS los tiene todos: la búsqueda no falla.
  return (SHORTCUTS.find((candidate) => candidate.id === id) ?? SHORTCUTS[0]) as Shortcut;
}

/** Cómo se escribe una tecla suelta: «Esc», «←», «R». */
function keyName(keys: Keys): string {
  if (keys.show !== undefined) {
    return keys.show;
  }
  const first = Array.isArray(keys.key) ? (keys.key[0] ?? "") : keys.key;
  return first.length === 1 ? first.toUpperCase() : first;
}

/**
 * Cómo se enseña un atajo: «⌘⇧E» en macOS, «Ctrl+Shift+E» en el resto.
 */
export function shortcutLabel(id: ShortcutId, mac: boolean): string {
  const { keys } = shortcut(id);
  const parts: string[] = [];
  if (keys.mod === true) {
    parts.push(mac ? "⌘" : "Ctrl");
  }
  if (keys.alt === true) {
    parts.push(mac ? "⌥" : "Alt");
  }
  if (keys.shift === true) {
    parts.push(mac ? "⇧" : "Shift");
  }
  parts.push(keyName(keys));
  return mac ? parts.join("") : parts.join("+");
}

/**
 * Si el foco está en un sitio donde se escribe. Ahí solo valen los atajos
 * con modificador: una letra suelta es texto.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Si un atajo se puede disparar mientras se escribe en un campo. */
export function worksWhileTyping(id: ShortcutId): boolean {
  return shortcut(id).keys.mod === true && id !== "undo" && id !== "redo";
}
