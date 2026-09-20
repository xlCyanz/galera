/**
 * Atajos de teclado.
 *
 * Se comprueban con funciones puras, sin tocar el DOM, para poder probarlos.
 * En macOS el modificador es ⌘; en Windows y Linux, Ctrl.
 */

/** Lo que hace falta de un evento de teclado para reconocer un atajo. */
export type KeyPress = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** Si la app corre en macOS, según el webview. */
export function isMac(platform: string = navigator.userAgent): boolean {
  return /Mac|iPhone|iPad/.test(platform);
}

/**
 * Exportar a PDF: ⌘⇧E en macOS, Ctrl+Shift+E en Windows y Linux.
 *
 * Con Shift, como en otros editores de diseño, para dejar ⌘E libre.
 */
export function isExportPdfShortcut(event: KeyPress, mac: boolean): boolean {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier && event.shiftKey && !event.altKey && event.key.toLowerCase() === "e";
}

/**
 * Guardar: ⌘S en macOS, Ctrl+S en Windows y Linux. Con Shift, «guardar
 * como».
 */
export function isSaveShortcut(event: KeyPress, mac: boolean): boolean {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "s";
}

/** Cómo se escribe el atajo de guardar. */
export function saveShortcutLabel(mac: boolean): string {
  return mac ? "⌘S" : "Ctrl+S";
}

/** Cómo se escribe el atajo de exportar, para enseñarlo en la interfaz. */
export function exportPdfShortcutLabel(mac: boolean): string {
  return mac ? "⌘⇧E" : "Ctrl+Shift+E";
}

/** Lo que pide un atajo de zoom. */
export type ZoomCommand = "in" | "out" | "reset" | "fit";

/**
 * Atajos de zoom, con ⌘ en macOS y Ctrl en Windows y Linux:
 *
 * - `+` o `=`: acercar. Se acepta `=` para no tener que pulsar Shift en los
 *   teclados donde `+` está encima.
 * - `-`: alejar.
 * - `0`: 100 %.
 * - `1`: ajustar a la ventana.
 */
export function zoomShortcut(event: KeyPress, mac: boolean): ZoomCommand | null {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey) {
    return null;
  }
  switch (event.key) {
    case "+":
    case "=":
      return "in";
    case "-":
    case "_":
      return "out";
    case "0":
      return "reset";
    case "1":
      return "fit";
    default:
      return null;
  }
}

/** Cómo se escribe cada atajo de zoom, para enseñarlo en la interfaz. */
export function zoomShortcutLabel(command: ZoomCommand, mac: boolean): string {
  const key = { in: "+", out: "-", reset: "0", fit: "1" }[command];
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/** Lo que pide un atajo del historial. */
export type HistoryCommand = "undo" | "redo";

/**
 * Deshacer y rehacer: ⌘Z y ⌘⇧Z en macOS; Ctrl+Z y Ctrl+Shift+Z (o Ctrl+Y)
 * en Windows y Linux.
 */
export function historyShortcut(event: KeyPress, mac: boolean): HistoryCommand | null {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  if (key === "y" && !mac && !event.shiftKey) {
    return "redo";
  }
  return null;
}

/** Cómo se escribe cada atajo del historial, para enseñarlo en la interfaz. */
export function historyShortcutLabel(command: HistoryCommand, mac: boolean): string {
  if (command === "undo") {
    return mac ? "⌘Z" : "Ctrl+Z";
  }
  return mac ? "⌘⇧Z" : "Ctrl+Shift+Z";
}

/**
 * Enseñar u ocultar las reglas: ⇧R, como en otros editores de diseño. Sin
 * ⌘ ni Ctrl, así que quien lo atiende tiene que ignorarlo mientras se
 * escribe.
 */
export function isToggleRulersShortcut(event: KeyPress): boolean {
  return (
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    event.key.toLowerCase() === "r"
  );
}

/** Cómo se escribe el atajo de las reglas. */
export const TOGGLE_RULERS_LABEL = "⇧R";

/**
 * Si el foco está en un sitio donde se escribe. Los atajos sin ⌘ ni Ctrl
 * (Espacio, ⇧R) no se atienden ahí.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}
