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

/** Cómo se escribe el atajo de exportar, para enseñarlo en la interfaz. */
export function exportPdfShortcutLabel(mac: boolean): string {
  return mac ? "⌘⇧E" : "Ctrl+Shift+E";
}
